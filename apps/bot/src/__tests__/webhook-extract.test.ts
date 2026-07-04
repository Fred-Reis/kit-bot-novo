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
