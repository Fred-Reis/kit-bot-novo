# docs/schema.md — Design do banco de dados

## Princípios

- Schema desenhado para suportar múltiplos proprietários e múltiplos imóveis desde o início.
- Mídia referenciada por URL pública do Supabase Storage — nunca por caminho local.
- Toda alteração de imóvel deve invalidar o cache Redis daquele imóvel (`DEL property:{id}`).
- O bot é leitura. O admin (fase 2) é leitura + escrita.

## Supabase Storage

Bucket sugerido: `properties`

Estrutura de pastas dentro do bucket:
```
properties/
└── {property_id}/
    ├── photos/
    │   ├── 01.jpg
    │   └── 02.jpg
    └── videos/
        └── tour.mp4
```

A URL pública de cada arquivo é armazenada na tabela `property_media`.

## Entidades principais (Prisma)

### Owner
```prisma
model Owner {
  id         String     @id @default(uuid())
  name       String
  phone      String     @unique
  email      String?    @unique
  properties Property[]
  createdAt  DateTime   @default(now())
}
```
Autenticação do admin via Supabase Auth (fase 2) — o `id` pode ser o UUID do Supabase Auth.

### Property
```prisma
model Property {
  id                     String          @id @default(uuid())
  externalId             String          @unique  // ex: "KIT-01"
  ownerId                String
  owner                  Owner           @relation(fields: [ownerId], references: [id])
  name                   String
  address                String
  neighborhood           String
  rent                   Decimal
  deposit                Decimal
  depositInstallmentsMax Int
  rooms                  Int
  bathrooms              Int
  includesWater          Boolean         @default(false)
  includesIptu           Boolean         @default(false)
  individualElectricity  Boolean         @default(true)
  firstRental            Boolean         @default(false)
  independentEntrance    Boolean         @default(true)
  acceptsPets            Boolean         @default(false)
  maxAdults              Int             @default(2)
  acceptsChildren        Boolean         @default(true)
  visitSchedule          String?
  listingUrl             String?
  active                 Boolean         @default(true)
  media                  PropertyMedia[]
  leads                  Lead[]
  tenants                Tenant[]
  createdAt              DateTime        @default(now())
  updatedAt              DateTime        @updatedAt
}
```

### PropertyMedia
```prisma
model PropertyMedia {
  id         String   @id @default(uuid())
  propertyId String
  property   Property @relation(fields: [propertyId], references: [id])
  type       String   // "photo" | "video"
  url        String   // URL pública do Supabase Storage
  order      Int      @default(0)
  createdAt  DateTime @default(now())
}
```

### Lead
```prisma
model Lead {
  id              String          @id @default(uuid())
  phone           String          // chat_id do WhatsApp
  propertyId      String?
  property        Property?       @relation(fields: [propertyId], references: [id])
  stage           String          @default("interest")
  // interest | visit | docs | contract | payment | keys
  visitedAt       DateTime?
  docsSentAt      DateTime?
  contractSignedAt DateTime?
  documents       LeadDocument[]
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt
}
```

### LeadDocument
```prisma
model LeadDocument {
  id        String   @id @default(uuid())
  leadId    String
  lead      Lead     @relation(fields: [leadId], references: [id])
  type      String   // "cnh" | "rg_front" | "rg_back" | "cpf"
  url       String   // URL pública do Supabase Storage
  createdAt DateTime @default(now())
}
```

### Tenant
```prisma
model Tenant {
  id            String   @id @default(uuid())
  phone         String   @unique
  propertyId    String
  property      Property @relation(fields: [propertyId], references: [id])
  contractStart DateTime
  contractEnd   DateTime?
  createdAt     DateTime @default(now())
}
```

### Event (histórico de mensagens)
```prisma
model Event {
  id        String   @id @default(uuid())
  chatId    String
  role      String   // "user" | "assistant"
  content   String
  createdAt DateTime @default(now())

  @@index([chatId])
}
```

### Conversation (estado atual da conversa)
```prisma
model Conversation {
  chatId    String   @id
  data      Json     // estado da máquina
  updatedAt DateTime @updatedAt
}
```

## Cache Redis

| Chave | Conteúdo | TTL |
|---|---|---|
| `property:{id}` | Dados completos do imóvel + mídia | 10 min |
| `lead:{phone}` | Estado atual do lead | 30 min |
| `tenant:{phone}` | Dados do inquilino | 30 min |

Invalidação ao atualizar imóvel no admin:
```ts
await redis.del(`property:${propertyId}`)
```
