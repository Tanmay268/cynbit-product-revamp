import http from 'node:http';
import https from 'node:https';
import type { Readable } from 'node:stream';
import zlib from 'node:zlib';
import { createGuardedLookup, type ResolveOptions } from './resolve.js';
import { normalizeUrl, UrlValidationError, type NormalizeOptions } from './url.js';

export type SafeFetchErrorCode =
  | 'BLOCKED'
  | 'TLS'
  | 'TIMEOUT'
  | 'TOO_MANY_REDIRECTS'
  | 'INVALID_REDIRECT'
  | 'NETWORK'
  | 'ABORTED';

/** Messages are safe to show to end users; low-level detail is deliberately dropped. */
export class SafeFetchError extends Error {
  constructor(
    public readonly code: SafeFetchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SafeFetchError';
  }
}

export interface SafeFetchConfig extends ResolveOptions, Pick<NormalizeOptions, 'allowedPorts'> {
  userAgent?: string;
}

export interface SafeFetchOptions {
  method?: 'GET' | 'HEAD';
  /** Wall-clock budget for the whole request including redirects. Default 15s. */
  timeoutMs?: number;
  /** Decompressed body cap; the body is truncated (truncated=true) beyond it. Default 5 MiB. */
  maxBytes?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface SafeFetchResponse {
  /** Final URL after redirects. */
  url: string;
  status: number;
  /** Lowercased names; set-cookie is always an array. */
  headers: Record<string, string | string[]>;
  body: Buffer;
  truncated: boolean;
  redirects: { from: string; to: string; status: number }[];
  durationMs: number;
}

export type SafeFetch = (url: string, options?: SafeFetchOptions) => Promise<SafeFetchResponse>;

const DEFAULTS = { timeoutMs: 15_000, maxBytes: 5 * 1024 * 1024, maxRedirects: 5 };
const IDLE_SOCKET_TIMEOUT_MS = 10_000;
const FORBIDDEN_REQUEST_HEADERS = new Set(['host', 'cookie', 'authorization', 'proxy-authorization']);

/**
 * The ONLY way audit code should touch a user-supplied website. Guarantees:
 *  - http/https, standard ports only (via normalizeUrl) on the first request AND every redirect hop
 *  - connection-time DNS validation of every address (rebinding-safe; see createGuardedLookup)
 *  - no ambient proxy, cookies, or credentials are ever sent
 *  - hard caps on total time, idle time, redirects, header size and decompressed body size
 */
export function createSafeFetch(config: SafeFetchConfig = {}): SafeFetch {
  const lookup = createGuardedLookup(config);
  const normalizeOptions: NormalizeOptions = {
    allowedPorts: config.allowedPorts,
    isBlockedIp: config.isBlockedIp,
  };

  return async function safeFetch(input, options = {}) {
    const started = Date.now();
    const timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
    const maxBytes = options.maxBytes ?? DEFAULTS.maxBytes;
    const maxRedirects = options.maxRedirects ?? DEFAULTS.maxRedirects;
    const method = options.method ?? 'GET';

    const deadline = AbortSignal.timeout(timeoutMs);
    const signal = options.signal ? AbortSignal.any([deadline, options.signal]) : deadline;

    const headers: Record<string, string> = {
      'user-agent': config.userAgent ?? 'WebsiteIntelligenceBot/1.0',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-encoding': 'gzip, deflate, br',
    };
    for (const [k, v] of Object.entries(options.headers ?? {})) {
      if (!FORBIDDEN_REQUEST_HEADERS.has(k.toLowerCase())) headers[k.toLowerCase()] = v;
    }

    let current = normalizeOrBlock(input, normalizeOptions);
    const redirects: SafeFetchResponse['redirects'] = [];

    for (let hop = 0; ; hop++) {
      const res = await requestOnce(current.href, { method, headers, maxBytes, signal, lookup });

      const location = res.headers['location'];
      if (res.status >= 300 && res.status < 400 && typeof location === 'string') {
        if (hop >= maxRedirects) throw new SafeFetchError('TOO_MANY_REDIRECTS', 'The website redirected too many times.');
        let target: string;
        try {
          target = new URL(location, current.href).href;
        } catch {
          throw new SafeFetchError('INVALID_REDIRECT', 'The website returned an invalid redirect.');
        }
        // Full re-validation of the redirect destination: scheme, port, host, literal IPs.
        // (Resolved IPs are validated again at connect time by the guarded lookup.)
        const next = normalizeOrBlock(target, normalizeOptions);
        redirects.push({ from: current.href, to: next.href, status: res.status });
        current = next;
        continue;
      }

      return {
        url: current.href,
        status: res.status,
        headers: res.headers,
        body: res.body,
        truncated: res.truncated,
        redirects,
        durationMs: Date.now() - started,
      };
    }
  };
}

function normalizeOrBlock(url: string, options: NormalizeOptions) {
  try {
    return normalizeUrl(url, options);
  } catch (err) {
    if (err instanceof UrlValidationError) throw new SafeFetchError('BLOCKED', err.message);
    throw new SafeFetchError('NETWORK', 'Could not connect to the website.');
  }
}

interface Hop {
  status: number;
  headers: Record<string, string | string[]>;
  body: Buffer;
  truncated: boolean;
}

function requestOnce(
  url: string,
  o: {
    method: 'GET' | 'HEAD';
    headers: Record<string, string>;
    maxBytes: number;
    signal: AbortSignal;
    lookup: ReturnType<typeof createGuardedLookup>;
  },
): Promise<Hop> {
  return new Promise<Hop>((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === 'https:' ? https : http;
    let settled = false;
    const ok = (v: Hop) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    const fail = (e: unknown) => {
      if (!settled) {
        settled = true;
        reject(mapFetchError(e, o.signal));
      }
    };

    const req = transport.request(
      target,
      {
        method: o.method,
        headers: o.headers,
        agent: false, // fresh connection per hop: no pooled socket can skip the guarded lookup
        lookup: o.lookup as never,
        signal: o.signal,
        timeout: IDLE_SOCKET_TIMEOUT_MS,
        maxHeaderSize: 32 * 1024,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const headers = normalizeHeaders(res.headers);

        if (o.method === 'HEAD' || (status >= 300 && status < 400)) {
          res.resume();
          ok({ status, headers, body: Buffer.alloc(0), truncated: false });
          req.destroy();
          return;
        }

        let stream: Readable = res;
        const encoding = String(res.headers['content-encoding'] ?? '').toLowerCase().trim();
        if (encoding === 'gzip' || encoding === 'x-gzip') stream = res.pipe(zlib.createGunzip());
        else if (encoding === 'deflate') stream = res.pipe(zlib.createInflate());
        else if (encoding === 'br') stream = res.pipe(zlib.createBrotliDecompress());

        const chunks: Buffer[] = [];
        let total = 0;
        let truncated = false;
        const finish = () => {
          ok({ status, headers, body: Buffer.concat(chunks), truncated });
          req.destroy();
        };

        // The cap applies to DECOMPRESSED bytes, so a small gzip bomb cannot exhaust memory.
        stream.on('data', (chunk: Buffer) => {
          if (truncated) return;
          const remaining = o.maxBytes - total;
          if (chunk.length > remaining) {
            chunks.push(chunk.subarray(0, remaining));
            total = o.maxBytes;
            truncated = true;
            finish();
          } else {
            chunks.push(chunk);
            total += chunk.length;
          }
        });
        stream.on('end', finish);
        stream.on('error', (e) => (truncated ? finish() : fail(e)));
        res.on('error', (e) => (truncated ? finish() : fail(e)));
        res.on('close', () => {
          if (!res.complete && !settled) fail(new SafeFetchError('NETWORK', 'The connection closed unexpectedly.'));
        });
      },
    );

    req.on('timeout', () => req.destroy(new SafeFetchError('TIMEOUT', 'The website took too long to respond.')));
    req.on('error', fail);
    req.end();
  });
}

function normalizeHeaders(raw: http.IncomingHttpHeaders): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    out[name.toLowerCase()] = name.toLowerCase() === 'set-cookie' ? ([] as string[]).concat(value) : Array.isArray(value) ? value.join(', ') : value;
  }
  return out;
}

