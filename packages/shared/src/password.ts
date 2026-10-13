export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Senhas comuns com 12+ caracteres (as mais curtas já são barradas pelo tamanho).
 * Comparação sem diferenciar maiúsculas/minúsculas.
 */
const COMMON_PASSWORDS = new Set([
  '123456789012',
  '1234567890123',
  '12345678901234',
  '123456789123',
  '111111111111',
  '000000000000',
  '123123123123',
  'qwertyuiopas',
  'qwertyuiop123',
  'qwerty123456',
  '1q2w3e4r5t6y',
  '1qaz2wsx3edc',
  'zaq12wsxcde3',
  'password1234',
  'password12345',
  'password123!',
  'passwordpassword',
  'p@ssw0rd1234',
  'iloveyou1234',
  'welcome12345',
  'administrator',
  'admin1234567',
  'adminadmin123',
  'changeme1234',
  'letmein12345',
  'senha1234567',
  'senha12345678',
  'senhasenha12',
  'mudar1234567',
  'brasil123456',
  'contraseña123',
  'contrasena123',
  'abcdefghijkl',
  'abc123456789',
  'aaaaaaaaaaaa',
]);

export type PasswordProblem = 'too_short' | 'too_long' | 'common' | 'contains_email' | 'repetitive';

/** Política de senha das contas locais. Retorna a lista de problemas (vazia = válida). */
export function checkPassword(
  password: string,
  context: { email?: string } = {},
): PasswordProblem[] {
  const problems: PasswordProblem[] = [];
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH) problems.push('too_short');
  if (length > PASSWORD_MAX_LENGTH) problems.push('too_long');

  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) problems.push('common');
  if (new Set(lower).size <= 3) problems.push('repetitive');

  const localPart = context.email?.split('@')[0]?.toLowerCase();
  if (localPart && localPart.length >= 4 && lower.includes(localPart)) {
    problems.push('contains_email');
  }
  return problems;
}
