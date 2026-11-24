import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

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
  plugins: [react(), offlineCache()],
  worker: { format: 'es' },
  build: { target: 'es2022' },
});
