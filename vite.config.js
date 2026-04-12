import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';

/** Vite plugin: dev-only API to save SQLite DB file to public/ */
function dbSavePlugin() {
  return {
    name: 'db-save',
    configureServer(server) {
      // Save entire SQLite DB binary to public/justball.db
      server.middlewares.use('/__api/save-db', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
          try {
            const buf = Buffer.concat(chunks);
            const dbPath = path.resolve('public/justball.db');
            fs.writeFileSync(dbPath, buf);

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, size: buf.length }));
          } catch (e) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: e.message }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  base: '/JustBall/',
  build: {
    outDir: 'dist',
  },
  plugins: [dbSavePlugin()],
});
