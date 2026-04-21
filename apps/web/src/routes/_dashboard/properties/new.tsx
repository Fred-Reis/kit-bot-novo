import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FormField } from '@/components/form-field';
import { Select } from '@/components/ui/select';
import { CustomButton } from '@/components/ui/btn';
import { PropertyFormFields, type PropertyFormState } from '@/components/property-form-fields';
import { adminApi } from '@/lib/api';
import { uploadPropertyMedia } from '@/lib/storage';

export const Route = createFileRoute('/_dashboard/properties/new')({ component: NewPropertyPage });

interface FormState extends PropertyFormState {
  firstRent: string;
  active: string;
}

const INITIAL: FormState = {
  name: '', externalId: '', address: '', complement: '', neighborhood: '',
  rent: '', deposit: '', depositInstallments: '', contractDuration: '',
  rooms: '', bathrooms: '', maxAdults: '',
  allowPets: 'false', allowChildren: 'true', includesWater: 'false',
  includesIptu: 'false', individualElectricity: 'true', independentEntrance: 'true',
  description: '', rules: '', visitSchedule: '', listingUrl: '',
  active: 'true', firstRent: 'false',
};

function NewPropertyPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(INITIAL);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  function set(key: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      setForm((prev) => ({ ...prev, [key]: e.target.value }));
    };
  }

  const { mutate: submit, isPending } = useMutation({
    mutationFn: async (draft: boolean) => {
      const { data } = await adminApi.createProperty({
        name: form.name,
        externalId: form.externalId || `PROP-${Date.now()}`,
        address: form.address,
        complement: form.complement || undefined,
        neighborhood: form.neighborhood,
        rent: parseFloat(form.rent) || 0,
        deposit: parseFloat(form.deposit) || 0,
        depositInstallmentsMax: parseInt(form.depositInstallments) || 1,
        contractMonths: parseInt(form.contractDuration) || 12,
        rooms: parseInt(form.rooms) || 1,
        bathrooms: parseInt(form.bathrooms) || 1,
        maxAdults: parseInt(form.maxAdults) || undefined,
        acceptsPets: form.allowPets === 'true',
        acceptsChildren: form.allowChildren === 'true',
        includesWater: form.includesWater === 'true',
        includesIptu: form.includesIptu === 'true',
        individualElectricity: form.individualElectricity === 'true',
        independentEntrance: form.independentEntrance === 'true',
        description: form.description || undefined,
        rulesText: form.rules || undefined,
        visitSchedule: form.visitSchedule || undefined,
        listingUrl: form.listingUrl || undefined,
        active: !draft && form.active === 'true',
        firstRental: form.firstRent === 'true',
      });
      const propertyId = data.id as string;
      if (pendingFiles.length > 0) {
        await Promise.all(pendingFiles.map((file) => uploadPropertyMedia(propertyId, file)));
      }
      return propertyId;
    },
    onSuccess: (propertyId, draft) => {
      queryClient.invalidateQueries({ queryKey: ['properties'] });
      toast.success(draft ? 'Rascunho salvo' : 'Imóvel publicado');
      navigate({ to: '/properties/$propertyId', params: { propertyId } });
    },
    onError: () => toast.error('Erro ao salvar imóvel'),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Novo imóvel</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Preencha os dados do imóvel para publicar.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CustomButton variant="ghost" size="sm" onClick={() => navigate({ to: '/properties' })}>
            Cancelar
          </CustomButton>
          <CustomButton
            variant="secondary"
            size="sm"
            disabled={isPending || !form.name}
            onClick={() => submit(true)}
          >
            Salvar rascunho
          </CustomButton>
          <CustomButton
            variant="primary"
            size="sm"
            disabled={isPending || !form.name || !form.address || !form.rent}
            onClick={() => submit(false)}
          >
            Publicar
          </CustomButton>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <PropertyFormFields
          form={form}
          set={set}
          onFilesChange={setPendingFiles}
          depositRequired
        />

        <div className="space-y-4 self-start lg:sticky lg:top-[76px]">
          <div className="rounded-[10px] bg-surface-raised p-5" style={{ boxShadow: 'var(--shadow-sm)' }}>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Status
            </h3>
            <FormField label="Visibilidade">
              <Select value={form.active} onChange={set('active')}>
                <option value="true">Ativo</option>
                <option value="false">Inativo</option>
              </Select>
            </FormField>
            <div className="mt-3">
              <FormField label="Primeiro aluguel">
                <Select value={form.firstRent} onChange={set('firstRent')}>
                  <option value="false">Não</option>
                  <option value="true">Sim</option>
                </Select>
              </FormField>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
