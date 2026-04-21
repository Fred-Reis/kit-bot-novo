import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check } from 'lucide-react';
import { fetchProperties } from '@/lib/queries';
import { adminApi } from '@/lib/api';
import { FormSection } from '@/components/form-section';
import { FormField } from '@/components/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { CustomButton } from '@/components/ui/btn';

export const Route = createFileRoute('/_dashboard/tenants/new')({ component: NewTenantPage });

interface TenantForm {
  name: string;
  cpf: string;
  birthDate: string;
  profession: string;
  income: string;
  phone: string;
  email: string;
  address: string;
  neighborhood: string;
  zipCode: string;
  propertyId: string;
  contractStart: string;
  contractEnd: string;
  dueDay: string;
}

const INITIAL: TenantForm = {
  name: '', cpf: '', birthDate: '', profession: '', income: '',
  phone: '', email: '', address: '', neighborhood: '', zipCode: '',
  propertyId: '', contractStart: '', contractEnd: '', dueDay: '',
};

const STEPS = [
  { id: 1, label: 'Dados pessoais' },
  { id: 2, label: 'Contato & endereço' },
  { id: 3, label: 'Contrato' },
  { id: 4, label: 'Documentos' },
];

function Stepper({ current }: { current: number }) {
  return (
    <div className="flex items-start">
      {STEPS.map((step, idx) => {
        const done = current > step.id;
        const active = current === step.id;
        return (
          <div key={step.id} className="flex flex-1 flex-col items-center gap-1">
            <div className="flex w-full items-center">
              {idx > 0 && <div className={`h-0.5 flex-1 ${done ? 'bg-primary' : 'bg-border'}`} />}
              <div className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                done ? 'bg-primary text-primary-foreground'
                : active ? 'border-2 border-primary bg-surface text-primary'
                : 'border-2 border-border bg-surface text-muted-foreground'
              }`}>
                {done ? <Check className="size-3.5" /> : step.id}
              </div>
              {idx < STEPS.length - 1 && <div className={`h-0.5 flex-1 ${done ? 'bg-primary' : 'bg-border'}`} />}
            </div>
            <span className={`text-center text-[10px] leading-tight ${active ? 'font-medium text-primary' : done ? 'text-foreground' : 'text-muted-foreground'}`}>
              {step.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

type SetForm = (key: keyof TenantForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;

function Step1({ form, set }: { form: TenantForm; set: SetForm }) {
  return (
    <FormSection title="Dados pessoais" subtitle="Informações do inquilino.">
      <FormField label="Nome completo" required>
        <Input value={form.name} onChange={set('name')} placeholder="Nome e sobrenome" />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="CPF" required>
          <Input value={form.cpf} onChange={set('cpf')} placeholder="000.000.000-00" mono />
        </FormField>
        <FormField label="Data de nascimento">
          <Input type="date" value={form.birthDate} onChange={set('birthDate')} />
        </FormField>
      </div>
      <FormField label="Profissão">
        <Input value={form.profession} onChange={set('profession')} placeholder="Ex: Professora" />
      </FormField>
      <FormField label="Renda mensal (R$)">
        <Input type="number" value={form.income} onChange={set('income')} placeholder="3000" mono />
      </FormField>
    </FormSection>
  );
}

function Step2({ form, set }: { form: TenantForm; set: SetForm }) {
  return (
    <FormSection title="Contato & endereço" subtitle="Dados de contato e residência atual.">
      <FormField label="Telefone (WhatsApp)" required>
        <Input type="tel" value={form.phone} onChange={set('phone')} placeholder="+55 11 99999-0000" mono />
      </FormField>
      <FormField label="E-mail">
        <Input type="email" value={form.email} onChange={set('email')} placeholder="email@exemplo.com" />
      </FormField>
      <FormField label="Endereço atual" required>
        <Input value={form.address} onChange={set('address')} placeholder="Rua, número, complemento" />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Bairro">
          <Input value={form.neighborhood} onChange={set('neighborhood')} placeholder="Bairro" />
        </FormField>
        <FormField label="CEP">
          <Input value={form.zipCode} onChange={set('zipCode')} placeholder="00000-000" mono />
        </FormField>
      </div>
    </FormSection>
  );
}

function Step3({ form, set }: { form: TenantForm; set: SetForm }) {
  const { data: properties = [], isLoading } = useQuery({
    queryKey: ['properties'],
    queryFn: fetchProperties,
  });
  const available = properties.filter((p) => p.active && p.status === 'available');

  return (
    <FormSection title="Contrato" subtitle="Imóvel e vigência do contrato.">
      <FormField label="Imóvel" required>
        <Select value={form.propertyId} onChange={set('propertyId')} disabled={isLoading}>
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
          <Input type="date" value={form.contractStart} onChange={set('contractStart')} />
        </FormField>
        <FormField label="Fim do contrato">
          <Input type="date" value={form.contractEnd} onChange={set('contractEnd')} />
        </FormField>
      </div>
      <FormField label="Dia de vencimento" required>
        <Input type="number" min={1} max={28} value={form.dueDay} onChange={set('dueDay')} placeholder="10" mono />
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
        <button type="button" className="mt-2 text-sm font-medium text-primary hover:underline">
          selecionar do computador
        </button>
        <p className="mt-1 text-xs text-muted-foreground/60">PDF, JPG ou PNG — máx. 10 MB cada</p>
      </div>
    </FormSection>
  );
}

const STEP_REQUIRED: Record<number, (f: TenantForm) => boolean> = {
  1: (f) => Boolean(f.name && f.cpf),
  2: (f) => Boolean(f.phone && f.address),
  3: (f) => Boolean(f.propertyId && f.contractStart && f.dueDay),
  4: () => true,
};

function NewTenantPage() {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<TenantForm>(INITIAL);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  function set(key: keyof TenantForm) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value }));
  }

  const { mutate: submit, isPending } = useMutation({
    mutationFn: () =>
      adminApi.createTenant({
        name: form.name,
        cpf: form.cpf || undefined,
        phone: form.phone,
        email: form.email || undefined,
        propertyId: form.propertyId,
        contractStart: form.contractStart,
        contractEnd: form.contractEnd || undefined,
        dueDay: parseInt(form.dueDay),
      }),
    onSuccess: ({ data }) => {
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
      toast.success('Inquilino cadastrado');
      navigate({ to: '/tenants/$tenantId', params: { tenantId: data.id as string } });
    },
    onError: () => toast.error('Erro ao cadastrar inquilino'),
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Novo inquilino</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Preencha os dados em 4 passos.</p>
      </div>

      <Stepper current={step} />

      <div className="max-w-lg">
        {step === 1 && <Step1 form={form} set={set} />}
        {step === 2 && <Step2 form={form} set={set} />}
        {step === 3 && <Step3 form={form} set={set} />}
        {step === 4 && <Step4 />}
      </div>

      <div className="flex items-center justify-between border-t border-border pt-4">
        <CustomButton
          variant="ghost"
          size="sm"
          onClick={step === 1 ? () => navigate({ to: '/tenants' }) : () => setStep((s) => s - 1)}
        >
          {step === 1 ? 'Cancelar' : 'Voltar'}
        </CustomButton>
        {step < 4 ? (
          <CustomButton
            variant="primary"
            size="sm"
            disabled={!STEP_REQUIRED[step](form)}
            onClick={() => setStep((s) => s + 1)}
          >
            Próximo
          </CustomButton>
        ) : (
          <CustomButton
            variant="primary"
            size="sm"
            disabled={isPending}
            onClick={() => submit()}
          >
            {isPending ? 'Salvando...' : 'Concluir'}
          </CustomButton>
        )}
      </div>
    </div>
  );
}
