import nextPlugin from '@next/eslint-plugin-next';
import rootConfig from '../../eslint.config.js';

export default [
  ...rootConfig,
  nextPlugin.configs['core-web-vitals'],
  {
    languageOptions: { globals: { React: 'readonly' } },
    rules: {
      // Imagens vêm dos uploads da própria instalação; o otimizador do Next não agrega aqui.
      '@next/next/no-img-element': 'off',
    },
  },
];
