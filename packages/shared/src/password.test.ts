import { describe, expect, it } from 'vitest';
import { checkPassword } from './password.js';

describe('checkPassword', () => {
  it('aceita uma senha forte', () => {
    expect(checkPassword('cavalo-bateria-grampo-42', { email: 'ana@example.com' })).toEqual([]);
  });

  it('rejeita senhas curtas, comuns, repetitivas ou com o e-mail', () => {
    expect(checkPassword('curta')).toContain('too_short');
    expect(checkPassword('Password1234')).toContain('common');
    expect(checkPassword('abababababab')).toContain('repetitive');
    expect(checkPassword('mariana-silva-2026', { email: 'mariana@example.com' })).toContain(
      'contains_email',
    );
  });
});
