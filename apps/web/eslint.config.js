import nextPlugin from '@next/eslint-plugin-next';
import rootConfig from '../../eslint.config.js';

export default [
  ...rootConfig,
  nextPlugin.configs['core-web-vitals'],
  { languageOptions: { globals: { React: 'readonly' } } },
];
