# docs/tenant-flow.md — Fase 2: Fluxo do Inquilino (Tenant)

> Documento-guia para o desenvolvimento do fluxo de tenant.
> Pré-requisito: fluxo de lead concluído. Router tenant vs lead já existe em `flows/router.ts`.

---

## 1. Identificação do inquilino

O `flows/router.ts` já decide `tenant` vs `lead` consultando o banco pelo `phone` (chat_id).
Quando o phone existe na tabela `Tenant` com contrato ativo, a mensagem entra no fluxo de tenant.

**Contrato ativo:** `contractStart <= hoje` e (`contractEnd` nulo ou `contractEnd >= hoje`).

Ao identificar o tenant, o bot carrega o **snapshot do inquilino** (com cache Redis `tenant:{phone}`, TTL 30 min):

```ts
interface TenantSnapshot {
  tenantId: string
  name: string
  property: PropertySnapshot        // dados do imóvel via catalog.ts
  owner: { id: string; name: string; phone: string }
  contractStart: Date
  contractEnd: Date | null
  // histórico financeiro resumido (fase 2.1, ver seção 4)
  payments?: PaymentSummary[]
}
```

Esse snapshot é o contexto factual injetado no LLM. **O LLM nunca responde nada sobre contrato, valores ou regras que não esteja no snapshot.**

---

## 2. Router de necessidade do tenant

Após identificar o tenant, um segundo router classifica **o que o inquilino precisa**. Três trilhas:

| Trilha | Exemplos de mensagem |
|---|---|
| `financeiro` | "quando vence o aluguel?", "posso pagar atrasado?", "vai ter reajuste?", "me manda o comprovante" |
| `manutencao` | "o chuveiro queimou", "tá vazando água", "a fechadura quebrou", "mofo na parede" |
| `info_reclamacao` | "o vizinho faz barulho", "quero registrar uma reclamação", "até quando vai meu contrato?" |

**Implementação:** mesmo padrão do lead — router LLM estruturado (GPT-4o mini com resposta JSON validada por Zod) + overrides determinísticos para os casos óbvios.

```ts
const TenantIntentSchema = z.object({
  track: z.enum(["financeiro", "manutencao", "info_reclamacao"]),
  confidence: z.number(),
})
```

Se a confiança for baixa ou a mensagem for ambígua, o bot pergunta de forma natural ("Você quer falar sobre pagamento, algum problema no imóvel, ou outra coisa?") — **nunca** um menu numérico de URA.

### Overrides determinísticos do tenant

| Gatilho | Ação |
|---|---|
| Saudações simples | Saudação hardcoded com nome do inquilino |
| Mensagem de áudio | Responder que não entende áudio |
| Palavras de emergência: `incêndio`, `fogo`, `cheiro de gás`, `alagamento` | Resposta hardcoded: orientar a acionar bombeiros/emergência e notificar o proprietário imediatamente |

---

## 3. Trilha: Manutenção

A trilha mais complexa. O agente de manutenção toma **duas decisões em sequência**:

### 3.1 Decisão 1 — De quem é a responsabilidade?

Baseada na Lei do Inquilinato (8.245/91) e no contrato:

- **Inquilino:** desgaste por mau uso, itens de consumo (lâmpada, resistência de chuveiro), pequenos reparos de conservação
- **Proprietário:** problemas estruturais, infiltração, instalação elétrica/hidráulica pré-existente, telhado, tudo que compromete a habitabilidade

O agente deve ter acesso (via contexto injetado, não improvisação) a:
- Regras resumidas da Lei do Inquilinato (arquivo estático `docs/lei-inquilinato-resumo.md`, injetado no prompt do agente de manutenção)
- Dados do contrato do inquilino (snapshot)

### 3.2 Decisão 2 — Qual o tipo de manutenção?

Classificar em: `eletrica` | `hidraulica` | `civil` | `limpeza_conservacao`

```ts
const MaintenanceSchema = z.object({
  responsibility: z.enum(["tenant", "owner", "unclear"]),
  type: z.enum(["eletrica", "hidraulica", "civil", "limpeza_conservacao"]),
  severity: z.enum(["baixa", "media", "urgente"]),
  summary: z.string(),          // resumo objetivo do problema
})
```

### 3.3 Ações por resultado

**Responsabilidade do inquilino (casos simples):**
- Retornar dicas práticas de "faça você mesmo": links, orientações passo a passo
- Se for algo além do trivial, sugerir profissional cadastrado para aquele tipo de serviço (tabela `ServiceProvider`, ver seção 6)

**Responsabilidade do proprietário:**
- Registrar o chamado no banco (`MaintenanceRequest`)
- Notificar o proprietário via WhatsApp com o resumo do problema
- Informar ao inquilino que o proprietário foi notificado
- O proprietário pode assumir a conversa (ver seção 7)

**Responsabilidade incerta (`unclear`):**
- Registrar o chamado
- Encaminhar ao proprietário com a dúvida explícita
- Nunca decidir sozinho em casos ambíguos

