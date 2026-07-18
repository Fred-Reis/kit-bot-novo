import { afterEach, describe, expect, it, mock } from 'bun:test';
import { config as realConfig } from '@/config';

mock.module('@/config', () => ({
  config: {
    ...realConfig,
    GOOGLE_CREDENTIALS_JSON: JSON.stringify({ client_email: 'x', private_key: 'y' }),
  },
}));
mock.module('google-auth-library', () => ({
  GoogleAuth: class {
    async getClient() {
      return { getAccessToken: async () => ({ token: 'fake-token' }) };
    }
  },
}));

import { extractTextFromBase64 } from '@/services/ocr';

describe('extractTextFromBase64', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('envia image.content (não imageUri) e retorna o texto', async () => {
    let capturedBody: string | null = null;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return new Response(
        JSON.stringify({ responses: [{ fullTextAnnotation: { text: 'CNH TEXTO' } }] }),
        { status: 200 },
      );
    }) as typeof fetch;

    const text = await extractTextFromBase64('QUJD');
    expect(text).toBe('CNH TEXTO');
    const parsed = JSON.parse(capturedBody!);
    expect(parsed.requests[0].image.content).toBe('QUJD');
    expect(parsed.requests[0].image.source).toBeUndefined();
  });
});
