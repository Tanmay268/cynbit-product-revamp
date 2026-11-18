export const AUDIT_QUEUE_NAME = 'audit';

/** Payload placed on the BullMQ audit queue. Only the id: the worker loads the rest from Postgres. */
export interface AuditJobData {
  auditId: string;
}