**Severidade `urgente`:**
- Notificar o proprietário imediatamente, independente da responsabilidade

---

## 4. Trilha: Financeiro

O agente financeiro responde com base **apenas** nos dados do snapshot:

- Valor do aluguel e data de vencimento
- Histórico de pagamentos (pago/pendente/atrasado)
- Regras de reajuste previstas no contrato
- Regras sobre atraso e multa (do contrato, nunca inventadas)

### O que o agente financeiro NÃO faz

- ❌ Não negocia valores, descontos ou parcelamentos — isso é encaminhado ao proprietário
- ❌ Não confirma recebimento de pagamento sem registro no banco
- ❌ Não inventa taxas, multas ou índices de reajuste

Pedidos de negociação → registrar no banco + notificar o proprietário + informar ao inquilino que o proprietário responderá.

### Modelo de dados (fase 2.1)

```prisma
model Payment {
  id        String    @id @default(uuid())
  tenantId  String
  tenant    Tenant    @relation(fields: [tenantId], references: [id])
  dueDate   DateTime
  amount    Decimal
  paidAt    DateTime?
  status    String    @default("pending") // pending | paid | late
  createdAt DateTime  @default(now())
}
```

> Nota: o registro de pagamentos pode começar manual (proprietário marca como pago via admin na fase do painel). O bot só lê.

---

## 5. Trilha: Informações e Reclamações

- **Toda** reclamação é registrada no banco (`Complaint`)
- Uma cópia/resumo é **sempre** encaminhada ao proprietário
- O inquilino recebe confirmação de que o registro foi feito
- Dúvidas informativas (fim do contrato, regras do imóvel) são respondidas pelo snapshot

```prisma
model Complaint {
  id        String   @id @default(uuid())
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id])
  summary   String
  content   String
  status    String   @default("open") // open | acknowledged | resolved
  createdAt DateTime @default(now())
}
```

---

## 6. Profissionais cadastrados

Para os casos em que o bot indica um profissional:

```prisma
model ServiceProvider {
  id        String   @id @default(uuid())
  ownerId   String   // cada proprietário cadastra os seus
  name      String
  phone     String
  type      String   // eletrica | hidraulica | civil | limpeza_conservacao
  active    Boolean  @default(true)
  createdAt DateTime @default(now())
}
```

- O bot **só indica profissionais que existem no banco** para aquele tipo de serviço
- Se não houver profissional cadastrado para o tipo, o bot diz isso honestamente e sugere que o inquilino procure um profissional de confiança
- Gestão dos profissionais será feita no painel admin (fase do painel)

---

## 7. Notificações e handoff para o proprietário

Padrão de comunicação com o proprietário (via Evolution API, no WhatsApp dele):

1. **Notificação:** mensagem estruturada com resumo do evento (chamado de manutenção, reclamação, pedido de negociação)
2. **Handoff:** o proprietário pode responder assumindo a conversa. Enquanto o proprietário estiver ativo naquele chat, o bot **silencia** (flag `humanTakeover` no estado da conversa Redis)
3. **Retorno ao bot:** após período de inatividade do proprietário (ex: 24h) ou comando explícito, o bot reassume

```ts
interface ConversationState {
  // ... estado existente
  humanTakeover: boolean
  takeoverUntil: Date | null
}
```

---

## 8. Registro de eventos

**Todos os eventos do fluxo de tenant ficam registrados no banco**, vinculados ao perfil do usuário (mesma tabela `Event` do lead):

- Mensagens trocadas
- Chamados de manutenção abertos
- Reclamações registradas
- Notificações enviadas ao proprietário

Isso alimenta o histórico do painel admin (fase do painel).

---

## 9. Regras invioláveis do fluxo de tenant

1. O bot **nunca** decide sozinho questões contratuais ambíguas — encaminha ao proprietário
2. O bot **nunca** inventa regras da Lei do Inquilinato — usa apenas o resumo injetado
3. O bot **nunca** confirma pagamentos sem registro no banco
4. O bot **nunca** promete prazos de resolução em nome do proprietário
5. Emergências têm resposta hardcoded, sem LLM
6. Toda interação relevante gera registro no banco

---

## 10. Ordem de implementação sugerida

- [ ] 1. Snapshot do tenant + cache Redis (`tenant:{phone}`)
- [ ] 2. Router de trilha (LLM estruturado + overrides determinísticos)
- [ ] 3. Trilha info/reclamação (mais simples — registrar + notificar)
- [ ] 4. Notificação ao proprietário via Evolution API
- [ ] 5. Trilha manutenção: classificação (responsabilidade + tipo + severidade)
- [ ] 6. Trilha manutenção: ações (dicas, profissional, chamado, notificação)
- [ ] 7. Tabelas `MaintenanceRequest`, `Complaint`, `ServiceProvider`
- [ ] 8. Trilha financeiro (leitura do snapshot; `Payment` pode vir depois)
- [ ] 9. Handoff/takeover do proprietário
- [ ] 10. Resumo da Lei do Inquilinato (`docs/lei-inquilinato-resumo.md`)