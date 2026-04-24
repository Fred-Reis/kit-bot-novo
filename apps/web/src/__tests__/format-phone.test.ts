import { describe, test, expect } from 'vitest';
import { formatPhone } from '@/lib/leads';

describe('formatPhone', () => {
  test('strips @s.whatsapp.net suffix', () => {
    expect(formatPhone('5524999204465@s.whatsapp.net')).toBe('5524999204465');
  });

  test('strips any @-prefixed suffix', () => {
    expect(formatPhone('5511999999999@c.us')).toBe('5511999999999');
  });

  test('leaves plain phone unchanged', () => {
    expect(formatPhone('5524999204465')).toBe('5524999204465');
  });

  test('handles empty string', () => {
    expect(formatPhone('')).toBe('');
  });
});
