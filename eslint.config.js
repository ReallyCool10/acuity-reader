import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'dist-electron/**',
      'dist-packages/**',
      'node_modules/**',
      'scripts/**',
      'coverage/**',
      '**/*.d.ts'
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // rules-of-hooks and exhaustive-deps. These catch the defects that are hardest
  // to see by reading: stale closures over props, and effects that silently stop
  // re-running when a dependency is omitted.
  reactHooks.configs.flat.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ],
      '@typescript-eslint/no-explicit-any': 'warn',

      /*
       * React Compiler rule, kept visible but non-blocking.
       *
       * The remaining sites stop speech synthesis when the chapter changes and
       * sync a tab when the settings dialog opens. Both are genuine
       * external-system synchronisation, which the rule cannot distinguish from
       * a cascading-render mistake. Restructuring the narration engine to
       * satisfy it is worthwhile but is its own change, so this stays a warning
       * rather than being silenced with inline disables.
       */
      'react-hooks/set-state-in-effect': 'warn',
    },
  }
);
