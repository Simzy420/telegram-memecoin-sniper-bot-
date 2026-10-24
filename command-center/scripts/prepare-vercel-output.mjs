import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');
const indexHtml = path.join(dist, 'index.html');

if (!existsSync(indexHtml)) {
  console.error('Build did not produce dist/index.html');
  process.exit(1);
}

// GitHub Pages has no SPA rewrite, so unknown paths need a copy of index.html.
cpSync(indexHtml, path.join(dist, '404.html'));

// Vercel looks for dist after this process exits and does not find it, even
// though Vite just wrote the directory. Publish the same files through the
// Build Output API before that check runs. GitHub Pages keeps using dist.
if (!process.env.VERCEL) {
  process.exit(0);
}

const outputDir = path.join(root, '.vercel', 'output');
const staticDir = path.join(outputDir, 'static');
rmSync(outputDir, { recursive: true, force: true });
mkdirSync(staticDir, { recursive: true });
cpSync(dist, staticDir, { recursive: true });

const config = {
  version: 3,
  routes: [
    { handle: 'filesystem' },
    { src: '/((?!api/).*)', dest: '/index.html' },
  ],
};
writeFileSync(path.join(outputDir, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
console.log('Prepared Vercel static output in .vercel/output/static');
