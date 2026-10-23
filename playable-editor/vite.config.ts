/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build:single` -> dist-single/index.html: 1 file, mở trực tiếp bằng trình duyệt
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' || mode === 'artifact' ? [react(), viteSingleFile()] : [react()],
  build: mode === 'single' ? { outDir: 'dist-single' } : mode === 'artifact' ? { outDir: 'dist-artifact' } : {},
  // bản artifact tự nạp game mẫu khi mở
  define: mode === 'artifact' ? { 'import.meta.env.VITE_AUTODEMO': JSON.stringify('1') } : {},
  test: { testTimeout: 120000 },
}));
