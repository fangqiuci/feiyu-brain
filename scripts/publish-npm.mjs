// 直接调 npm registry 发布——不需要本机装 npm。
//
//   NPM_TOKEN=xxxx node scripts/publish-npm.mjs
//   NPM_TOKEN=xxxx node scripts/publish-npm.mjs --dry
//
// 走的是官方 registry 的 publish 协议（PUT /:package，tarball 放 _attachments）。
// 没 token 就只打印说明，不会碰网络发任何东西。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(fs.readFileSync(path.join(HERE, 'package.json'), 'utf8'));
const DIST = path.join(HERE, 'dist');
const tarball = path.join(DIST, `${pkg.name}-${pkg.version}.tgz`);
const dry = process.argv.includes('--dry');

const token = process.env.NPM_TOKEN || process.env.NODE_AUTH_TOKEN;
if (!token) {
  console.log(`缺 NPM_TOKEN。

在 https://www.npmjs.com/settings/<你的用户名>/tokens 建一个
「Automation」或「Bypass 2FA + Read and write」的 token，然后：

  set NPM_TOKEN=npm_xxxxxxxx
  node scripts/publish-npm.mjs

（或者把 token 贴给 agent，让 agent 直接发。）`);
  process.exit(1);
}

if (!fs.existsSync(tarball)) {
  console.log('还没打包，先跑 node scripts/release.mjs');
  execFileSync(process.execPath, [path.join(HERE, 'scripts', 'release.mjs')], { stdio: 'inherit' });
}
if (!fs.existsSync(tarball)) {
  console.error('打包失败');
  process.exit(1);
}

const buf = fs.readFileSync(tarball);
const shasum = crypto.createHash('sha1').update(buf).digest('hex');
const integrity = `sha512-${crypto.createHash('sha512').update(buf).digest('base64')}`;
const readme = fs.existsSync(path.join(HERE, 'README.md'))
  ? fs.readFileSync(path.join(HERE, 'README.md'), 'utf8')
  : '';

const manifest = JSON.parse(fs.readFileSync(path.join(DIST, 'manifest.json'), 'utf8'));

const versionDoc = {
  ...pkg,
  _id: `${pkg.name}@${pkg.version}`,
  _nodeVersion: process.versions.node,
  _npmVersion: '0.0.0-http',
  dist: {
    shasum,
    integrity,
    tarball: `https://registry.npmjs.org/${pkg.name}/-/${path.basename(tarball)}`,
  },
  ...(readme ? { readme } : {}),
};

const body = {
  _id: pkg.name,
  name: pkg.name,
  description: pkg.description,
  'dist-tags': { latest: pkg.version },
  versions: { [pkg.version]: versionDoc },
  ...(readme ? { readme } : {}),
  _attachments: {
    [path.basename(tarball)]: {
      content_type: 'application/octet-stream',
      data: buf.toString('base64'),
      length: buf.length,
    },
  },
};

const url = pkg.name.startsWith('@')
  ? `https://registry.npmjs.org/${pkg.name.replace('/', '%2F')}`
  : `https://registry.npmjs.org/${pkg.name}`;

console.log(`包     ${pkg.name}@${pkg.version}`);
console.log(`大小   ${(buf.length / 1024).toFixed(1)} KB`);
console.log(`sha256 ${manifest.sha256}`);
console.log(`目标   ${url}`);
console.log('');

if (dry) {
  console.log('--dry：不发送。文档大小 ' + (JSON.stringify(body).length / 1024).toFixed(1) + ' KB');
  process.exit(0);
}

const res = await fetch(url, {
  method: 'PUT',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'npm-command': 'publish',
  },
  body: JSON.stringify(body),
});

const text = await res.text();
if (!res.ok) {
  console.error(`发布失败 HTTP ${res.status}`);
  console.error(text.slice(0, 800));
  if (res.status === 403) {
    console.error('\n提示：403 通常是 token 没权限，或这个包名已被别人占用。');
    console.error('被占用就改成 scope 包：@你的名字/feiyu-brain（package.json 的 name 一起改）。');
  }
  process.exit(1);
}

console.log('发布成功 ✔');
console.log(text.slice(0, 400));
console.log('');
console.log(`安装：npm i ${pkg.name}`);
console.log(`页面：https://www.npmjs.com/package/${pkg.name}`);
