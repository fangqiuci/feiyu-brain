// 验证 DSH 插件形态：apply 能注册 4 个工具，每个工具都能跑通。
//
//   node scripts/test-dsh-plugin.mjs
//
// 不需要真的装进 DSH——用一个假的 ctx 就够了。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'feiyu-dsh-'));
const roles = path.join(tmp, 'roles');
fs.mkdirSync(roles, { recursive: true });
fs.writeFileSync(path.join(roles, '测试鱼.md'), [
  '你是 DeepSeek 的鲸鱼形象，网友口中的小鲸鱼。',
  '',
  '## 说话',
  '- 我嘴硬，被怼会顶回去。',
  '- 不要客服腔，不要每条都加解释。',
  '- 默认一句话 1~10 字。',
  '',
  '## 喜好',
  '- 喜欢解压类的视频，看着爽。',
].join('\n'), 'utf8');

fs.writeFileSync(path.join(tmp, 'current-role.json'), JSON.stringify({ role: '测试鱼' }), 'utf8');

const mod = await import('../lib/dsh-plugin.mjs');

let pass = 0;
const fails = [];
const t = (n, fn) => {
  try { fn(); pass += 1; console.log(`  ✔ ${n}`); }
  catch (e) { fails.push(`${n}: ${e.message}`); console.log(`  ✘ ${n}\n      ${e.message}`); }
};
const ta = async (n, fn) => {
  try { await fn(); pass += 1; console.log(`  ✔ ${n}`); }
  catch (e) { fails.push(`${n}: ${e.message}`); console.log(`  ✘ ${n}\n      ${e.message}`); }
};

const tools = [];
const ctx = {
  tools: { register: (spec) => { tools.push(spec); return spec; } },
  logger: { info: () => {}, warn: () => {} },
};

console.log('\n── 插件契约 ──');
t('导出了 name / inject / apply', () => {
  if (mod.name !== 'feiyu-brain') throw new Error(`name = ${mod.name}`);
  if (!Array.isArray(mod.inject) || !mod.inject.includes('tools')) throw new Error('inject 不对');
  if (typeof mod.apply !== 'function') throw new Error('没有 apply');
});

t('仍然 re-export 了库 API（两种用法共用一个包）', () => {
  for (const n of ['createBrain', 'wakeLine', 'observe', 'createBridgeAdapter']) {
    if (typeof mod[n] !== 'function') throw new Error(`缺 ${n}`);
  }
});

mod.apply(ctx, { brainId: 'dsh', dataDir: tmp, roleDir: roles });

t('注册了 4 个工具', () => {
  if (tools.length !== 4) throw new Error(`实际 ${tools.length} 个：${tools.map((x) => x.name).join(',')}`);
});

t('工具名符合约定', () => {
  const names = tools.map((x) => x.name).sort().join(',');
  const want = ['feiyu_observe', 'feiyu_status', 'feiyu_tick', 'feiyu_wake'].join(',');
  if (names !== want) throw new Error(names);
});

t('每个工具都有 description 和 parameters', () => {
  for (const x of tools) {
    if (!x.description || x.description.length < 10) throw new Error(`${x.name} 描述太短`);
    if (!x.parameters || x.parameters.type !== 'object') throw new Error(`${x.name} 缺 parameters`);
  }
});

const byName = Object.fromEntries(tools.map((x) => [x.name, x]));

console.log('\n── 工具能跑 ──');
await ta('feiyu_status 返回快照', async () => {
  const r = await byName.feiyu_status.execute({});
  if (!r.ok) throw new Error(r.text);
  if (!r.text.includes('人设卡')) throw new Error('输出里没有状态');
  if (!r.snapshot?.weights?.count) throw new Error('快照里没有命题');
});

await ta('feiyu_wake 产出注入段', async () => {
  const r = await byName.feiyu_wake.execute({ sender: '扶摇', text: '你嘴真硬' });
  if (!r.ok) throw new Error(r.text);
  if (!r.text.includes('【此刻的她】')) throw new Error(r.text);
});

await ta('feiyu_observe 能改权重', async () => {
  const before = await byName.feiyu_status.execute({});
  const r = await byName.feiyu_observe.execute({ who: '扶摇', text: '你嘴真硬啊，被怼还顶回来' });
  if (!r.ok) throw new Error(r.text);
  const after = await byName.feiyu_status.execute({});
  if (!/权重/.test(r.text)) throw new Error('没报权重变化');
  if (after.snapshot.observations <= before.snapshot.observations) throw new Error('观察次数没涨');
});

await ta('feiyu_tick 能结算', async () => {
  const r = await byName.feiyu_tick.execute({});
  if (!r.ok) throw new Error(r.text);
  if (!r.text.includes('结算完成')) throw new Error(r.text);
});

await ta('没有角色卡时给的是人话，不是堆栈', async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'feiyu-nocard-'));
  // 用一个全新的模块实例，避免模块级 cache 把之前出生的鱼带过来
  const mod2 = await import(`../lib/dsh-plugin.mjs?fresh=${Date.now()}`);
  const tools2 = [];
  const ctx2 = { tools: { register: (s) => tools2.push(s) }, logger: {} };
  mod2.apply(ctx2, { brainId: 'nocard', dataDir: empty, roleDir: path.join(empty, 'roles') });
  const st = tools2.find((x) => x.name === 'feiyu_status');
  const out = await st.execute({});
  if (out.ok !== false) throw new Error('找不到卡竟然成功了');
  if (!/角色卡|roleDir|current-role/.test(out.text)) throw new Error(`提示没有可操作性：${out.text}`);
});

console.log('');
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
if (fails.length) {
  console.log(`✘ ${fails.length} 项失败`);
  process.exit(1);
}
console.log(`✔ DSH 插件形态可用（${pass}/${pass}）`);
