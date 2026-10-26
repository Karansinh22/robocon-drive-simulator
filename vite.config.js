import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// base './' lets the built site work from any folder or sub-path (GitHub Pages, school server, USB stick).
export default defineConfig({
  base: './',
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      // two pages: the simulator (index.html) and the Code Lab (codelab.html)
      input: { main: resolve(__dirname, 'index.html'), codelab: resolve(__dirname, 'codelab.html') },
    },
  },
  test: { include: ['tests/**/*.test.js'] },
});
