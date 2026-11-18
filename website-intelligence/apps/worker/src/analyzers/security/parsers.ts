/** Parses a CSP header into directive -> source list (directive names lowercased, first occurrence wins per the spec). */
export function parseCsp(value: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const part of value.split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    const name = tokens.shift()?.toLowerCase();
    if (name && !out.has(name)) out.set(name, tokens.map((t) => t.toLowerCase()));
  }
  return out;
}

export function parseHstsMaxAge(value: string): number | null {
  const m = /max-age\s*=\s*"?(\d+)"?/i.exec(value);
  return m ? Number(m[1]) : null;
}

export interface ParsedCookie {
  name: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string | null;
}

/** Parses Set-Cookie header values. Cookie VALUES are intentionally discarded and never stored or logged. */
export function parseCookies(setCookie: string[]): ParsedCookie[] {
  return setCookie.map((line) => {
    const [pair = '', ...attrs] = line.split(';').map((s) => s.trim());
    const lower = attrs.map((a) => a.toLowerCase());
    const sameSite = lower.find((a) => a.startsWith('samesite='));
    return {
      name: pair.split('=')[0]?.trim() || '(unnamed)',
      secure: lower.includes('secure'),
      httpOnly: lower.includes('httponly'),
      sameSite: sameSite ? sameSite.slice('samesite='.length) : null,
    };
  });
}
