import globals from 'globals';
import pluginJs from '@eslint/js';
import tseslint from 'typescript-eslint';
import markdown from '@eslint/markdown';

export default [
    ...markdown.configs.recommended,
    { files: ['**/*.{js,mjs,cjs,ts}'] },
    { languageOptions: { globals: globals.node } },
    pluginJs.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['*.md'],
        rules: {
            'no-irregular-whitespace': 'off', // This rule was causing an error while linting markdown files
        },
    },
];
