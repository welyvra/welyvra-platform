// Shared JSON schemas and request types. Amounts are strings of integer minor units (never JSON numbers).
export const uuid = { type: 'string', format: 'uuid' } as const;
export const amount = {
  type: 'string',
  pattern: '^[1-9][0-9]{0,38}$',
  description: 'Integer amount in the asset smallest unit',
} as const;
export const stellarAddress = { type: 'string', pattern: '^[GC][A-Z2-7]{55}$' } as const;
export const txHash = { type: 'string', pattern: '^[0-9a-f]{64}$' } as const;
export const reason = { type: 'string', minLength: 1, maxLength: 2000 } as const;
export const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: uuid },
  additionalProperties: false,
} as const;
export const listQuery = {
  type: 'object',
  properties: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 } },
  additionalProperties: false,
} as const;
export const error = {
  type: 'object',
  properties: { error: { type: 'string' }, message: { type: 'string' } },
  required: ['error'],
} as const;
export const routingKey = {
  type: 'object',
  required: ['kind', 'value'],
  additionalProperties: false,
  properties: {
    kind: {
      type: 'string',
      enum: ['id', 'text', 'hash'],
      description: 'id = memo ID or M/W muxed ID (u64); text = memo text; hash = memo hash (hex)',
    },
    value: { type: 'string', minLength: 1, maxLength: 64 },
  },
} as const;

export type Id = { id: string };
export type Limit = { limit: number };
