import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves this as a project site at /winteremblem/, not the domain
// root, so built asset URLs need that prefix. The dev server stays at root.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/winteremblem/' : '/',
  plugins: [react()],
}));
