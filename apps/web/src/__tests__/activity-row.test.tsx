import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { ActivityRow } from '@/components/activity-row';
import type { ActivityLogEntry } from '@/lib/queries';

function makeEntry(overrides: Partial<ActivityLogEntry> = {}): ActivityLogEntry {
  return {
    id: 'log-1',
    actorLabel: 'Admin',
    action: 'property_status_changed',
    subject: 'Apartamento Centro',
    subjectType: 'property',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('ActivityRow', () => {
  test('renders actor and formatted action label', () => {
    render(<ActivityRow entry={makeEntry()} />);
    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(screen.getByText(/atualizou status do imóvel/)).toBeInTheDocument();
  });

  test('renders subject when present', () => {
    render(<ActivityRow entry={makeEntry({ subject: 'Apartamento Centro' })} />);
    expect(screen.getByText('Apartamento Centro')).toBeInTheDocument();
  });

  test('falls back to "Sistema" when actorLabel is null', () => {
    render(<ActivityRow entry={makeEntry({ actorLabel: null })} />);
    expect(screen.getByText('Sistema')).toBeInTheDocument();
  });

  test('does not render a subject span when subject is null', () => {
    render(<ActivityRow entry={makeEntry({ subject: null })} />);
    expect(screen.queryByText('Apartamento Centro')).not.toBeInTheDocument();
  });
});
