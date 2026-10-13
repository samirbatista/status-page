import { describe, expect, it } from 'vitest';
import { overallStatus } from './status.js';
import { roleAtLeast } from './roles.js';

describe('overallStatus', () => {
  it('retorna operational para lista vazia', () => {
    expect(overallStatus([])).toBe('operational');
  });

  it('retorna o pior status', () => {
    expect(overallStatus(['operational', 'major_outage', 'degraded_performance'])).toBe(
      'major_outage',
    );
    expect(overallStatus(['under_maintenance', 'operational'])).toBe('under_maintenance');
  });
});

describe('roleAtLeast', () => {
  it('respeita a hierarquia de papéis', () => {
    expect(roleAtLeast('admin', 'operator')).toBe(true);
    expect(roleAtLeast('viewer', 'operator')).toBe(false);
    expect(roleAtLeast('owner', 'owner')).toBe(true);
  });
});
