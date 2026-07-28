import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // In dev the app is served at the root by Vite's own dev server. In
  // production it is served by the backend under the /web prefix (see
  // backend/src/app.ts), so assets/routes need that base path baked in.
  base: command === 'build' ? '/web/' : '/',
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:4000',
        ws: true,
      },
      '/hls': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
}))
