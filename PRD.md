# PRD — kit-manager

> Product Requirements Document. Fonte da verdade do produto.
> Última atualização: 2026-06-21

---

## 1. Visão

**kit-manager** consolida a operação de locação de imóveis em um único sistema, automatizando atendimento via WhatsApp e centralizando gestão no painel admin.

> **Pitch:** "Gerenciar imóveis sem dor de cabeça, com todas as informações consolidadas em um lugar."

---

## 2. Persona

### Primária — Proprietário solo (MVP — você mesmo)
- Proprietário que gerencia 5–15 imóveis próprios (kits, quitinetes, apartamentos)
- Dev — construiu o sistema para automatizar a própria operação (dogfooding)
- Usa WhatsApp como canal principal de captação (OLX, ZAP, Instagram, indicação)
- Antes do sistema: planilhas, anotações, prints, conversas informais — informação fragmentada
- Quer reduzir tempo gasto em qualificação repetitiva de leads
- **Prefere distância do inquilino** — não quer ser ponto único de contato emocional/operacional. Sistema age como intermediário formal
- **Quer formalizar o que era informal** — combinados verbais, lembretes manuais, "te aviso no zap" viram fluxos estruturados
- Dor: perder lead por demora, esquecer follow-up, perder controle de pagamentos, retrabalho por falta de registro
- Critério de sucesso pessoal: zero planilhas paralelas, operação ponta-a-ponta no sistema, contato mínimo direto com inquilino

### Secundária — Outros proprietários (validação comercial)
- Proprietário independente com 5–50 imóveis
- Perfil técnico variável (dev ou não)
- Espera UI clara, fluxos curtos, onboarding sem fricção
- Pode pagar mensalidade se reduzir tempo/erro de gestão

### Terciária — Imobiliária / PMC (Fase 5+)
- Empresa que gerencia imóveis de terceiros
- Equipe: Admin, Gestor, Visualizador
- Faz repasses aos donos reais
- Requer multi-tenancy (org_id em todas as tabelas, RLS por org)

### Não-persona
- Inquilino final: usa WhatsApp, não acessa admin
- Corretor independente intermediando: fora de escopo

---

## 3. Problema

Proprietários de imóveis perdem tempo e dinheiro porque:

1. **Lead esfria** — leva horas/dias pra responder mensagens repetitivas no WhatsApp
2. **Informação fragmentada** — fotos no celular, contratos no Word, pagamentos na planilha, conversas no WhatsApp. Nada cruza
3. **Qualificação manual** — perguntar renda, pedir docs, agendar visita, repetir 10x por semana
4. **Gestão de pagamentos** — quem pagou, quem atrasou, quanto vai entrar. Tudo de cabeça ou planilha
5. **Sem visão consolidada** — ocupação, leads ativos, KYC pendente, próximos vencimentos: dados não convergem
6. **Operação informal não escala** — combinados verbais e mensagens soltas geram disputa, esquecimento, retrabalho

---

## 4. Solução

Dois módulos integrados compartilhando o mesmo banco:

### 4.1. Bot WhatsApp (`apps/bot`)
- Atende leads 24/7 via Evolution API
- Pipeline: extrator LLM → router → agente especializado → resposta
- 4 agentes: `options`, `info`, `scheduling`, `collection`
- Coleta documentos (CNH ou RG+CPF) com OCR via Google Cloud Vision
- Comportamentos determinísticos: saudações, envio de mídia, áudio
- Notifica proprietário em momentos-chave (KYC pronto, pagamento, etc)
- **Toggle global de pausa** — proprietário desliga o bot pelo painel; Evolution permanece conectado; WhatsApp funciona normalmente para atendimento manual
- **Atua como intermediário formal** — proprietário não precisa responder cada mensagem

