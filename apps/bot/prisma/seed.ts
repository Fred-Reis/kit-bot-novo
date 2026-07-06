import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

function monthStr(offsetMonths: number): string {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() + offsetMonths)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

async function main() {
  console.log('Seeding database...')

  // ─── Owner ────────────────────────────────────────────────────────────────
  const owner = await prisma.owner.upsert({
    where: { phone: '5524999999999' },
    update: { name: 'Fred' },
    create: { name: 'Fred', phone: '5524999999999' },
  })
  console.log(`Owner: ${owner.name} (${owner.id})`)
  const oid = owner.id

  // ─── Properties ───────────────────────────────────────────────────────────
  const propBase = {
    ownerId: oid,
    category: 'kitnet',
    rooms: 1,
    bathrooms: 1,
    deposit: 900,
    depositInstallmentsMax: 3,
    contractMonths: 6,
    includesWater: true,
    includesIptu: true,
    individualElectricity: true,
    acceptsPets: false,
    maxAdults: 2,
    acceptsChildren: false,
    active: true,
    visitSchedule: 'Segunda a sexta, 9h–17h.',
  }

  const p1 = await prisma.property.upsert({
    where: { externalId: 'KIT-01' },
    update: { status: 'available', name: 'Kitnet no Retiro – Unid. 01', visitSchedule: 'Segunda a sexta, 9h–17h.' },
    create: {
      ...propBase,
      externalId: 'KIT-01',
      name: 'Kitnet no Retiro – Unid. 01',
      address: 'Rua Laranjeiras, 111',
      neighborhood: 'Retiro',
      rent: 900,
      area: 28,
      status: 'available',
      description: 'Quitinete nova, porcelanato, suíte, lavanderia coberta. Próxima à CSN.',
      rulesText: 'Locação direta. Sem pets. Máx 2 adultos.',
      listingUrl: 'https://rj.olx.com.br/serra-angra-dos-reis-e-regiao/imoveis/alugo-kitnet-no-retiro-1487572817',
    },
  })

  const p2 = await prisma.property.upsert({
    where: { externalId: 'KIT-02' },
    update: { status: 'available', name: 'Kitnet no Retiro – Unid. 02', visitSchedule: 'Segunda a sexta, 9h–17h.' },
    create: {
      ...propBase,
      externalId: 'KIT-02',
      name: 'Kitnet no Retiro – Unid. 02',
      address: 'Rua Laranjeiras, 111',
      neighborhood: 'Retiro',
      rent: 900,
      area: 28,
      status: 'available',
      description: 'Unidade igual à 01, segundo andar, mais silenciosa.',
      rulesText: 'Locação direta. Sem pets. Máx 2 adultos.',
    },
  })

  const p3 = await prisma.property.upsert({
    where: { externalId: 'KIT-03' },
    update: { status: 'rented', name: 'Kitnet no Retiro – Unid. 03' },
    create: {
      ...propBase,
      externalId: 'KIT-03',
      name: 'Kitnet no Retiro – Unid. 03',
      address: 'Rua Laranjeiras, 111',
      neighborhood: 'Retiro',
      rent: 900,
      area: 28,
      status: 'rented',
      description: 'Ocupada por inquilino ativo.',
      rulesText: 'Locação direta. Sem pets. Máx 2 adultos.',
    },
  })

  const p4 = await prisma.property.upsert({
    where: { externalId: 'KIT-04' },
    update: { status: 'rented', name: 'Studio no Centro' },
    create: {
      ...propBase,
      externalId: 'KIT-04',
      name: 'Studio no Centro',
      address: 'Av. Lucas Evangelista, 230',
      neighborhood: 'Vila Santa Cecília',
      rent: 1100,
      deposit: 1100,
      area: 35,
      status: 'rented',
      acceptsChildren: true,
      maxAdults: 3,
      description: 'Studio amplo, ótima localização, próximo ao comércio.',
      rulesText: 'Locação direta. Aceita família pequena.',
    },
  })

  const p5 = await prisma.property.upsert({
    where: { externalId: 'KIT-05' },
    update: { status: 'maintenance', name: 'Kitnet Vila Rica' },
    create: {
      ...propBase,
      externalId: 'KIT-05',
      name: 'Kitnet Vila Rica',
      address: 'Rua João XXIII, 45',
      neighborhood: 'Vila Rica',
      rent: 800,
      area: 22,
      status: 'maintenance',
      active: false,
      description: 'Em reforma — previsão de disponibilidade em 30 dias.',
      rulesText: 'Locação direta. Sem pets.',
    },
  })

  console.log(`Properties: ${[p1, p2, p3, p4, p5].map((p) => p.externalId).join(', ')}`)

  // ─── Contract Templates ───────────────────────────────────────────────────
  const template = await prisma.contractTemplate.upsert({
    where: { id: 'seed-template-ct-01' },
    update: { name: 'Contrato de Locação Residencial', status: 'published' },
    create: {
      id: 'seed-template-ct-01',
      ownerId: oid,
      name: 'Contrato de Locação Residencial',
      status: 'published',
      body: `CONTRATO DE LOCAÇÃO RESIDENCIAL

LOCADOR: {{nome_locador}}, CPF {{cpf_locador}}.
LOCATÁRIO: {{nome_locatario}}, CPF {{cpf_locatario}}.
IMÓVEL: {{endereco_imovel}}, {{bairro_imovel}}.

CLÁUSULA 1 — DO PRAZO
Prazo de {{prazo_meses}} meses, com início em {{data_inicio}} e término em {{data_termino}}.

CLÁUSULA 2 — DO ALUGUEL
Aluguel mensal de R$ {{valor_aluguel}}, pago até o dia {{dia_vencimento}} de cada mês.

CLÁUSULA 3 — DA CAUÇÃO
Caução equivalente a R$ {{valor_caucao}}, devolvida ao término, descontados eventuais reparos.

CLÁUSULA 4 — DAS DESPESAS
Água e IPTU inclusos. Energia elétrica por conta do LOCATÁRIO.

{{cidade}}, {{data_assinatura}}.

___________________________________     ___________________________________
LOCADOR: {{nome_locador}}               LOCATÁRIO: {{nome_locatario}}`,
    },
  })

  await prisma.contractTemplate.upsert({
    where: { id: 'seed-template-ct-02' },
    update: {},
    create: {
      id: 'seed-template-ct-02',
      ownerId: oid,
      name: 'Aditivo de Reajuste',
      status: 'draft',
      body: `ADITIVO — REAJUSTE DE ALUGUEL

LOCADOR: {{nome_locador}} | LOCATÁRIO: {{nome_locatario}}

A partir de {{data_vigencia}}, o aluguel passa de R$ {{valor_anterior}} para R$ {{valor_novo}} ({{percentual_reajuste}}% — {{indice_reajuste}}).

{{cidade}}, {{data_assinatura}}.`,
    },
  })

  console.log('Templates: CT-01 (published), CT-02 (draft)')

  // ─── Tenants ──────────────────────────────────────────────────────────────
  const t1 = await prisma.tenant.upsert({
    where: { externalId: 'IQ-001' },
    update: { name: 'Maria Silva', onTimeRate: 0.95, score: 92, propertyId: p3.id, dueDay: 10 },
    create: {
      ownerId: oid,
      externalId: 'IQ-001',
      phone: '5524988110001',
      propertyId: p3.id,
      name: 'Maria Silva',
      cpf: '123.456.789-00',
      email: 'maria.silva@gmail.com',
      score: 92,
      dueDay: 10,
      onTimeRate: 0.95,
      contractStart: new Date('2025-06-01'),
      contractEnd: new Date('2025-12-01'),
    },
  })

  const t2 = await prisma.tenant.upsert({
    where: { externalId: 'IQ-002' },
    update: { name: 'João Oliveira', onTimeRate: 0.6, score: 65, propertyId: p4.id, dueDay: 5 },
    create: {
      ownerId: oid,
      externalId: 'IQ-002',
      phone: '5524988220002',
      propertyId: p4.id,
      name: 'João Oliveira',
      cpf: '987.654.321-00',
      email: 'joao.oliveira@hotmail.com',
      score: 65,
      dueDay: 5,
      onTimeRate: 0.6,
      contractStart: new Date('2024-07-01'),
      contractEnd: new Date('2026-07-01'),
    },
  })

  console.log(`Tenants: ${t1.externalId} (${t1.name}), ${t2.externalId} (${t2.name})`)

  // ─── Contracts ────────────────────────────────────────────────────────────
  const contractBody = template.body
    .replace('{{nome_locador}}', 'Fred Lopes')
    .replace('{{cpf_locador}}', '000.000.000-00')

  await prisma.contract.upsert({
    where: { code: 'CT-2025-0001' },
    update: {},
    create: {
      ownerId: oid,
      code: 'CT-2025-0001',
      templateId: template.id,
      tenantId: t1.id,
      propertyId: p3.id,
      body: contractBody
        .replace('{{nome_locatario}}', 'Maria Silva')
        .replace('{{cpf_locatario}}', '123.456.789-00')
        .replace('{{endereco_imovel}}', 'Rua Laranjeiras, 111')
        .replace('{{bairro_imovel}}', 'Retiro')
        .replace('{{prazo_meses}}', '6')
        .replace('{{data_inicio}}', '01/06/2025')
        .replace('{{data_termino}}', '01/12/2025')
        .replace('{{valor_aluguel}}', '900,00')
        .replace('{{dia_vencimento}}', '10')
        .replace('{{valor_caucao}}', '900,00')
        .replace('{{cidade}}', 'Volta Redonda')
        .replace('{{data_assinatura}}', '01/06/2025'),
      status: 'active',
      startDate: new Date('2025-06-01'),
      endDate: new Date('2025-12-01'),
      monthlyRent: 900,
    },
  })

  // Contract nearing renewal (ends in ~45 days)
  const nearEnd = new Date()
  nearEnd.setDate(nearEnd.getDate() + 45)
  await prisma.contract.upsert({
    where: { code: 'CT-2024-0001' },
    update: { endDate: nearEnd },
    create: {
      ownerId: oid,
      code: 'CT-2024-0001',
      templateId: template.id,
      tenantId: t2.id,
      propertyId: p4.id,
      body: contractBody
        .replace('{{nome_locatario}}', 'João Oliveira')
        .replace('{{cpf_locatario}}', '987.654.321-00')
        .replace('{{endereco_imovel}}', 'Av. Lucas Evangelista, 230')
        .replace('{{bairro_imovel}}', 'Vila Santa Cecília')
        .replace('{{prazo_meses}}', '12')
        .replace('{{data_inicio}}', '01/07/2024')
        .replace('{{data_termino}}', nearEnd.toLocaleDateString('pt-BR'))
        .replace('{{valor_aluguel}}', '1.100,00')
        .replace('{{dia_vencimento}}', '5')
        .replace('{{valor_caucao}}', '1.100,00')
        .replace('{{cidade}}', 'Volta Redonda')
        .replace('{{data_assinatura}}', '01/07/2024'),
      status: 'active',
      startDate: new Date('2024-07-01'),
      endDate: nearEnd,
      monthlyRent: 1100,
    },
  })

  console.log('Contracts: CT-2025-0001 (active), CT-2024-0001 (near renewal)')

  // ─── Payments ─────────────────────────────────────────────────────────────
  // Maria Silva (IQ-001, KIT-03, R$900) — pagadora pontual
  const paymentsT1 = [
    { month: monthStr(-2), status: 'paid', amount: 900, paidAt: new Date() },
    { month: monthStr(-1), status: 'paid', amount: 900, paidAt: new Date() },
    { month: monthStr(0),  status: 'paid', amount: 900, paidAt: new Date() },
    { month: monthStr(1),  status: 'pending', amount: 900 },
  ]

  // João Oliveira (IQ-002, KIT-04, R$1100) — com atraso
  const paymentsT2 = [
    { month: monthStr(-2), status: 'paid', amount: 1100, paidAt: new Date() },
    { month: monthStr(-1), status: 'paid', amount: 1100, paidAt: new Date() },
    { month: monthStr(0),  status: 'overdue', amount: 1100 },
    { month: monthStr(1),  status: 'pending', amount: 1100 },
  ]

  for (const [tenant, property, payments] of [
    [t1, p3, paymentsT1],
    [t2, p4, paymentsT2],
  ] as const) {
    for (const p of payments) {
      const existing = await prisma.payment.findFirst({
        where: { tenantId: tenant.id, month: p.month },
      })
      if (!existing) {
        await prisma.payment.create({
          data: {
            ownerId: oid,
            tenantId: tenant.id,
            propertyId: property.id,
            month: p.month,
            amount: p.amount,
            status: p.status,
            type: 'income',
            paidAt: 'paidAt' in p ? p.paidAt : null,
          },
        })
      }
    }
  }

  console.log('Payments: 8 registros (4 por inquilino)')

  // ─── Leads ────────────────────────────────────────────────────────────────
  const leadsData = [
    {
      externalId: 'LD-0001',
      phone: '5524991001001',
      name: 'Ana Costa',
      source: 'olx',
      stage: 'interest',
      propertyId: p1.id,
    },
    {
      externalId: 'LD-0002',
      phone: '5524991002002',
      name: 'Bruno Ferreira',
      source: 'zap',
      stage: 'visiting',
      propertyId: p2.id,
    },
    {
      externalId: 'LD-0003',
      phone: '5524991003003',
      name: 'Carla Mendes',
      source: 'instagram',
      stage: 'collection',
      propertyId: p1.id,
      visitedAt: new Date(Date.now() - 3 * 86400000),
    },
    {
      externalId: 'LD-0004',
      phone: '5524991004004',
      name: 'Diego Ramos',
      source: 'indicacao',
      stage: 'kyc_pending',
      propertyId: p2.id,
      visitedAt: new Date(Date.now() - 7 * 86400000),
      docsSentAt: new Date(Date.now() - 2 * 86400000),
    },
    {
      externalId: 'LD-0005',
      phone: '5524991005005',
      name: 'Elisa Duarte',
      source: 'olx',
      stage: 'contract_pending',
      propertyId: p1.id,
      visitedAt: new Date(Date.now() - 14 * 86400000),
      docsSentAt: new Date(Date.now() - 10 * 86400000),
    },
  ]

  for (const lead of leadsData) {
    await prisma.lead.upsert({
      where: { externalId: lead.externalId },
      update: { stage: lead.stage, name: lead.name },
      create: { ownerId: oid, ...lead },
    })
  }

  console.log(`Leads: ${leadsData.map((l) => l.externalId).join(', ')}`)

  // ─── Rule Set ─────────────────────────────────────────────────────────────
  const existingRuleSet = await prisma.ruleSet.findFirst({
    where: { ownerId: oid, name: 'Padrão Residencial' },
  })

  const ruleSet = existingRuleSet ?? await prisma.ruleSet.create({
    data: {
      ownerId: oid,
      name: 'Padrão Residencial',
      description: 'Regras base para todas as kitnets do Retiro',
      propagatePolicies: true,
      propagateClauses: true,
      propagateFields: false,
    },
  })

  const policies = [
    { name: 'Aceita pets', value: 'no' },
    { name: 'Aceita crianças', value: 'no' },
    { name: 'Aceita fumantes', value: 'no' },
    { name: 'Permite sublocação', value: 'no' },
    { name: 'Aceita fiador', value: 'conditional', description: 'Apenas quando caução não é viável' },
  ]

  for (const pol of policies) {
    const existing = await prisma.ruleSetPolicy.findFirst({
      where: { ruleSetId: ruleSet.id, name: pol.name },
    })
    if (!existing) {
      await prisma.ruleSetPolicy.create({
        data: { ruleSetId: ruleSet.id, ...pol, appliesToProperty: true },
      })
    }
  }

  // Link rule set to available properties
  for (const prop of [p1, p2]) {
    await prisma.propertyRuleSet.upsert({
      where: { propertyId_ruleSetId: { propertyId: prop.id, ruleSetId: ruleSet.id } },
      update: {},
      create: { propertyId: prop.id, ruleSetId: ruleSet.id },
    })
  }

  console.log(`RuleSet: "${ruleSet.name}" com ${policies.length} políticas`)

  // ─── Activity Log ─────────────────────────────────────────────────────────
  const activityCount = await prisma.activityLog.count({ where: { ownerId: oid } })

  if (activityCount === 0) {
    const logEntries = [
      {
        actorType: 'bot', actorLabel: 'Bot', action: 'lead_created',
        subjectType: 'lead', subjectId: 'LD-0001', subject: 'LD-0001 (Ana Costa)',
        createdAt: new Date(Date.now() - 6 * 3600000),
      },
      {
        actorType: 'bot', actorLabel: 'Bot', action: 'lead_created',
        subjectType: 'lead', subjectId: 'LD-0002', subject: 'LD-0002 (Bruno Ferreira)',
        createdAt: new Date(Date.now() - 5 * 3600000),
      },
      {
        actorType: 'user', actorLabel: 'Fred', action: 'property_created',
        subjectType: 'property', subjectId: p5.id, subject: 'KIT-05',
        createdAt: new Date(Date.now() - 4 * 3600000),
      },
      {
        actorType: 'bot', actorLabel: 'Bot', action: 'lead_created',
        subjectType: 'lead', subjectId: 'LD-0003', subject: 'LD-0003 (Carla Mendes)',
        createdAt: new Date(Date.now() - 3 * 3600000),
      },
      {
        actorType: 'user', actorLabel: 'Fred', action: 'rule_set_linked',
        subjectType: 'property', subjectId: p1.id, subject: 'KIT-01',
        createdAt: new Date(Date.now() - 2 * 3600000),
      },
      {
        actorType: 'bot', actorLabel: 'Bot', action: 'kyc_approved',
        subjectType: 'lead', subjectId: 'LD-0004', subject: 'LD-0004 (Diego Ramos)',
        createdAt: new Date(Date.now() - 1 * 3600000),
      },
      {
        actorType: 'user', actorLabel: 'Fred', action: 'payment_recorded',
        subjectType: 'payment', subjectId: t1.id, subject: `IQ-001 — ${monthStr(0)}`,
        createdAt: new Date(Date.now() - 30 * 60000),
      },
      {
        actorType: 'user', actorLabel: 'Fred', action: 'tenant_created',
        subjectType: 'tenant', subjectId: t1.id, subject: 'IQ-001 (Maria Silva)',
        createdAt: new Date(Date.now() - 10 * 60000),
      },
    ]

    for (const entry of logEntries) {
      await prisma.activityLog.create({ data: { ownerId: oid, ...entry, metadata: {} } })
    }

    console.log(`ActivityLog: ${logEntries.length} entradas`)
  } else {
    console.log(`ActivityLog: ${activityCount} entradas existentes — pulando`)
  }

  console.log('\nSeed completo ✓')
  console.log('─────────────────────────────────────────')
  console.log(`Imóveis : 5 (2 available, 2 rented, 1 maintenance)`)
  console.log(`Tenants : 2 (IQ-001 pontual, IQ-002 com atraso)`)
  console.log(`Leads   : 5 (interest → contract_pending)`)
  console.log(`Pagtos  : 8 (paid/pending/overdue)`)
  console.log(`Contratos: 2 (1 ativo, 1 próximo do vencimento)`)
  console.log(`RuleSets: 1 com 5 políticas`)
  console.log(`ActivityLog: 8 entradas`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
