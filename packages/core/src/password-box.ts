import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/**
 * Cifra por senha (exportação de configuração): chave derivada com scrypt e
 * AES-256-GCM. O sal vai no arquivo; sem a senha, os segredos não abrem.
 */

export interface PasswordKdf {
  kdf: 'scrypt';
  salt: string;
  N: number;
  r: number;
  p: number;
}

export class InvalidPasswordError extends Error {
  constructor() {
    super('senha incorreta ou arquivo corrompido');
  }
}

export class PasswordBox {
  private readonly key: Buffer;

  private constructor(
    key: Buffer,
    readonly params: PasswordKdf,
  ) {
    this.key = key;
  }

  static create(password: string): PasswordBox {
    return PasswordBox.open(password, {
      kdf: 'scrypt',
      salt: randomBytes(16).toString('base64url'),
      N: 2 ** 15,
      r: 8,
      p: 1,
    });
  }

  static open(password: string, params: PasswordKdf): PasswordBox {
    if (params.kdf !== 'scrypt' || params.N > 2 ** 20 || params.r > 32 || params.p > 16) {
      throw new InvalidPasswordError();
    }
    const key = scryptSync(password, Buffer.from(params.salt, 'base64url'), 32, {
      N: params.N,
      r: params.r,
      p: params.p,
      maxmem: 256 * params.N * params.r + 1024 * 1024,
    });
    return new PasswordBox(key, params);
  }

  /** Formato: `p1.<iv>.<tag>.<dados>` em base64url. */
  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['p1', iv, cipher.getAuthTag(), data]
      .map((b) => (typeof b === 'string' ? b : b.toString('base64url')))
      .join('.');
  }

  decrypt(sealed: string): string {
    const [version, iv, tag, data] = sealed.split('.');
    if (version !== 'p1' || !iv || !tag || data === undefined) throw new InvalidPasswordError();
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(data, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new InvalidPasswordError();
    }
  }
}
