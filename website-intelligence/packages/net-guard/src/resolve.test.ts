import { describe, expect, it } from 'vitest';
import { createGuardedLookup, resolvePublicAddresses } from './resolve.js';

const stub = (answers: { address: string; family: number }[]) => async () => answers;

describe('resolvePublicAddresses', () => {
  it('returns addresses when all are public', async () => {
    const r = await resolvePublicAddresses('example.com', {
      lookup: stub([{ address: '93.184.216.34', family: 4 }, { address: '2606:2800:220:1::1', family: 6 }]),
    });
    expect(r).toEqual(['93.184.216.34', '2606:2800:220:1::1']);
  });

  it('rejects when the name resolves to a private address', async () => {
    await expect(
      resolvePublicAddresses('evil.example', { lookup: stub([{ address: '10.0.0.5', family: 4 }]) }),
    ).rejects.toMatchObject({ code: 'HOST_NOT_ALLOWED' });
  });

  it('rejects a MIXED answer (one public, one private): all records must be public', async () => {
    await expect(
      resolvePublicAddresses('mixed.example', {
        lookup: stub([{ address: '93.184.216.34', family: 4 }, { address: '169.254.169.254', family: 4 }]),
      }),
    ).rejects.toMatchObject({ code: 'HOST_NOT_ALLOWED' });
  });

  it('rejects names that resolve to IPv4-mapped loopback', async () => {
    await expect(
      resolvePublicAddresses('sneaky.example', { lookup: stub([{ address: '::ffff:127.0.0.1', family: 6 }]) }),
    ).rejects.toMatchObject({ code: 'HOST_NOT_ALLOWED' });
  });

  it('maps resolver failures and empty answers to DNS_FAILURE without leaking the cause', async () => {
    await expect(
      resolvePublicAddresses('nope.example', {
        lookup: async () => {
          throw Object.assign(new Error('getaddrinfo ENOTFOUND nope.example 10.0.0.2'), { code: 'ENOTFOUND' });
        },
      }),
    ).rejects.toMatchObject({ code: 'DNS_FAILURE', message: 'That domain could not be found.' });
    await expect(resolvePublicAddresses('empty.example', { lookup: stub([]) })).rejects.toMatchObject({ code: 'DNS_FAILURE' });
  });

  it('checks literal IPs without a DNS lookup', async () => {
    const lookup = async () => {
      throw new Error('should not be called');
    };
    await expect(resolvePublicAddresses('127.0.0.1', { lookup })).rejects.toMatchObject({ code: 'HOST_NOT_ALLOWED' });
    await expect(resolvePublicAddresses('8.8.8.8', { lookup })).resolves.toEqual(['8.8.8.8']);
  });
});

describe('createGuardedLookup (connection-time check, DNS-rebinding defence)', () => {
  it('re-validates on EVERY call, so a name that flips from public to private is caught', async () => {
    let calls = 0;
    const lookup = createGuardedLookup({
      lookup: async () => (++calls === 1 ? [{ address: '93.184.216.34', family: 4 }] : [{ address: '127.0.0.1', family: 4 }]),
    });
    const call = (opts: { all?: boolean }) =>
      new Promise<{ err: Error | null; address: unknown }>((resolve) =>
        lookup('rebind.example', opts, (err, address) => resolve({ err, address })),
      );

    const first = await call({});
    expect(first.err).toBeNull();
    expect(first.address).toBe('93.184.216.34');

    const second = await call({});
    expect(second.err).toMatchObject({ code: 'HOST_NOT_ALLOWED' });
    expect(second.address).toBeUndefined();
  });

  it('supports the {all: true} calling convention used by autoSelectFamily', async () => {
    const lookup = createGuardedLookup({ lookup: stub([{ address: '93.184.216.34', family: 4 }]) });
    const r = await new Promise((resolve) => lookup('a.example', { all: true }, (_e, a) => resolve(a)));
    expect(r).toEqual([{ address: '93.184.216.34', family: 4 }]);
  });
});
