// Minimal flat-config lint gate: typescript-eslint recommended, no style rules
// (formatting is left to the codebase's existing conventions). The goal is a
// green `npm run lint` in CI that catches real defects (unused symbols, unsafe
// patterns), not a style war.
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'drizzle/**', 'node_modules/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      // Intentionally-unused things are named with a leading underscore
      // (e.g. the `_exhaustive: never` switch guards in main.ts).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
);