const TLS_ERRORS: Record<string, string> = {
  CERT_HAS_EXPIRED: 'has expired',
  CERT_NOT_YET_VALID: 'is not yet valid',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'is self-signed',
  SELF_SIGNED_CERT_IN_CHAIN: 'is signed by an untrusted authority',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'could not be verified (incomplete certificate chain)',
  UNABLE_TO_GET_ISSUER_CERT: 'could not be verified (unknown issuer)',
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'could not be verified (unknown issuer)',
  ERR_TLS_CERT_ALTNAME_INVALID: 'does not match the domain name',
  CERT_REVOKED: 'has been revoked',
};

/** Exported for tests. Converts low-level errors into SafeFetchErrors whose messages are safe for end users. */
export function mapFetchError(err: unknown, signal: AbortSignal): SafeFetchError {
  if (err instanceof SafeFetchError) return err;
  let e: unknown = err;
  for (let depth = 0; depth < 3 && e; depth++) {
    if (e instanceof SafeFetchError) return e;
    if (e instanceof UrlValidationError) return new SafeFetchError('BLOCKED', e.message);
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && TLS_ERRORS[code]) {
      return new SafeFetchError('TLS', `The website's HTTPS certificate ${TLS_ERRORS[code]}.`);
    }
    e = (e as { cause?: unknown }).cause;
  }
  if (signal.aborted) {
    const reason = signal.reason as { name?: string } | undefined;
    return reason?.name === 'TimeoutError'
      ? new SafeFetchError('TIMEOUT', 'The website took too long to respond.')
      : new SafeFetchError('ABORTED', 'The request was cancelled.');
  }
  return new SafeFetchError('NETWORK', 'Could not connect to the website.');
}
