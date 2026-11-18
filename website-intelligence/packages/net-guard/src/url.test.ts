import { describe, expect, it } from 'vitest';
import { normalizeUrl, UrlValidationError } from './url.js';

const codeOf = (input: string) => {
  try {
    normalizeUrl(input);
  } catch (e) {
    return e instanceof UrlValidationError ? e.code : `non-validation:${String(e)}`;
  }
  return 'ok';
};

describe('normalizeUrl: accepts and canonicalises', () => {
  it.each([
    ['example.com', 'https://example.com/', 'https://example.com'],
    ['  EXAMPLE.com  ', 'https://example.com/', 'https://example.com'],
    ['http://Example.com/', 'http://example.com/', 'http://example.com'],
    ['https://example.com/path/?a=1#frag', 'https://example.com/path/?a=1', 'https://example.com/path?a=1'],
    ['https://example.com:443/x', 'https://example.com/x', 'https://example.com/x'],
    ['http://example.com:80', 'http://example.com/', 'http://example.com'],
    ['https://example.com.', 'https://example.com/', 'https://example.com'],
    ['//example.com/a', 'https://example.com/a', 'https://example.com/a'],
    ['example.com:443', 'https://example.com/', 'https://example.com'],
    ['https://bücher.example/', 'https://xn--bcher-kva.example/', 'https://xn--bcher-kva.example'],
    ['https://93.184.216.34/', 'https://93.184.216.34/', 'https://93.184.216.34'],
  ])('%s', (input, href, key) => {
    const r = normalizeUrl(input);
    expect(r.href).toBe(href);
    expect(r.key).toBe(key);
  });

  it('gives equivalent spellings the same history key', () => {
    const a = normalizeUrl('Example.com').key;
    expect(normalizeUrl('https://example.com/').key).toBe(a);
    expect(normalizeUrl('https://example.com#top').key).toBe(a);
  });
});

describe('normalizeUrl: rejects', () => {
  it.each([
    ['', 'INVALID_URL'],
    ['   ', 'INVALID_URL'],
    ['a'.repeat(2050), 'URL_TOO_LONG'],
    ['http://exa mple.com', 'INVALID_URL'],
    ['https://exam\nple.com', 'INVALID_URL'],
    ['not a url', 'INVALID_URL'],
    ['https://', 'INVALID_URL'],
    // schemes
    ['javascript:alert(1)', 'UNSUPPORTED_SCHEME'],
    ['file:///etc/passwd', 'UNSUPPORTED_SCHEME'],
    ['ftp://example.com', 'UNSUPPORTED_SCHEME'],
    ['gopher://example.com', 'UNSUPPORTED_SCHEME'],
    ['data:text/html,<h1>x</h1>', 'UNSUPPORTED_SCHEME'],
    ['mailto:a@b.com', 'UNSUPPORTED_SCHEME'],
    ['http:example.com', 'UNSUPPORTED_SCHEME'],
    // credentials
    ['https://user:pass@example.com', 'CREDENTIALS_NOT_ALLOWED'],
    ['https://user@example.com', 'CREDENTIALS_NOT_ALLOWED'],
    ['https://example.com@evil.com@example.org', 'CREDENTIALS_NOT_ALLOWED'],
    // ports
    ['https://example.com:8080', 'PORT_NOT_ALLOWED'],
    ['https://example.com:22', 'PORT_NOT_ALLOWED'],
    ['http://example.com:6379', 'PORT_NOT_ALLOWED'],
    ['example.com:3000', 'PORT_NOT_ALLOWED'],
    // private / loopback hosts and literals
    ['http://localhost', 'HOST_NOT_ALLOWED'],
    ['http://LOCALHOST.', 'HOST_NOT_ALLOWED'],
    ['http://app.localhost', 'HOST_NOT_ALLOWED'],
    ['http://127.0.0.1', 'HOST_NOT_ALLOWED'],
    ['http://127.1', 'HOST_NOT_ALLOWED'],
    ['http://2130706433', 'HOST_NOT_ALLOWED'], // decimal 127.0.0.1
    ['http://0x7f000001', 'HOST_NOT_ALLOWED'], // hex 127.0.0.1
    ['http://0177.0.0.1', 'HOST_NOT_ALLOWED'], // octal 127.0.0.1
    ['http://[::1]', 'HOST_NOT_ALLOWED'],
    ['http://[::ffff:127.0.0.1]', 'HOST_NOT_ALLOWED'],
    ['http://[::ffff:7f00:1]', 'HOST_NOT_ALLOWED'],
    ['http://0.0.0.0', 'HOST_NOT_ALLOWED'],
    ['http://10.1.2.3', 'HOST_NOT_ALLOWED'],
    ['http://192.168.0.1', 'HOST_NOT_ALLOWED'],
    ['http://172.20.0.1', 'HOST_NOT_ALLOWED'],
    // cloud metadata
    ['http://169.254.169.254/latest/meta-data/', 'HOST_NOT_ALLOWED'],
    ['http://metadata.google.internal/computeMetadata/v1/', 'HOST_NOT_ALLOWED'],
    ['http://[fd00:ec2::254]/', 'HOST_NOT_ALLOWED'],
    ['http://100.100.100.200/', 'HOST_NOT_ALLOWED'],
    // single-label names only resolve on internal networks
    ['http://intranet', 'HOST_NOT_ALLOWED'],
    ['http://router', 'INVALID_URL'],
  ])('%s -> %s', (input, code) => {
    expect(codeOf(input)).toBe(code);
  });

  it('error messages never echo internals', () => {
    expect(() => normalizeUrl('http://169.254.169.254')).toThrow(/private or reserved/);
  });
});

describe('normalizeUrl options (test hooks)', () => {
  it('can allow arbitrary ports', () => {
    expect(normalizeUrl('https://example.com:8443', { allowedPorts: null }).port).toBe(8443);
  });
});
