import { BadRequestException, Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { checkPassword } from '@status-page/shared';

@Injectable()
export class PasswordService {
  /** Hash usado quando o usuário não existe, para o tempo de resposta não revelar isso. */
  private readonly dummyHash = argon2.hash('dummy-password-for-timing', { type: argon2.argon2id });

  hash(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  async verify(hash: string | null | undefined, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash ?? (await this.dummyHash), password);
    } catch {
      return false;
    }
  }

  /** Lança 400 se a senha não atende à política. */
  assertPolicy(password: string, email?: string): void {
    const problems = checkPassword(password, { email });
    if (problems.length > 0) {
      throw new BadRequestException({ message: 'password_policy', problems });
    }
  }
}
