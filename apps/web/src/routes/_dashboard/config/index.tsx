import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useUiStore } from '@/store/ui';
import { PageHeader } from '@/components/page-header';
import { Toggle } from '@/components/ui/toggle';
import { FormField } from '@/components/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { CustomButton } from '@/components/ui/btn';

export const Route = createFileRoute('/_dashboard/config/')({ component: SettingsPage });

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-3">
      <span className="text-sm text-foreground">{label}</span>
      {children}
    </div>
  );
}

function SettingsPage() {
  const { darkMode, setDarkMode } = useUiStore();
  const [notifications, setNotifications] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [language, setLanguage] = useState('pt-BR');

  return (
    <div className="space-y-6">
      <PageHeader title="Configurações" subtitle="Preferências do painel admin" />

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Appearance */}
        <div
          className="rounded-[10px] bg-surface-raised p-5"
          style={{ boxShadow: 'var(--shadow-sm)' }}
        >
          <h2 className="mb-1 text-sm font-semibold text-foreground">Aparência</h2>
          <p className="mb-4 text-xs text-muted-foreground">Tema e idioma da interface.</p>
          <div className="divide-y divide-border">
            <SettingRow label="Modo escuro">
              <Toggle checked={darkMode} onChange={setDarkMode} aria-label="Alternar modo escuro" />
            </SettingRow>
            <SettingRow label="Idioma">
              <Select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-36"
              >
                <option value="pt-BR">Português (BR)</option>
                <option value="en-US">English (US)</option>
              </Select>
            </SettingRow>
          </div>
        </div>

        {/* Notifications */}
        <div
          className="rounded-[10px] bg-surface-raised p-5"
          style={{ boxShadow: 'var(--shadow-sm)' }}
        >
          <h2 className="mb-1 text-sm font-semibold text-foreground">Notificações</h2>
          <p className="mb-4 text-xs text-muted-foreground">Alertas e atualizações automáticas.</p>
          <div className="divide-y divide-border">
            <SettingRow label="Notificações ativas">
              <Toggle
                checked={notifications}
                onChange={setNotifications}
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
          </div>
        </div>

        {/* Account */}
        <div
          className="rounded-[10px] bg-surface-raised p-5"
          style={{ boxShadow: 'var(--shadow-sm)' }}
        >
          <h2 className="mb-1 text-sm font-semibold text-foreground">Conta</h2>
          <p className="mb-4 text-xs text-muted-foreground">Dados do proprietário.</p>
          <div className="space-y-3">
            <FormField label="Nome">
              <Input placeholder="Proprietário" />
            </FormField>
            <FormField label="E-mail">
              <Input type="email" placeholder="email@exemplo.com" />
            </FormField>
          </div>
          <div className="mt-4 flex justify-end">
            <CustomButton variant="primary" size="sm" onClick={() => console.warn('TODO: save')}>
              Salvar
            </CustomButton>
          </div>
        </div>

        {/* Bot */}
        <div
          className="rounded-[10px] bg-surface-raised p-5"
          style={{ boxShadow: 'var(--shadow-sm)' }}
        >
          <h2 className="mb-1 text-sm font-semibold text-foreground">Bot WhatsApp</h2>
          <p className="mb-4 text-xs text-muted-foreground">Configurações do bot de atendimento.</p>
          <div className="space-y-3">
            <FormField label="URL da API">
              <Input placeholder="https://bot.exemplo.com" type="url" />
            </FormField>
            <FormField label="Instância Evolution">
              <Input placeholder="kit-manager" />
            </FormField>
          </div>
          <div className="mt-4 flex justify-end">
            <CustomButton variant="primary" size="sm" onClick={() => console.warn('TODO: save')}>
              Salvar
            </CustomButton>
          </div>
        </div>
      </div>
    </div>
  );
}
