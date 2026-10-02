import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// FastAPI serves the built app at the site root; `npm run dev` proxies the API to uvicorn.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
})
