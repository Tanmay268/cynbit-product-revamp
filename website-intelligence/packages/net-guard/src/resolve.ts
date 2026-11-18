import dns from 'node:dns';
import { isIP } from 'node:net';
import { isBlockedIp } from './ip.js';
import { UrlValidationError } from './url.js';

export interface ResolveOptions {
  /** Resolver returning ALL address records. Injected in tests. */
  lookup?: (hostname: string) => Promise<{ address: string; family: number }[]>;
  isBlockedIp?: (ip: string) => boolean;
}

const defaultLookup: NonNullable<ResolveOptions['lookup']> = (hostname) =>
  dns.promises.lookup(hostname, { all: true, verbatim: true });

/**
 * Resolves a hostname and requires EVERY returned address to be public.
 * Requiring all (not just the first) defeats "mixed answer" tricks where a
 * name returns one public and one private record.
 */
export async function resolvePublicAddresses(hostname: string, options: ResolveOptions = {}): Promise<string[]> {
  const blockedIp = options.isBlockedIp ?? isBlockedIp;
  const lookup = options.lookup ?? defaultLookup;

  if (isIP(hostname)) {
    if (blockedIp(hostname)) throw nonPublic();
    return [hostname];
  }

  let answers: { address: string; family: number }[];
  try {
    answers = await lookup(hostname);
  } catch {
    throw new UrlValidationError('DNS_FAILURE', 'That domain could not be found.');
  }
  if (answers.length === 0) throw new UrlValidationError('DNS_FAILURE', 'That domain could not be found.');
  if (answers.some((a) => blockedIp(a.address))) throw nonPublic();
  return answers.map((a) => a.address);
}

type LookupCallback = (err: Error | null, address?: string | { address: string; family: number }[], family?: number) => void;

/**
 * `lookup` function for http(s).request. The socket connects to exactly the
 * address this function returns, and this function validates it at connection
 * time. That closes the DNS-rebinding gap between "check" and "use": there is
 * no second, unvalidated resolution.
 */
export function createGuardedLookup(options: ResolveOptions = {}) {
  return (hostname: string, lookupOptions: { all?: boolean } | number | undefined, callback: LookupCallback) => {
    const wantsAll = typeof lookupOptions === 'object' && lookupOptions?.all === true;
    resolvePublicAddresses(hostname, options).then(
      (addresses) => {
        if (wantsAll) callback(null, addresses.map((address) => ({ address, family: isIP(address) })));
        else callback(null, addresses[0]!, isIP(addresses[0]!));
      },
      (err: Error) => callback(err),
    );
  };
}

const nonPublic = () =>
  new UrlValidationError('HOST_NOT_ALLOWED', 'That address is private or reserved, so it cannot be analyzed.');
