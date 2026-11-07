import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ base: './', publicDir: false, plugins: [react()], build: { outDir: '../preview/p06', emptyOutDir: true, rollupOptions: { input: 'preview-p06-frame.html' } } });
