import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { twMerge } from 'tailwind-merge';
import { FormField } from '@/components/form-field';
import { PageHeader } from '@/components/page-header';
import { CustomButton } from '@/components/ui/btn';
import { Input } from '@/components/ui/input';
import { Toggle } from '@/components/ui/toggle';
import { adminApi, apiErrorMessage } from '@/lib/api';
import { fetchOwner } from '@/lib/queries';
import { useUiStore } from '@/store/ui';

export const Route = createFileRoute('/_dashboard/config/')({ component: SettingsPage });

type Section =
  | 'workspace'
  | 'team'
  | 'billing'
  | 'integrations'
  | 'notifications'
  | 'appearance'
  | 'security';

const NAV_ITEMS: { id: Section; label: string }[] = [
  { id: 'workspace', label: 'Workspace' },
  { id: 'team', label: 'Equipe & permissões' },
  { id: 'billing', label: 'Plano & cobrança' },
  { id: 'integrations', label: 'Integrações' },
  { id: 'notifications', label: 'Notificações' },
  { id: 'appearance', label: 'Aparência' },
  { id: 'security', label: 'Segurança' },
];

function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[10px] bg-surface-raised p-5" style={{ boxShadow: 'var(--shadow-sm)' }}>
      <h2 className="mb-1 text-sm font-semibold text-foreground">{title}</h2>
      {subtitle && <p className="mb-4 text-xs text-muted-foreground">{subtitle}</p>}
      {children}
    </div>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground font-medium">{value}</span>
    </div>
  );
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-3 border-b border-border last:border-0">
      <span className="text-sm text-foreground">{label}</span>
      {children}
    </div>
  );
}

function WorkspaceSection() {
  return (
    <SectionCard title="Workspace" subtitle="Informações da empresa.">
      <ReadOnlyField label="Nome da empresa" value="kit-manager" />
      <ReadOnlyField label="CNPJ" value="—" />
      <ReadOnlyField label="Domínio" value="—" />
      <ReadOnlyField label="Idioma padrão" value="pt-BR" />
      <ReadOnlyField label="Moeda" value="BRL" />
      <ReadOnlyField label="Fuso horário" value="America/Sao_Paulo" />
    </SectionCard>
  );
}

function TeamSection() {
  return (
    <SectionCard title="Equipe & permissões">
      <p className="text-sm text-muted-foreground">
        Disponível em breve. Aguardando implementação de multi-tenancy.
      </p>
    </SectionCard>
  );
}

function BillingSection() {
  return (
    <SectionCard title="Plano & cobrança">
      <p className="text-sm text-muted-foreground">Em breve.</p>
    </SectionCard>
  );
}

function BotToggleCard() {
  const qc = useQueryClient();
  const { data: owner } = useQuery({ queryKey: ['owner'], queryFn: fetchOwner });
  const [optimistic, setOptimistic] = useState<boolean | null>(null);

  const enabled = optimistic ?? owner?.botEnabled ?? true;

  async function handleToggle() {
    const next = !enabled;
    setOptimistic(next);
    try {
      await adminApi.updateBotEnabled(next);
      void qc.invalidateQueries({ queryKey: ['owner'] });
    } catch (err) {
      setOptimistic(null);
      toast.error(apiErrorMessage(err, 'Erro ao atualizar configuração do bot.'));
    }
  }

  return (
    <SectionCard title="Bot WhatsApp" subtitle="Controle global do bot de atendimento.">
      <SettingRow label="Bot ativo">
        <div className="flex items-center gap-2">
          <span
            className={twMerge(
              'text-xs font-medium px-2 py-0.5 rounded-full',
              enabled ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning',
            )}
          >
            {enabled ? 'Ativo' : 'Pausado'}
          </span>
          <Toggle checked={enabled} onChange={handleToggle} aria-label={enabled ? 'Desativar bot' : 'Ativar bot'} />
        </div>
      </SettingRow>
      {!enabled && (
        <p className="mt-2 text-xs text-muted-foreground">
          Mensagens chegam normalmente no seu WhatsApp. Você responde manualmente.
        </p>
      )}
    </SectionCard>
  );
}

function IntegrationsSection() {
  return (
    <div className="space-y-4">
      <BotToggleCard />
      <SectionCard title="Integrações" subtitle="Configurações do bot de atendimento.">
        <div className="space-y-3">
          <FormField label="URL da API">
            <Input placeholder="https://bot.exemplo.com" type="url" />
          </FormField>
          <FormField label="Instância Evolution">
            <Input placeholder="kit-manager" />
          </FormField>
        </div>
        <div className="mt-4 flex justify-end">
          <CustomButton variant="primary" size="sm" onClick={() => toast.info('Em breve')}>
            Salvar
          </CustomButton>
        </div>
      </SectionCard>
    </div>
  );
}

