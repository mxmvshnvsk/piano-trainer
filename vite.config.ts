import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Private, opt-in diagnostics. This endpoint exists only on the local dev
// server and accepts same-origin browser requests, never a user-supplied path.
function localCalibration(): Plugin {
  return { name: 'local-calibration', apply: 'serve', configureServer(server) {
    server.middlewares.use('/__calibration', async (req, res) => {
      const host = req.headers.host || '';
      if (req.method !== 'POST' || !/^(127\.0\.0\.1|localhost):\d+$/.test(host) || req.headers.origin !== `http://${host}` || req.headers['content-type'] !== 'application/json') {
        res.statusCode = 403; res.end('Forbidden'); return;
      }
      try {
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 8 * 1024 * 1024) { res.statusCode = 413; res.end('Too large'); return; }
          chunks.push(Buffer.from(chunk));
        }
        const record = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (record.version !== 1 || !Array.isArray(record.actual) || !Array.isArray(record.frames) || !Array.isArray(record.windows)) throw new Error('Invalid diagnostic');
        const file = `attempt-${Date.now()}-${randomUUID().slice(0, 8)}.json`;
        const directory = join(server.config.root, 'output/calibration');
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, file), JSON.stringify(record), { flag: 'wx' });
        console.info(`Calibration saved: output/calibration/${file}`);
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ file }));
      } catch { res.statusCode = 400; res.end('Invalid diagnostic'); }
    });
  } };
}

// One versioned shell cache includes worker chunks, fonts, weights, and WASM.
function offlineCache(): Plugin {
  return {
    name: 'offline-cache-manifest',
    generateBundle(_, bundle) {
      const assets = Object.keys(bundle);
      const template = readFileSync('src/sw-template.js', 'utf8');
      const hash = createHash('sha256').update(JSON.stringify(assets)).update(template).update(readFileSync('index.html'));
      for (const file of readdirSync('public', { recursive: true }) as string[]) {
        const path = join('public', file);
        if (statSync(path).isFile()) hash.update(file).update(readFileSync(path));
      }
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: template.replace('__BUILD_HASH__', hash.digest('hex').slice(0, 16)) });
      this.emitFile({ type: 'asset', fileName: 'precache.json', source: JSON.stringify(assets) });
    },
  };
}
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [react(), offlineCache(), localCalibration()],
  worker: { format: 'es' },
  build: { target: 'es2022' },
});
