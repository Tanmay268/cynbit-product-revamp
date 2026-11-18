import { resolvePublicAddresses } from '@wi/net-guard';
import { AUDIT_CATEGORIES, type AuditCategoryId } from '@wi/shared';
import { describe, expect, it } from 'vitest';
import { baseDeps, fakeAnalyzer, finding, InMemoryAuditStore } from './test-helpers.js';
import { runAudit } from './run-audit.js';

const all = (b: Parameters<typeof fakeAnalyzer>[1] = {}) => AUDIT_CATEGORIES.map((c) => fakeAnalyzer(c, b));

describe('runAudit: happy path', () => {
  it('completes when every analyzer succeeds and computes the weighted overall score', async () => {
    const store = new InMemoryAuditStore();
    const scores: Record<AuditCategoryId, number> = { performance: 80, seo: 100, accessibility: 60, security: 40, 'best-practices': 100 };
    const analyzers = AUDIT_CATEGORIES.map((c) => fakeAnalyzer(c, { score: scores[c] }));

    const out = await runAudit('audit-1', baseDeps(store, analyzers));

    expect(out).toEqual({ status: 'completed', overallScore: 75 }); // see shared scoring tests
    expect(store.audit.status).toBe('completed');
    expect(store.results.size).toBe(5);
  });

  it('derives the score from findings when an analyzer does not provide one', async () => {
    const store = new InMemoryAuditStore();
    const analyzers = all({ score: null, findings: [finding({ severity: 'critical', status: 'failed' }), finding({ severity: 'low', status: 'passed' })] });
    await runAudit('audit-1', baseDeps(store, analyzers));
    expect(store.results.get('seo')!.score).toBe(9); // 1 / 11
  });

  it('recomputes the summary from findings instead of trusting the analyzer', async () => {
    const store = new InMemoryAuditStore();
    const analyzers = all({ findings: [finding({ status: 'failed' })], summary: { passed: 99, failed: 0, warnings: 0 } });
    await runAudit('audit-1', baseDeps(store, analyzers));
    expect(store.results.get('seo')!.summary).toEqual({ passed: 0, failed: 1, warnings: 0 });
  });

  it('clamps out-of-range scores and forces the analyzer category', async () => {
    const store = new InMemoryAuditStore();
    const analyzers = [fakeAnalyzer('seo', { score: 250 }), { category: 'security' as const, run: async () => ({ ...(await fakeAnalyzer('seo', { score: -5 }).run({} as never)), category: 'seo' as const }) }];
    await runAudit('audit-1', baseDeps(store, analyzers));
    expect(store.results.get('seo')!.score).toBe(100);
    expect(store.results.get('security')!.category).toBe('security');
    expect(store.results.get('security')!.score).toBe(0);
  });
});

