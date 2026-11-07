import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ base: './', publicDir: false, plugins: [react()], build: { outDir: '../dist-phone/web', emptyOutDir: true, rollupOptions: { input: 'phone-preview-frame.html' } } });
