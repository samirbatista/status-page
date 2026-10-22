import { BadRequestException, Body, type PipeTransform, Query } from '@nestjs/common';
import { ApiBody, ApiQuery } from '@nestjs/swagger';

import { toJSONSchema, type z } from 'zod';

/** Valida e transforma o valor com um schema zod; erros viram 400 com os campos. */
export class ZodPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'validation_failed',
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
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
