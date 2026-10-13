import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// O SWC emite o metadata de decorators que a injeção de dependência do NestJS exige.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    globalSetup: ['test/support/global-setup.ts'],
    // Os arquivos compartilham o mesmo banco de testes e o limpam no início.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
