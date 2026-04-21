import { FormSection } from '@/components/form-section';
import { FormField } from '@/components/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { MediaUploader } from '@/components/media-uploader';

export interface PropertyFormState {
  name: string;
  externalId: string;
  address: string;
  complement: string;
  neighborhood: string;
  rent: string;
  deposit: string;
  depositInstallments: string;
  contractDuration: string;
  rooms: string;
  bathrooms: string;
  maxAdults: string;
  allowPets: string;
  allowChildren: string;
  includesWater: string;
  includesIptu: string;
  individualElectricity: string;
  independentEntrance: string;
  description: string;
  rules: string;
  visitSchedule: string;
  listingUrl: string;
}

type ChangeHandler = (
  e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
) => void;

interface PropertyFormFieldsProps {
  form: PropertyFormState;
  set: (key: keyof PropertyFormState) => ChangeHandler;
  onFilesChange: (files: File[]) => void;
  depositRequired?: boolean;
  photosTitle?: string;
  photosSubtitle?: string;
}

export function PropertyFormFields({
  form,
  set,
  onFilesChange,
  depositRequired = false,
  photosTitle = 'Fotos e vídeos',
  photosSubtitle = 'Arraste para reordenar. Primeira foto será a capa.',
}: PropertyFormFieldsProps) {
  return (
    <div className="space-y-5">
      <FormSection title="Dados básicos" subtitle="Identificação e localização do imóvel.">
        <FormField label="Nome do imóvel" required>
          <Input value={form.name} onChange={set('name')} placeholder="Ex: Apartamento Centro — 101" />
        </FormField>
        <FormField label="ID externo" hint="Código do anúncio ou referência interna.">
          <Input value={form.externalId} onChange={set('externalId')} placeholder="Ex: AP-101" />
        </FormField>
        <FormField label="Endereço" required>
          <Input value={form.address} onChange={set('address')} placeholder="Rua, número" />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Complemento">
            <Input value={form.complement} onChange={set('complement')} placeholder="Apto, bloco..." />
          </FormField>
          <FormField label="Bairro" required>
            <Input value={form.neighborhood} onChange={set('neighborhood')} placeholder="Bairro" />
          </FormField>
        </div>
      </FormSection>

      <FormSection title="Valores" subtitle="Aluguel, depósito e vigência do contrato.">
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Aluguel (R$)" required>
            <Input type="number" value={form.rent} onChange={set('rent')} placeholder="1500" mono />
          </FormField>
          <FormField label="Depósito (R$)" required={depositRequired}>
            <Input type="number" value={form.deposit} onChange={set('deposit')} placeholder="1500" mono />
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Parcelas máx. depósito">
            <Input type="number" value={form.depositInstallments} onChange={set('depositInstallments')} placeholder="3" mono />
          </FormField>
          <FormField label="Duração do contrato (meses)">
            <Input type="number" value={form.contractDuration} onChange={set('contractDuration')} placeholder="12" mono />
          </FormField>
        </div>
      </FormSection>

      <FormSection title="Características" subtitle="Quartos, banheiros e capacidade.">
        <div className="grid grid-cols-3 gap-3">
          <FormField label="Quartos" required>
            <Input type="number" value={form.rooms} onChange={set('rooms')} placeholder="2" mono />
          </FormField>
          <FormField label="Banheiros" required>
            <Input type="number" value={form.bathrooms} onChange={set('bathrooms')} placeholder="1" mono />
          </FormField>
          <FormField label="Máx. adultos">
            <Input type="number" value={form.maxAdults} onChange={set('maxAdults')} placeholder="3" mono />
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Aceita pets">
            <Select value={form.allowPets} onChange={set('allowPets')}>
              <option value="false">Não</option>
              <option value="true">Sim</option>
            </Select>
          </FormField>
          <FormField label="Aceita crianças">
            <Select value={form.allowChildren} onChange={set('allowChildren')}>
              <option value="true">Sim</option>
              <option value="false">Não</option>
            </Select>
          </FormField>
          <FormField label="Inclui água">
            <Select value={form.includesWater} onChange={set('includesWater')}>
              <option value="false">Não</option>
              <option value="true">Sim</option>
            </Select>
          </FormField>
          <FormField label="Inclui IPTU">
            <Select value={form.includesIptu} onChange={set('includesIptu')}>
              <option value="false">Não</option>
              <option value="true">Sim</option>
            </Select>
          </FormField>
          <FormField label="Luz individual">
            <Select value={form.individualElectricity} onChange={set('individualElectricity')}>
              <option value="true">Sim</option>
              <option value="false">Não</option>
            </Select>
          </FormField>
          <FormField label="Entrada independente">
            <Select value={form.independentEntrance} onChange={set('independentEntrance')}>
              <option value="true">Sim</option>
              <option value="false">Não</option>
            </Select>
          </FormField>
        </div>
      </FormSection>

      <FormSection title={photosTitle} subtitle={photosSubtitle}>
        <MediaUploader onFilesChange={onFilesChange} />
      </FormSection>

      <FormSection title="Descrição e regras" subtitle="Texto do anúncio e regras da locação.">
        <FormField label="Descrição">
          <Textarea value={form.description} onChange={set('description')} placeholder="Descreva o imóvel..." rows={4} />
        </FormField>
        <FormField label="Regras">
          <Textarea value={form.rules} onChange={set('rules')} placeholder="Regras da locação..." rows={4} />
        </FormField>
        <FormField label="Agendamento de visita">
          <Input value={form.visitSchedule} onChange={set('visitSchedule')} placeholder="Ex: Seg-Sex das 9h às 18h" />
        </FormField>
        <FormField label="URL do anúncio">
          <Input type="url" value={form.listingUrl} onChange={set('listingUrl')} placeholder="https://..." />
        </FormField>
      </FormSection>
    </div>
  );
}
