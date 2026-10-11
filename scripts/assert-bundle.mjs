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

// The Content Security Policy keeps book markup that slips past the sanitiser
// from running script. It is added by a plugin in vite.config.ts at build time.
// Vite writes the quotes in the policy as &#39;.
const html = fs.readFileSync(path.resolve('dist/index.html'), 'utf8').replaceAll('&#39;', "'");
if (!/<meta http-equiv="Content-Security-Policy" content="[^"]*script-src 'self'/.test(html)) {
  console.error('assert-bundle error: dist/index.html has no Content Security Policy. See vite.config.ts.');
  process.exit(1);
}
console.log('✓ Content Security Policy present in dist/index.html');
