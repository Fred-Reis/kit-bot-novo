import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Pill } from '@/components/ui/pill';

describe('Pill', () => {
  test('renders children', () => {
    render(<Pill>KYC pendente</Pill>);
    expect(screen.getByText('KYC pendente')).toBeInTheDocument();
  });

  test('renders dot when dot=true', () => {
    const { container } = render(<Pill dot>Ativo</Pill>);
    const dot = container.querySelector('span.size-1\\.5');
    expect(dot).toBeInTheDocument();
  });

  test('does not render dot by default', () => {
    const { container } = render(<Pill>Sem dot</Pill>);
    const dot = container.querySelector('span.size-1\\.5');
    expect(dot).not.toBeInTheDocument();
  });

  test('applies ok tone classes', () => {
    const { container } = render(<Pill tone="ok">Pago</Pill>);
    const el = container.querySelector('[data-slot="pill"]');
    expect(el?.className).toContain('text-success');
  });

  test('applies warn tone classes', () => {
    const { container } = render(<Pill tone="warn">Pendente</Pill>);
    const el = container.querySelector('[data-slot="pill"]');
    expect(el?.className).toContain('text-warning');
  });

  test('applies bad tone classes', () => {
    const { container } = render(<Pill tone="bad">Erro</Pill>);
    const el = container.querySelector('[data-slot="pill"]');
    expect(el?.className).toContain('text-destructive');
  });

  test('has data-slot="pill"', () => {
    const { container } = render(<Pill>x</Pill>);
    expect(container.querySelector('[data-slot="pill"]')).toBeInTheDocument();
  });
});
