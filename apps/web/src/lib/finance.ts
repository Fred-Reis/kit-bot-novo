import type { Payment } from '@kit-manager/types';

export interface MonthlyTotal {
  month: string;
  revenue: number;
  overdue: number;
}

function toYearMonth(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(date: Date): string {
  const raw = new Intl.DateTimeFormat('pt-BR', { month: 'short' }).format(date);
  const clean = raw.replace(/\.$/,'');
  return clean[0].toUpperCase() + clean.slice(1);
}

export function computeMonthlyTotals(payments: Payment[], months: number): MonthlyTotal[] {
  const now = new Date();
  const buckets = new Map<string, MonthlyTotal>();
  const order: string[] = [];

  for (let i = months - 1; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = toYearMonth(date);
    buckets.set(key, { month: monthLabel(date), revenue: 0, overdue: 0 });
    order.push(key);
  }

  for (const p of payments) {
    const entry = buckets.get(p.month);
    if (!entry) continue;
    if (p.status === 'paid') entry.revenue += p.amount;
    else if (p.status === 'overdue') entry.overdue += p.amount;
  }

  return order.map((key) => buckets.get(key)!);
}
