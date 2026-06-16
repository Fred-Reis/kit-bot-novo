import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/form-field';
import { PageHeader } from '@/components/page-header';
import { CustomButton } from '@/components/ui/btn';
import { Input } from '@/components/ui/input';
import { Toggle } from '@/components/ui/toggle';
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

function IntegrationsSection() {
  return (
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
  );
}

function NotificationsSection() {
  const { notificationsEnabled, setNotificationsEnabled, autoRefresh, setAutoRefresh } =
    useUiStore();

  return (
    <SectionCard title="Notificações" subtitle="Alertas e atualizações automáticas.">
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
