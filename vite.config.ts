import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Proxy API + OAuth routes to the backend (server/) during dev.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Listen on all interfaces so both localhost and 127.0.0.1 resolve.
    host: true,
  },
})
