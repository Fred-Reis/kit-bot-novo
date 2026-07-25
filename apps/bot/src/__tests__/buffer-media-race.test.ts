import { beforeEach, describe, expect, it, mock } from 'bun:test';

const routeCalls: Array<{ text: string | null; mediaCount: number }> = [];

mock.module('@/config', () => ({
  config: { BUFFER_TTL_SECONDS: 60, DEBOUNCE_SECONDS: 0.1 },
}));

const store = new Map<string, string[]>();

mock.module('@/db/redis', () => ({
  redis: {
    set: async () => 'OK',
    rpush: async (key: string, value: string) => {
      const arr = store.get(key) ?? [];
      arr.push(value);
      store.set(key, arr);
      return arr.length;
    },
    expire: async () => 1,
    lrange: async (key: string) => store.get(key) ?? [],
    del: async (key: string) => {
      store.delete(key);
      return 1;
    },
    get: async () => null,
  },
}));

mock.module('@/services/storage', () => ({
  uploadLeadDocument: async () => {
    // Slower than DEBOUNCE_SECONDS (0.1s) — simulates the exact race:
    // the debounce timer would otherwise fire before this resolves.
    await new Promise((resolve) => setTimeout(resolve, 250));
    return 'leads/5511999999999/signed.pdf';
  },
}));

mock.module('@/services/media-failure-tracker', () => ({
  recordMediaFailure: async () => {},
  resetMediaFailures: async () => {},
}));

mock.module('@/services/evolution', () => ({
  sendText: async () => {},
  sendMedia: async () => {},
}));

mock.module('@/flows/router', () => ({
  routeMessage: async (_chatId: string, text: string | null, mediaItems: unknown[]) => {
    routeCalls.push({ text, mediaCount: mediaItems.length });
  },
}));

import { bufferMedia, bufferMessage } from '@/buffer';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('buffer: PDF (upload lento) + texto quase simultâneo', () => {
  beforeEach(() => {
    store.clear();
    routeCalls.length = 0;
  });

  it('não faz flush prematuro enquanto o upload ainda está em andamento', async () => {
    const chatId = '5511999999999@s.whatsapp.net';

    void bufferMedia(chatId, { type: 'document', mime: 'application/pdf', base64: 'AAAA' });
    await wait(20);
    await bufferMessage(chatId, 'Assinado');

    // Sem o guard de pendingUploads, o debounce (0.1s) dispararia aqui,
    // antes do upload (0.25s) terminar e a mídia entrar no buffer.
    await wait(200);
    expect(routeCalls.length).toBe(0);

    await wait(250);
    expect(routeCalls.length).toBe(1);
    expect(routeCalls[0].mediaCount).toBe(1);
    expect(routeCalls[0].text).toBe('Assinado');
  });
});
