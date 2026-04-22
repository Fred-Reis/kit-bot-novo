import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmButton } from '@/components/confirm-button';

describe('ConfirmButton', () => {
  test('renders trigger label initially', () => {
    render(<ConfirmButton onConfirm={vi.fn()} label="Excluir" />);
    expect(screen.getByRole('button', { name: 'Excluir' })).toBeInTheDocument();
    expect(screen.queryByText('Confirmar?')).not.toBeInTheDocument();
  });

  test('clicking trigger shows confirm UI', () => {
    render(<ConfirmButton onConfirm={vi.fn()} label="Excluir" />);
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }));
    expect(screen.getByText('Confirmar?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sim' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Não' })).toBeInTheDocument();
  });

  test('clicking Não returns to initial state', () => {
    render(<ConfirmButton onConfirm={vi.fn()} label="Excluir" />);
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }));
    fireEvent.click(screen.getByRole('button', { name: 'Não' }));
    expect(screen.queryByText('Confirmar?')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Excluir' })).toBeInTheDocument();
  });

  test('clicking Sim calls onConfirm', () => {
    const onConfirm = vi.fn();
    render(<ConfirmButton onConfirm={onConfirm} label="Excluir" />);
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sim' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  test('clicking Sim does not call onConfirm when disabled', () => {
    const onConfirm = vi.fn();
    render(<ConfirmButton onConfirm={onConfirm} label="Excluir" disabled />);
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }));
    // confirm state never shown when disabled
    expect(screen.queryByText('Confirmar?')).not.toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test('renders custom confirmLabel', () => {
    render(<ConfirmButton onConfirm={vi.fn()} label="Arquivar" confirmLabel="Arquivar mesmo assim" />);
    fireEvent.click(screen.getByRole('button', { name: 'Arquivar' }));
    expect(screen.getByRole('button', { name: 'Arquivar mesmo assim' })).toBeInTheDocument();
  });
});
