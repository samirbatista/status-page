'use client';

import { useTranslations } from 'next-intl';
import { ClientApiError } from './client-api';

/** Problema de validação devolvido pela API (`validation_failed`). */
export interface FieldIssue {
  path: string;
  code?: string;
  message: string;
  origin?: string;
  minimum?: number;
  maximum?: number;
}

/** Códigos próprios usados como mensagem nos schemas (ver packages/shared). */
const KNOWN_MESSAGES = [
  'invalid_target',
  'invalid_host',
  'invalid_status_list',
  'invalid_dns_server',
  'invalid_match_field',
] as const;

export function validationIssues(error: unknown): FieldIssue[] {
  if (!(error instanceof ClientApiError) || error.code !== 'validation_failed') return [];
  const issues = error.body?.issues;
  return Array.isArray(issues) ? (issues as FieldIssue[]) : [];
}

/**
 * Erros de validação por campo do formulário. `toField` converte o caminho da
 * API (ex.: `config.port`) no nome do campo na tela; campos sem correspondência
 * ficam em `unmatched`, para o alerta geral listar.
 */
export function useFieldErrors(error: unknown, toField: (path: string) => string = (p) => p) {
  const t = useTranslations('errors.field');
  const byField = new Map<string, string>();
  const unmatched: FieldIssue[] = [];
  const known = new Set<string>(KNOWN_MESSAGES);

  const describe = (issue: FieldIssue): string => {
    if (known.has(issue.message)) return t(issue.message as (typeof KNOWN_MESSAGES)[number]);
    if (issue.code === 'invalid_type' && /undefined|null|NaN/.test(issue.message))
      return t('required');
    if (issue.code === 'too_small') {
      if (issue.origin === 'string' && issue.minimum === 1) return t('required');
      if (issue.minimum !== undefined) {
        return issue.origin === 'string'
          ? t('tooShort', { min: issue.minimum })
          : t('tooSmall', { min: issue.minimum });
      }
    }
    if (issue.code === 'too_big' && issue.maximum !== undefined) {
      return issue.origin === 'string'
        ? t('tooLong', { max: issue.maximum })
        : t('tooBig', { max: issue.maximum });
    }
    if (issue.code === 'invalid_format') return t('invalidFormat');
    return t('invalid');
  };

  for (const issue of validationIssues(error)) {
    const field = toField(issue.path);
    if (!field) {
      unmatched.push(issue);
      continue;
    }
    if (!byField.has(field)) byField.set(field, describe(issue));
  }
  return {
    /** Mensagem do campo (nome do input), se houver erro nele. */
    get: (field: string) => byField.get(field),
    /** Há erros mostrados nos próprios campos. */
    any: byField.size > 0,
    /** Problemas que não correspondem a nenhum campo da tela. */
    unmatched: unmatched.map((i) => ({ path: i.path, message: describe(i) })),
  };
}
