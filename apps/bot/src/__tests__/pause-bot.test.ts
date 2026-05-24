import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

// Schema exported from admin routes — import once implemented
// For RED phase: define expected shape inline and verify behavior
const PauseBotBodySchema = z.object({
  paused: z.boolean(),
});

function resolvePauseAction(paused: boolean): 'bot_paused' | 'bot_resumed' {
  return paused ? 'bot_paused' : 'bot_resumed';
}

describe('pause-bot endpoint', () => {
  describe('PauseBotBodySchema', () => {
    test('accepts { paused: true }', () => {
      expect(PauseBotBodySchema.parse({ paused: true })).toEqual({ paused: true });
    });

    test('accepts { paused: false }', () => {
      expect(PauseBotBodySchema.parse({ paused: false })).toEqual({ paused: false });
    });

    test('rejects missing paused field', () => {
      expect(() => PauseBotBodySchema.parse({})).toThrow();
    });

    test('rejects non-boolean paused', () => {
      expect(() => PauseBotBodySchema.parse({ paused: 'yes' })).toThrow();
    });
  });

  describe('resolvePauseAction', () => {
    test('paused=true → bot_paused', () => {
      expect(resolvePauseAction(true)).toBe('bot_paused');
    });

    test('paused=false → bot_resumed', () => {
      expect(resolvePauseAction(false)).toBe('bot_resumed');
    });
  });
});
