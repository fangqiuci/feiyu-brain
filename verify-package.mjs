// 打包自检：没有 npm 也能知道包里有什么、有没有夹带。
//   node verify-package.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(HERE, 'package.json'), 'utf8'));

const REQUIRED = ['index.js', 'store.js', 'package.json', 'README.md', 'LICENSE'];
const FORBIDDEN = [/^state\//, /^data\//, /^node_modules\//, /\.tgz$/, /\.env$/, /\.local\.json$/];

function walk(dir) {
  const out = [];
  const full = path.join(HERE, dir);
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    const abs = path.join(full, entry.name);
    if (entry.isDirectory()) out.push(...walk(path.relative(HERE, abs)));
    else out.push(path.relative(HERE, abs).split(path.sep).join('/'));
  }
  return out;
}

const included = [];
for (const item of pkg.files ?? []) {
  const clean = item.replace(/\/$/, '');
  if (!fs.existsSync(path.join(HERE, clean))) continue;
  if (fs.statSync(path.join(HERE, clean)).isDirectory()) included.push(...walk(clean));
  else included.push(clean);
}
for (const r of REQUIRED) if (!included.includes(r)) included.push(r);

const bad = included.filter((f) => FORBIDDEN.some((re) => re.test(f)));
const missing = REQUIRED.filter((f) => !included.includes(f));

const bytes = included.reduce((s, f) => {
  try { return s + fs.statSync(path.join(HERE, f)).size; } catch { return s; }
}, 0);

console.log(`包名：${pkg.name}@${pkg.version}`);
console.log(`文件：${included.length} 个，${(bytes / 1024).toFixed(1)} KB`);
console.log('');
for (const f of included.sort()) console.log(`  ${f}`);

console.log('');
if (missing.length) {
  console.log(`✘ 缺少必带文件：${missing.join(', ')}`);
  process.exit(1);
}
if (bad.length) {
  console.log(`✘ 夹带了不该发的东西：${bad.join(', ')}`);
  process.exit(1);
}
console.log('✔ 包内容干净，可以发布');