### 4.2. Painel Admin (`apps/web`)
- Dashboard com KPIs reais (ocupação, leads, KYC, atraso)
- Gestão de imóveis com fotos, regras, mídia
- Funil de leads (kanban + tabela + detalhe)
- Inquilinos ativos com histórico de pagamentos
- Templates de contrato (foundation para automação futura)
- Financeiro: visualização + lançamento manual
- Regras de locação reutilizáveis (rule sets)
- Calendário de visitas com histórico completo (agendadas, concluídas, canceladas, não realizadas) e filtros de status
- **Responsável por visita por imóvel** — cada imóvel pode ter um ou mais responsáveis (nome + WhatsApp) para acompanhar visitas; proprietário não precisa ser o acompanhante
- **Lembretes automáticos de visita** — cron horário envia WhatsApp ao responsável e ao lead com antecedência configurável pelo proprietário (múltiplos offsets: ex. 1h antes, 24h antes)
- **Instalável como PWA** — proprietário adiciona o painel à tela inicial do celular ou desktop sem app store

---

## 5. MVP — definição

### Princípio
> Todas as 9 páginas do design devem estar funcionais. Nenhuma é cortada. Algumas chegam com versão simples (manual onde a automação plena exige integração externa).

### Dentro do MVP
| Área | Escopo |
|---|---|
| **Bot WhatsApp** | Atual + notificações multi-canal ao proprietário (WhatsApp, email, in-app) |
| **Leads** | Kanban + tabela + detalhe + ações (KYC, gerar contrato, confirmar pagamento). Schema adicional: `name`, `source`, `propertyId` |
| **Imóveis** | CRUD completo + mídia + regras vinculadas + `area` (m²) |
| **Inquilinos** | Lista + detalhe + STATUS pill + `externalId` (IQ-XXX) |
| **Contratos** | Lista + detalhe + criação a partir de template. Geração de Word/PDF baixável (assinatura **fora do sistema**) |
| **Templates** | Editor com variáveis. Source-of-truth para contratos. Bot envia link ou texto do contrato gerado |
| **Regras** | Rule sets com políticas Sim/Não/Cond, vincular a imóveis |
| **Financeiro** | KPIs reais + tabela "últimos movimentos" + lançamento manual de pagamento |
| **Dashboard** | KPIs reais + ocupação + activity feed + próximos vencimentos |
| **Configurações** | Sidebar 7 seções: Workspace (read-only), Integrações (Evolution config + toggle global do bot), Notificações, Aparência (dark mode wired), Segurança (stub), Equipe (stub), Plano (stub) |
| **Activity Log** | Tabela `activity_log` escrita por bot **e** web em todos os pontos relevantes |
| **RLS** | Reativar antes de subir para produção real |

### Fora do MVP
- **Autentique** (assinatura digital): contrato é manual (Word/PDF assinado em papel)
- **Multi-tenancy / RBAC**: schema preparado mas não implementado
- **Repasses a proprietários terceiros**: aba do Financeiro fica como placeholder
- **Conciliação bancária** (Pluggy/Belvo)
- **OCR retry com foto melhor**
- **Transcrição de áudio** (Whisper)
- **PDF de contrato com geração avançada**: MVP gera Word baseado em template
- **Importar .docx em templates**
- **Validação automática de CPF** (Receita)
- **Filtros avançados / bulk actions** em listas

### Critério "pronto para uso real"
1. Proprietário consegue operar **seus próprios 5–15 imóveis** de ponta a ponta via sistema
2. Lead chega → bot conduz → admin aprova → tenant ativo + pagamentos rastreados
3. Sem necessidade de planilha/Word paralelo (exceto contrato físico)
4. Proprietário tem contato direto mínimo com inquilino (bot media a maioria das interações)
5. RLS ativa, deploy em produção, dados reais

---

## 6. Posicionamento

> **Para** proprietários que gerenciam de 5 a 50 imóveis
> **Que** sofrem com fragmentação de info, atendimento manual lento e operação informal
> **kit-manager** é um sistema integrado bot+admin
> **Que** consolida atendimento via WhatsApp e gestão em um lugar, atuando como intermediário formal
> **Diferente de** planilhas, CRMs genéricos, ou bots WhatsApp sem gestão
> **Nosso produto** automatiza qualificação com IA e centraliza tudo desde o primeiro contato até pagamentos recorrentes, reduzindo contato direto proprietário↔inquilino

---

## 7. Métricas de sucesso

### Dogfooding (Fase atual — você)
- 100% dos imóveis próprios operados via sistema
- Zero planilhas/Word paralelos para gestão
- Tempo médio de qualificação de lead < 5 min (antes: 30+ min)
- < 10% dos eventos exigem contato direto seu com inquilino (resto via bot/admin)

