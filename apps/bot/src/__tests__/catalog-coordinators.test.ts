import { describe, expect, test } from 'bun:test';
import { coordinatorFact } from '@/services/catalog';
import type { PropertyCoordinatorLink } from '@kit-manager/types';

describe('coordinatorFact', () => {
  test('retorna null quando não há coordinators', () => {
    expect(coordinatorFact([])).toBeNull();
  });

  test('retorna null quando nenhum tem show_property', () => {
    const links: PropertyCoordinatorLink[] = [
      { responsibilities: ['deliver_keys'], coordinator: { id: '1', name: 'Maria', phone: '11999990000' } },
    ];
    expect(coordinatorFact(links)).toBeNull();
  });

  test('formata um responsável com show_property', () => {
    const links: PropertyCoordinatorLink[] = [
      { responsibilities: ['show_property'], coordinator: { id: '1', name: 'João', phone: '11988887777' } },
    ];
    expect(coordinatorFact(links)).toBe('Responsavel pela visita: João (11988887777)');
  });

  test('formata múltiplos responsáveis com show_property, ignorando quem só tem outras responsabilidades', () => {
    const links: PropertyCoordinatorLink[] = [
      { responsibilities: ['show_property'], coordinator: { id: '1', name: 'João', phone: '11988887777' } },
      { responsibilities: ['deliver_keys', 'receive_keys'], coordinator: { id: '2', name: 'Maria', phone: '11999990000' } },
      { responsibilities: ['show_property', 'inspection'], coordinator: { id: '3', name: 'Ana', phone: '11977776666' } },
    ];
    expect(coordinatorFact(links)).toBe(
      'Responsavel pela visita: João (11988887777), Ana (11977776666)',
    );
  });
});
