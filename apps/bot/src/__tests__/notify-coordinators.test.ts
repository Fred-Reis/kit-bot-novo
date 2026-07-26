import { describe, expect, test } from 'bun:test';
import { buildVisitScheduledMessage } from '@/services/notify';

describe('buildVisitScheduledMessage', () => {
  test('formata a mensagem de visita agendada', () => {
    const msg = buildVisitScheduledMessage({
      leadName: 'Maria Silva',
      leadPhone: '11999998888',
      scheduledVisitAt: '2026-07-27T15:00:00-03:00',
      propertyExternalId: 'AP-007',
    });
    expect(msg).toContain('AP-007');
    expect(msg).toContain('Maria Silva');
    expect(msg).toContain('11999998888');
    expect(msg).toContain('27/07/2026');
    expect(msg).toContain('15:00');
  });
});
