import { config } from '@/config';
import { logger } from '@/lib/logger';

function normalizePhone(chatId: string): string {
  return chatId.split('@')[0];
}

function headers() {
  return {
    apikey: config.EVOLUTION_API_KEY,
    'Content-Type': 'application/json',
  };
}

export async function sendText(chatId: string, text: string): Promise<void> {
  const phone = normalizePhone(chatId);
  const url = `${config.EVOLUTION_API_URL}/message/sendText/${config.EVOLUTION_INSTANCE_NAME}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ number: phone, text }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Evolution sendText failed: ${response.status} ${body}`);
  }
}

const MIME_TYPES: Record<string, string> = {
  video: 'video/mp4',
  image: 'image/jpeg',
  audio: 'audio/mpeg',
  document: 'application/pdf',
};

export async function sendMedia(
  chatId: string,
  mediaType: 'image' | 'video' | 'document' | 'audio',
  mediaUrl: string,
  caption?: string,
  fileName?: string,
): Promise<void> {
  const phone = normalizePhone(chatId);
  const url = `${config.EVOLUTION_API_URL}/message/sendMedia/${config.EVOLUTION_INSTANCE_NAME}`;

  const payload = {
    number: phone,
    mediatype: mediaType,
    mimetype: MIME_TYPES[mediaType] ?? 'application/octet-stream',
    media: mediaUrl,
    caption: caption ?? '',
    fileName:
      fileName ??
      `media.${mediaType === 'video' ? 'mp4' : mediaType === 'image' ? 'jpg' : mediaType === 'audio' ? 'mp3' : 'pdf'}`,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Evolution sendMedia failed: ${response.status} ${body}`);
  }
}

export async function getBase64FromMediaMessage(messageId: string): Promise<string | null> {
  const url = `${config.EVOLUTION_API_URL}/chat/getBase64FromMediaMessage/${config.EVOLUTION_INSTANCE_NAME}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(url, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ message: { key: { id: messageId } }, convertToMp4: false }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (!response.ok) {
      logger.error({ messageId, status: response.status }, '[evolution] Falha ao obter base64 da mídia');
      return null;
    }

    const data = (await response.json().catch(() => null)) as { base64?: string } | null;
    return data?.base64 ?? null;
  } catch (err) {
    logger.error({ messageId, err }, '[evolution] Erro ao buscar base64 da mídia');
    return null;
  }
}
