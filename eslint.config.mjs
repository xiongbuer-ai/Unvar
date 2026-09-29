import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['**/node_modules/**', '**/out/**', '**/dist/**', '**/coverage/**', '**/test-results/**', '**/.cache/**', '.idea/**', '.pnpm-store/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['**/*.mjs'], languageOptions: { globals: { console: 'readonly', process: 'readonly', setTimeout: 'readonly', URL: 'readonly' } } },
  { files: ['tests/desktop-smoke.mjs', 'tests/workspace-smoke.mjs', 'tests/packaged-smoke.mjs'], languageOptions: { globals: { window: 'readonly' } } },
];
