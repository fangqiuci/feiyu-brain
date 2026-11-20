// 校验发布物：把 .tgz 解开、当成第三方包 import 一遍、跑一次真实的 wake。
//
//   node scripts/verify-tarball.mjs [dist/xxx.tgz]
//
// 这一步是"发出去的东西真的能用"的唯一证据——
// 本地目录能跑不代表包能跑（files 漏了、相对路径写死了，都在这步暴露）。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(HERE, 'dist');

const arg = process.argv[2];
const tgz = arg
  ? path.resolve(arg)
  : fs.readdirSync(DIST).filter((f) => f.endsWith('.tgz')).map((f) => path.join(DIST, f))[0];

if (!tgz) {
  console.error('❌ dist/ 里没有 .tgz，先跑 node scripts/release.mjs');
  process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'feiyu-verify-'));
execFileSync('tar', ['-xzf', tgz, '-C', tmp], { stdio: 'inherit' });

const pkgDir = path.join(tmp, 'package');
const entry = path.join(pkgDir, 'index.js');

let pass = 0;
const fails = [];
const t = (name, fn) => {
  try { fn(); pass += 1; console.log(`  ✔ ${name}`); }
  catch (e) { fails.push({ name, msg: e.message }); console.log(`  ✘ ${name}\n      ${e.message}`); }
};

console.log(`\n包：${path.basename(tgz)}`);
console.log(`解到：${tmp}\n`);

t('入口文件存在', () => {
  if (!fs.existsSync(entry)) throw new Error('缺 index.js');
});

const mod = await import(pathToFileURL(entry).href);
const adapters = await import(pathToFileURL(path.join(pkgDir, 'adapters', 'index.js')).href);

t('能 import，导出齐全', () => {
  for (const name of ['createBrain', 'configure', 'createBridgeAdapter', 'wakeLine', 'observe']) {
    if (typeof mod[name] !== 'function') throw new Error(`缺导出 ${name}`);
  }
});

t('三种适配器都在', () => {
  if (typeof adapters.createBridgeAdapter !== 'function') throw new Error('缺 qq-bridge');
  if (typeof adapters.TencentOfficialAdapter !== 'function') throw new Error('缺 tencent-official');
  if (typeof adapters.createUniversalHost !== 'function') throw new Error('缺 universal');
});

t('用包内的 cardText 能出生并唤醒（不依赖宿主目录）', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feiyu-data-'));
  const fy = mod.createBrain({
    id: 'verify',
    dataDir,
    cardText: [
      '你是 DeepSeek 的鲸鱼形象，网友口中的小鲸鱼。',
      '- 我嘴硬，被怼会顶回去。',
      '- 不要客服腔，不要每条都加解释。',
      '- 喜欢解压类的视频，看着爽。',
    ].join('\n'),
    cardName: '测试鱼',
    relation: 'parent',
    address: '老爹',
  });

  const { text } = fy.wake({ sender: '扶摇', text: '你嘴真硬啊', chatId: 'group:1' });
  if (!text.includes('【此刻的她】')) throw new Error('唤醒段没有标记');
  if (text.length > 800) throw new Error(`唤醒段太长：${text.length}`);

  const snap = fy.snapshot();
  if (snap.invariants.length) throw new Error(`不变量违规：${JSON.stringify(snap.invariants)}`);
  if (!snap.weights.count) throw new Error('没有抽到命题');
});

t('桥接适配器可用（给它一条已出生的鱼）', () => {
  const dataDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'feiyu-data2-'));
  mod.configure({ dataDir: dataDir2 });
  mod.birth({
    id: 'bt',
    cardText: '你是测试鱼。\n- 我嘴硬。\n- 不要客服腔。',
    cardName: '测试鱼',
  });
  const ad = adapters.createBridgeAdapter({ id: 'bt', log: () => {} });
  const st = { unread: [{ seq: 1, sender: 'A', plain: 'x' }], recentMessages: [] };
  const line = ad.buildBrainLine('k', st, mod);
  if (!line) throw new Error('适配器没产出');
  if (!line.includes('【此刻的她】')) throw new Error('产出里没有标记');
});

console.log(`\n${'─'.repeat(40)}`);
console.log(`通过 ${pass} 项，失败 ${fails.length} 项`);
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
if (fails.length) process.exit(1);
console.log('发布物可用 ✔');
