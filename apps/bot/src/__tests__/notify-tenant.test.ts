import { describe, expect, test } from 'bun:test';
import {
  buildTenantComplaintMessage,
  buildTenantEmergencyMessage,
  buildTenantEscalationMessage,
  buildTenantMaintenanceRequestMessage,
  buildTenantMediaForwardedMessage,
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

describe('buildTenantMaintenanceRequestMessage', () => {
  test('inclui nome, telefone, tipo, resumo, responsabilidade e severidade', () => {
    const msg = buildTenantMaintenanceRequestMessage({
      tenantName: 'Carlos Nunes',
      tenantPhone: '11944443333',
      summary: 'Vazamento sob a pia da cozinha',
      type: 'hidraulica',
      responsibility: 'owner',
      severity: 'media',
    });
    expect(msg).toContain('Carlos Nunes');
    expect(msg).toContain('11944443333');
    expect(msg).toContain('Vazamento sob a pia da cozinha');
    expect(msg.toLowerCase()).toContain('proprietário');
    expect(msg).toContain('media');
    expect(msg).toContain('Hidráulica');
  });
});

describe('buildTenantMediaForwardedMessage', () => {
  test('inclui nome, telefone e os links das mídias', () => {
    const msg = buildTenantMediaForwardedMessage({
      tenantName: 'Paula Reis',
      tenantPhone: '11933332222',
      mediaUrls: ['https://signed.example/foto1.jpg'],
    });
    expect(msg).toContain('Paula Reis');
    expect(msg).toContain('11933332222');
    expect(msg).toContain('https://signed.example/foto1.jpg');
  });

  test('sem mediaUrls, avisa que não conseguiu gerar o link', () => {
    const msg = buildTenantMediaForwardedMessage({
      tenantName: 'Paula Reis',
      tenantPhone: '11933332222',
      mediaUrls: [],
    });
    expect(msg.toLowerCase()).toContain('painel');
  });
});
