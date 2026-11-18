import { describe, expect, it } from 'vitest';
import { isDatabaseUnavailable } from '../middleware/error-handler.js';
import { withDbTimeouts } from './infrastructure.js';

describe('withDbTimeouts', () => {
  it('adds fail-fast timeouts', () => {
    const u = new URL(withDbTimeouts('postgresql://u:p@localhost:5432/db'));
    expect(u.searchParams.get('connect_timeout')).toBe('3');
    expect(u.searchParams.get('pool_timeout')).toBe('3');
  });
  it('never overrides explicit settings', () => {
    const u = new URL(withDbTimeouts('postgresql://u:p@h/db?connect_timeout=20&schema=x'));
    expect(u.searchParams.get('connect_timeout')).toBe('20');
    expect(u.searchParams.get('schema')).toBe('x');
  });
});

describe('isDatabaseUnavailable', () => {
  it('recognises Prisma connection failures only', () => {
    expect(isDatabaseUnavailable({ name: 'PrismaClientInitializationError' })).toBe(true);
    expect(isDatabaseUnavailable({ code: 'P1001' })).toBe(true);
    expect(isDatabaseUnavailable({ code: 'P2024' })).toBe(true);
    expect(isDatabaseUnavailable({ code: 'P2002' })).toBe(false); // unique constraint: a different problem
    expect(isDatabaseUnavailable(new Error('boom'))).toBe(false);
    expect(isDatabaseUnavailable(null)).toBe(false);
  });
});
