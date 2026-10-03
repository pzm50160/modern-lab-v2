import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
export default defineConfig({
  root: __dirname, plugins: [react()],
  resolve: { alias: [{ find: /^\.\.\/lib\/supabase$/, replacement: path.resolve(__dirname, 'supabaseMock.js') }] },
  server: { port: 5287, strictPort: true },
})
