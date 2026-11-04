// AW21: UI-literál tilos a webes kódban – minden felirat a szótárból jön (`t('kulcs')`). Csak ez az egy szabály fut.
import tseslint from 'typescript-eslint';

const LABEL_ATTRS = '/^(aria-label|aria-description|title|placeholder|alt|label)$/';

export default tseslint.config(
  { files: ['src/**/*.{ts,tsx}'], languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } } },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/sim/**', 'src/ui/SimPanel.tsx', 'src/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXText[value=/\\p{L}/u]',
          message: 'UI-literál: a felirat a szótárba kerül (t(\'kulcs\')).',
        },
        {
          selector: `JSXAttribute[name.name=${LABEL_ATTRS}] > Literal[value=/\\p{L}/u]`,
          message: 'UI-literál az attribútumban: a felirat a szótárba kerül (t(\'kulcs\')).',
        },
        {
          selector: `JSXAttribute[name.name=${LABEL_ATTRS}] > JSXExpressionContainer > Literal[value=/\\p{L}/u]`,
          message: 'UI-literál az attribútumban: a felirat a szótárba kerül (t(\'kulcs\')).',
        },
        {
          selector: 'CallExpression[callee.property.name=/^toLocale(Date|Time)?String$/] > Literal[value=/^hu/]',
          message: 'A nyelv az app nyelve legyen (LOCALES[getLanguage()]), ne beégetett hu.',
        },
      ],
    },
  },
);
