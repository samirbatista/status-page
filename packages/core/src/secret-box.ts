import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Cifra segredos em repouso (senha do bind LDAP, segredo TOTP) com AES-256-GCM.
 * A chave vem do APP_SECRET; subchaves diferentes são derivadas por finalidade
 * (HKDF), para que a mesma chave nunca sirva a dois usos.
 */
export class SecretBox {
  private readonly encKey: Buffer;
  private readonly macKey: Buffer;

  constructor(appSecret: string) {
    const master = Buffer.from(appSecret, 'base64');
    if (master.length !== 32) throw new Error('APP_SECRET deve ter 32 bytes em base64');
    this.encKey = derive(master, 'status-page:secret-box:v1');
    this.macKey = derive(master, 'status-page:hmac:v1');
  }

  /** Formato: `v1.<iv>.<tag>.<texto cifrado>`, em base64url. */
  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encKey, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv, cipher.getAuthTag(), data].map((p) => toB64(p)).join('.');
  }

  decrypt(sealed: string): string {
    const [version, iv, tag, data] = sealed.split('.');
    if (version !== 'v1' || !iv || !tag || data === undefined) {
      throw new Error('segredo cifrado em formato desconhecido');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.encKey, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  /** HMAC-SHA256 com chave própria: usado para guardar códigos de recuperação. */
  mac(value: string): string {
    return createHmac('sha256', this.macKey).update(value).digest('hex');
  }
}

function derive(master: Buffer, info: string): Buffer {
  return Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), info, 32));
}

function toB64(part: string | Buffer): string {
  return typeof part === 'string' ? part : part.toString('base64url');
}
