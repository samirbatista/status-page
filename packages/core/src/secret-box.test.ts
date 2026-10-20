import { describe, expect, it } from 'vitest';
import { SecretBox } from './secret-box.js';

const KEY = Buffer.alloc(32, 7).toString('base64');

describe('SecretBox', () => {
  it('cifra e decifra, com IV aleatório', () => {
    const box = new SecretBox(KEY);
    const a = box.encrypt('senha do bind');
    const b = box.encrypt('senha do bind');
    expect(a).not.toBe(b);
    expect(a).not.toContain('senha');
    expect(box.decrypt(a)).toBe('senha do bind');
  });

  it('recusa texto adulterado ou chave diferente', () => {
    const box = new SecretBox(KEY);
    const sealed = box.encrypt('segredo');
    const parts = sealed.split('.');
    const tampered = [...parts.slice(0, 3), Buffer.from('outro').toString('base64url')].join('.');
    expect(() => box.decrypt(tampered)).toThrow();
    expect(() => new SecretBox(Buffer.alloc(32, 8).toString('base64')).decrypt(sealed)).toThrow();
  });

  it('HMAC estável e diferente da chave de cifra', () => {
    const box = new SecretBox(KEY);
    expect(box.mac('abc')).toBe(box.mac('abc'));
    expect(box.mac('abc')).not.toBe(box.mac('abd'));
  });

  it('exige chave de 32 bytes', () => {
    expect(() => new SecretBox('curta')).toThrow();
  });
});
