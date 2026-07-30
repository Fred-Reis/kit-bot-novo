import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { ProviderFormModal } from '@/components/provider-form-modal';

describe('ProviderFormModal', () => {
  test('não renderiza nada quando fechado', () => {
    const { container } = render(
      <ProviderFormModal open={false} onClose={vi.fn()} onSubmit={vi.fn()} />,
    );
    expect(container.querySelector('[data-slot="provider-form-modal"]')).not.toBeInTheDocument();
  });

  test('envia nome, telefone e tipo preenchidos', () => {
    const onSubmit = vi.fn();
    render(<ProviderFormModal open onClose={vi.fn()} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/nome/i), { target: { value: 'João Elétrica' } });
    fireEvent.change(screen.getByLabelText(/telefone/i), { target: { value: '11955554444' } });
    fireEvent.change(screen.getByLabelText(/tipo/i), { target: { value: 'eletrica' } });
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }));
    expect(onSubmit).toHaveBeenCalledWith({ name: 'João Elétrica', phone: '11955554444', type: 'eletrica' });
  });

  test('pré-preenche quando initialValue é passado (edição)', () => {
    render(
      <ProviderFormModal
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        initialValue={{ name: 'Ana Hidráulica', phone: '11922221111', type: 'hidraulica' }}
      />,
    );
    expect(screen.getByLabelText(/nome/i)).toHaveValue('Ana Hidráulica');
  });

  test('reabrir pra editar outro prestador sem desmontar atualiza os campos (não fica com estado obsoleto)', () => {
    const { rerender } = render(
      <ProviderFormModal
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        initialValue={{ name: 'Ana Hidráulica', phone: '11922221111', type: 'hidraulica' }}
      />,
    );
    rerender(
      <ProviderFormModal
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        initialValue={{ name: 'Bruno Elétrica', phone: '11933332222', type: 'eletrica' }}
      />,
    );
    expect(screen.getByLabelText(/nome/i)).toHaveValue('Bruno Elétrica');
    expect(screen.getByLabelText(/telefone/i)).toHaveValue('11933332222');
  });

  test('Escape fecha o modal', () => {
    const onClose = vi.fn();
    render(<ProviderFormModal open onClose={onClose} onSubmit={vi.fn()} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  test('botão Salvar fica desabilitado com nome ou telefone vazios', () => {
    render(<ProviderFormModal open onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByRole('button', { name: /salvar/i })).toBeDisabled();
  });
});
