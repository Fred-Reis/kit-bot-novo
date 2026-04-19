import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { CustomButton } from '@/components/ui/btn';

export const Route = createFileRoute('/_dashboard/templates/')({ component: TemplatesPage });

const TEMPLATES = [
  { id: 1, name: 'Boas-vindas', preview: 'Olá {{nome}}, seja bem-vindo(a) ao imóvel...' },
  { id: 2, name: 'Solicitação de documentos', preview: 'Precisamos de alguns documentos seus: {{lista_docs}}...' },
  { id: 3, name: 'Lembrete de vencimento', preview: 'Seu aluguel vence em {{dias}} dias no valor de {{valor}}...' },
  { id: 4, name: 'Aprovação KYC', preview: 'Parabéns {{nome}}! Sua análise foi aprovada...' },
  { id: 5, name: 'Confirmação de visita', preview: 'Sua visita está confirmada para {{data}} às {{hora}}...' },
];

function highlight(text: string) {
  const parts = text.split(/({{[^}]+}})/g);
  return parts.map((part, i) =>
    part.startsWith('{{') ? (
      <span key={i} className="rounded px-0.5 font-mono text-accent-ink bg-accent-soft">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function TemplatesPage() {
  const [selected, setSelected] = useState(TEMPLATES[0]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Templates"
        subtitle="Mensagens automáticas do bot"
        actions={
          <CustomButton variant="primary" size="sm">
            <Plus className="size-4" />
            Novo template
          </CustomButton>
        }
      />

      <div className="grid h-[calc(100vh-220px)] min-h-[400px] gap-4 lg:grid-cols-[280px_1fr]">
        {/* List */}
        <div
          className="overflow-y-auto rounded-[10px] bg-surface-raised"
          style={{ boxShadow: 'var(--shadow-sm)' }}
        >
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSelected(t)}
              className={`flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-muted/50 ${selected.id === t.id ? 'bg-accent-soft' : ''}`}
            >
              <p className={`text-sm font-medium ${selected.id === t.id ? 'text-accent-ink' : 'text-foreground'}`}>
                {t.name}
              </p>
              <p className="truncate text-xs text-muted-foreground">{t.preview.slice(0, 50)}…</p>
            </button>
          ))}
        </div>

        {/* Editor panel */}
        <div
          className="flex flex-col rounded-[10px] bg-surface-raised p-5"
          style={{ boxShadow: 'var(--shadow-sm)' }}
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-foreground">{selected.name}</h2>
            <span className="text-[10px] text-muted-foreground/60">dados fictícios</span>
          </div>
          <div className="flex-1 rounded-lg border border-border bg-muted/30 p-4">
            <p className="text-sm leading-relaxed text-foreground">{highlight(selected.preview)}</p>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <CustomButton variant="secondary" size="sm">
              Cancelar
            </CustomButton>
            <CustomButton variant="primary" size="sm" onClick={() => console.warn('TODO: save')}>
              Salvar
            </CustomButton>
          </div>
        </div>
      </div>
    </div>
  );
}
