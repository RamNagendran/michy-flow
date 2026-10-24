import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { port: 3000, strictPort: true },
  preview: { port: 3000, strictPort: true },
  build: {
    // antd is one large vendor chunk (~1.1 MB, ~350 KB gzipped), cached across deploys.
    chunkSizeWarningLimit: 1500,
    rolldownOptions: {
      output: {
        // Vendor code changes rarely, so splitting it out keeps it cached when only app code changes.
        codeSplitting: {
          groups: [
            { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/, priority: 40 },
            { name: 'vendor-state', test: /node_modules[\\/](@reduxjs|react-redux|redux|redux-persist|reselect|immer|@tanstack)[\\/]/, priority: 30 },
            { name: 'vendor-http', test: /node_modules[\\/]axios[\\/]/, priority: 20 },
            { name: 'vendor-antd', test: /node_modules[\\/](antd|@ant-design|@rc-component|rc-[^\\/]+|@emotion)[\\/]/, priority: 10 },
          ],
        },
      },
    },
  },
})
