# Lead Flow v2 — Fase 0: Hotfix de produção — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parar a perda silenciosa de documentos de leads em produção: garantir bucket de storage funcional, avisar o lead quando upload falha, confirmar recebimento de documento e cobrir os buracos do webhook (vídeo e mídia sem base64).

**Architecture:** Bot WhatsApp Fastify/Bun. Mensagens chegam via webhook da Evolution API (`src/webhooks/evolution.ts`), são debounced no Redis (`src/buffer.ts`) e processadas por `src/flows/lead/index.ts`. Documentos (imagens) são upados ao Supabase Storage no buffer e persistidos na tabela `LeadDocument` no flow. Hoje, upload falho e mídia sem base64 somem sem rastro — em produção o Storage está vazio e `LeadDocument` sem linhas, indicando que nenhum upload jamais funcionou (bucket `leads` provavelmente não existe).

**Tech Stack:** Bun + TypeScript strict, Fastify, Prisma (PostgreSQL/Supabase), ioredis, `@supabase/supabase-js`, Evolution API (REST), `bun test`.

## Global Constraints

- Usar **bun** (nunca npm/yarn). Rodar comandos a partir de `apps/bot/`.
- Typecheck: `bunx tsc --noEmit` em `apps/bot/` deve passar após cada task.
- Testes: `bun test` em `apps/bot/` (testes em `src/__tests__/*.test.ts`).
- Lint: Oxlint (`bunx oxlint src`).
- Imports com alias `@/` (ex.: `@/services/evolution`).
- **Não usar Python. Não versionar mídia binária.**
- Mensagens ao lead em português brasileiro, tom cordial e curto.
- **Git:** trabalhar na branch `feat/lead-flow-v2-fase-0` (criada de `main`). Commits locais por task; ao final do plan, push + PR (task final). **Nunca commitar/pushar em `main`; merge é do Fred via PR.**
- Env vars já existentes (ver `src/config.ts`): `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `EVOLUTION_API_URL`, `EVOLUTION_INSTANCE_NAME`, `EVOLUTION_API_KEY`. Bun carrega `.env` automaticamente.

---

### Task 1: Healthcheck e criação do bucket `leads` no Supabase Storage

**Files:**
- Create: `apps/bot/scripts/check-storage.ts`

**Interfaces:**
- Consumes: `config` de `src/config.ts`, `@supabase/supabase-js` (já é dependência).
- Produces: bucket `leads` existente e upload funcional em produção. Nenhum código de runtime depende deste script.

Contexto: `src/services/storage.ts` faz `supabase.storage.from('leads').upload(...)` e `getPublicUrl(...)`. Se o bucket não existe, TODO upload falha e o erro é engolido em `src/buffer.ts:67-71`. O bucket é criado **público** porque o código atual (storage + OCR + painel admin) consome `getPublicUrl`; endurecimento (bucket privado + signed URLs) está fora do escopo desta fase e registrado na Fase A como pendência.

- [ ] **Step 1: Escrever o script**

```ts
// apps/bot/scripts/check-storage.ts
import { createClient } from '@supabase/supabase-js';
import { config } from '../src/config';

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);

async function main(): Promise<void> {
  const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
  if (listErr) throw new Error(`listBuckets falhou: ${listErr.message}`);

  const exists = (buckets ?? []).some((b) => b.name === 'leads');
  if (!exists) {
    const { error: createErr } = await supabase.storage.createBucket('leads', { public: true });
    if (createErr) throw new Error(`createBucket falhou: ${createErr.message}`);
    console.log('Bucket "leads" criado (public).');
  } else {
    console.log('Bucket "leads" já existe.');
  }

  // Teste ponta a ponta: upload + public URL + download + cleanup
  const testPath = `healthcheck/${Date.now()}.txt`;
  const { error: upErr } = await supabase.storage
    .from('leads')
    .upload(testPath, Buffer.from('healthcheck'), { contentType: 'text/plain' });
  if (upErr) throw new Error(`upload de teste falhou: ${upErr.message}`);

  const { data: pub } = supabase.storage.from('leads').getPublicUrl(testPath);
  const res = await fetch(pub.publicUrl);
  if (!res.ok) throw new Error(`public URL inacessível: HTTP ${res.status}`);

  await supabase.storage.from('leads').remove([testPath]);
  console.log('Storage saudável ✅ upload + public URL OK');
}

