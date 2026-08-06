import type { Complaint, MaintenanceRequest } from '@kit-manager/types';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { ComplaintsSection } from '@/components/complaints-section';

function makeComplaint(overrides: Partial<Complaint> = {}): Complaint {
  return {
    id: 'complaint-1',
    ownerId: 'owner-1',
    tenantId: 'tenant-1',
    summary: 'Barulho excessivo do vizinho',
    content: 'Relato completo do inquilino sobre o barulho.',
    status: 'open',
    createdAt: '2026-07-29T00:00:00Z',
    ...overrides,
  };
}

function makeMaintenanceRequest(overrides: Partial<MaintenanceRequest> = {}): MaintenanceRequest {
  return {
    id: 'maintenance-1',
    ownerId: 'owner-1',
    tenantId: 'tenant-1',
    propertyId: 'property-1',
    type: 'hidraulica',
    responsibility: 'owner',
    severity: 'media',
    summary: 'Vazamento sob a pia',
    status: 'open',
    mediaUrls: ['https://signed.example/photo.jpg'],
    createdAt: '2026-07-29T01:00:00Z',
    updatedAt: '2026-07-29T01:00:00Z',
    ...overrides,
  };
}

describe('ComplaintsSection', () => {
  test('renders nothing when there are no complaints and it is not loading', () => {
    const { container } = render(
      <ComplaintsSection
        complaints={[]}
        maintenanceRequests={[]}
        isLoading={false}
        isAdvancing={false}
        onAdvanceStatus={vi.fn()}
        onAdvanceMaintenanceStatus={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-slot="complaints-section"]')).not.toBeInTheDocument();
  });

  test('renders summary, content and status pill', () => {
    render(
      <ComplaintsSection
        complaints={[makeComplaint()]}
        maintenanceRequests={[]}
        isLoading={false}
        isAdvancing={false}
        onAdvanceStatus={vi.fn()}
        onAdvanceMaintenanceStatus={vi.fn()}
      />,
    );
    expect(screen.getByText('Barulho excessivo do vizinho')).toBeInTheDocument();
    expect(screen.getByText('Relato completo do inquilino sobre o barulho.')).toBeInTheDocument();
    expect(screen.getByText('Aberta')).toBeInTheDocument();
  });

  test('advance button calls onAdvanceStatus with the next status', () => {
    const onAdvanceStatus = vi.fn();
    render(
      <ComplaintsSection
        complaints={[makeComplaint({ status: 'open' })]}
        maintenanceRequests={[]}
        isLoading={false}
        isAdvancing={false}
        onAdvanceStatus={onAdvanceStatus}
        onAdvanceMaintenanceStatus={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText(/marcar como reconhecida/i));
    expect(onAdvanceStatus).toHaveBeenCalledWith('complaint-1', 'acknowledged');
  });

  test('resolved complaints show no advance button', () => {
    render(
      <ComplaintsSection
        complaints={[makeComplaint({ status: 'resolved' })]}
        maintenanceRequests={[]}
        isLoading={false}
        isAdvancing={false}
        onAdvanceStatus={vi.fn()}
        onAdvanceMaintenanceStatus={vi.fn()}
      />,
    );
    expect(screen.queryByText(/marcar como/i)).not.toBeInTheDocument();
  });
});

describe('ComplaintsSection — manutenção', () => {
  test('renderiza chamados de manutenção junto com reclamações', () => {
    render(
      <ComplaintsSection
        complaints={[makeComplaint()]}
        maintenanceRequests={[makeMaintenanceRequest()]}
        isLoading={false}
        isAdvancing={false}
        onAdvanceStatus={vi.fn()}
        onAdvanceMaintenanceStatus={vi.fn()}
      />,
    );
    expect(screen.getByText('Vazamento sob a pia')).toBeInTheDocument();
  });

  test('exibe a galeria de fotos do chamado de manutenção', () => {
    render(
      <ComplaintsSection
        complaints={[]}
        maintenanceRequests={[makeMaintenanceRequest()]}
        isLoading={false}
        isAdvancing={false}
        onAdvanceStatus={vi.fn()}
        onAdvanceMaintenanceStatus={vi.fn()}
      />,
    );
    expect(screen.getByAltText(/foto \d+ do chamado/i)).toHaveAttribute('src', 'https://signed.example/photo.jpg');
  });

  test('múltiplas fotos no mesmo chamado têm alt text distinto (não repetido)', () => {
    render(
      <ComplaintsSection
        complaints={[]}
        maintenanceRequests={[
          makeMaintenanceRequest({
            mediaUrls: ['https://signed.example/foto-a.jpg', 'https://signed.example/foto-b.jpg'],
          }),
        ]}
        isLoading={false}
        isAdvancing={false}
        onAdvanceStatus={vi.fn()}
        onAdvanceMaintenanceStatus={vi.fn()}
      />,
    );
    expect(screen.getByAltText('Foto 1 do chamado')).toHaveAttribute('src', 'https://signed.example/foto-a.jpg');
    expect(screen.getByAltText('Foto 2 do chamado')).toHaveAttribute('src', 'https://signed.example/foto-b.jpg');
  });

  test('anexo que não é imagem (ex: vídeo/pdf) vira link de arquivo, não <img> quebrada', () => {
    render(
      <ComplaintsSection
        complaints={[]}
        maintenanceRequests={[
          makeMaintenanceRequest({ mediaUrls: ['https://signed.example/evidencia.mp4?token=abc'] }),
        ]}
        isLoading={false}
        isAdvancing={false}
        onAdvanceStatus={vi.fn()}
        onAdvanceMaintenanceStatus={vi.fn()}
      />,
    );
    expect(screen.queryByAltText(/foto \d+ do chamado/i)).not.toBeInTheDocument();
    expect(screen.getByText(/ver arquivo/i)).toBeInTheDocument();
  });

  test('avança status de manutenção chama onAdvanceMaintenanceStatus com in_progress', () => {
    const onAdvanceMaintenanceStatus = vi.fn();
    render(
      <ComplaintsSection
        complaints={[]}
        maintenanceRequests={[makeMaintenanceRequest({ status: 'acknowledged' })]}
        isLoading={false}
        isAdvancing={false}
        onAdvanceStatus={vi.fn()}
        onAdvanceMaintenanceStatus={onAdvanceMaintenanceStatus}
      />,
    );
    fireEvent.click(screen.getByText(/marcar como em andamento/i));
    expect(onAdvanceMaintenanceStatus).toHaveBeenCalledWith('maintenance-1', 'in_progress');
  });

  test('"Ver detalhes" abre o modal com o conteúdo completo da reclamação', () => {
    render(
      <ComplaintsSection
        complaints={[makeComplaint({ content: 'Relato bem longo e detalhado do inquilino sobre o barulho.' })]}
        maintenanceRequests={[]}
        isLoading={false}
        isAdvancing={false}
        onAdvanceStatus={vi.fn()}
        onAdvanceMaintenanceStatus={vi.fn()}
      />,
    );
    fireEvent.click(screen.getAllByText(/ver detalhes/i)[0]!);
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText('Relato bem longo e detalhado do inquilino sobre o barulho.'),
    ).toBeInTheDocument();
  });

  test('"Ver detalhes" no chamado de manutenção permite corrigir a responsabilidade', () => {
    const onUpdateMaintenanceResponsibility = vi.fn();
    render(
      <ComplaintsSection
        complaints={[]}
        maintenanceRequests={[makeMaintenanceRequest({ responsibility: 'unclear' })]}
        isLoading={false}
        isAdvancing={false}
        onAdvanceStatus={vi.fn()}
        onAdvanceMaintenanceStatus={vi.fn()}
        onUpdateMaintenanceResponsibility={onUpdateMaintenanceResponsibility}
      />,
    );
    fireEvent.click(screen.getByText(/ver detalhes/i));
    fireEvent.change(screen.getByLabelText(/responsabilidade/i), { target: { value: 'owner' } });
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }));
    expect(onUpdateMaintenanceResponsibility).toHaveBeenCalledWith('maintenance-1', 'owner');
  });
});
