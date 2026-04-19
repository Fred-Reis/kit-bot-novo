import { createFileRoute } from '@tanstack/react-router';
import { Download } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Pill } from '@/components/ui/pill';

export const Route = createFileRoute('/_dashboard/contracts/')({ component: ContractsPage });

const CONTRACTS = [
  { id: 'CT-2024-0421', tenant: 'Ana R.', property: 'Studio Centro', start: '01/04/2024', end: '31/03/2025', status: 'Ativo' },
  { id: 'CT-2023-0376', tenant: 'João S.', property: 'Ap. 101', start: '01/10/2023', end: '30/09/2024', status: 'Encerrado' },
  { id: 'CT-2024-0304', tenant: 'Maria L.', property: 'Casa Jd. Paulista', start: '01/01/2024', end: '31/12/2024', status: 'Ativo' },
  { id: 'CT-2023-0299', tenant: 'Carlos M.', property: 'Ap. 304', start: '01/09/2023', end: '31/08/2024', status: 'Encerrado' },
  { id: 'CT-2021-0257', tenant: 'Paula F.', property: 'Ap. 202', start: '01/06/2021', end: '31/05/2022', status: 'Encerrado' },
];

function ContractsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PageHeader title="Contratos" subtitle="Histórico de contratos de locação" />
        <span className="text-[10px] text-muted-foreground/60">dados fictícios</span>
      </div>

      <div
        className="overflow-hidden rounded-[10px] bg-surface-raised"
        style={{ boxShadow: 'var(--shadow-sm)' }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">Nº</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">Inquilino</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground hidden md:table-cell">Imóvel</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground hidden sm:table-cell">Início</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground hidden sm:table-cell">Fim</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">Status</th>
              <th className="w-10 px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {CONTRACTS.map((c) => (
              <tr key={c.id} className="transition-colors hover:bg-muted/50">
                <td className="px-5 py-3.5 font-mono text-xs font-medium text-foreground">{c.id}</td>
                <td className="px-5 py-3.5 text-sm text-foreground">{c.tenant}</td>
                <td className="px-5 py-3.5 text-xs text-muted-foreground hidden md:table-cell">{c.property}</td>
                <td className="px-5 py-3.5 text-xs text-muted-foreground hidden sm:table-cell">{c.start}</td>
                <td className="px-5 py-3.5 text-xs text-muted-foreground hidden sm:table-cell">{c.end}</td>
                <td className="px-5 py-3.5">
                  <Pill tone={c.status === 'Ativo' ? 'ok' : 'default'} dot>
                    {c.status}
                  </Pill>
                </td>
                <td className="px-5 py-3.5">
                  <button
                    type="button"
                    aria-label="Baixar contrato"
                    onClick={() => console.warn('TODO: download', c.id)}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Download className="size-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
