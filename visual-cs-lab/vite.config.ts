import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dev server is mounted inside the Express process (server/index.ts), so the
// app is served from a single origin on port 3000. Vite's own allowed-host list
// picks up __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS from the environment, which the
// sandbox supplies, so no preview host is hardcoded here.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: Number(process.env.PORT || 3000),
    strictPort: true
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
