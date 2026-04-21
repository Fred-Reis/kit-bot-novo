import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EmptyState } from '@/components/empty-state';

describe('EmptyState', () => {
  test('renders title', () => {
    render(<EmptyState illustration="properties" title="Nenhum imóvel" />);
    expect(screen.getByText('Nenhum imóvel')).toBeInTheDocument();
  });

  test('renders subtitle when provided', () => {
    render(<EmptyState illustration="leads" title="Sem leads" subtitle="Os leads aparecem aqui." />);
    expect(screen.getByText('Os leads aparecem aqui.')).toBeInTheDocument();
  });

  test('does not render subtitle when omitted', () => {
    render(<EmptyState illustration="tenants" title="Sem inquilinos" />);
    expect(screen.queryByText(/aparecem/)).not.toBeInTheDocument();
  });

  test('renders action button when action prop provided', () => {
    const onClick = vi.fn();
    render(
      <EmptyState
        illustration="properties"
        title="Nenhum imóvel"
        action={{ label: 'Novo imóvel', onClick }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Novo imóvel' })).toBeInTheDocument();
  });

  test('does not render action button when action omitted', () => {
    render(<EmptyState illustration="filter" title="Sem resultados" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  test('calls action.onClick when button clicked', () => {
    const onClick = vi.fn();
    render(
      <EmptyState
        illustration="leads"
        title="Nenhum lead"
        action={{ label: 'Adicionar', onClick }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test('has data-slot="empty-state"', () => {
    const { container } = render(<EmptyState illustration="payments" title="Sem pagamentos" />);
    expect(container.querySelector('[data-slot="empty-state"]')).toBeInTheDocument();
  });
});
