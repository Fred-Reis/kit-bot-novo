import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

const PauseBotBodySchema = z.object({
  paused: z.boolean(),
});

describe('pause-bot endpoint', () => {
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
