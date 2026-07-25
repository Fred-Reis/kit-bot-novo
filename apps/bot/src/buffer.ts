import { config } from '@/config';
import { redis } from '@/db/redis';
import { logger } from '@/lib/logger';
import { sendText } from '@/services/evolution';
import { recordMediaFailure, resetMediaFailures } from '@/services/media-failure-tracker';
import { uploadLeadDocument } from '@/services/storage';

const debounceHandles = new Map<string, NodeJS.Timeout>();

// Tracks in-flight Storage uploads per chatId. resetDebounce() alone can't
// prevent a premature flush if the upload itself takes longer than
// DEBOUNCE_SECONDS with nothing else resetting the timer in between — the
// timeout would fire before the media ever reaches media_buffer's rpush.
// The debounce callback checks this and re-arms instead of flushing while
// any upload for that chatId is still pending.
const pendingUploads = new Map<string, number>();

function markUploadPending(chatId: string): void {
  pendingUploads.set(chatId, (pendingUploads.get(chatId) ?? 0) + 1);
}

function markUploadSettled(chatId: string): void {
  const next = (pendingUploads.get(chatId) ?? 1) - 1;
  if (next <= 0) pendingUploads.delete(chatId);
  else pendingUploads.set(chatId, next);
}

async function storeSenderName(chatId: string, name: string | null | undefined): Promise<void> {
  if (!name) return;
  await redis.set(`sender:${chatId}`, name, 'EX', config.BUFFER_TTL_SECONDS, 'NX');
}

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
  senderName?: string | null,
): Promise<void> {
  if (await isDuplicateMessage(chatId, messageId)) {
    logger.warn({ chatId, messageId }, '[buffer] Duplicate message ignored');
    return;
  }

  const bufferKey = `msg_buffer:${chatId}`;
  await redis.rpush(bufferKey, message);
  await redis.expire(bufferKey, config.BUFFER_TTL_SECONDS);

  await storeSenderName(chatId, senderName);

  resetDebounce(chatId);
}

export async function bufferMedia(
  chatId: string,
  media: MediaItem,
  message?: string,
  messageId?: string | null,
  senderName?: string | null,
): Promise<void> {
  if (await isDuplicateMessage(chatId, messageId ?? null)) {
    logger.warn({ chatId, messageId }, '[buffer] Duplicate media ignored');
    return;
  }

  // Hold the debounce window open immediately, before the (slow) upload below.
  // Otherwise a fast text message arriving while this upload is still in
  // flight can flush the buffer first — splitting a "PDF + confirmation text"
  // pair sent together into two separate flushes (see incident: bot asking
  // to resend a signed contract PDF that had already arrived, moments earlier).
  resetDebounce(chatId);

  // Upload non-audio media to Supabase Storage before enqueueing
  let resolvedMedia: MediaItem = media;
  if (media.base64 && media.type !== 'audio' && media.mime) {
    markUploadPending(chatId);
    try {
      const storagePath = await uploadLeadDocument(chatId, media.base64, media.mime);
      // Store the storage path — URL is generated on demand at display time
      resolvedMedia = { type: media.type, mime: media.mime, url: storagePath, messageId: media.messageId };
      resetMediaFailures(chatId).catch((err) =>
        logger.error({ err, chatId }, '[buffer] resetMediaFailures failed'),
      );
    } catch (err) {
      logger.error({ err, chatId }, '[buffer] Failed to upload media to Storage');
      await sendText(
        chatId,
        'Não consegui receber seu arquivo agora 😕 Pode reenviar, por favor?',
      ).catch((sendErr) => logger.error({ sendErr, chatId }, '[buffer] Failed to notify lead'));
      recordMediaFailure(chatId).catch((trackErr) =>
        logger.error({ err: trackErr, chatId }, '[buffer] recordMediaFailure failed'),
      );
      // Sem URL a mídia é inútil no flow — não enfileirar
      resetDebounce(chatId);
      return;
    } finally {
      markUploadSettled(chatId);
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

  await storeSenderName(chatId, senderName);

  resetDebounce(chatId);
}

function resetDebounce(chatId: string): void {
  const existing = debounceHandles.get(chatId);
  if (existing) clearTimeout(existing);

  const handle = setTimeout(() => {
    if ((pendingUploads.get(chatId) ?? 0) > 0) {
      // An upload for this chatId hasn't reached media_buffer yet — flushing
      // now would process without it. Re-arm instead of flushing; the
      // upload's own post-success resetDebounce() (or this poll, worst case)
      // will eventually flush once nothing is pending.
      resetDebounce(chatId);
      return;
    }
    void flushAndProcess(chatId);
  }, config.DEBOUNCE_SECONDS * 1000);

  debounceHandles.set(chatId, handle);
}

async function flushAndProcess(chatId: string): Promise<void> {
  debounceHandles.delete(chatId);

  const bufferKey = `msg_buffer:${chatId}`;
  const mediaKey = `media_buffer:${chatId}`;

  const [messages, mediaRows, senderName] = await Promise.all([
    redis.lrange(bufferKey, 0, -1),
    redis.lrange(mediaKey, 0, -1),
    redis.get(`sender:${chatId}`),
  ]);

  await Promise.all([redis.del(bufferKey), redis.del(mediaKey)]);

  const text = messages.join(' ').trim() || null;
  const mediaItems: MediaItem[] = mediaRows.map((row) => JSON.parse(row) as MediaItem);

  if (!text && mediaItems.length === 0) return;

  logger.info({ chatId, mediaCount: mediaItems.length }, '[buffer] Processing');

  // Lazy import to avoid circular dependency at load time
  const { routeMessage } = await import('@/flows/router');
  await routeMessage(chatId, text, mediaItems, senderName ?? null);
}
