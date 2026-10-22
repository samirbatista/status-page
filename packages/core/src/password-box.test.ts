import { describe, expect, it } from 'vitest';
import { InvalidPasswordError, PasswordBox } from './password-box.js';

describe('PasswordBox', () => {
  it('cifra e decifra com a mesma senha; senha errada falha', async () => {
    const box = await PasswordBox.create('senha-forte-123');
    const sealed = box.encrypt('{"url":"https://hooks.slack.com/x"}');
    expect(sealed).toMatch(/^p1\./);
    expect(sealed).not.toContain('hooks');
    expect((await PasswordBox.open('senha-forte-123', box.params)).decrypt(sealed)).toContain(
      'hooks',
    );
    const wrong = await PasswordBox.open('outra', box.params);
    expect(() => wrong.decrypt(sealed)).toThrow(InvalidPasswordError);
  });

  it('recusa parâmetros de custo vindos do arquivo', async () => {
    const box = await PasswordBox.create('x');
    await expect(PasswordBox.open('x', { ...box.params, N: 2 ** 20 })).rejects.toThrow(
      InvalidPasswordError,
    );
  });
});
