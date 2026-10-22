import { describe, expect, it } from 'vitest';
import { InvalidPasswordError, PasswordBox } from './password-box.js';

describe('PasswordBox', () => {
  it('cifra e decifra com a mesma senha; senha errada falha', () => {
    const box = PasswordBox.create('senha-forte-123');
    const sealed = box.encrypt('{"url":"https://hooks.slack.com/x"}');
    expect(sealed).toMatch(/^p1\./);
    expect(sealed).not.toContain('hooks');
    expect(PasswordBox.open('senha-forte-123', box.params).decrypt(sealed)).toContain('hooks');
    expect(() => PasswordBox.open('outra', box.params).decrypt(sealed)).toThrow(
      InvalidPasswordError,
    );
  });
});
