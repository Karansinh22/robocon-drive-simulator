import { defineConfig } from 'vite';

// base './' lets the built site work from any folder or sub-path (GitHub Pages, school server, USB stick).
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 900 },
  test: { include: ['tests/**/*.test.js'] },
});
