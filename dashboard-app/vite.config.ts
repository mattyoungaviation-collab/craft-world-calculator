import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backendTarget = process.env.VITE_API_URL || 'http://localhost:3001'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Local dev only: frontend calls backend API routes; backend calls CraftWorld.
      '/api': {
        target: backendTarget,
        changeOrigin: true,
        secure: false,
      },
      // Proxy Ronin public RPC to query Katana pool reserves on-chain
      '/api/ronin-rpc': {
        target: 'https://api.roninchain.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/ronin-rpc/, '/rpc'),
        secure: false,
      },
    }
  }
})
