import { describe, test, expect, vi, beforeAll } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
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

describe('MediaUploader onFilesChange', () => {
  test('calls onFilesChange with File array when image added', async () => {
    const onChange = vi.fn();
    render(<MediaUploader onFilesChange={onChange} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['img'], 'photo.jpg', { type: 'image/jpeg' });
    await userEvent.upload(input, file);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith([file]);
  });

  test('calls onFilesChange with empty array when last file removed', async () => {
    const onChange = vi.fn();
    render(<MediaUploader onFilesChange={onChange} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['img'], 'photo.jpg', { type: 'image/jpeg' });
    await userEvent.upload(input, file);
    onChange.mockClear();

    const removeBtn = document.querySelector('[aria-label="Remover"]') as HTMLElement;
    fireEvent.click(removeBtn);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  test('includes all files in onFilesChange when multiple added', async () => {
    const onChange = vi.fn();
    render(<MediaUploader onFilesChange={onChange} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const a = new File(['a'], 'a.jpg', { type: 'image/jpeg' });
    const b = new File(['b'], 'b.mp4', { type: 'video/mp4' });
    await userEvent.upload(input, [a, b]);
    const lastCall = onChange.mock.calls.at(-1)![0] as File[];
    expect(lastCall).toHaveLength(2);
    expect(lastCall.map((f) => f.name)).toContain('a.jpg');
    expect(lastCall.map((f) => f.name)).toContain('b.mp4');
  });

  test('does not call onFilesChange when non-media file ignored', async () => {
    const onChange = vi.fn();
    render(<MediaUploader onFilesChange={onChange} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const pdf = new File(['doc'], 'doc.pdf', { type: 'application/pdf' });
    await userEvent.upload(input, pdf);
    expect(onChange).not.toHaveBeenCalled();
  });
});
