import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { fetchProperties } from '@/lib/queries';
import { FormSection } from '@/components/form-section';
import { FormField } from '@/components/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { CustomButton } from '@/components/ui/btn';

export const Route = createFileRoute('/_dashboard/tenants/new')({ component: NewTenantPage });

const STEPS = [
  { id: 1, label: 'Dados pessoais' },
  { id: 2, label: 'Contato & endereço' },
  { id: 3, label: 'Contrato' },
  { id: 4, label: 'Documentos' },
];

function Stepper({ current }: { current: number }) {
  return (
    <div className="flex items-start gap-0">
      {STEPS.map((step, idx) => {
        const done = current > step.id;
        const active = current === step.id;
        return (
          <div key={step.id} className="flex flex-1 flex-col items-center gap-1">
            <div className="flex w-full items-center">
              {idx > 0 && (
                <div className={`h-0.5 flex-1 ${done ? 'bg-primary' : 'bg-border'}`} />
              )}
              <div
                className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold
                ${done ? 'bg-primary text-primary-foreground' : active ? 'border-2 border-primary bg-surface text-primary' : 'border-2 border-border bg-surface text-muted-foreground'}`}
              >
                {done ? <Check className="size-3.5" /> : step.id}
              </div>
              {idx < STEPS.length - 1 && (
                <div className={`h-0.5 flex-1 ${done ? 'bg-primary' : 'bg-border'}`} />
              )}
            </div>
            <span
              className={`text-center text-[10px] leading-tight ${active ? 'font-medium text-primary' : done ? 'text-foreground' : 'text-muted-foreground'}`}
            >
              {step.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Step1() {
  return (
    <FormSection title="Dados pessoais" subtitle="Informações do inquilino.">
      <FormField label="Nome completo" required>
        <Input placeholder="Nome e sobrenome" />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="CPF" required>
          <Input placeholder="000.000.000-00" mono />
        </FormField>
        <FormField label="Data de nascimento">
          <Input type="date" />
        </FormField>
      </div>
      <FormField label="Profissão">
        <Input placeholder="Ex: Professora" />
      </FormField>
      <FormField label="Renda mensal (R$)">
        <Input type="number" placeholder="3000" mono />
      </FormField>
    </FormSection>
  );
}

function Step2() {
  return (
    <FormSection title="Contato & endereço" subtitle="Dados de contato e residência atual.">
      <FormField label="Telefone (WhatsApp)" required>
        <Input type="tel" placeholder="+55 11 99999-0000" mono />
      </FormField>
      <FormField label="E-mail">
        <Input type="email" placeholder="email@exemplo.com" />
      </FormField>
      <FormField label="Endereço atual" required>
        <Input placeholder="Rua, número, complemento" />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Bairro">
          <Input placeholder="Bairro" />
        </FormField>
        <FormField label="CEP">
          <Input placeholder="00000-000" mono />
        </FormField>
      </div>
    </FormSection>
  );
}

function Step3() {
  const { data: properties = [], isLoading } = useQuery({
    queryKey: ['properties'],
    queryFn: fetchProperties,
  });

  const available = properties.filter((p) => p.active);

  return (
    <FormSection title="Contrato" subtitle="Imóvel e vigência do contrato.">
      <FormField label="Imóvel" required>
        <Select disabled={isLoading}>
          <option value="">Selecionar imóvel...</option>
          {available.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.rent)}/mês
            </option>
          ))}
        </Select>
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Início do contrato" required>
          <Input type="date" />
        </FormField>
        <FormField label="Fim do contrato">
          <Input type="date" />
        </FormField>
      </div>
      <FormField label="Dia de vencimento" required>
        <Input type="number" min={1} max={28} placeholder="10" mono />
      </FormField>
    </FormSection>
  );
}

function Step4() {
  return (
    <FormSection title="Documentos" subtitle="Upload dos documentos do inquilino.">
      <p className="text-sm text-muted-foreground">
        Documentos serão solicitados automaticamente via WhatsApp após o cadastro.
      </p>
      <div className="mt-3 rounded-lg border-2 border-dashed border-border bg-muted/30 p-8 text-center">
        <p className="text-sm text-muted-foreground">Arrastar arquivos ou</p>
        <button
          type="button"
          className="mt-2 text-sm font-medium text-primary hover:underline"
          onClick={() => console.warn('TODO: file upload')}
        >
          selecionar do computador
        </button>
        <p className="mt-1 text-xs text-muted-foreground/60">PDF, JPG ou PNG — máx. 10 MB cada</p>
      </div>
    </FormSection>
  );
}

function NewTenantPage() {
  const [step, setStep] = useState(1);
  const navigate = useNavigate();

  function prev() {
    setStep((s) => Math.max(1, s - 1));
  }
  function next() {
    if (step < 4) setStep((s) => s + 1);
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Novo inquilino</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Preencha os dados em 4 passos.</p>
      </div>

      <Stepper current={step} />

      <div className="max-w-lg">
        {step === 1 && <Step1 />}
        {step === 2 && <Step2 />}
        {step === 3 && <Step3 />}
        {step === 4 && <Step4 />}
      </div>

      <div className="flex items-center justify-between border-t border-border pt-4">
        <CustomButton
          variant="ghost"
          size="sm"
          onClick={step === 1 ? () => navigate({ to: '/tenants' }) : prev}
        >
          {step === 1 ? 'Cancelar' : 'Voltar'}
        </CustomButton>
        {step < 4 ? (
          <CustomButton variant="primary" size="sm" onClick={next}>
            Próximo
          </CustomButton>
        ) : (
          <CustomButton
            variant="primary"
            size="sm"
            onClick={() => console.warn('TODO: submit')}
          >
            Concluir
          </CustomButton>
        )}
      </div>
    </div>
  );
}
