import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const root = process.cwd();
const configPath = path.join(root, '.vercel', 'output', 'config.json');
if (!existsSync(configPath)) {
  console.log('No Vercel build output yet. Drive function attach skipped.');
  process.exit(0);
}

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const entries = [
  ['serverless-src/drive/session.ts', 'api/drive/session.func'],
  ['serverless-src/drive/files.ts', 'api/drive/files.func'],
  ['serverless-src/drive/files/[id].ts', 'api/drive/files/[id].func'],
  ['serverless-src/accounts.ts', 'api/accounts.func'],
];

// The repo root package.json is "type": "module". Without a local
// package.json in each .func directory, Node/Vercel loads index.js as ESM,
// hits `module is not defined`, and production Sign-in/Drive return
// FUNCTION_INVOCATION_FAILED.
const FOOTER =
  'module.exports = typeof handler === "function" ? handler : (module.exports.default || module.exports);\n';

for (const [entry, funcDir] of entries) {
  const funcRoot = path.join(root, '.vercel', 'output', 'functions', funcDir);
  const outfile = path.join(funcRoot, 'index.js');
  mkdirSync(funcRoot, { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    outfile,
    footer: { js: FOOTER },
  });
  writeFileSync(path.join(funcRoot, 'package.json'), `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`);
  writeFileSync(
    path.join(funcRoot, '.vc-config.json'),
    `${JSON.stringify({
      runtime: 'nodejs20.x',
      handler: 'index.js',
      launcherType: 'Nodejs',
      shouldAddHelpers: true,
      maxDuration: 30,
    }, null, 2)}\n`,
  );

  // Verify outside the ESM package root (tmp .cjs) so require works locally.
  const probe = path.join(os.tmpdir(), `cc-fn-probe-${funcDir.replace(/[^\w]+/g, '-')}.cjs`);
  writeFileSync(probe, readFileSync(outfile));
  try {
    const resolved = require.resolve(probe);
    delete require.cache[resolved];
    const mod = require(resolved);
    if (typeof mod !== 'function') {
      throw new Error(
        `Bundled ${entry} did not export a function handler (got ${typeof mod}). Refusing to ship a broken login/Drive API.`,
      );
    }
    delete require.cache[resolved];
  } finally {
    try {
      unlinkSync(probe);
    } catch {
      /* ignore */
    }
  }
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
console.log('Attached Google Drive + accounts functions to the Vercel build output.');
