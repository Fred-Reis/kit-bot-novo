import type { Payment } from '@kit-manager/types';

export interface PaymentsSummary {
  monthRevenue: number;
  prevMonthRevenue: number;
  overdueAmount: number;
  overdueCount: number;
  /** Count of pending payments in the current month. */
  pendingCount: number;
  /** Sum of pending payment amounts in the current month. */
  pendingAmount: number;
  /** Percentage change in revenue vs previous month (rounded to 1 decimal). 0 when prev is 0. */
  delta: number;
}

export function computePaymentsSummary(payments: Payment[]): PaymentsSummary {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

  let monthRevenue = 0;
  let prevMonthRevenue = 0;
  let overdueAmount = 0;
  let overdueCount = 0;
  let pendingCount = 0;
  let pendingAmount = 0;

  for (const p of payments) {
    if (p.status === 'paid' && p.month.startsWith(currentMonth)) monthRevenue += p.amount;
    if (p.status === 'paid' && p.month.startsWith(prevMonth)) prevMonthRevenue += p.amount;
    if (p.status === 'overdue') { overdueAmount += p.amount; overdueCount++; }
    if (p.status === 'pending' && p.month.startsWith(currentMonth)) {
      pendingCount++;
      pendingAmount += p.amount;
    }
  }

  const delta = prevMonthRevenue === 0
    ? 0
    : Number(((monthRevenue - prevMonthRevenue) / prevMonthRevenue * 100).toFixed(1));

  return { monthRevenue, prevMonthRevenue, overdueAmount, overdueCount, pendingCount, pendingAmount, delta };
}
