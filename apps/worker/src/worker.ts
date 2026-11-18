import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { createSafeFetch, type SafeFetch } from '@wi/net-guard';
import { createAnalyzers } from './analyzers/registry.js';
import { loadWorkerEnv } from './config/env.js';
import { startAuditWorker } from './jobs/audit-job.js';
import { PlaywrightAxeRunner } from './services/browser.js';
import { createPageSpeedLoader } from './services/pagespeed.js';
import { PrismaAuditStore } from './services/prisma-audit-store.js';

const env = loadWorkerEnv();

const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
const connection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null, // required by BullMQ for blocking commands
  retryStrategy: (attempt) => Math.min(attempt * 200, 5_000),
});
let lastWarn = 0;
connection.on('error', (err) => {
  if (Date.now() - lastWarn > 30_000) {
    lastWarn = Date.now();
    console.warn(`[worker] redis unavailable: ${err.name}`);
  }
});

const safeFetch = createSafeFetch({ userAgent: 'WebsiteIntelligenceBot/1.0' });
const auditFetch: SafeFetch = (url, opts) => safeFetch(url, { maxBytes: env.MAX_RESPONSE_BYTES, ...opts });
// The browser gets the same guarded fetch as the analyzers: it never touches the network directly.
const browser = new PlaywrightAxeRunner({ noSandbox: env.BROWSER_NO_SANDBOX, fetch: auditFetch });
const analyzers = createAnalyzers({ axeRunner: browser });
const pagespeed = createPageSpeedLoader({ apiKey: env.PAGESPEED_API_KEY });

const worker = startAuditWorker({
  connection,
  concurrency: env.WORKER_CONCURRENCY,
  deps: {
    store: new PrismaAuditStore(prisma),
    analyzers,
    fetch: auditFetch,
    pagespeed,
    analyzerTimeoutMs: env.AUDIT_TIMEOUT_MS,
  },
});

console.log(
  `[worker] ready (concurrency=${env.WORKER_CONCURRENCY}, analyzers=${analyzers.length}, ` +
    `pagespeedKey=${env.PAGESPEED_API_KEY ? 'set' : 'missing'}, browserSandbox=${env.BROWSER_NO_SANDBOX ? 'off' : 'on'})`,
);

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await worker.close().catch(() => undefined); // waits for in-flight jobs
  await browser.close();
  connection.disconnect();
  await prisma.$disconnect().catch(() => undefined);
  process.exit(0);
}
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => void shutdown());
