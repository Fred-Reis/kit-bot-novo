import { describe, expect, test } from 'bun:test';
import {
  addCivilMonths,
  buildLeadAutoMap,
  formatDatePtBR,
  getSaoPauloDateParts,
  uniquePlaceholders,
} from '@/services/contract-variables';

const baseProperty = {
  externalId: 'KIT-01',
  name: 'Kit Centro',
  address: 'Rua A, 100',
  complement: 'Apto 2',
  neighborhood: 'Centro',
  rent: 1500,
  deposit: 1500,
  contractMonths: 12,
  owner: { name: 'Maria Proprietária' },
};

const baseLead = { name: 'João Locatário', phone: '5511999990000@s.whatsapp.net' };

describe('uniquePlaceholders', () => {
  test('extracts unique {{var}} tokens, ignoring duplicates', () => {
    expect(uniquePlaceholders('{{nome_locador}} e {{nome_locador}} - {{cpf_locador}}')).toEqual([
      '{{nome_locador}}',
      '{{cpf_locador}}',
    ]);
  });

  test('returns empty array when no placeholders', () => {
    expect(uniquePlaceholders('sem variáveis aqui')).toEqual([]);
  });
});

describe('buildLeadAutoMap', () => {
  test('maps locatário fields from lead', () => {
    const map = buildLeadAutoMap(baseLead, baseProperty, 10, '123.456.789-09', '12.345.678-9');
    expect(map.nome_locatario).toBe('João Locatário');
    expect(map.cpf_locatario).toBe('123.456.789-09');
    expect(map.rg_locatario).toBe('12.345.678-9');
    expect(map.telefone_locatario).toBe('5511999990000');
  });

  test('maps locador name from property.owner', () => {
    const map = buildLeadAutoMap(baseLead, baseProperty, 10, null);
    expect(map.locador).toBe('Maria Proprietária');
    expect(map.nome_locador).toBe('Maria Proprietária');
  });

  test('maps imóvel, valores e prazo', () => {
    const map = buildLeadAutoMap(baseLead, baseProperty, 15, null);
    expect(map.unidade).toBe('KIT-01');
    expect(map.endereco).toBe('Rua A, 100, Apto 2');
    expect(map.bairro).toBe('Centro');
    expect(map.aluguel).toBe('R$ 1.500,00');
    expect(map.prazo_meses).toBe('12');
    expect(map.vencimento).toBe('15');
  });

  test('omits cpf_locatario/rg_locatario when null', () => {
    const map = buildLeadAutoMap(baseLead, baseProperty, 10, null);
    expect('cpf_locatario' in map).toBe(false);
    expect('rg_locatario' in map).toBe(false);
  });

  test('maps cpf_locador, cnpj_locador, endereco_locador when present on owner', () => {
    const property = {
      ...baseProperty,
      owner: { name: 'Maria Proprietária', cpf: '111.222.333-44', cnpj: '12.345.678/0001-99', address: 'Av. B, 200' },
    };
    const map = buildLeadAutoMap(baseLead, property, 10, null);
    expect(map.cpf_locador).toBe('111.222.333-44');
    expect(map.cnpj_locador).toBe('12.345.678/0001-99');
    expect(map.endereco_locador).toBe('Av. B, 200');
  });

  test('omits cpf_locador, cnpj_locador, endereco_locador when absent on owner', () => {
    const map = buildLeadAutoMap(baseLead, baseProperty, 10, null);
    expect('cpf_locador' in map).toBe(false);
    expect('cnpj_locador' in map).toBe(false);
    expect('endereco_locador' in map).toBe(false);
  });
});

describe('addCivilMonths', () => {
  test('clamps Jan 31 + 1 month to Feb 28 in a non-leap year', () => {
    const result = addCivilMonths({ year: 2026, month: 0, day: 31 }, 1);
    expect(formatDatePtBR(result)).toBe('28/02/2026');
  });

  test('clamps Jan 31 + 1 month to Feb 29 in a leap year', () => {
    const result = addCivilMonths({ year: 2028, month: 0, day: 31 }, 1);
    expect(formatDatePtBR(result)).toBe('29/02/2028');
  });

  test('rolls Dec 31 + 1 month into January of the next year', () => {
    const result = addCivilMonths({ year: 2026, month: 11, day: 31 }, 1);
    expect(formatDatePtBR(result)).toBe('31/01/2027');
  });

  test('clamps Jan 30 + 1 month to Feb 28', () => {
    const result = addCivilMonths({ year: 2026, month: 0, day: 30 }, 1);
    expect(formatDatePtBR(result)).toBe('28/02/2026');
  });

  test('preserves the day for a normal same-length-month addition', () => {
    const result = addCivilMonths({ year: 2026, month: 2, day: 15 }, 3);
    expect(formatDatePtBR(result)).toBe('15/06/2026');
  });

  test('adds 12 months across a year boundary without drift', () => {
    const result = addCivilMonths({ year: 2026, month: 6, day: 20 }, 12);
    expect(formatDatePtBR(result)).toBe('20/07/2027');
  });
});

describe('getSaoPauloDateParts', () => {
  test('extracts the São Paulo calendar day from a UTC instant, even when it differs from the UTC day', () => {
    // 02:00 UTC on Jan 1 is still Dec 31 in America/Sao_Paulo (UTC-3)
    const parts = getSaoPauloDateParts(new Date('2026-01-01T02:00:00Z'));
    expect(parts).toEqual({ year: 2025, month: 11, day: 31 });
  });
});
