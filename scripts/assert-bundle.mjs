import fs from 'node:fs';
import path from 'node:path';

const assetsDir = path.resolve('dist/assets');
if (!fs.existsSync(assetsDir)) {
  console.error('assert-bundle: dist/assets directory does not exist. Run vite build first.');
  process.exit(1);
}

const files = fs.readdirSync(assetsDir);
const cssFiles = files.filter((f) => f.endsWith('.css'));

if (cssFiles.length === 0) {
  console.error(
    'assert-bundle error: dist/assets/ contains no .css bundle! Ensure src/App.css is imported in src/main.tsx.'
  );
  process.exit(1);
}

for (const cssFile of cssFiles) {
  const stats = fs.statSync(path.join(assetsDir, cssFile));
  console.log(`✓ CSS bundle verified: ${cssFile} (${(stats.size / 1024).toFixed(2)} kB)`);
}
