import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronLeft } from 'lucide-react';
import { fetchProperty } from '@/lib/queries';
import { adminApi } from '@/lib/api';
import { uploadPropertyMedia } from '@/lib/storage';
import { FormField } from '@/components/form-field';
import { Select } from '@/components/ui/select';
import { CustomButton } from '@/components/ui/btn';
import { PropertyFormFields, type PropertyFormState } from '@/components/property-form-fields';

export const Route = createFileRoute('/_dashboard/properties/$propertyId/edit')({
  component: EditPropertyPage,
});

interface FormState extends PropertyFormState {
  active: string;
}

const INITIAL: FormState = {
  name: '', externalId: '', address: '', complement: '', neighborhood: '',
  rent: '', deposit: '', depositInstallments: '', contractDuration: '',
  rooms: '', bathrooms: '', maxAdults: '',
  allowPets: 'false', allowChildren: 'true', includesWater: 'false',
  includesIptu: 'false', individualElectricity: 'true', independentEntrance: 'true',
  description: '', rules: '', visitSchedule: '', listingUrl: '', active: 'true',
};

function EditPropertyPage() {
  const { propertyId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(INITIAL);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  const { data: property, isLoading } = useQuery({
    queryKey: ['property', propertyId],
    queryFn: () => fetchProperty(propertyId),
  });

  useEffect(() => {
    if (!property) return;
    setForm({
      name: property.name,
      externalId: property.externalId ?? '',
      address: property.address,
      complement: property.complement ?? '',
      neighborhood: property.neighborhood ?? '',
      rent: String(property.rent),
      deposit: String(property.deposit),
      depositInstallments: String(property.depositInstallmentsMax ?? ''),
      contractDuration: String(property.contractMonths ?? ''),
      rooms: String(property.rooms),
      bathrooms: String(property.bathrooms),
      maxAdults: String(property.maxAdults ?? ''),
      allowPets: property.acceptsPets ? 'true' : 'false',
      allowChildren: property.acceptsChildren ? 'true' : 'false',
      includesWater: property.includesWater ? 'true' : 'false',
      includesIptu: property.includesIptu ? 'true' : 'false',
      individualElectricity: property.individualElectricity ? 'true' : 'false',
      independentEntrance: property.independentEntrance ? 'true' : 'false',
      description: property.description ?? '',
      rules: property.rulesText ?? '',
      visitSchedule: property.visitSchedule ?? '',
      listingUrl: property.listingUrl ?? '',
      active: property.active ? 'true' : 'false',
    });
  }, [property?.id]);

  function set(key: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value }));
  }

  const { mutate: save, isPending } = useMutation({
    mutationFn: async () => {
      await adminApi.updateProperty(propertyId, {
        name: form.name,
        externalId: form.externalId || undefined,
        address: form.address,
        complement: form.complement || undefined,
        neighborhood: form.neighborhood,
        rent: parseFloat(form.rent) || property!.rent,
        deposit: parseFloat(form.deposit) || property!.deposit,
        depositInstallmentsMax: parseInt(form.depositInstallments) || property!.depositInstallmentsMax,
        contractMonths: parseInt(form.contractDuration) || property!.contractMonths,
        rooms: parseInt(form.rooms) || property!.rooms,
        bathrooms: parseInt(form.bathrooms) || property!.bathrooms,
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
        active: form.active === 'true',
      });
      if (pendingFiles.length > 0) {
        await Promise.all(pendingFiles.map((file) => uploadPropertyMedia(propertyId, file)));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['property', propertyId] });
      queryClient.invalidateQueries({ queryKey: ['properties'] });
      toast.success('Imóvel atualizado');
      navigate({ to: '/properties/$propertyId', params: { propertyId } });
    },
    onError: () => toast.error('Erro ao salvar'),
  });

  if (isLoading) return <div className="h-96 animate-pulse rounded-[10px] bg-muted" />;
  if (!property) return <p className="text-sm text-muted-foreground">Imóvel não encontrado.</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate({ to: '/properties/$propertyId', params: { propertyId } })}
            className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <ChevronLeft className="size-4" />
          </button>
          <div>
            <h1 className="text-xl font-semibold text-foreground">Editar imóvel</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">{property.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <CustomButton
            variant="ghost"
            size="sm"
            onClick={() => navigate({ to: '/properties/$propertyId', params: { propertyId } })}
          >
            Cancelar
          </CustomButton>
          <CustomButton
            variant="primary"
            size="sm"
            disabled={isPending || !form.name}
            onClick={() => save()}
          >
            {isPending ? 'Salvando...' : 'Salvar'}
          </CustomButton>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <PropertyFormFields
          form={form}
          set={set}
          onFilesChange={setPendingFiles}
          photosTitle="Adicionar fotos"
          photosSubtitle="Novas fotos serão adicionadas à galeria existente."
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
          </div>
        </div>
      </div>
    </div>
  );
}
