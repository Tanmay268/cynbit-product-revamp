import { isIP } from 'node:net';
import { isBlockedHostname, isBlockedIp } from './ip.js';

export type UrlErrorCode =
  | 'INVALID_URL'
  | 'URL_TOO_LONG'
  | 'UNSUPPORTED_SCHEME'
  | 'CREDENTIALS_NOT_ALLOWED'
  | 'PORT_NOT_ALLOWED'
  | 'HOST_NOT_ALLOWED'
  | 'DNS_FAILURE';

/** Messages are written for end users: no internals, safe to return from the API. */
export class UrlValidationError extends Error {
  constructor(
    public readonly code: UrlErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'UrlValidationError';
  }
}

export interface NormalizeOptions {
  /** Ports that may be contacted. null disables the check (tests only). Default [80, 443]. */
  allowedPorts?: readonly number[] | null;
  /** Override the IP deny-list (tests only). */
  isBlockedIp?: (ip: string) => boolean;
}

export interface NormalizedUrl {
  /** Fetchable absolute URL (scheme, lowercased/punycode host, no fragment, default port dropped). */
  href: string;
  /** Canonical key for history/comparison: no fragment, no trailing slash. */
  key: string;
  hostname: string;
  port: number;
  protocol: 'http:' | 'https:';
}

export const MAX_URL_LENGTH = 2048;
const DEFAULT_PORTS = [80, 443] as const;

export function normalizeUrl(input: string, options: NormalizeOptions = {}): NormalizedUrl {
  const blockedIp = options.isBlockedIp ?? isBlockedIp;
  const allowedPorts = options.allowedPorts === undefined ? DEFAULT_PORTS : options.allowedPorts;

  const raw = input.trim();
  if (!raw) throw new UrlValidationError('INVALID_URL', 'Enter a website URL.');
  if (raw.length > MAX_URL_LENGTH) throw new UrlValidationError('URL_TOO_LONG', 'That URL is too long.');
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(raw)) throw new UrlValidationError('INVALID_URL', 'That URL contains invalid characters.');

  let candidate = raw;
  if (candidate.startsWith('//')) {
    candidate = `https:${candidate}`;
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(candidate)) {
    if (/^https?:\/\//i.test(candidate)) {
      // fine
    } else if (/^[a-z0-9.-]+:\d+(\/|\?|#|$)/i.test(candidate)) {
      candidate = `https://${candidate}`; // "example.com:8080"
    } else {
      throw new UrlValidationError('UNSUPPORTED_SCHEME', 'Only http:// and https:// websites can be analyzed.');
    }
  } else {
    candidate = `https://${candidate}`;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new UrlValidationError('INVALID_URL', 'That does not look like a valid website URL.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UrlValidationError('UNSUPPORTED_SCHEME', 'Only http:// and https:// websites can be analyzed.');
  }
  if (url.username || url.password) {
    throw new UrlValidationError('CREDENTIALS_NOT_ALLOWED', 'URLs containing a username or password are not allowed.');
  }

  // The WHATWG parser already canonicalises odd IPv4 spellings (2130706433, 0x7f.1, 127.1 -> 127.0.0.1).
  const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!hostname) throw new UrlValidationError('INVALID_URL', 'That does not look like a valid website URL.');

  if (isIP(hostname)) {
    if (blockedIp(hostname)) throw hostNotAllowed();
  } else {
    if (isBlockedHostname(hostname)) throw hostNotAllowed();
    // Single-label hosts ("intranet", "router") only resolve on private networks.
    if (!hostname.includes('.')) throw new UrlValidationError('INVALID_URL', 'Enter a full domain name, like example.com.');
  }

  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  if (allowedPorts && !allowedPorts.includes(port)) {
    throw new UrlValidationError('PORT_NOT_ALLOWED', 'Only standard web ports (80 and 443) are supported.');
  }

  url.hash = '';
  url.hostname = hostname.includes(':') ? `[${hostname}]` : hostname;

  const pathname = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
  const key = `${url.protocol}//${url.host}${pathname}${url.search}`;

  return { href: url.href, key, hostname, port, protocol: url.protocol };
}

const hostNotAllowed = () =>
  new UrlValidationError('HOST_NOT_ALLOWED', 'That address is private or reserved, so it cannot be analyzed.');
