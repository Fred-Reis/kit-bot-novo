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

  console.log('Seed complete.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