function NotificationContactCard() {
  const qc = useQueryClient();
  const { data: owner } = useQuery({ queryKey: ['owner'], queryFn: fetchOwner });
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (owner) {
      setPhone(owner.notificationPhone ?? '');
      setEmail(owner.notificationEmail ?? '');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner?.id]);

  async function handleSave() {
    setSaving(true);
    try {
      await adminApi.updateNotificationSettings({ notificationPhone: phone, notificationEmail: email });
      void qc.invalidateQueries({ queryKey: ['owner'] });
      toast.success('Configurações de notificação salvas.');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Erro ao salvar configurações.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard
      title="Contato para notificações"
      subtitle="Número e e-mail que recebem alertas de KYC, contratos e pagamentos em atraso."
    >
      <div className="space-y-3">
        <FormField label="WhatsApp (somente dígitos, sem +55)">
          <Input
            placeholder="11999990000"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </FormField>
        <FormField label="E-mail">
          <Input
            type="email"
            placeholder="voce@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </FormField>
      </div>
      <div className="mt-4 flex justify-end">
        <CustomButton variant="primary" size="sm" onClick={handleSave} disabled={saving}>
          {saving ? 'Salvando…' : 'Salvar'}
        </CustomButton>
      </div>
    </SectionCard>
  );
}

function NotificationsSection() {
  const { notificationsEnabled, setNotificationsEnabled, autoRefresh, setAutoRefresh } =
    useUiStore();

  return (
    <div className="space-y-4">
      <NotificationContactCard />
      <SectionCard title="Interface" subtitle="Alertas e atualizações automáticas no painel.">
        <SettingRow label="Notificações ativas">
          <Toggle
            checked={notificationsEnabled}
            onChange={setNotificationsEnabled}
            aria-label="Alternar notificações"
          />
        </SettingRow>
        <SettingRow label="Atualização automática">
          <Toggle
            checked={autoRefresh}
            onChange={setAutoRefresh}
            aria-label="Alternar atualização automática"
          />
        </SettingRow>
      </SectionCard>
    </div>
  );
}

function AppearanceSection() {
  const { darkMode, setDarkMode } = useUiStore();

  return (
    <SectionCard title="Aparência" subtitle="Tema da interface.">
      <SettingRow label="Modo escuro">
        <Toggle checked={darkMode} onChange={setDarkMode} aria-label="Alternar modo escuro" />
      </SettingRow>
    </SectionCard>
  );
}

function SecuritySection() {
  return (
    <SectionCard title="Segurança" subtitle="Alterar credenciais de acesso.">
      <div className="space-y-3">
        <FormField label="Senha atual">
          <Input type="password" placeholder="••••••••" />
        </FormField>
        <FormField label="Nova senha">
          <Input type="password" placeholder="••••••••" />
        </FormField>
        <FormField label="Confirmar nova senha">
          <Input type="password" placeholder="••••••••" />
        </FormField>
      </div>
      <div className="mt-4 flex justify-end">
        <CustomButton variant="primary" size="sm" onClick={() => toast.info('Em breve')}>
          Alterar senha
        </CustomButton>
      </div>
    </SectionCard>
  );
}

const SECTION_COMPONENTS: Record<Section, React.ComponentType> = {
  workspace: WorkspaceSection,
  team: TeamSection,
  billing: BillingSection,
  integrations: IntegrationsSection,
  notifications: NotificationsSection,
  appearance: AppearanceSection,
  security: SecuritySection,
};

function SettingsPage() {
  const [active, setActive] = useState<Section>('workspace');
  const SectionContent = SECTION_COMPONENTS[active];

  return (
    <div className="space-y-6">
      <PageHeader title="Configurações" subtitle="Preferências do painel admin" />

      <div className="flex gap-6 items-start">
        <nav
          className="w-[220px] shrink-0 rounded-[10px] bg-surface-raised p-2"
          style={{ boxShadow: 'var(--shadow-sm)' }}
        >
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              data-active={active === item.id ? '' : undefined}
              onClick={() => setActive(item.id)}
              className="w-full rounded-[7px] px-3 py-2 text-left text-sm transition-colors text-muted-foreground hover:text-foreground hover:bg-muted/50 data-[active]:bg-accent-soft data-[active]:text-accent-ink data-[active]:font-medium"
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="flex-1 min-w-0">
          <SectionContent />
        </div>
      </div>
    </div>
  );
}
