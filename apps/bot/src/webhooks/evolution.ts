import type { FastifyInstance } from 'fastify';
import { bufferMedia, bufferMessage } from '@/buffer';
import { config } from '@/config';
import { logger } from '@/lib/logger';
import { getBase64FromMediaMessage, sendText } from '@/services/evolution';

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

function redactPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const safe = { ...payload };
  const data = safe['data'];
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    const message = d['message'];
    if (message && typeof message === 'object') {
      const m = { ...(message as Record<string, unknown>) };
      if (typeof m['base64'] === 'string') {
        m['base64'] = `<omitted:${m['base64'].length} chars>`;
      }
      safe['data'] = { ...d, message: m };
    }
  }
  return safe;
}

export function extractInboundMessage(payload: Record<string, unknown>): InboundMessage | null {
  if (payload['event'] !== 'messages.upsert') return null;

  const data = (payload['data'] ?? {}) as Record<string, unknown>;
  const key = (data['key'] ?? {}) as Record<string, unknown>;
  const msg = (data['message'] ?? {}) as Record<string, unknown>;

  const chatId = key['remoteJid'] as string | undefined;
  if (!chatId) return null;

  const messageId = (key['id'] as string | null) ?? null;
  const senderName = (data['pushName'] as string | null) ?? null;
  const timestamp = (data['messageTimestamp'] as number | null) ?? null;
  const mediaBase64 = (msg['base64'] as string | null) ?? null;

  let messageType: InboundMessage['messageType'] = 'unknown';
  let text: string | null = null;
  let mediaUrl: string | null = null;
  let mediaMime: string | null = null;

  if ('conversation' in msg) {
    messageType = 'text';
    text = msg['conversation'] as string;
  } else if ('extendedTextMessage' in msg) {
    messageType = 'text';
    const ext = (msg['extendedTextMessage'] ?? {}) as Record<string, unknown>;
    text = (ext['text'] as string | null) ?? null;
  } else if ('imageMessage' in msg) {
    messageType = 'image';
    const image = (msg['imageMessage'] ?? {}) as Record<string, unknown>;
    text = (image['caption'] as string | null) ?? null;
    mediaMime = (image['mimetype'] as string | null) ?? null;
    mediaUrl = ((image['url'] ?? image['directPath']) as string | null) ?? null;
  } else if ('documentMessage' in msg) {
    messageType = 'document';
    const doc = (msg['documentMessage'] ?? {}) as Record<string, unknown>;
    text = ((doc['caption'] ?? doc['title']) as string | null) ?? null;
    mediaMime = (doc['mimetype'] as string | null) ?? null;
    mediaUrl = ((doc['url'] ?? doc['directPath']) as string | null) ?? null;
  } else if ('videoMessage' in msg) {
    messageType = 'video';
    const video = (msg['videoMessage'] ?? {}) as Record<string, unknown>;
    text = (video['caption'] as string | null) ?? null;
    mediaMime = (video['mimetype'] as string | null) ?? null;
    mediaUrl = ((video['url'] ?? video['directPath']) as string | null) ?? null;
  } else if ('audioMessage' in msg) {
    messageType = 'audio';
    const audio = (msg['audioMessage'] ?? {}) as Record<string, unknown>;
    mediaMime = (audio['mimetype'] as string | null) ?? null;
    mediaUrl = ((audio['url'] ?? audio['directPath']) as string | null) ?? null;
  }

  return {
    chatId,
    messageId,
    messageType,
    text,
    mediaUrl,
    mediaMime,
    mediaBase64,
    senderName,
    timestamp,
  };
}

export async function evolutionWebhookPlugin(fastify: FastifyInstance) {
  fastify.post<{ Body: Record<string, unknown> }>('/webhook', async (request, reply) => {
    const payload = request.body;

    if (config.LOG_PAYLOADS) {
      fastify.log.info({ payload: redactPayload(payload) }, 'Webhook payload');
    }

    const inbound = extractInboundMessage(payload);

    if (!inbound || inbound.chatId.includes('@g.us')) {
      return reply.send({ status: 'ok' });
    }

    // Dispatch async — reply immediately
    void dispatch(inbound);

    return reply.send({ status: 'ok' });
  });
}

async function dispatch(inbound: InboundMessage): Promise<void> {
  const { chatId, messageId, messageType, text, mediaMime, mediaBase64, mediaUrl, senderName } = inbound;

  if (messageType === 'text' && text) {
    await bufferMessage(chatId, text, messageId, senderName);
    return;
  }

  if (messageType === 'audio') {
    await bufferMedia(
      chatId,
      { type: 'audio', mime: mediaMime ?? undefined, messageId: messageId ?? undefined },
      text ?? undefined,
      messageId,
      senderName,
    );
    return;
  }

  if (messageType === 'image' || messageType === 'document' || messageType === 'video') {
    let base64 = mediaBase64;

    if (!base64 && messageId) {
      // Evolution nem sempre inclui base64 no webhook — buscar sob demanda
      base64 = await getBase64FromMediaMessage(messageId);
    }

    if (!base64) {
      const reason = messageId ? 'fallback falhou' : 'sem messageId';
      logger.error({ chatId, messageId, messageType, mediaUrl }, `[webhook] Midia sem base64 (${reason}) — midia perdida`);
      await sendText(chatId, 'Não consegui receber seu arquivo 😕 Pode reenviar, por favor?').catch(
        (sendErr) => logger.error({ sendErr, chatId, messageId }, '[webhook] Failed to notify lead'),
      );
      return;
    }

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
}
