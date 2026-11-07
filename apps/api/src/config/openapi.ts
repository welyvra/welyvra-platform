import type { SwaggerOptions } from '@fastify/swagger';

/** OpenAPI document metadata. Route schemas fill in the rest (see services/openapi.ts). */
export const openApiOptions: SwaggerOptions = {
  openapi: {
    openapi: '3.1.0',
    info: {
      title: 'Welyvra API',
      version: '0.1.0',
      description:
        'Reconciliation layer for payments on Stellar. Amounts are strings of integer minor units. Testnet only (pre-alpha).',
    },
    components: {
      securitySchemes: {
        apiKey: { type: 'http', scheme: 'bearer', description: 'wlv_<prefix>_<secret>' },
      },
    },
    security: [{ apiKey: [] }],
  },
};
