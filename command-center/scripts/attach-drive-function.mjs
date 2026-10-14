import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = process.cwd();
const configPath = path.join(root, '.vercel', 'output', 'config.json');
if (!existsSync(configPath)) {
  console.log('No Vercel build output yet. Drive function attach skipped.');
  process.exit(0);
}

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const entries = [
  ['api/drive/session.ts', 'api/drive/session.func'],
  ['api/drive/files.ts', 'api/drive/files.func'],
  ['api/drive/files/[id].ts', 'api/drive/files/[id].func'],
  ['api/accounts.ts', 'api/accounts.func'],
];

for (const [entry, funcDir] of entries) {
  const outfile = path.join(root, '.vercel', 'output', 'functions', funcDir, 'index.js');
  mkdirSync(path.dirname(outfile), { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    outfile,
    footer: { js: 'module.exports = module.exports.default || module.exports;\n' },
  });
  writeFileSync(
    path.join(path.dirname(outfile), '.vc-config.json'),
    `${JSON.stringify({
      runtime: 'nodejs22.x',
      handler: 'index.js',
      launcherType: 'Nodejs',
      shouldAddHelpers: true,
      maxDuration: 30,
    }, null, 2)}\n`,
  );
}

const config = JSON.parse(readFileSync(configPath, 'utf8'));
const driveRoutes = [
  { src: '^/api/accounts$', dest: '/api/accounts' },
  { src: '^/api/drive/session$', dest: '/api/drive/session' },
  { src: '^/api/drive/files$', dest: '/api/drive/files' },
  { src: '^/api/drive/files/(?<id>[A-Za-z0-9_-]+)$', dest: '/api/drive/files/[id]?id=$id' },
];
const routes = Array.isArray(config.routes) ? config.routes : [];
config.routes = [
  ...driveRoutes,
  ...routes.filter((route) => {
    const src = String(route.src || '');
    return !src.includes('/api/drive') && !src.includes('/api/accounts');
  }),
];
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
console.log('Attached Google Drive functions to the Vercel build output.');
