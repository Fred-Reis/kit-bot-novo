import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';
import { computePaymentsSummary } from '@/lib/payments';
import type { Payment } from '@kit-manager/types';

const currentMonth = '2026-04';
const prevMonth = '2026-03';

function makePayment(overrides: Partial<Payment>): Payment {
  return {
    id: crypto.randomUUID(),
    tenantId: 'tenant-1',
    month: currentMonth,
    amount: 1000,
    status: 'pending',
    description: null,
    type: 'income',
    paidAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('computePaymentsSummary', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-23T10:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('monthRevenue sums paid payments for current month', () => {
    const payments = [
      makePayment({ status: 'paid', amount: 1200, month: currentMonth }),
      makePayment({ status: 'paid', amount: 800, month: currentMonth }),
      makePayment({ status: 'paid', amount: 500, month: prevMonth }),
    ];
    const result = computePaymentsSummary(payments);
    expect(result.monthRevenue).toBe(2000);
  });

  test('prevMonthRevenue sums paid payments for previous month', () => {
    const payments = [
      makePayment({ status: 'paid', amount: 1000, month: prevMonth }),
      makePayment({ status: 'paid', amount: 500, month: prevMonth }),
    ];
    const result = computePaymentsSummary(payments);
    expect(result.prevMonthRevenue).toBe(1500);
  });

  test('overdueAmount and overdueCount count overdue payments', () => {
    const payments = [
      makePayment({ status: 'overdue', amount: 1000 }),
      makePayment({ status: 'overdue', amount: 2000 }),
      makePayment({ status: 'paid', amount: 500 }),
    ];
    const result = computePaymentsSummary(payments);
    expect(result.overdueAmount).toBe(3000);
    expect(result.overdueCount).toBe(2);
  });

  test('pendingCount counts pending payments in current month', () => {
    const payments = [
      makePayment({ status: 'pending', month: currentMonth }),
      makePayment({ status: 'pending', month: currentMonth }),
      makePayment({ status: 'pending', month: prevMonth }),
    ];
    const result = computePaymentsSummary(payments);
    expect(result.pendingCount).toBe(2);
  });

  test('delta is 0 when prevMonthRevenue is 0', () => {
    const payments = [makePayment({ status: 'paid', amount: 1000, month: currentMonth })];
    const result = computePaymentsSummary(payments);
    expect(result.delta).toBe(0);
  });

  test('delta is positive when revenue grew', () => {
    const payments = [
      makePayment({ status: 'paid', amount: 1100, month: currentMonth }),
      makePayment({ status: 'paid', amount: 1000, month: prevMonth }),
    ];
    const result = computePaymentsSummary(payments);
    expect(result.delta).toBe(10);
  });

  test('delta is negative when revenue shrank', () => {
    const payments = [
      makePayment({ status: 'paid', amount: 900, month: currentMonth }),
      makePayment({ status: 'paid', amount: 1000, month: prevMonth }),
    ];
    const result = computePaymentsSummary(payments);
    expect(result.delta).toBe(-10);
  });

  test('pendingAmount sums pending payment amounts in current month only', () => {
    const payments = [
      makePayment({ status: 'pending', amount: 1200, month: currentMonth }),
      makePayment({ status: 'pending', amount: 800, month: currentMonth }),
      makePayment({ status: 'pending', amount: 500, month: prevMonth }),
    ];
    const result = computePaymentsSummary(payments);
    expect(result.pendingAmount).toBe(2000);
  });

  test('returns zeros for empty payments list', () => {
    const result = computePaymentsSummary([]);
    expect(result.monthRevenue).toBe(0);
    expect(result.overdueAmount).toBe(0);
    expect(result.overdueCount).toBe(0);
    expect(result.pendingCount).toBe(0);
    expect(result.pendingAmount).toBe(0);
    expect(result.delta).toBe(0);
  });
});