### Validação comercial (próxima fase)
- 3 proprietários externos usando ≥ 30 dias
- NPS ≥ 8
- Tempo lead → tenant convertido reduzido em 40%

### Produto (Fase 5+)
- 10 PMCs pagantes
- Churn mensal < 5%
- ARPU > custo de infra + LLM × 3

---

## 8. Princípios de produto

1. **Informação consolidada** — nada vive fora do sistema. Se vive fora, sistema sabe que existe.
2. **WhatsApp como interface universal** — lead nunca precisa abrir link, app, formulário web.
3. **Bot nunca improvisa regras** — toda info factual vem do banco. Bot apenas comunica.
4. **Admin é onde proprietário opera** — não é dashboard de leitura. Toda ação importante começa lá.
5. **Schema preparado para escalar** — single-owner hoje, multi-tenant amanhã. Sem rework.
6. **Manual onde automação ainda não vale** — contrato em papel hoje, Autentique depois. Não bloqueia funil.
7. **Notificações redundantes onde importa** — proprietário não pode perder evento crítico. WhatsApp + email + in-app.
8. **Bot como mediador formal** — reduz necessidade de contato direto proprietário↔inquilino. Tudo registrado, nada informal.

---

## 9. Restrições técnicas (resumo)

> Detalhes técnicos completos em `CLAUDE.md` e `OVERVIEW.md`.

- Monorepo Bun. Sem npm/yarn. Sem Python.
- Bot: Fastify + Prisma + OpenAI GPT-4o mini + Supabase + Redis + Evolution API
- Web: Vite + React 19 + TanStack Router/Query + Tailwind v4 + shadcn/ui
- Tipos compartilhados em `packages/types`
- Componentes: named export, `tv()`, `data-slot`, sem barrel files, cores via CSS vars
- Cobertura inicial: solo proprietário, ~15 imóveis, ~50 leads/mês

---

## 10. Hipóteses

1. **H1**: Proprietários querem trocar fricção do WhatsApp por sistema integrado
2. **H2**: IA conduz qualificação inicial sem irritar leads (já validado em testes do bot)
3. **H3**: Admin web é o canal preferido para gestão (vs app mobile)
4. **H4**: Manual de contrato em papel não é dealbreaker para proprietários pequenos
5. **H5**: Notificação WhatsApp pro próprio proprietário é mais eficaz que email para urgência
6. **H6**: Modelo single-owner basta para 6+ meses antes de demanda PMC concreta
7. **H7**: Proprietários valorizam distanciamento operacional do inquilino (bot como mediador)

Cada hipótese vira critério de validação em uso real.

---

## 11. Roadmap macro

> Detalhamento por slice em `ROADMAP.md`.

| Fase | Status | Foco |
|---|---|---|
| **0 — Foundation** | parcial | Schema migrations on-demand, activity_log, RLS readiness |
| **1 — Bot WhatsApp** | produção | Atual + notif ao proprietário |
| **2 — MVP Admin** | em curso | 9 páginas funcionais com dados reais |
| **3 — Operação real** | pendente | Dogfooding 100% próprios imóveis |
| **4 — Validação externa** | futuro | 3 proprietários externos |
| **5 — Multi-tenancy** | futuro | Org, RBAC, billing, onboarding |
| **6 — Autentique + KYC auto** | futuro | Assinatura digital, validação CPF |

---

## 12. Glossário

- **Lead**: pessoa que contactou via WhatsApp, não convertida em inquilino
- **Tenant** (inquilino): lead convertido, com contrato ativo
- **Owner** (proprietário): dono do imóvel — hoje único, no MVP **= user do sistema**
- **PMC**: Property Management Company (imobiliária)
- **FSM**: Finite State Machine — estados do lead derivados do contexto
- **Rule Set**: conjunto nomeado de políticas de locação (ex: "Premium residencial")
- **External ID**: código humanamente legível (`IM-0421`, `IQ-102`, `LD-2301`, `CT-2024-0001`)
- **KYC**: Know Your Customer — análise documental do lead pré-contrato
