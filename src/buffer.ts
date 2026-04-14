import { redis } from '@/db/redis';
import { config } from '@/config';
import { uploadLeadDocument } from '@/services/storage';

const debounceHandles = new Map<string, NodeJS.Timeout>();

export interface MediaItem {
  type: string;
  mime?: string;
  url?: string;
  base64?: string;
  messageId?: string;
}

async function isDuplicateMessage(chatId: string, messageId: string | null): Promise<boolean> {
  if (!messageId) return false;
  const dedupeKey = `${chatId}:dedupe:${messageId}`;
  const wasSet = await redis.set(dedupeKey, '1', 'EX', config.BUFFER_TTL_SECONDS, 'NX');
  return wasSet === null;
}

export async function bufferMessage(
  chatId: string,
  message: string,
  messageId: string | null = null,
): Promise<void> {
  if (await isDuplicateMessage(chatId, messageId)) {
    console.warn(`[buffer] Duplicate message ignored for ${chatId}: ${messageId}`);
    return;
  }

  const bufferKey = `msg_buffer:${chatId}`;
  await redis.rpush(bufferKey, message);
  await redis.expire(bufferKey, config.BUFFER_TTL_SECONDS);

  resetDebounce(chatId);
}

export async function bufferMedia(
  chatId: string,
  media: MediaItem,
  message?: string,
  messageId?: string | null,
): Promise<void> {
  if (await isDuplicateMessage(chatId, messageId ?? null)) {
    console.warn(`[buffer] Duplicate media ignored for ${chatId}: ${messageId}`);
    return;
  }

  // Upload non-audio media to Supabase Storage before enqueueing
  let resolvedMedia: MediaItem = media;
  if (media.base64 && media.type !== 'audio' && media.mime) {
    try {
      const url = await uploadLeadDocument(chatId, media.base64, media.mime);
      // Keep type and mime but replace base64 with url
      resolvedMedia = { type: media.type, mime: media.mime, url, messageId: media.messageId };
    } catch (err) {
      console.error(`[buffer] Failed to upload media to Storage for ${chatId}:`, err);
      // Proceed without URL — flow will handle missing url gracefully
      resolvedMedia = { type: media.type, mime: media.mime, messageId: media.messageId };
    }
  }

  if (message) {
    const bufferKey = `msg_buffer:${chatId}`;
    await redis.rpush(bufferKey, message);
    await redis.expire(bufferKey, config.BUFFER_TTL_SECONDS);
  }

  const mediaKey = `media_buffer:${chatId}`;
  await redis.rpush(mediaKey, JSON.stringify(resolvedMedia));
  await redis.expire(mediaKey, config.BUFFER_TTL_SECONDS);

  resetDebounce(chatId);
}

function resetDebounce(chatId: string): void {
  const existing = debounceHandles.get(chatId);
  if (existing) clearTimeout(existing);

  const handle = setTimeout(() => {
    void flushAndProcess(chatId);
  }, config.DEBOUNCE_SECONDS * 1000);

  debounceHandles.set(chatId, handle);
}

async function flushAndProcess(chatId: string): Promise<void> {
  debounceHandles.delete(chatId);

  const bufferKey = `msg_buffer:${chatId}`;
  const mediaKey = `media_buffer:${chatId}`;

  const [messages, mediaRows] = await Promise.all([
    redis.lrange(bufferKey, 0, -1),
    redis.lrange(mediaKey, 0, -1),
  ]);

  await Promise.all([redis.del(bufferKey), redis.del(mediaKey)]);

  const text = messages.join(' ').trim() || null;
  const mediaItems: MediaItem[] = mediaRows.map((row) => JSON.parse(row) as MediaItem);

  if (!text && mediaItems.length === 0) return;

  console.info(`[buffer] Processing ${chatId} — text="${text}" media_count=${mediaItems.length}`);

  // Lazy import to avoid circular dependency at load time
  const { routeMessage } = await import('@/flows/router');
  await routeMessage(chatId, text, mediaItems);
}
