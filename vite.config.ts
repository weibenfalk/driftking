import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Share previews (Open Graph) need an absolute image address: build with VITE_SITE_URL=https://your.domain set (in the
  // environment or a .env file) and the `__SITE__` in index.html becomes that; without it the address is relative.
  const site = (loadEnv(mode, '.', 'VITE_').VITE_SITE_URL ?? '').replace(/\/$/, '')
  return {
    plugins: [react(), { name: 'site-url', transformIndexHtml: (html: string) => html.replaceAll('__SITE__', site) }],
  }
})
