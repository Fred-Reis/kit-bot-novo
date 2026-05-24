import { describe, test, expect } from 'vitest';
import { SOURCE_LABELS } from '@/lib/leads';

describe('SOURCE_LABELS', () => {
  test('maps whatsapp to ZAP', () => expect(SOURCE_LABELS.whatsapp).toBe('ZAP'));
  test('maps zap to ZAP', () => expect(SOURCE_LABELS.zap).toBe('ZAP'));
  test('maps site to Site', () => expect(SOURCE_LABELS.site).toBe('Site'));
  test('maps instagram to Instagram', () => expect(SOURCE_LABELS.instagram).toBe('Instagram'));
  test('maps indicacao to Indicação', () => expect(SOURCE_LABELS.indicacao).toBe('Indicação'));
  test('maps other to Outro', () => expect(SOURCE_LABELS.other).toBe('Outro'));
  test('maps olx to OLX', () => expect(SOURCE_LABELS.olx).toBe('OLX'));
  test('maps outro to Outro', () => expect(SOURCE_LABELS.outro).toBe('Outro'));
  test('maps desconhecido to ?', () => expect(SOURCE_LABELS.desconhecido).toBe('?'));
});