main().catch((err) => {
  console.error('FALHA:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Rodar contra o Supabase do projeto**

Run: `cd apps/bot && bun run scripts/check-storage.ts`
Expected: `Storage saudável ✅ upload + public URL OK` (na primeira execução, também `Bucket "leads" criado (public).`)

Se falhar com erro de permissão: a `SUPABASE_SERVICE_KEY` do `.env` não é a service role key — parar e reportar ao Fred.

- [ ] **Step 3: Typecheck**

Run: `cd apps/bot && bunx tsc --noEmit`
Expected: sem erros

- [ ] **Step 4: Commit**

```bash
git add apps/bot/scripts/check-storage.ts
git commit -m "bot: adicionar healthcheck de storage e criar bucket leads"
```

---

### Task 2: Upload falho → avisar o lead (fim do buraco negro)

**Files:**
- Modify: `apps/bot/src/buffer.ts:60-72` (função `bufferMedia`)
- Test: `apps/bot/src/__tests__/buffer-upload-failure.test.ts`

**Interfaces:**
- Consumes: `uploadLeadDocument` de `@/services/storage`, `sendText` de `@/services/evolution` (assinatura: `sendText(chatId: string, text: string): Promise<void>`).
- Produces: comportamento — upload falho gera mensagem ao lead e a mídia NÃO entra no buffer (sem URL ela seria inútil no flow).

- [ ] **Step 1: Escrever o teste que falha**

```ts
// apps/bot/src/__tests__/buffer-upload-failure.test.ts
import { beforeEach, describe, expect, it, mock } from 'bun:test';

const sentTexts: Array<{ chatId: string; text: string }> = [];
const pushedMedia: string[] = [];

mock.module('@/db/redis', () => ({
  redis: {
    set: async () => 'OK', // dedupe sempre passa (NX ok)
    rpush: async (_key: string, value: string) => {
      pushedMedia.push(value);
      return 1;
    },
    expire: async () => 1,
    lrange: async () => [],
    del: async () => 1,
    get: async () => null,
  },
}));

mock.module('@/services/storage', () => ({
  uploadLeadDocument: async () => {
    throw new Error('bucket not found');
  },
}));

mock.module('@/services/evolution', () => ({
  sendText: async (chatId: string, text: string) => {
    sentTexts.push({ chatId, text });
  },
  sendMedia: async () => {},
}));

import { bufferMedia } from '@/buffer';

describe('bufferMedia com upload falho', () => {
  beforeEach(() => {
    sentTexts.length = 0;
    pushedMedia.length = 0;
  });

  it('avisa o lead e não enfileira a mídia sem URL', async () => {
    await bufferMedia(
      '5511999999999@s.whatsapp.net',
      { type: 'image', mime: 'image/jpeg', base64: 'AAAA', messageId: 'm1' },
      undefined,
      'm1',
      'Fred',
    );

    expect(sentTexts.length).toBe(1);
    expect(sentTexts[0].chatId).toBe('5511999999999@s.whatsapp.net');
    expect(sentTexts[0].text).toContain('reenviar');
    expect(pushedMedia.length).toBe(0);
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `cd apps/bot && bun test buffer-upload-failure`
Expected: FAIL — hoje a mídia sem URL é enfileirada (`pushedMedia.length` = 1) e nada é enviado ao lead.

- [ ] **Step 3: Implementar em `buffer.ts`**

Adicionar import no topo (junto aos existentes):

```ts
import { sendText } from '@/services/evolution';
```

Substituir o bloco de upload dentro de `bufferMedia` (linhas ~60-72):

```ts
  // Upload non-audio media to Supabase Storage before enqueueing
  let resolvedMedia: MediaItem = media;
  if (media.base64 && media.type !== 'audio' && media.mime) {
    try {
      const url = await uploadLeadDocument(chatId, media.base64, media.mime);
      // Keep type and mime but replace base64 with url
      resolvedMedia = { type: media.type, mime: media.mime, url, messageId: media.messageId };
    } catch (err) {
      logger.error({ err, chatId }, '[buffer] Failed to upload media to Storage');
      await sendText(
        chatId,
        'Não consegui receber seu arquivo agora 😕 Pode reenviar, por favor?',
      ).catch((sendErr) => logger.error({ sendErr, chatId }, '[buffer] Failed to notify lead'));
      // Sem URL a mídia é inútil no flow — não enfileirar
      resetDebounce(chatId);
      return;
    }
  }
```

- [ ] **Step 4: Rodar testes**

Run: `cd apps/bot && bun test`
Expected: PASS (incluindo os testes pré-existentes)

- [ ] **Step 5: Typecheck + commit**

Run: `cd apps/bot && bunx tsc --noEmit`
Expected: sem erros

```bash
git add apps/bot/src/buffer.ts apps/bot/src/__tests__/buffer-upload-failure.test.ts
git commit -m "bot: avisar lead quando upload de midia falha"
```

---

### Task 3: Confirmação determinística de recebimento de documento

**Files:**
- Create: `apps/bot/src/flows/lead/receipt.ts`
- Modify: `apps/bot/src/flows/lead/index.ts:117-142` (função `persistLeadDocuments`) e `:229` (chamada)
- Test: `apps/bot/src/__tests__/receipt.test.ts`

**Interfaces:**
- Consumes: nada novo.
- Produces: `buildReceiptMessage(count: number): string | null` — usada em `index.ts`. `persistLeadDocuments` passa a retornar `Promise<number>` (docs persistidos).

Nota: a Fase A substitui este feedback por um checklist completo com classificação OCR. Esta versão simples existe para o lead nunca mais ficar sem resposta ao enviar documento.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// apps/bot/src/__tests__/receipt.test.ts
import { describe, expect, it } from 'bun:test';
import { buildReceiptMessage } from '@/flows/lead/receipt';

describe('buildReceiptMessage', () => {
  it('retorna null para zero documentos', () => {
    expect(buildReceiptMessage(0)).toBeNull();
  });

  it('singular para 1 documento', () => {
    expect(buildReceiptMessage(1)).toBe('📄 Recebi seu documento!');
  });

  it('plural para 2+', () => {
    expect(buildReceiptMessage(3)).toBe('📄 Recebi 3 documentos!');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd apps/bot && bun test receipt`
Expected: FAIL — módulo `@/flows/lead/receipt` não existe.

- [ ] **Step 3: Implementar `receipt.ts`**

```ts
// apps/bot/src/flows/lead/receipt.ts
export function buildReceiptMessage(count: number): string | null {
  if (count <= 0) return null;
  if (count === 1) return '📄 Recebi seu documento!';
  return `📄 Recebi ${count} documentos!`;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd apps/bot && bun test receipt`
Expected: PASS (3 testes)

- [ ] **Step 5: Wire em `index.ts`**

Adicionar import (junto aos imports de `@/flows/lead/...`):

```ts
import { buildReceiptMessage } from '@/flows/lead/receipt';
```

Alterar `persistLeadDocuments` para retornar a contagem — trocar a assinatura e o final:

```ts
async function persistLeadDocuments(
  leadId: string,
  mediaItems: MediaItem[],
  docsPreference: 'cnh' | 'rg_cpf' | null,
  ownerId: string,
): Promise<number> {
  const docItems = mediaItems.filter(isDocMedia);
  if (docItems.length === 0) return 0;

  const docType = docsPreference ?? 'image';

  await Promise.all(
    docItems.map(async (m) => {
      const ocrText = await extractTextFromImage(m.url!);
      return prisma.leadDocument.create({
        data: {
          leadId,
          type: docType,
          url: m.url!,
          ocrText: ocrText || null,
          ownerId,
        },
      });
    }),
  );
  return docItems.length;
}
```

No corpo de `handleLeadMessage`, trocar a chamada (comentário `// 7. Persist document images`):

```ts
    // 7. Persist document images
    const persistedDocsCount = await persistLeadDocuments(
      lead.id,
      mediaItems,
      context.docsPreference ?? null,
      ownerId,
    );
    const receiptMsg = buildReceiptMessage(persistedDocsCount);
    if (receiptMsg) {
      await sendText(chatId, receiptMsg);
    }
```

- [ ] **Step 6: Rodar tudo + typecheck**

Run: `cd apps/bot && bun test && bunx tsc --noEmit`
Expected: PASS / sem erros

- [ ] **Step 7: Commit**

```bash
git add apps/bot/src/flows/lead/receipt.ts apps/bot/src/flows/lead/index.ts apps/bot/src/__tests__/receipt.test.ts
git commit -m "bot: confirmar recebimento de documento de forma deterministica"
```

---

### Task 4: Webhook — tratar vídeo e mídia sem base64

**Files:**
- Modify: `apps/bot/src/webhooks/evolution.ts` (tipo `InboundMessage`, `extractInboundMessage`, `dispatch`)
- Modify: `apps/bot/src/services/evolution.ts` (nova função `getBase64FromMediaMessage`)
- Test: `apps/bot/src/__tests__/webhook-extract.test.ts`

**Interfaces:**
- Consumes: padrão de headers/URL de `services/evolution.ts` (`apikey`, `${EVOLUTION_API_URL}/<recurso>/${EVOLUTION_INSTANCE_NAME}`).
- Produces: `extractInboundMessage` exportada (para teste); `messageType` ganha `'video'`; `getBase64FromMediaMessage(messageId: string): Promise<string | null>` em `services/evolution.ts`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// apps/bot/src/__tests__/webhook-extract.test.ts
import { describe, expect, it } from 'bun:test';
import { extractInboundMessage } from '@/webhooks/evolution';

function payload(message: Record<string, unknown>): Record<string, unknown> {
  return {
    event: 'messages.upsert',
    data: {
      key: { remoteJid: '5511999999999@s.whatsapp.net', id: 'msg1' },
      pushName: 'Fred',
      messageTimestamp: 1751500000,
      message,
    },
  };
}

describe('extractInboundMessage', () => {
  it('extrai videoMessage como video', () => {
    const inbound = extractInboundMessage(
      payload({
        videoMessage: { caption: 'olha o doc', mimetype: 'video/mp4', url: 'https://x/v.mp4' },
        base64: 'QUFB',
      }),
    );
    expect(inbound?.messageType).toBe('video');
    expect(inbound?.text).toBe('olha o doc');
    expect(inbound?.mediaMime).toBe('video/mp4');
    expect(inbound?.mediaBase64).toBe('QUFB');
  });

  it('extrai imageMessage sem base64 (para fallback no dispatch)', () => {
    const inbound = extractInboundMessage(
      payload({ imageMessage: { mimetype: 'image/jpeg', url: 'https://x/i.jpg' } }),
    );
    expect(inbound?.messageType).toBe('image');
    expect(inbound?.mediaBase64).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd apps/bot && bun test webhook-extract`
Expected: FAIL — `extractInboundMessage` não é exportada e não existe branch de `videoMessage`.

- [ ] **Step 3: Implementar em `webhooks/evolution.ts`**

Atualizar o tipo:

```ts
export interface InboundMessage {
  chatId: string;
  messageId: string | null;
  messageType: 'text' | 'image' | 'document' | 'video' | 'audio' | 'unknown';
  text: string | null;
  mediaUrl: string | null;
  mediaMime: string | null;
  mediaBase64: string | null;
  senderName: string | null;
  timestamp: number | null;
}
```

Exportar a função e adicionar o branch de vídeo (depois do branch de `documentMessage`):

```ts
export function extractInboundMessage(payload: Record<string, unknown>): InboundMessage | null {
```

```ts
  } else if ('videoMessage' in msg) {
    messageType = 'video';
    const video = (msg['videoMessage'] ?? {}) as Record<string, unknown>;
    text = (video['caption'] as string | null) ?? null;
    mediaMime = (video['mimetype'] as string | null) ?? null;
    mediaUrl = ((video['url'] ?? video['directPath']) as string | null) ?? null;
  } else if ('audioMessage' in msg) {
```

Substituir o final de `dispatch` (bloco `image || document`):

```ts
  if (messageType === 'image' || messageType === 'document' || messageType === 'video') {
    let base64 = mediaBase64;

    if (!base64 && messageId) {
      // Evolution nem sempre inclui base64 no webhook — buscar sob demanda
      const { getBase64FromMediaMessage } = await import('@/services/evolution');
      base64 = await getBase64FromMediaMessage(messageId);
      if (!base64) {
        const { logger } = await import('@/lib/logger');
        logger.error(
          { chatId, messageId, messageType },
          '[webhook] Midia sem base64 e fallback falhou — midia perdida',
        );
        return;
      }
    }

    if (!base64) return;

    await bufferMedia(
      chatId,
      {
        type: messageType,
        mime: mediaMime ?? undefined,
        base64,
        messageId: messageId ?? undefined,
      },
      text ?? undefined,
      messageId,
      senderName,
    );
    return;
  }
```

- [ ] **Step 4: Implementar `getBase64FromMediaMessage` em `services/evolution.ts`**

Adicionar ao final do arquivo, seguindo o padrão de `sendText`:

```ts
export async function getBase64FromMediaMessage(messageId: string): Promise<string | null> {
  const url = `${config.EVOLUTION_API_URL}/chat/getBase64FromMediaMessage/${config.EVOLUTION_INSTANCE_NAME}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ message: { key: { id: messageId } }, convertToMp4: false }),
  });

  if (!response.ok) {
    return null;
  }

  const data = (await response.json().catch(() => null)) as { base64?: string } | null;
  return data?.base64 ?? null;
}
```

- [ ] **Step 5: Rodar tudo + typecheck**

Run: `cd apps/bot && bun test && bunx tsc --noEmit`
Expected: PASS / sem erros

- [ ] **Step 6: Verificação manual (opcional, requer Evolution local)**

Run: `docker compose up -d --build bot && docker compose logs -f bot`
Enviar uma imagem pelo WhatsApp de teste → log deve mostrar `[buffer] Processing` com `mediaCount: 1` e o lead deve receber "📄 Recebi seu documento!".

- [ ] **Step 7: Commit**

```bash
git add apps/bot/src/webhooks/evolution.ts apps/bot/src/services/evolution.ts apps/bot/src/__tests__/webhook-extract.test.ts
git commit -m "bot: tratar video e midia sem base64 no webhook"
```

---

### Task 5: Abrir a PR

**Files:** nenhum (operação git).

- [ ] **Step 1: Push da branch**

Run: `git push -u origin feat/lead-flow-v2-fase-0`

- [ ] **Step 2: Criar a PR**

```bash
gh pr create \
  --title "fix(bot): hotfix de intake de documentos em produção" \
  --body "$(cat <<'EOF'
## Resumo
Fase 0 do Lead Flow v2 (plan: docs/superpowers/plans/2026-07-02-lead-flow-v2-fase-0-hotfix.md).

- Healthcheck + criação do bucket `leads` no Supabase Storage (causa raiz provável do loop de docs em produção)
- Upload de mídia falho agora avisa o lead e não enfileira mídia sem URL
- Confirmação determinística de recebimento de documento
- Webhook: suporte a `videoMessage` e fallback `getBase64FromMediaMessage` para mídia sem base64

## Como testar
1. `cd apps/bot && bun test && bunx tsc --noEmit`
2. `bun run scripts/check-storage.ts` (com .env de produção)
3. Enviar imagem pelo WhatsApp de teste → deve responder "📄 Recebi seu documento!"

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Review local antes de reportar** — rodar a skill `coderabbit:code-review` no diff da branch e resolver findings relevantes (fallback: `/code-review`). O app do CodeRabbit também revisará a PR automaticamente.

- [ ] **Step 4: Reportar a URL da PR ao Fred** — merge é dele, após os reviews.
