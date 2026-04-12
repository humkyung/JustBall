import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';

/** Vite plugin: dev-only API to save stage files to public/stages/ */
function stageSavePlugin() {
  return {
    name: 'stage-save',
    configureServer(server) {
      server.middlewares.use('/__api/save-stage', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          try {
            const { filename, content } = JSON.parse(body);
            if (!filename || !content) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'filename and content required' }));
              return;
            }

            // Sanitize filename
            const safe = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '');
            if (!safe.endsWith('.json')) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Only .json files allowed' }));
              return;
            }

            const stagesDir = path.resolve('public/stages');
            const filePath = path.join(stagesDir, safe);

            // Write stage file
            fs.writeFileSync(filePath, JSON.stringify(content, null, 2), 'utf-8');

            // Update index.json if this is a new file
            const indexPath = path.join(stagesDir, 'index.json');
            const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
            if (!index.includes(safe)) {
              index.push(safe);
              index.sort();
              fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n', 'utf-8');
            }

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, file: safe }));
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
  plugins: [stageSavePlugin()],
});
