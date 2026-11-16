import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const MAX_BACKUPS = 40;

/**
 * Dev only: `PROJECT=path/to/project.json npm run dev` lets the editor read and write that file
 * through `/api/project` (GET reads it, 204 while it does not exist; POST writes it). Each write first
 * copies the previous version to a `backups` folder next to it, keeping the latest 40.
 * Without `PROJECT`, the editor keeps the project in the browser (IndexedDB), as on the static site.
 */
function projectApi(file: string): Plugin {
  const backups = join(dirname(file), 'backups');
  return {
    name: 'project-api',
    apply: 'serve',
    config: () => ({ server: { watch: { ignored: [file, `${file}.tmp`, `${backups}/**`] } } }),
    configureServer(server) {
      server.middlewares.use('/api/project', (req, res) => {
        if (req.method === 'GET') {
          res.setHeader('Cache-Control', 'no-store');
          if (!existsSync(file)) {
            res.statusCode = 204;
            res.end();
            return;
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(readFileSync(file));
          return;
        }
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          try {
            JSON.parse(text);
          } catch {
            res.statusCode = 400;
            res.end('Invalid JSON');
            return;
          }
          try {
            mkdirSync(dirname(file), { recursive: true });
            if (existsSync(file)) {
              mkdirSync(backups, { recursive: true });
              const stamp = new Date().toISOString().replace(/[:.]/g, '-');
              copyFileSync(file, join(backups, `${basename(file, '.json')}-${stamp}.json`));
              const old = readdirSync(backups).filter((f) => f.endsWith('.json')).sort();
              for (const f of old.slice(0, Math.max(0, old.length - MAX_BACKUPS))) unlinkSync(join(backups, f));
            }
            // Write to a temporary file and rename, so a crash never leaves half a project.
            writeFileSync(`${file}.tmp`, text);
            renameSync(`${file}.tmp`, file);
            res.end('ok');
          } catch (e) {
            res.statusCode = 500;
            res.end(String(e));
          }
        });
      });
    },
  };
}

const project = process.env.PROJECT;

/** Dev server and demo site: the landing page, the editor and the examples. */
export default defineConfig({
  plugins: project ? [projectApi(resolve(project))] : [],
  build: {
    outDir: 'site',
    rollupOptions: {
      input: {
        index: resolve('index.html'),
        editor: resolve('editor/index.html'),
        room: resolve('examples/room/index.html'),
        adventure: resolve('examples/adventure/index.html'),
        board: resolve('examples/board/index.html'),
        blocks: resolve('examples/blocks/index.html'),
      },
    },
  },
});
