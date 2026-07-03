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
