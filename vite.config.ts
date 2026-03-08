import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { resolve } from 'path';

export default defineConfig({
  plugins: [preact()],
  resolve: {
    alias: {
      // Make React-based packages (like @excalidraw/excalidraw) work with Preact
      'react': resolve('./node_modules/preact/compat'),
      'react-dom': resolve('./node_modules/preact/compat'),
      'react/jsx-runtime': resolve('./node_modules/preact/jsx-runtime'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:4000',
      '/socket.io': {
        target: 'http://localhost:4000',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
