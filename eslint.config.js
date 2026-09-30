import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/*.tsbuildinfo',
      'supabase/.temp/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // Requirement 18.10. The app renders user-written notes, so the three ways to turn a string
      // into markup are banned outright rather than reviewed case by case.
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'Banned by Requirement 18.10. Render user text as text.',
        },
        {
          selector: "MemberExpression[property.name='innerHTML']",
          message: 'Banned by Requirement 18.10. Use textContent.',
        },
        {
          selector: "MemberExpression[property.name='outerHTML']",
          message: 'Banned by Requirement 18.10.',
        },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },

  {
    files: ['packages/web/**/*.{ts,tsx}'],
    plugins: { react, 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    languageOptions: { globals: globals.browser },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
    },
  },

  // Scripts and Deno-hosted Edge Functions are not part of the app's type graph.
  {
    files: ['scripts/**/*.mjs', 'supabase/functions/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },

  prettier,
);
