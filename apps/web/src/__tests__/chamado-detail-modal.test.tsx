import type { Complaint, MaintenanceRequest } from '@kit-manager/types';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { ChamadoDetailModal } from '@/components/chamado-detail-modal';

function makeComplaint(overrides: Partial<Complaint> = {}): Complaint {
  return {
    id: 'complaint-1',
    ownerId: 'owner-1',
    tenantId: 'tenant-1',
    summary: 'Barulho excessivo do vizinho',
    content: 'Relato completo e bem longo do inquilino sobre o barulho, noite após noite.',
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
    responsibility: 'unclear',
    severity: 'media',
    summary: 'Vazamento sob a pia',
    status: 'open',
    mediaUrls: ['https://signed.example/foto-a.jpg', 'https://signed.example/foto-b.jpg'],
    createdAt: '2026-07-29T01:00:00Z',
    updatedAt: '2026-07-29T01:00:00Z',
    ...overrides,
  };
}

describe('ChamadoDetailModal', () => {
  test('não renderiza nada quando item é null', () => {
    const { container } = render(<ChamadoDetailModal item={null} onClose={vi.fn()} />);
    expect(container.querySelector('[data-slot="chamado-detail-modal"]')).not.toBeInTheDocument();
  });

  test('reclamação: mostra resumo e conteúdo completo', () => {
    render(
      <ChamadoDetailModal item={{ kind: 'complaint', data: makeComplaint() }} onClose={vi.fn()} />,
    );
    expect(screen.getByText('Barulho excessivo do vizinho')).toBeInTheDocument();
    expect(
      screen.getByText('Relato completo e bem longo do inquilino sobre o barulho, noite após noite.'),
    ).toBeInTheDocument();
  });

  test('chamado de manutenção: mostra tipo, severidade e todas as fotos', () => {
    render(
      <ChamadoDetailModal
        item={{ kind: 'maintenance', data: makeMaintenanceRequest() }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/hidráulica/i)).toBeInTheDocument();
    expect(screen.getByText(/media/i)).toBeInTheDocument();
    expect(screen.getByAltText('Foto 1 do chamado')).toHaveAttribute(
      'src',
      'https://signed.example/foto-a.jpg',
    );
    expect(screen.getByAltText('Foto 2 do chamado')).toHaveAttribute(
      'src',
      'https://signed.example/foto-b.jpg',
    );
  });

  test('permite trocar a responsabilidade e salvar', () => {
    const onSaveResponsibility = vi.fn();
    render(
      <ChamadoDetailModal
        item={{ kind: 'maintenance', data: makeMaintenanceRequest({ responsibility: 'unclear' }) }}
        onClose={vi.fn()}
        onSaveResponsibility={onSaveResponsibility}
      />,
    );
    fireEvent.change(screen.getByLabelText(/responsabilidade/i), { target: { value: 'owner' } });
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }));
    expect(onSaveResponsibility).toHaveBeenCalledWith('maintenance-1', 'owner');
  });

  test('botão salvar só aparece quando a responsabilidade muda', () => {
    render(
      <ChamadoDetailModal
        item={{ kind: 'maintenance', data: makeMaintenanceRequest({ responsibility: 'owner' }) }}
        onClose={vi.fn()}
        onSaveResponsibility={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /salvar/i })).not.toBeInTheDocument();
  });

  test('Escape fecha o modal', () => {
    const onClose = vi.fn();
    render(
      <ChamadoDetailModal item={{ kind: 'complaint', data: makeComplaint() }} onClose={onClose} />,
    );
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
