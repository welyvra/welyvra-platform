import { Ajv } from 'ajv';
import addFormatsModule from 'ajv-formats';
import type { FastifyInstance } from 'fastify';

/**
 * Bodies are validated strictly: no type coercion, so an amount sent as a JSON number is
 * rejected instead of silently becoming a string. Querystrings and params need coercion.
 */
export function registerValidation(app: FastifyInstance): void {
  const addFormats = addFormatsModule as unknown as (ajv: Ajv) => Ajv;
  const strict = addFormats(
    new Ajv({ coerceTypes: false, useDefaults: true, removeAdditional: false, strict: false }),
  );
  const coercing = addFormats(
    new Ajv({ coerceTypes: 'array', useDefaults: true, removeAdditional: false, strict: false }),
  );
  app.setValidatorCompiler(({ schema, httpPart }) =>
    (httpPart === 'body' ? strict : coercing).compile(schema),
  );
}