describe('runAudit: partial failures (one category must not sink the audit)', () => {
  it('a crashing analyzer fails only its own category; audit is partial', async () => {
    const store = new InMemoryAuditStore();
    const analyzers = AUDIT_CATEGORIES.map((c) =>
      c === 'accessibility'
        ? fakeAnalyzer(c, async () => {
            throw new Error('chromium exploded: /usr/lib/secret/path');
          })
        : fakeAnalyzer(c, { score: 90 }),
    );

    const out = await runAudit('audit-1', baseDeps(store, analyzers));

    expect(out).toEqual({ status: 'partial', overallScore: 90 });
    const a11y = store.results.get('accessibility')!;
    expect(a11y.status).toBe('failed');
    expect(a11y.score).toBeNull(); // failed is NOT zero
    expect(a11y.reason).toBe('The analysis failed unexpectedly.');
    expect(JSON.stringify(a11y)).not.toMatch(/chromium|secret/); // internals never reach the DB/UI
  });

  it('an analyzer that exceeds its time budget is failed, aborted, and does not block the others', async () => {
    const store = new InMemoryAuditStore();
    let aborted = false;
    const slow = {
      category: 'performance' as const,
      run: ({ signal }: { signal: AbortSignal }) =>
        new Promise<never>((_, reject) => {
          signal.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('aborted'));
          });
        }),
    };
    const analyzers = [slow, ...AUDIT_CATEGORIES.filter((c) => c !== 'performance').map((c) => fakeAnalyzer(c))];

    const started = Date.now();
    const out = await runAudit('audit-1', { ...baseDeps(store, analyzers), analyzerTimeoutMs: 100 });

    expect(Date.now() - started).toBeLessThan(2000);
    expect(aborted).toBe(true);
    expect(store.results.get('performance')).toMatchObject({ status: 'failed', reason: 'The analysis timed out.', score: null });
    expect(out!.status).toBe('partial');
  });

  it('missing credentials/analyzers are "unavailable", never a fabricated score', async () => {
    const store = new InMemoryAuditStore();
    const analyzers = [
      fakeAnalyzer('performance', { status: 'unavailable', score: null, findings: [], reason: 'PAGESPEED_API_KEY is not configured.' }),
      fakeAnalyzer('seo', { score: 70 }),
      // security / accessibility / best-practices have no analyzer registered
    ];
    const out = await runAudit('audit-1', baseDeps(store, analyzers));

    expect(store.results.get('performance')).toMatchObject({ status: 'unavailable', score: null, reason: 'PAGESPEED_API_KEY is not configured.' });
    expect(store.results.get('security')).toMatchObject({ status: 'unavailable', score: null });
    expect(out).toEqual({ status: 'partial', overallScore: 70 }); // only SEO counted; others are not zeros
  });

  it('forces score to null when an analyzer reports unavailable but still supplies a number', async () => {
    const store = new InMemoryAuditStore();
    await runAudit('audit-1', baseDeps(store, all({ status: 'unavailable', score: 55 })));
    expect(store.results.get('seo')!.score).toBeNull();
  });

  it('a completed analyzer with nothing scorable becomes unavailable (not 0, not 100)', async () => {
    const store = new InMemoryAuditStore();
    await runAudit('audit-1', baseDeps(store, all({ score: null, findings: [] })));
    expect(store.results.get('seo')).toMatchObject({ status: 'unavailable', score: null });
  });

  it('fails the audit (with a safe message) when no category produces a result', async () => {
    const store = new InMemoryAuditStore();
    const out = await runAudit('audit-1', baseDeps(store, []));
    expect(out).toEqual({ status: 'failed', overallScore: null });
    expect(store.audit.errorMessage).toBe('None of the checks could be completed for this website.');
  });

  it('surfaces user-safe network errors from safe-fetch as the category reason', async () => {
    const { SafeFetchError } = await import('@wi/net-guard');
    const store = new InMemoryAuditStore();
    const analyzers = AUDIT_CATEGORIES.map((c) =>
      c === 'seo' ? fakeAnalyzer(c, async () => { throw new SafeFetchError('TIMEOUT', 'The website took too long to respond.'); }) : fakeAnalyzer(c),
    );
    await runAudit('audit-1', baseDeps(store, analyzers));
    expect(store.results.get('seo')).toMatchObject({ status: 'failed', reason: 'The website took too long to respond.' });
  });
});

describe('runAudit: progress is real', () => {
  it('persists each category the moment it finishes, before slower ones complete', async () => {
    const store = new InMemoryAuditStore();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const analyzers = AUDIT_CATEGORIES.map((c) =>
      c === 'performance'
        ? fakeAnalyzer(c, async () => {
            await gate;
            return { category: c, status: 'completed', score: 50, findings: [finding()], summary: { passed: 1, failed: 0, warnings: 0 }, executionTimeMs: 1 };
          })
        : fakeAnalyzer(c),
    );

    const run = runAudit('audit-1', baseDeps(store, analyzers));
    await new Promise((r) => setTimeout(r, 50));

    // Four fast categories are already saved while performance is still running.
    expect(store.log.filter((l) => l.startsWith('saved:'))).toHaveLength(4);
    expect(store.log).not.toContain('saved:performance:completed');
    expect(store.audit.status).toBe('running');

    release();
    await run;
    expect(store.log.at(-1)).toBe('complete:completed');
  });
});

