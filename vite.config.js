import { defineConfig } from 'vite';

// http://localhost is a secure context in Chrome, so Web Serial works
// with zero HTTPS setup. Only LAN-IP access would need mkcert + server.https.
export default defineConfig({
  server: {
    port: 5173,
  },
});
