import { describe, test, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MediaUploader } from '@/components/media-uploader';

beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID: () => Math.random().toString(36).slice(2) },
    configurable: true,
  });
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock');
  globalThis.URL.revokeObjectURL = vi.fn();
});

describe('MediaUploader', () => {
  test('renders drop zone text', () => {
    render(<MediaUploader />);
    expect(screen.getByText(/Arraste fotos e vídeos/i)).toBeInTheDocument();
  });

  test('accepted image file shows Foto 1 badge', async () => {
    render(<MediaUploader />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['img'], 'photo.jpg', { type: 'image/jpeg' });
    await userEvent.upload(input, file);
    expect(screen.getByText('Foto 1')).toBeInTheDocument();
  });

  test('accepted video file shows Vídeo badge', async () => {
    render(<MediaUploader />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['vid'], 'clip.mp4', { type: 'video/mp4' });
    await userEvent.upload(input, file);
    expect(screen.getByText('Vídeo')).toBeInTheDocument();
  });

  test('count line shows correct photo and video totals', async () => {
    render(<MediaUploader />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const img = new File(['a'], 'a.jpg', { type: 'image/jpeg' });
    const vid = new File(['b'], 'b.mp4', { type: 'video/mp4' });
    await userEvent.upload(input, [img, vid]);
    expect(screen.getByText(/1 foto\(s\) · 1 vídeo\(s\)/)).toBeInTheDocument();
  });

  test('non-media files are ignored', async () => {
    render(<MediaUploader />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const pdf = new File(['doc'], 'file.pdf', { type: 'application/pdf' });
    await userEvent.upload(input, pdf);
    expect(screen.queryByText(/foto\(s\)/)).not.toBeInTheDocument();
  });

  test('remove button deletes the item', async () => {
    render(<MediaUploader />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'x.jpg', { type: 'image/jpeg' });
    await userEvent.upload(input, file);
    expect(screen.getByText('Foto 1')).toBeInTheDocument();

    const removeBtn = screen.getByRole('button', { name: /remover/i });
    fireEvent.click(removeBtn);

    expect(screen.queryByText('Foto 1')).not.toBeInTheDocument();
    expect(screen.queryByText(/foto\(s\)/)).not.toBeInTheDocument();
  });

  test('multiple photos are numbered sequentially', async () => {
    render(<MediaUploader />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const a = new File(['a'], 'a.jpg', { type: 'image/jpeg' });
    const b = new File(['b'], 'b.png', { type: 'image/png' });
    await userEvent.upload(input, [a, b]);
    expect(screen.getByText('Foto 1')).toBeInTheDocument();
    expect(screen.getByText('Foto 2')).toBeInTheDocument();
  });
});