describe('runAudit: retries and idempotency', () => {
  it('keeps categories completed by an earlier attempt and only runs the rest', async () => {
    const store = new InMemoryAuditStore({
      status: 'running',
      categories: { seo: { status: 'completed', score: 100 }, security: { status: 'completed', score: 60 } },
    });
    const ran: string[] = [];
    const analyzers = AUDIT_CATEGORIES.map((c) =>
      fakeAnalyzer(c, async () => {
        ran.push(c);
        return { category: c, status: 'completed', score: 80, findings: [finding()], summary: { passed: 1, failed: 0, warnings: 0 }, executionTimeMs: 1 };
      }),
    );

    const out = await runAudit('audit-1', baseDeps(store, analyzers));

    expect(ran.sort()).toEqual(['accessibility', 'best-practices', 'performance']);
    expect(out!.status).toBe('completed');
    // overall includes the preserved scores: .25*80 + .2*100 + .2*80 + .2*60 + .15*80 = 80
    expect(out!.overallScore).toBe(80);
  });

  it('ignores duplicate deliveries of an already-finished audit', async () => {
    const store = new InMemoryAuditStore({ status: 'completed' });
    expect(await runAudit('audit-1', baseDeps(store, all()))).toBeNull();
    expect(store.log).toEqual([]);
  });

  it('drops jobs for audits that do not exist', async () => {
    const store = new InMemoryAuditStore();
    expect(await runAudit('missing', baseDeps(store, all()))).toBeNull();
  });

  it('rethrows infrastructure errors so BullMQ can retry', async () => {
    const store = new InMemoryAuditStore();
    store.saveCategoryResult = async () => {
      throw new Error('database unavailable');
    };
    await expect(runAudit('audit-1', baseDeps(store, all()))).rejects.toThrow('database unavailable');
    expect(store.audit.status).toBe('running'); // not marked failed: the retry will resume
  });
});

describe('runAudit: invalid / hostile targets (the queue is not trusted)', () => {
  it.each(['http://169.254.169.254/latest', 'http://localhost:6379', 'file:///etc/passwd', 'https://user:pw@example.com'])(
    'fails %s permanently without running any analyzer',
    async (targetUrl) => {
      const store = new InMemoryAuditStore({ targetUrl });
      let called = false;
      const analyzers = AUDIT_CATEGORIES.map((c) => fakeAnalyzer(c, async () => { called = true; throw new Error('x'); }));

      const out = await runAudit('audit-1', baseDeps(store, analyzers));

      expect(out).toEqual({ status: 'failed', overallScore: null });
      expect(called).toBe(false);
      expect(store.audit.errorMessage).toBeTruthy();
      expect(store.log).toEqual(['fail']);
    },
  );

  it('fails when DNS now resolves to a private address (rebinding between submission and execution)', async () => {
    const store = new InMemoryAuditStore({ targetUrl: 'https://was-public.example' });
    const out = await runAudit('audit-1', {
      ...baseDeps(store, all()),
      resolveHost: (h) => resolvePublicAddresses(h, { lookup: async () => [{ address: '192.168.1.10', family: 4 }] }),
    });
    expect(out!.status).toBe('failed');
    expect(store.audit.errorMessage).toMatch(/private or reserved/);
    expect(store.results.size).toBe(0);
  });

  it('a DNS failure is a permanent user-facing failure', async () => {
    const store = new InMemoryAuditStore({ targetUrl: 'https://nonexistent.example' });
    await runAudit('audit-1', {
      ...baseDeps(store, all()),
      resolveHost: (h) => resolvePublicAddresses(h, { lookup: async () => { throw new Error('ENOTFOUND'); } }),
    });
    expect(store.audit.errorMessage).toBe('That domain could not be found.');
  });
});
