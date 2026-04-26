import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

async function main() {
  console.log('Seeding database...')

  // Upsert owner
  const owner = await prisma.owner.upsert({
    where: { phone: '5524999999999' },
    update: { name: 'Fred' },
    create: {
      name: 'Fred',
      phone: '5524999999999',
    },
  })

  console.log(`Owner upserted: ${owner.name} (${owner.id})`)

  // Upsert KIT-01 property
  const property = await prisma.property.upsert({
    where: { externalId: 'KIT-01' },
    update: {
      name: 'Kitnet no Retiro',
      address: 'Rua Laranjeiras, 111',
      neighborhood: 'Retiro',
      category: 'kitnet',
      description:
        'Quitinete no Retiro, imóvel novo e primeira locação, com porcelanato ' +
        'e acabamento de primeira. Tem sala e cozinha americana amplas, quarto ' +
        'suite e lavanderia individual com cobertura. São 4 unidades iguais ' +
        'disponíveis. Fica perto da entrada da CSN e do Supermercado Poupe. ' +
        'O ambiente é tranquilo e reservado. A entrada não é independente.',
      rent: 900,
      deposit: 900,
      depositInstallmentsMax: 3,
      contractMonths: 6,
      rooms: 1,
      bathrooms: 1,
      includesWater: true,
      includesIptu: true,
      individualElectricity: true,
      firstRental: true,
      independentEntrance: false,
      acceptsPets: false,
      maxAdults: 2,
      acceptsChildren: false,
      visitSchedule:
        'Segunda a sexta, 9h–17h. Aos sábados, confirmar disponibilidade; ' +
        'quando houver atendimento, o ideal é visitar até meio-dia. No local, procurar Valéria ou Vitória.',
      listingUrl:
        'https://rj.olx.com.br/serra-angra-dos-reis-e-regiao/imoveis/alugo-kitnet-no-retiro-1487572817',
      rulesText:
        'Locação direta com o proprietário Fred. Não é permitido animais. ' +
        'Permitido no máximo 2 moradores adultos por quitinete; crianças e bebês ' +
        'não são aceitos nesta quitinete. Prioridade para pessoas sozinhas. ' +
        'Aluguel de R$ 900 adiantado + caução de R$ 900. ' +
        'A caução pode ser parcelada em até 3x junto com os aluguéis, deixando ' +
        'os 3 primeiros pagamentos em R$ 1.200. O contrato inicial é de 6 meses ' +
        'e se renova automaticamente se ambas as partes concordarem. Água e IPTU ' +
        'inclusos; luz individual, com ligação por conta do inquilino junto à Light. ' +
        'O valor do aluguel não baixa para R$ 800; se a pessoa pedir mais parcelas ' +
        'da caução, diga que o padrão é até 3x e que exceção precisa ser confirmada ' +
        'com o responsável.',
      active: true,
      ownerId: owner.id,
    },
    create: {
      externalId: 'KIT-01',
      ownerId: owner.id,
      name: 'Kitnet no Retiro',
      address: 'Rua Laranjeiras, 111',
      neighborhood: 'Retiro',
      category: 'kitnet',
      description:
        'Quitinete no Retiro, imóvel novo e primeira locação, com porcelanato ' +
        'e acabamento de primeira. Tem sala e cozinha americana amplas, quarto ' +
        'suite e lavanderia individual com cobertura. São 4 unidades iguais ' +
        'disponíveis. Fica perto da entrada da CSN e do Supermercado Poupe. ' +
        'O ambiente é tranquilo e reservado. A entrada não é independente.',
      rent: 900,
      deposit: 900,
      depositInstallmentsMax: 3,
      contractMonths: 6,
      rooms: 1,
      bathrooms: 1,
      includesWater: true,
      includesIptu: true,
      individualElectricity: true,
      firstRental: true,
      independentEntrance: false,
      acceptsPets: false,
      maxAdults: 2,
      acceptsChildren: false,
      visitSchedule:
        'Segunda a sexta, 9h–17h. Aos sábados, confirmar disponibilidade; ' +
        'quando houver atendimento, o ideal é visitar até meio-dia. No local, procurar Valéria ou Vitória.',
      listingUrl:
        'https://rj.olx.com.br/serra-angra-dos-reis-e-regiao/imoveis/alugo-kitnet-no-retiro-1487572817',
      rulesText:
        'Locação direta com o proprietário Fred. Não é permitido animais. ' +
        'Permitido no máximo 2 moradores adultos por quitinete; crianças e bebês ' +
        'não são aceitos nesta quitinete. Prioridade para pessoas sozinhas. ' +
        'Aluguel de R$ 900 adiantado + caução de R$ 900. ' +
        'A caução pode ser parcelada em até 3x junto com os aluguéis, deixando ' +
        'os 3 primeiros pagamentos em R$ 1.200. O contrato inicial é de 6 meses ' +
        'e se renova automaticamente se ambas as partes concordarem. Água e IPTU ' +
        'inclusos; luz individual, com ligação por conta do inquilino junto à Light. ' +
        'O valor do aluguel não baixa para R$ 800; se a pessoa pedir mais parcelas ' +
        'da caução, diga que o padrão é até 3x e que exceção precisa ser confirmada ' +
        'com o responsável.',
      active: true,
    },
  })

  console.log(`Property upserted: ${property.externalId} (${property.id})`)

  // Upsert OLX listing media (type: listing)
  const existingListing = await prisma.propertyMedia.findFirst({
    where: { propertyId: property.id, type: 'listing' },
  })

  if (!existingListing) {
    await prisma.propertyMedia.create({
      data: {
        propertyId: property.id,
        type: 'listing',
        url: 'https://rj.olx.com.br/serra-angra-dos-reis-e-regiao/imoveis/alugo-kitnet-no-retiro-1487572817',
        label: 'Anúncio OLX com fotos e informações',
        order: 0,
      },
    })
    console.log('OLX listing media created')
  }

  // NOTE: Video media should be added after uploading to Supabase Storage.
  // Run: npx supabase storage upload properties/KIT-01/videos/tour.mp4
  // Then update the PropertyMedia record with the public URL.
  console.log(
    'REMINDER: Upload kitnet-retiro-video.mp4 to Supabase Storage bucket "properties/KIT-01/videos/" ' +
      'and add a PropertyMedia record with type="video" and the public URL.',
  )

  // Upsert contract templates
  const templates = [
    {
      code: 'CT-01',
      name: 'Contrato de Locação Residencial',
      status: 'published',
      body: `CONTRATO DE LOCAÇÃO RESIDENCIAL

Pelo presente instrumento particular, as partes abaixo identificadas celebram o presente Contrato de Locação Residencial, que se regerá pelas cláusulas e condições seguintes:

LOCADOR: {{nome_locador}}, CPF {{cpf_locador}}, residente à {{endereco_locador}}.

LOCATÁRIO: {{nome_locatario}}, CPF {{cpf_locatario}}, RG {{rg_locatario}}, residente à {{endereco_locatario}}.

IMÓVEL: {{endereco_imovel}}, {{complemento_imovel}}, {{bairro_imovel}} — doravante denominado "imóvel".

CLÁUSULA 1 — DO PRAZO
O prazo de locação é de {{prazo_meses}} meses, com início em {{data_inicio}} e término em {{data_termino}}, renovando-se automaticamente por igual período caso nenhuma das partes manifeste intenção contrária com 30 dias de antecedência.

CLÁUSULA 2 — DO ALUGUEL
O valor do aluguel mensal é de R$ {{valor_aluguel}}, a ser pago até o dia {{dia_vencimento}} de cada mês mediante transferência bancária ou PIX para os dados informados pelo LOCADOR.

CLÁUSULA 3 — DA CAUÇÃO
O LOCATÁRIO deposita, neste ato, caução equivalente a R$ {{valor_caucao}}, a ser devolvida ao término da locação, descontadas eventuais despesas de reparos por danos causados pelo LOCATÁRIO.

CLÁUSULA 4 — DAS DESPESAS
Ficam a cargo do LOCATÁRIO as despesas de energia elétrica, gás e demais consumos individuais. Água e IPTU {{agua_iptu}}.

CLÁUSULA 5 — DAS OBRIGAÇÕES DO LOCATÁRIO
O LOCATÁRIO se compromete a: (a) usar o imóvel exclusivamente para fins residenciais; (b) conservar o imóvel em bom estado; (c) não sublocar, ceder ou emprestar o imóvel sem autorização expressa do LOCADOR; (d) respeitar o regulamento interno do condomínio, se houver.

CLÁUSULA 6 — DA RESCISÃO
Em caso de rescisão antecipada pelo LOCATÁRIO, fica estabelecida multa equivalente a {{multa_proporcional}} proporcional ao período restante do contrato.

{{cidade}}, {{data_assinatura}}.

___________________________________
LOCADOR: {{nome_locador}}

___________________________________
LOCATÁRIO: {{nome_locatario}}`,
    },
    {
      code: 'CT-02',
      name: 'Aditivo de Reajuste de Aluguel',
      status: 'draft',
      body: `ADITIVO CONTRATUAL — REAJUSTE DE ALUGUEL

Pelo presente Aditivo ao Contrato de Locação firmado em {{data_contrato_original}}, as partes:

LOCADOR: {{nome_locador}}
LOCATÁRIO: {{nome_locatario}}

acordam o seguinte:

CLÁUSULA 1 — DO REAJUSTE
A partir de {{data_vigencia}}, o valor mensal do aluguel do imóvel situado à {{endereco_imovel}} passará de R$ {{valor_anterior}} para R$ {{valor_novo}}, representando reajuste de {{percentual_reajuste}}% conforme índice {{indice_reajuste}} acumulado no período.

CLÁUSULA 2 — DAS DEMAIS CLÁUSULAS
Permanecem inalteradas todas as demais cláusulas e condições do contrato original.

{{cidade}}, {{data_assinatura}}.

___________________________________
LOCADOR: {{nome_locador}}

___________________________________
LOCATÁRIO: {{nome_locatario}}`,
    },
  ]

  for (const tpl of templates) {
    await prisma.contractTemplate.upsert({
      where: { code: tpl.code },
      update: { name: tpl.name, body: tpl.body, status: tpl.status },
      create: tpl,
    })
    console.log(`ContractTemplate upserted: ${tpl.code} — ${tpl.name}`)
  }

  console.log('Seed complete.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
