import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';
import { computeMonthlyTotals } from '@/lib/finance';
import type { Payment } from '@kit-manager/types';

function makePayment(overrides: Partial<Payment>): Payment {
  return {
    id: crypto.randomUUID(),
    tenantId: 'tenant-1',
    month: '2026-04',
    amount: 1000,
    status: 'paid',
    description: null,
    type: 'income',
    paidAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('computeMonthlyTotals', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-24T10:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('returns last N months in ascending order', () => {
    const result = computeMonthlyTotals([], 3);
    expect(result).toHaveLength(3);
    expect(result[0].month).toBe('Fev');
    expect(result[1].month).toBe('Mar');
    expect(result[2].month).toBe('Abr');
  });

  test('sums revenue (paid) per month', () => {
    const payments = [
      makePayment({ status: 'paid', amount: 1200, month: '2026-04' }),
      makePayment({ status: 'paid', amount: 800, month: '2026-04' }),
      makePayment({ status: 'paid', amount: 500, month: '2026-03' }),
    ];
    const result = computeMonthlyTotals(payments, 3);
    const apr = result.find((r) => r.month === 'Abr')!;
    const mar = result.find((r) => r.month === 'Mar')!;
    expect(apr.revenue).toBe(2000);
    expect(mar.revenue).toBe(500);
  });

  test('sums overdue per month', () => {
    const payments = [
      makePayment({ status: 'overdue', amount: 700, month: '2026-03' }),
      makePayment({ status: 'overdue', amount: 300, month: '2026-03' }),
    ];
    const result = computeMonthlyTotals(payments, 3);
    const mar = result.find((r) => r.month === 'Mar')!;
    expect(mar.overdue).toBe(1000);
  });

  test('months with no payments have zero revenue and overdue', () => {
    const result = computeMonthlyTotals([], 6);
    for (const m of result) {
      expect(m.revenue).toBe(0);
      expect(m.overdue).toBe(0);
    }
  });

  test('ignores payments outside the window', () => {
    const payments = [
      makePayment({ status: 'paid', amount: 999, month: '2025-01' }),
    ];
    const result = computeMonthlyTotals(payments, 3);
    const total = result.reduce((s, r) => s + r.revenue, 0);
    expect(total).toBe(0);
  });
});
