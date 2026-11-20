// 验证「已经发出去的包」真的能用——不是验证本地目录。
//
//   node scripts/verify-published.mjs            # 验证 latest
//   node scripts/verify-published.mjs 1.1.0      # 验证指定版本
//
// 做的事：从 registry 下载 tarball → 解包 → import → 出生 → 唤醒 → 断言。
// 这一步过了，才叫"别人能装上并且能用"。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const NAME = 'feiyu-brain';
const want = process.argv[2] ?? null;

const registry = `https://registry.npmjs.org/${NAME}`;
const meta = await (await fetch(registry)).json();
if (!meta?.versions) {
  console.error('❌ registry 上查不到这个包');
  process.exit(1);
}

const version = want ?? meta['dist-tags']?.latest;
const info = meta.versions[version];
if (!info) {
  console.error(`❌ 没有 ${version} 这个版本。现有：${Object.keys(meta.versions).join(', ')}`);
  process.exit(1);
}

console.log(`包      ${meta.name}`);
console.log(`版本      ${version}`);
console.log(`发布      ${meta.time?.[version] ?? '?'}`);
console.log(`tarball   ${info.dist.tarball}`);
console.log('');

const buf = Buffer.from(await (await fetch(info.dist.tarball)).arrayBuffer());
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'feiyu-pub-'));
const tgz = path.join(tmp, 'pkg.tgz');
fs.writeFileSync(tgz, buf);
execFileSync('tar', ['-xzf', tgz, '-C', tmp], { stdio: 'inherit' });

const pkgDir = path.join(tmp, 'package');
const pkgJson = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));

let pass = 0;
const fails = [];
const t = (name, fn) => {
  try { fn(); pass += 1; console.log(`  ✔ ${name}`); }
  catch (e) { fails.push(`${name}: ${e.message}`); console.log(`  ✘ ${name}\n      ${e.message}`); }
};

console.log(`解开后 ${(buf.length / 1024).toFixed(1)} KB\n`);

t('包名和版本对得上', () => {
  if (pkgJson.name !== NAME) throw new Error(`包里写的是 ${pkgJson.name}`);
  if (pkgJson.version !== version) throw new Error(`包里写的是 ${pkgJson.version}`);
});

t('没有夹带 state / data / dist', () => {
  const bad = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (['state', 'data', 'dist', 'node_modules'].includes(e.name)) bad.push(e.name); walk(p); }
    }
  };
  walk(pkgDir);
  if (bad.length) throw new Error(`夹带了：${[...new Set(bad)].join(', ')}`);
});

const mod = await import(pathToFileURL(path.join(pkgDir, 'index.js')).href);
const adapters = await import(pathToFileURL(path.join(pkgDir, 'adapters', 'index.js')).href);

t('能 import，核心导出齐全', () => {
  for (const n of ['createBrain', 'configure', 'wakeLine', 'observe', 'createBridgeAdapter']) {
    if (typeof mod[n] !== 'function') throw new Error(`缺 ${n}`);
  }
});

t('三种适配器都在', () => {
  if (typeof adapters.createBridgeAdapter !== 'function') throw new Error('缺 qq-bridge');
  if (typeof adapters.TencentOfficialAdapter !== 'function') throw new Error('缺 tencent');
  if (typeof adapters.createUniversalHost !== 'function') throw new Error('缺 universal');
});

t('真的能出生、能唤醒', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feiyu-pubdata-'));
  const fy = mod.createBrain({
    id: 'pubcheck',
    dataDir,
    cardText: '你是 DeepSeek 的鲸鱼形象。\n- 我嘴硬，被怼会顶回去。\n- 不要客服腔。\n- 喜欢解压的东西。',
    cardName: '测试鱼',
    relation: 'parent',
    address: '老爹',
  });
  const { text } = fy.wake({ sender: '扶摇', text: '你嘴真硬啊', chatId: 'group:1' });
  if (!text.includes('【此刻的她】')) throw new Error('没有注入段');
  if (!text.includes('【手上的东西】')) throw new Error('没有身体');
  const s = fy.snapshot();
  if (s.invariants.length) throw new Error(JSON.stringify(s.invariants));
});

t('CLI 文件在（bin 能用）', () => {
  if (!fs.existsSync(path.join(pkgDir, 'cli.mjs'))) throw new Error('缺 cli.mjs');
});

console.log('');
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
if (fails.length) {
  console.log(`✘ ${fails.length} 项失败`);
  process.exit(1);
}
console.log(`✔ 线上包可用（${pass}/${pass}）—— 别人 npm i 就能用`);
