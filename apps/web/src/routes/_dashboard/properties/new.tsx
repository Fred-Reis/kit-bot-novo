import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { MediaUploader } from '@/components/media-uploader';
import { FormSection } from '@/components/form-section';
import { FormField } from '@/components/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { CustomButton } from '@/components/ui/btn';

function NewPropertyPage() {
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      {/* Header */}
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
            onClick={() => console.warn('TODO: save draft')}
          >
            Salvar rascunho
          </CustomButton>
          <CustomButton
            variant="primary"
            size="sm"
            onClick={() => console.warn('TODO: publish')}
          >
            Publicar
          </CustomButton>
        </div>
      </div>

      {/* 2-col layout */}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Main form */}
        <div className="space-y-5">
          <FormSection title="Dados básicos" subtitle="Identificação e localização do imóvel.">
            <FormField label="Nome do imóvel" required>
              <Input placeholder="Ex: Apartamento Centro — 101" />
            </FormField>
            <FormField label="ID externo" hint="Código do anúncio ou referência interna.">
              <Input placeholder="Ex: AP-101" />
            </FormField>
            <FormField label="Endereço" required>
              <Input placeholder="Rua, número" />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Complemento">
                <Input placeholder="Apto, bloco..." />
              </FormField>
              <FormField label="Bairro" required>
                <Input placeholder="Bairro" />
              </FormField>
            </div>
          </FormSection>

          <FormSection title="Valores" subtitle="Aluguel, depósito e vigência do contrato.">
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Aluguel (R$)" required>
                <Input type="number" placeholder="1500" mono />
              </FormField>
              <FormField label="Depósito (R$)" required>
                <Input type="number" placeholder="1500" mono />
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Parcelas máx. depósito">
                <Input type="number" placeholder="3" mono />
              </FormField>
              <FormField label="Duração do contrato (meses)">
                <Input type="number" placeholder="12" mono />
              </FormField>
            </div>
          </FormSection>

          <FormSection title="Características" subtitle="Quartos, banheiros e capacidade.">
            <div className="grid grid-cols-3 gap-3">
              <FormField label="Quartos" required>
                <Input type="number" placeholder="2" mono />
              </FormField>
              <FormField label="Banheiros" required>
                <Input type="number" placeholder="1" mono />
              </FormField>
              <FormField label="Máx. adultos">
                <Input type="number" placeholder="3" mono />
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Aceita pets">
                <Select>
                  <option value="false">Não</option>
                  <option value="true">Sim</option>
                </Select>
              </FormField>
              <FormField label="Aceita crianças">
                <Select>
                  <option value="true">Sim</option>
                  <option value="false">Não</option>
                </Select>
              </FormField>
              <FormField label="Inclui água">
                <Select>
                  <option value="false">Não</option>
                  <option value="true">Sim</option>
                </Select>
              </FormField>
              <FormField label="Inclui IPTU">
                <Select>
                  <option value="false">Não</option>
                  <option value="true">Sim</option>
                </Select>
              </FormField>
              <FormField label="Luz individual">
                <Select>
                  <option value="true">Sim</option>
                  <option value="false">Não</option>
                </Select>
              </FormField>
              <FormField label="Entrada independente">
                <Select>
                  <option value="true">Sim</option>
                  <option value="false">Não</option>
                </Select>
              </FormField>
            </div>
          </FormSection>

          <FormSection title="Fotos e vídeos" subtitle="Arraste para reordenar. Primeira foto será a capa.">
            <MediaUploader />
          </FormSection>

          <FormSection title="Descrição e regras" subtitle="Texto do anúncio e regras da locação.">
            <FormField label="Descrição">
              <Textarea placeholder="Descreva o imóvel..." rows={4} />
            </FormField>
            <FormField label="Regras">
              <Textarea placeholder="Regras da locação..." rows={4} />
            </FormField>
            <FormField label="Agendamento de visita">
              <Input placeholder="Ex: Seg-Sex das 9h às 18h" />
            </FormField>
            <FormField label="URL do anúncio">
              <Input type="url" placeholder="https://..." />
            </FormField>
          </FormSection>
        </div>

        {/* Sticky sidebar */}
        <div className="space-y-4 self-start lg:sticky lg:top-[76px]">
          <div
            className="rounded-[10px] bg-surface-raised p-5"
            style={{ boxShadow: 'var(--shadow-sm)' }}
          >
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Status
            </h3>
            <FormField label="Visibilidade">
              <Select>
                <option value="true">Ativo</option>
                <option value="false">Inativo</option>
              </Select>
            </FormField>
            <div className="mt-3">
              <FormField label="Primeiro aluguel">
                <Select>
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
