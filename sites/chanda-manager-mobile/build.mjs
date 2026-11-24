import { mkdir, readFile, writeFile } from 'node:fs/promises';

const dist = new URL('./dist/', import.meta.url);
const files = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/admin': ['admin.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/admin.css': ['admin.css', 'text/css; charset=utf-8'],
  '/motion.js': ['motion.js', 'text/javascript; charset=utf-8'],
  '/landing.css': ['landing.css', 'text/css; charset=utf-8'],
  '/vendor/gsap.min.js': ['vendor/gsap.min.js', 'text/javascript; charset=utf-8'],
  '/vendor/ScrollTrigger.min.js': ['vendor/ScrollTrigger.min.js', 'text/javascript; charset=utf-8'],
  '/vendor/SplitText.min.js': ['vendor/SplitText.min.js', 'text/javascript; charset=utf-8'],
  '/admin.js': ['admin.js', 'text/javascript; charset=utf-8'],
  '/records.js': ['records.js', 'text/javascript; charset=utf-8'],
  '/chanda-icon.png': ['chanda-icon.png', 'image/png'],
  '/masjid-interior.jpg': ['masjid-interior.jpg', 'image/jpeg'],
};

const assets = {};
for (const [path, [file, type]] of Object.entries(files)) {
  assets[path] = { type, body: (await readFile(new URL(file, dist))).toString('base64') };
}
const worker = await readFile(new URL('./worker.mjs', import.meta.url), 'utf8');
await mkdir(new URL('server/', dist), { recursive: true });
await writeFile(new URL('server/index.js', dist), 'const assets = ' + JSON.stringify(assets) + ';\n' + worker);
