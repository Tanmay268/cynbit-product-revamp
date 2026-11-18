export interface RobotsInfo {
  sitemaps: string[];
  /** True when a "User-agent: *" group disallows the entire site ("Disallow: /") without an "Allow: /" override. */
  blocksAll: boolean;
}

/** Minimal robots.txt parser covering what the audit needs (wildcard group + Sitemap lines). */
export function parseRobots(text: string): RobotsInfo {
  const sitemaps: string[] = [];
  let agents: string[] = [];
  let inRules = false;
  const wildcard = { disallowAll: false, allowAll: false };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (key === 'sitemap') {
      if (/^https?:\/\//i.test(value)) sitemaps.push(value);
    } else if (key === 'user-agent') {
      if (inRules) {
        agents = [];
        inRules = false;
      }
      agents.push(value.toLowerCase());
    } else if (key === 'disallow' || key === 'allow') {
      inRules = true;
      if (agents.includes('*')) {
        if (key === 'disallow' && value === '/') wildcard.disallowAll = true;
        if (key === 'allow' && value === '/') wildcard.allowAll = true;
      }
    }
  }
  return { sitemaps, blocksAll: wildcard.disallowAll && !wildcard.allowAll };
}
