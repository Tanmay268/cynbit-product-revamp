import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { PrismaAuditRepository } from './services/audit-repository.js';
import { AuditService } from './services/audit-service.js';
import { PrismaLeadRepository } from './services/lead-repository.js';
import { LeadService } from './services/lead-service.js';
import { createInfrastructure } from './services/infrastructure.js';

const env = loadEnv();
const infra = createInfrastructure(env);
const audits = new AuditService({ repo: new PrismaAuditRepository(infra.prisma), queue: infra });
const app = createApp({ env, health: infra, audits, leads: new LeadService({ repo: new PrismaLeadRepository(infra.prisma) }) });

const server = app.listen(env.API_PORT, () => {
  console.log(`[api] listening on :${env.API_PORT} (${env.NODE_ENV})`);
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close();
  await infra.close().catch(() => undefined);
  process.exit(0);
}
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => void shutdown());
