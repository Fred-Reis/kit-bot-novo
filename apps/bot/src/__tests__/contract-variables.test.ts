import { describe, expect, test } from 'bun:test';
import { buildLeadAutoMap, uniquePlaceholders } from '@/services/contract-variables';

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
});
