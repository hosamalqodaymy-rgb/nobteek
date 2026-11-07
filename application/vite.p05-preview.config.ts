import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ publicDir: false, plugins: [react()], build: { outDir: '../preview/p05', emptyOutDir: true, rollupOptions: { input: 'preview-p05-frame.html' } } });
