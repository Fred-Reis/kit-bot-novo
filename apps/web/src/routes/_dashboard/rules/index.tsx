import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Plus, Copy } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { CustomButton } from '@/components/ui/btn';

export const Route = createFileRoute('/_dashboard/rules/')({ component: RulesPage });

const TABS = ['Políticas', 'Financeiro', 'Documentos', 'Visitas'];

const POLICIES = [
  {
    id: 1,
    title: 'Pets',
    detail: 'Somente animais de pequeno porte (até 10kg). Máx. 2 animais por unidade.',
    reuse: 3,
  },
  {
    id: 2,
    title: 'Crianças',
    detail: 'Permitido em todas as unidades, exceto studios.',
    reuse: 5,
  },
  {
    id: 3,
    title: 'Fumantes',
    detail: 'Não é permitido fumar em ambientes internos.',
    reuse: 5,
  },
  {
    id: 4,
    title: 'Festas',
    detail: 'Eventos limitados a 10 pessoas. Silêncio após 22h.',
    reuse: 2,
  },
];

function RulesPage() {
  const [tab, setTab] = useState(0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Regras"
        subtitle="Políticas aplicadas aos imóveis"
        actions={
          <div className="flex gap-2">
            <CustomButton variant="secondary" size="sm">
              <Copy className="size-4" />
              Duplicar
            </CustomButton>
            <CustomButton variant="primary" size="sm">
              <Plus className="size-4" />
              Nova regra
            </CustomButton>
          </div>
        }
      />

      <div className="flex gap-1 border-b border-border">
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

      {tab === 0 ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          <div className="space-y-3">
            {POLICIES.map((p) => (
              <div
                key={p.id}
                className="rounded-[10px] bg-surface-raised p-5"
                style={{ boxShadow: 'var(--shadow-sm)' }}
              >
                <div className="mb-1 flex items-start justify-between gap-3">
                  <h3 className="text-sm font-medium text-foreground">{p.title}</h3>
                  <span className="text-[10px] text-muted-foreground/60">dados fictícios</span>
                </div>
                <p className="text-sm text-muted-foreground">{p.detail}</p>
              </div>
            ))}
          </div>

          <div
            className="h-fit rounded-[10px] bg-surface-raised p-5 self-start"
            style={{ boxShadow: 'var(--shadow-sm)' }}
          >
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Reuso de políticas
            </h3>
            <div className="space-y-2">
              {POLICIES.map((p) => (
                <div key={p.id} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{p.title}</span>
                  <span className="font-mono text-xs font-medium text-foreground">
                    {p.reuse} imóveis
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex h-40 items-center justify-center rounded-[10px] border border-border bg-surface-raised">
          <p className="text-sm text-muted-foreground">Em construção.</p>
        </div>
      )}
    </div>
  );
}
