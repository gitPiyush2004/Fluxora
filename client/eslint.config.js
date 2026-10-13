import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Modules that intentionally co-export hooks/helpers with components (Fast Refresh falls back to a full reload).
    files: ['src/app.tsx', 'src/providers/**', 'src/components/charts.tsx', 'src/components/globe/globe-panel.tsx', 'src/features/shipments/spec-form.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  {
    // Test helpers are never hot-reloaded.
    files: ['src/test/**', '**/*.test.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
);
