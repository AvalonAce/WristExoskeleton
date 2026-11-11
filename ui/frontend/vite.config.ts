import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// host: true -> listen on all interfaces, so a Windows browser reaches the WSL dev server.
// /api -> local storage server (ui/backend).
// VITE_POLL=1 (npm run dev:poll) -> polling file watcher, for repos on /mnt/c under WSL.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    watch: process.env.VITE_POLL ? { usePolling: true, interval: 300 } : undefined,
    // Live mode: profiles, health checks and rosbag control go to ui/backend/server.py.
    proxy: { '/api': 'http://127.0.0.1:8765' },
  },
});
