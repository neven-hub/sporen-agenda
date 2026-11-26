import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// base './' zodat de app werkt op GitHub Pages (submap) en lokaal.
export default defineConfig({
  base: './',
  plugins: [react()],
  test: { environment: 'node' },
});
