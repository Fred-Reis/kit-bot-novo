import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { KpiCard } from '@/components/kpi-card';
import { PageHeader } from '@/components/page-header';

export const Route = createFileRoute('/_dashboard/finance/')({ component: FinancePage });

const TABS = ['Visão geral', 'Receitas', 'Despesas', 'Relatórios'];

const MONTHS = ['Nov', 'Dez', 'Jan', 'Fev', 'Mar', 'Abr'];
const BAR_HEIGHTS = [55, 72, 48, 85, 63, 90];

function FinancePage() {
  const [tab, setTab] = useState(0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <PageHeader title="Financeiro" subtitle="Visão geral das finanças" />
        <span className="text-[10px] text-muted-foreground/60">dados fictícios</span>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Receita mensal" value="R$ 9.300" seed={10} up />
        <KpiCard label="Inadimplência" value="R$ 0" seed={11} up={false} />
        <KpiCard label="A receber (30d)" value="R$ 9.300" seed={12} up />
        <KpiCard label="Média por imóvel" value="R$ 1.860" seed={13} up />
      </div>

      <div
        className="rounded-[10px] bg-surface-raised p-5"
        style={{ boxShadow: 'var(--shadow-sm)' }}
      >
        <div className="mb-4 flex gap-1 border-b border-border">
          {TABS.map((t, i) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(i)}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                tab === i
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === 0 && (
          <div>
            <p className="mb-4 text-xs text-muted-foreground">Receita mensal (R$)</p>
            <div className="flex h-40 items-end gap-3">
              {BAR_HEIGHTS.map((h, i) => (
                <div key={i} className="flex flex-1 flex-col items-center gap-1">
                  <div
                    className="w-full rounded-t-md bg-primary/70"
                    style={{ height: `${h}%` }}
                  />
                  <span className="text-[10px] text-muted-foreground">{MONTHS[i]}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab !== 0 && (
          <div className="flex h-40 items-center justify-center">
            <p className="text-sm text-muted-foreground">Em construção.</p>
          </div>
        )}
      </div>
    </div>
  );
}
