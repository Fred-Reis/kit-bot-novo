import { describe, expect, test } from 'bun:test';
import {
  buildTenantComplaintMessage,
  buildTenantEmergencyMessage,
  buildTenantEscalationMessage,
} from '@/services/notify';

describe('buildTenantEscalationMessage', () => {
  test('inclui nome, telefone e motivo', () => {
    const msg = buildTenantEscalationMessage({
      tenantName: 'Maria Silva',
      tenantPhone: '11988887777',
      reason: 'Pedido fora do escopo atual (financeiro)',
    });
    expect(msg).toContain('Maria Silva');
    expect(msg).toContain('11988887777');
    expect(msg).toContain('financeiro');
  });
});

describe('buildTenantEmergencyMessage', () => {
  test('inclui nome, telefone e imóvel, e é marcado como urgente', () => {
    const msg = buildTenantEmergencyMessage({
      tenantName: 'João Souza',
      tenantPhone: '11977776666',
      propertyName: 'Kitnet no Retiro',
    });
    expect(msg).toContain('João Souza');
    expect(msg).toContain('11977776666');
    expect(msg).toContain('Kitnet no Retiro');
    expect(msg.toUpperCase()).toContain('EMERGÊNCIA');
  });
});

describe('buildTenantComplaintMessage', () => {
  test('inclui nome, telefone e resumo', () => {
    const msg = buildTenantComplaintMessage({
      tenantName: 'Ana Costa',
      tenantPhone: '11966665555',
      summary: 'Barulho excessivo do vizinho à noite',
    });
    expect(msg).toContain('Ana Costa');
    expect(msg).toContain('11966665555');
    expect(msg).toContain('Barulho excessivo do vizinho à noite');
  });
});
