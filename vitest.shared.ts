// Shared Vitest settings. The custom `@welyvra/source` export condition (a unique name, because generic names like `source` are also used by third-party packages) makes tests read workspace
// packages from src/ (no build needed). Vite replaces its default conditions when
// these are set, so the defaults are listed explicitly, for both client and SSR/Node.
export const sourceConditions = {
  resolve: { conditions: ['@welyvra/source', 'module', 'browser', 'development|production'] },
  ssr: { resolve: { conditions: ['@welyvra/source', 'module', 'node', 'development|production'] } },
};
