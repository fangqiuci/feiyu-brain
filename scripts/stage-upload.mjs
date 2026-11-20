// 准备一个「要上传到 GitHub」的干净目录。
//
//   node scripts/stage-upload.mjs
//
// 产物：<仓库同级>/feiyu-brain-upload/
// 里面只有该进 git 的文件——dist / node-path.txt / state 已经剔除。
// 然后：打开那个文件夹 → Ctrl+A → 拖到 GitHub 的 upload 页面。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(path.dirname(HERE), 'feiyu-brain-upload');

const FOLDERS = ['core', 'adapters', 'lib', 'docs', 'examples', 'market', 'scripts'];
const FILES = [
  '.gitignore',
  'cordis.patch.yml',
  'index.js',
  'store.js',
  'cli.mjs',
  'package.json',
  'README.md',
  'LICENSE',
  'demo.mjs',
  'selftest.mjs',
  'test-adapters.mjs',
  'smoke.mjs',
  'verify-package.mjs',
  'publish.bat',
];

if (fs.existsSync(OUT)) fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

let count = 0;
let bytes = 0;

for (const f of FILES) {
  const src = path.join(HERE, f);
  if (!fs.existsSync(src)) { console.log(`  ⚠ 缺文件 ${f}`); continue; }
  fs.copyFileSync(src, path.join(OUT, f));
  count += 1;
  bytes += fs.statSync(src).size;
}

for (const d of FOLDERS) {
  const src = path.join(HERE, d);
  if (!fs.existsSync(src)) { console.log(`  ⚠ 缺目录 ${d}`); continue; }
  const walk = (from, to) => {
    fs.mkdirSync(to, { recursive: true });
    for (const e of fs.readdirSync(from, { withFileTypes: true })) {
      const a = path.join(from, e.name);
      const b = path.join(to, e.name);
      if (e.isDirectory()) walk(a, b);
      else { fs.copyFileSync(a, b); count += 1; bytes += fs.statSync(a).size; }
    }
  };
  walk(src, path.join(OUT, d));
}

fs.writeFileSync(path.join(OUT, '.gitignore'), fs.readFileSync(path.join(HERE, '.gitignore'), 'utf8'), 'utf8');

console.log('');
console.log(`✔ 准备好了：${OUT}`);
console.log(`  ${count} 个文件，${(bytes / 1024).toFixed(1)} KB`);
console.log('');
console.log('  已剔除：dist/  node-path.txt  state/');
console.log('');
console.log('  下一步：打开那个文件夹 → Ctrl+A → 拖到 GitHub 上传页');
console.log('');
