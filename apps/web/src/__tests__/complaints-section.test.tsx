import type { Complaint, MaintenanceRequest } from '@kit-manager/types';
import { fireEvent, render, screen } from '@testing-library/react';
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
    expect(screen.getByAltText(/foto do chamado/i)).toHaveAttribute('src', 'https://signed.example/photo.jpg');
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
});
