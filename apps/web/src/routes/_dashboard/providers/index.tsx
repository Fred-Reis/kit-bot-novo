import type { ServiceProvider } from '@kit-manager/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page-header';
import { ProviderFormModal, type ProviderFormValue } from '@/components/provider-form-modal';
import { CustomButton } from '@/components/ui/btn';
import { Toggle } from '@/components/ui/toggle';
import { adminApi, apiErrorMessage } from '@/lib/api';
import { fetchServiceProviders } from '@/lib/queries';

export const Route = createFileRoute('/_dashboard/providers/')({ component: ProvidersPage });

const TYPE_LABEL: Record<string, string> = {
  eletrica: 'Elétrica',
  hidraulica: 'Hidráulica',
  civil: 'Civil',
  limpeza_conservacao: 'Limpeza/Conservação',
};

function ProvidersPage() {
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ServiceProvider | null>(null);

  const { data: providers = [], isLoading } = useQuery({
    queryKey: ['service-providers'],
    queryFn: fetchServiceProviders,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['service-providers'] });

  const createMutation = useMutation({
    mutationFn: (value: ProviderFormValue) => adminApi.createProvider(value),
    onSuccess: () => {
      invalidate();
      setModalOpen(false);
      toast.success('Prestador cadastrado.');
    },
    onError: (err) => toast.error(apiErrorMessage(err, 'Falha ao cadastrar prestador')),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, value }: { id: string; value: ProviderFormValue }) =>
      adminApi.updateProvider(id, value),
    onSuccess: () => {
      invalidate();
      setModalOpen(false);
      setEditing(null);
      toast.success('Prestador atualizado.');
    },
    onError: (err) => toast.error(apiErrorMessage(err, 'Falha ao atualizar prestador')),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      adminApi.updateProvider(id, { active }),
    onSuccess: invalidate,
    onError: (err) => toast.error(apiErrorMessage(err, 'Falha ao atualizar prestador')),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Prestadores de serviço"
        actions={
          <CustomButton
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
          >
            <Plus className="size-4" /> Novo prestador
          </CustomButton>
        }
      />

      <div className="overflow-hidden rounded-xl border border-border bg-surface-raised">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">Telefone</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Ativo</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                  Carregando...
                </td>
              </tr>
            ) : (
              providers.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 text-foreground">{p.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{p.phone}</td>
                  <td className="px-4 py-3 text-muted-foreground">{TYPE_LABEL[p.type] ?? p.type}</td>
                  <td className="px-4 py-3">
                    <Toggle
                      checked={p.active}
                      onChange={(v) => toggleActiveMutation.mutate({ id: p.id, active: v })}
                      aria-label={`Ativar/desativar ${p.name}`}
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      className="text-xs font-medium text-accent-ink hover:underline"
                      onClick={() => {
                        setEditing(p);
                        setModalOpen(true);
                      }}
                    >
                      Editar
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ProviderFormModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        onSubmit={(value) =>
          editing ? updateMutation.mutate({ id: editing.id, value }) : createMutation.mutate(value)
        }
        initialValue={editing ?? undefined}
      />
    </div>
  );
}
