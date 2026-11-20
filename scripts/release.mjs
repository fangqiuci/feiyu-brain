// 打包发布物：按 package.json 的 files 列表生成 npm 格式的 .tgz
//
//   node scripts/release.mjs
//
// 产物：
//   dist/feiyu-brain-<版本>.tgz      ← 可以 npm i 的文件
//   dist/manifest.json               ← 版本 / sha256 / 文件清单
//
// 没有 npm 也能跑：用系统自带的 tar（Windows 10+ 自带 bsdtar）。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(fs.readFileSync(path.join(HERE, 'package.json'), 'utf8'));
const DIST = path.join(HERE, 'dist');

function copyInto(src, dstRoot) {
  const st = fs.statSync(src);
  const rel = path.relative(HERE, src);
  const dst = path.join(dstRoot, rel);
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src)) copyInto(path.join(src, entry), dstRoot);
  } else {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'feiyu-pack-'));
const target = path.join(staging, 'package');
fs.mkdirSync(target, { recursive: true });

const included = [];
for (const entry of pkg.files ?? []) {
  const src = path.join(HERE, entry);
  if (!fs.existsSync(src)) continue;
  copyInto(src, target);
}
for (const must of ['package.json', 'README.md', 'LICENSE']) {
  const src = path.join(HERE, must);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(target, must));
}

fs.mkdirSync(DIST, { recursive: true });
const out = path.join(DIST, `${pkg.name}-${pkg.version}.tgz`);

// bsdtar / gnu tar 都认这套参数
execFileSync('tar', ['-czf', out, '-C', staging, 'package'], { stdio: 'inherit' });

// 清单
const walk = (dir, base = '') => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) walk(path.join(dir, e.name), rel);
    else included.push(rel);
  }
};
walk(target);

const size = fs.statSync(out).size;
const hash = sha256(out);
const manifest = {
  name: pkg.name,
  version: pkg.version,
  builtAt: new Date().toISOString(),
  tarball: path.basename(out),
  sizeBytes: size,
  sha256: hash,
  fileCount: included.length,
  files: included.sort(),
};
fs.writeFileSync(path.join(DIST, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

try { fs.rmSync(staging, { recursive: true, force: true }); } catch {}

console.log('');
console.log(`✔ ${path.basename(out)}`);
console.log(`  大小   ${(size / 1024).toFixed(1)} KB`);
console.log(`  文件   ${included.length} 个`);
console.log(`  sha256 ${hash}`);
console.log(`  清单   dist/manifest.json`);
console.log('');
