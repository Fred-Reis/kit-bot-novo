import { describe, expect, test } from 'bun:test';
import { extractCpfFromDocs } from '@/services/cpf';

describe('extractCpfFromDocs', () => {
  test('returns null for empty docs array', () => {
    expect(extractCpfFromDocs([])).toBeNull();
  });

  test('returns null when no CPF in text', () => {
    expect(extractCpfFromDocs([{ ocrText: 'João da Silva RG 12345' }])).toBeNull();
  });

  test('extracts formatted CPF 000.000.000-00', () => {
    expect(extractCpfFromDocs([{ ocrText: 'CPF: 123.456.789-09' }])).toBe('123.456.789-09');
  });

  test('extracts and normalizes unformatted CPF', () => {
    expect(extractCpfFromDocs([{ ocrText: 'cpf 12345678909' }])).toBe('123.456.789-09');
  });

  test('finds CPF in second doc when first has none', () => {
    expect(
      extractCpfFromDocs([
        { ocrText: 'RG: 12.345.678-9' },
        { ocrText: 'CPF 321.654.987-00' },
      ]),
    ).toBe('321.654.987-00');
  });

  test('returns null when ocrText is null', () => {
    expect(extractCpfFromDocs([{ ocrText: null }])).toBeNull();
  });

  test('normalizes partial-formatted CPF', () => {
    expect(extractCpfFromDocs([{ ocrText: 'CPF: 456.789.123-45' }])).toBe('456.789.123-45');
  });

  test('prefers labeled CPF over unlabeled 11-digit fields (CNH REGISTRO)', () => {
    const ocrText = 'REGISTRO: 12345678901\nCPF: 123.456.789-09';
    expect(extractCpfFromDocs([{ ocrText }])).toBe('123.456.789-09');
  });
});
