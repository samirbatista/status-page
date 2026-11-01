import { BadRequestException, Body, type PipeTransform, Query } from '@nestjs/common';
import { ApiBody, ApiQuery } from '@nestjs/swagger';

import { toJSONSchema, type z } from 'zod';

/**
 * Problema de validação de um campo, para o painel destacar o campo certo:
 * `code` é o tipo do erro do zod (ex.: `too_small`), com o limite quando houver;
 * `message` é um código nosso (ex.: `invalid_target`) ou o texto do zod.
 */
export function describeIssue(issue: z.core.$ZodIssue) {
  const limits = issue as { minimum?: unknown; maximum?: unknown; origin?: unknown };
  return {
    path: issue.path.join('.'),
    code: issue.code,
    message: issue.message,
    ...(typeof limits.origin === 'string' ? { origin: limits.origin } : {}),
    ...(limits.minimum !== undefined ? { minimum: Number(limits.minimum) } : {}),
    ...(limits.maximum !== undefined ? { maximum: Number(limits.maximum) } : {}),
  };
}

/** Valida e transforma o valor com um schema zod; erros viram 400 com os campos. */
export class ZodPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'validation_failed',
        issues: result.error.issues.map(describeIssue),
      });
    }
    return result.data;
  }
}

/** JSON Schema (entrada) de um schema zod, para a documentação OpenAPI. */
export function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const json = toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<
    string,
    unknown
  >;
  delete json.$schema;
  return json;
}

/** Corpo validado pelo schema e documentado no OpenAPI. */
export function ZodBody(schema: z.ZodType): ParameterDecorator {
  return (target, key, index) => {
    Body(new ZodPipe(schema))(target, key, index);
    if (key === undefined) return;
    const descriptor = Object.getOwnPropertyDescriptor(target, key)!;
    // O JSON Schema gerado pelo zod é compatível com o SchemaObject do OpenAPI 3.1.
    ApiBody({ schema: jsonSchemaOf(schema) as never })(target, key, descriptor);
  };
}

/** Query string validada pelo schema; cada campo vira um parâmetro no OpenAPI. */
export function ZodQuery(schema: z.ZodType): ParameterDecorator {
  return (target, key, index) => {
    Query(new ZodPipe(schema))(target, key, index);
    if (key === undefined) return;
    const descriptor = Object.getOwnPropertyDescriptor(target, key)!;
    const json = jsonSchemaOf(schema) as {
      properties?: Record<string, object>;
      required?: string[];
    };
    for (const [name, prop] of Object.entries(json.properties ?? {})) {
      ApiQuery({ name, schema: prop as never, required: json.required?.includes(name) ?? false })(
        target,
        key,
        descriptor,
      );
    }
  };
}
