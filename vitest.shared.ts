// Shared Vitest settings. The `source` export condition makes tests read workspace
// packages from src/ (no build needed). Vite replaces its default conditions when
// these are set, so the defaults are listed explicitly, for both client and SSR/Node.
export const sourceConditions = {
  resolve: { conditions: ['source', 'module', 'browser', 'development|production'] },
  ssr: { resolve: { conditions: ['source', 'module', 'node', 'development|production'] } },
};
