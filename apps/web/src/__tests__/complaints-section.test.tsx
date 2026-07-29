import type { Complaint } from '@kit-manager/types';
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

describe('ComplaintsSection', () => {
  test('renders nothing when there are no complaints and it is not loading', () => {
    const { container } = render(
      <ComplaintsSection complaints={[]} isLoading={false} isAdvancing={false} onAdvanceStatus={vi.fn()} />,
    );
    expect(container.querySelector('[data-slot="complaints-section"]')).not.toBeInTheDocument();
  });

  test('renders summary, content and status pill', () => {
    render(
      <ComplaintsSection
        complaints={[makeComplaint()]}
        isLoading={false}
        isAdvancing={false}
        onAdvanceStatus={vi.fn()}
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
        isLoading={false}
        isAdvancing={false}
        onAdvanceStatus={onAdvanceStatus}
      />,
    );
    fireEvent.click(screen.getByText(/marcar como reconhecida/i));
    expect(onAdvanceStatus).toHaveBeenCalledWith('complaint-1', 'acknowledged');
  });

  test('resolved complaints show no advance button', () => {
    render(
      <ComplaintsSection
        complaints={[makeComplaint({ status: 'resolved' })]}
        isLoading={false}
        isAdvancing={false}
        onAdvanceStatus={vi.fn()}
      />,
    );
    expect(screen.queryByText(/marcar como/i)).not.toBeInTheDocument();
  });
});
