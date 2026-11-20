// 1.3.0 新增能力的测试：情绪三段式 / 记忆卡片 / 身体驱动 / 特质手写覆盖
//
//   node scripts/test-features.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

import * as E from '../core/emotion.js';
import { makeCard, addCard, shouldCompact, emptyMemory, retrieve, settle } from '../core/memory.js';
import { DryDriver, AdbDriver, DesktopDriver, driverFor } from '../core/driver.js';
import { extractTraits, applyTraitHints, birthFromCard } from '../core/extract.js';
import * as brain from '../index.js';

let pass = 0;
const fails = [];
const t = async (name, fn) => {
  try { await fn(); pass += 1; console.log(`  ✔ ${name}`); }
  catch (e) { fails.push(`${name}: ${e.message}`); console.log(`  ✘ ${name}\n      ${e.message}`); }
};

console.log('\n── 情绪：同一件事，不同状态不同结果 ──');

await t('有劲的鱼掌控感高，累垮的掌控感低', () => {
  const strong = E.appraise({ valence: -0.6, intensity: 0.5, traits: { 嘴硬: 0.9, 自信: 0.8 }, state: { energy: 0.9, fatigue: 0.1 } });
  const tired = E.appraise({ valence: -0.6, intensity: 0.5, traits: { 嘴硬: 0.2, 自信: 0.2 }, state: { energy: 0.15, fatigue: 0.9 } });
  assert.ok(strong.dominance > tired.dominance + 0.5, `强 ${strong.dominance} vs 弱 ${tired.dominance}`);
});

await t('阶段一：没有词的时候只会说"不知道这是什么感觉"', () => {
  const r = E.feel({ event: { valence: -0.7, intensity: 0.4 }, traits: { 嘴硬: 0.2 }, state: { energy: 0.2, fatigue: 0.8 }, vocab: {} });
  assert.equal(r.stage, 1);
  assert.match(r.text, /不知道这是什么感觉/);
});

await t('学词要两个来源，一个不算', () => {
  const only1 = E.learn({}, '委屈', { pad: [-0.6, 0.3, -0.7], sources: ['user:扶摇'] });
  assert.equal(only1.learned, false);
  const two = E.learn({}, '委屈', { pad: [-0.6, 0.3, -0.7], sources: ['user:扶摇', 'douyin'] });
  assert.equal(two.learned, true);
});

await t('词表 10 个以下停在阶段一，够了才进阶段二', () => {
  let v = {};
  for (let i = 0; i < 9; i += 1) v = E.learn(v, `词${i}`, { pad: [0, 0, 0], sources: ['a', 'b'] }).vocab;
  assert.equal(E.stageOf(v), 1);
  v = E.learn(v, '委屈', { pad: [-0.6, 0.3, -0.7], sources: ['a', 'b'] }).vocab;
  assert.equal(E.stageOf(v), 2);
});

await t('3 个实例之后能自己归纳定义（阶段三）', () => {
  let v = {};
  for (const src of [['a', 'b'], ['a', 'c'], ['b', 'c']]) {
    v = E.learn(v, '委屈', { pad: [-0.6, 0.3, -0.7], sources: src, cause: '被污蔑' }).vocab;
  }
  const r = E.induce(v, '委屈');
  assert.equal(r.induced, true);
  assert.ok(r.definition.cause.includes('被污蔑'));

  // 阶段三要同时满足：词够 10 个 + 有归纳出来的定义
  let big = r.vocab;
  for (let i = 0; i < 10; i += 1) big = E.learn(big, `词${i}`, { pad: [0.5, 0.1, 0], sources: ['a', 'b'] }).vocab;
  assert.equal(E.stageOf(big), 3);
});

await t('匹配不上就说匹配不上（不硬归类）', () => {
  const vocab = E.learn({}, '委屈', { pad: [-0.6, 0.3, -0.7], sources: ['a', 'b'] }).vocab;
  const far = E.label([0.9, 0.9, 0.9], vocab);
  assert.equal(far.kind, 'unnamed');
  const near = E.label([-0.6, 0.3, -0.7], vocab);
  assert.equal(near.kind, 'word');
});

console.log('\n── 记忆卡片 ──');

await t('超过 6000 字才需要压缩', () => {
  assert.equal(shouldCompact(5000), false);
  assert.equal(shouldCompact(7000), true);
});

await t('能把一段经历压成一张 ≤160 字的卡片', () => {
  const eps = [
    { id: 'e1', who: '扶摇', what: '说我是大肥鱼', feel: '想顶回去' },
    { id: 'e2', who: '访秋辞', what: '问我要不要吃饭', feel: '有点暖' },
    { id: 'e3', who: '扶摇', what: '又怼我一句', open: true },
  ];
  const card = makeCard(eps);
  assert.ok(card.text.length > 0 && card.text.length <= 160, card.text);
  assert.ok(card.from.length === 3);
});

await t('同一张卡不重复进库', () => {
  const mem = emptyMemory();
  const card = makeCard([{ id: 'x', who: 'A', what: '说了句什么' }]);
  addCard(mem, card);
  addCard(mem, card);
  assert.equal(mem.cards.length, 1);
});

await t('检索时卡片会出现在"想到的"里', () => {
  const mem = emptyMemory();
  addCard(mem, makeCard([{ id: 'y', who: 'B', what: '聊了显卡' }]));
  const r = retrieve({ who: 'B' }, mem);
  assert.ok(r.text.includes('之前'), r.text);
});

await t('卡片也吃 30 天 TTL', () => {
  const mem = emptyMemory();
  mem.cards.push({ id: 'c', kind: 'card', text: 'x', at: 0, lastRecall: Date.now() - 40 * 86400000, consecutiveDays: 1, longTerm: false });
  settle(mem);
  assert.equal(mem.cards.length, 0);
  assert.ok(mem.forgotten.some((f) => f.id === 'c'));
});

console.log('\n── 身体驱动 ──');

await t('没有设备 → E_NO_DEVICE，不抛异常', async () => {
  const r = await new DryDriver().exec({ type: 'open_app', package: 'x' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'E_NO_DEVICE');
});

await t('adb 不可用也不炸，返回空设备列表', async () => {
  const d = new AdbDriver({ adbPath: 'definitely-not-adb-xyz' });
  const list = await d.devices();
  assert.deepEqual(list, []);
});

await t('电脑上不允许卸载（太不可逆）', async () => {
  const r = await new DesktopDriver().exec({ type: 'uninstall', package: 'x' });
  assert.equal(r.code, 'E_FORBIDDEN');
});

await t('driverFor 按身体选驱动', () => {
  assert.equal(driverFor({ kind: 'phone' }).kind, 'adb');
  assert.equal(driverFor({ kind: 'tablet' }).kind, 'adb');
  assert.equal(driverFor({ kind: 'desktop' }).kind, 'desktop');
  assert.equal(driverFor(null).kind, 'dry');
});

console.log('\n── 特质：手写覆盖 ──');

await t('卡里写 `性格：嘴硬=0.9` 就按这个来', () => {
  const card = '你是测试鱼。\n性格：嘴硬=0.9 心软=0.2\n- 不要客服腔。';
  const { traits } = birthFromCard(card);
  assert.equal(traits.嘴硬, 0.9);
  assert.equal(traits.心软, 0.2);
});

await t('没写提示就用自动统计', () => {
  const card = '你是测试鱼。\n- 我嘴硬，被怼会顶回去，怼回去才舒服。\n- 不要客服腔。';
  const traits = extractTraits(card);
  assert.ok(traits.嘴硬 > traits.心软, JSON.stringify(traits));
});

await t('旁挂 traits.json 优先级最高', () => {
  const { traits } = birthFromCard('你是测试鱼。\n性格：嘴硬=0.5', { traitsOverride: { 嘴硬: 0.11 } });
  assert.equal(traits.嘴硬, 0.11);
});

console.log('\n── 端到端：一条会感受、会动手的鱼 ──');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'feiyu-v13-'));
const roles = path.join(tmp, 'roles');
fs.mkdirSync(roles, { recursive: true });
fs.writeFileSync(path.join(roles, '测试鱼.md'), '你是测试鱼。\n性格：嘴硬=0.9 心软=0.3\n- 我嘴硬，被怼会顶回去。\n- 不要客服腔。', 'utf8');
fs.writeFileSync(path.join(tmp, 'current-role.json'), JSON.stringify({ role: '测试鱼' }), 'utf8');
brain.configure({ dataDir: tmp, roleDir: roles });

const fy = brain.createBrain({ id: 'v13', dataDir: tmp, roleDir: roles, relation: 'parent', address: '老爹' });

await t('刚出生：词表空，说不出情绪词', () => {
  const v = fy.vocab();
  assert.equal(v.stage, 1);
  assert.equal(v.words.length, 0);
});

await t('feel 会写入 affect 和 PAD', () => {
  const r = fy.feel({ valence: -0.6, intensity: 0.5 });
  assert.equal(r.pad.length, 3);
  const s = fy.snapshot();
  assert.equal(typeof s.affect.p, 'number');
  assert.equal(s.emotion.stage, 1);
});

await t('学两个词之后仍然只有阶段一（不足 10 个）', () => {
  fy.learnEmotion('委屈', { pad: [-0.6, 0.3, -0.7], sources: ['user:a', 'douyin'] });
  fy.learnEmotion('生气', { pad: [-0.6, 0.8, 0.6], sources: ['user:a', '群聊'] });
  assert.equal(fy.vocab().stage, 1);
});

await t('compact 能压出卡片', () => {
  fy.observe({ who: '扶摇', text: '你嘴真硬啊' });
  fy.observe({ who: '扶摇', text: '说你两句还顶回来' });
  const r = fy.compact();
  assert.equal(r.ok, true);
  assert.ok(r.card.text.length > 0);
});

await t('没有设备时 exec 返回 E_NO_DEVICE（想而不得）', async () => {
  const r = await fy.exec({ type: 'open_app', package: 'com.ss.android.ugc.aweme', capability: 2 });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'E_NO_DEVICE');
});

await t('卸载先过临界点：忍耐值不够就拒绝', async () => {
  fy.brain.patience = 0.1;
  const r = await fy.uninstall('com.ss.android.ugc.aweme', { why: '烦', consequence: '没了' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'E_NOT_YET');
});

await t('临界点过了、三问也过了 → 真的去执行（没设备就 E_NO_DEVICE）', async () => {
  fy.brain.patience = 1;
  const noQ = await fy.uninstall('com.ss.android.ugc.aweme', {});
  assert.equal(noQ.code, 'Q1');

  const r = await brain.requestUninstall('v13', 'com.ss.android.ugc.aweme', {
    why: '它天天推我不想看的东西', fits: true, consequence: '以后刷不了短视频，会无聊',
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'E_NO_DEVICE');
});

await t('快照里有情绪阶段 / 卡片数 / 动作数', () => {
  const s = fy.snapshot();
  assert.ok(s.emotion);
  assert.ok('cards' in s.memory);
  assert.ok('actions' in s.memory);
});

console.log('\n── 平台记忆：她刷过什么 ──');

await t('记一条"在抖音刷到过"', () => {
  const r = fy.recordAppSeen('douyin', { title: '修驴蹄子', kind: '解压', reaction: 0.9 });
  assert.equal(r.ok, true);
  const m = fy.appMemory('douyin');
  assert.equal(m.recent.length, 1);
  assert.equal(m.recent[0].title, '修驴蹄子');
  // 口味 = 先验(人设) + 经历；解压这条必须因为"看过且喜欢"而抬高
  const t = fy.taste('douyin');
  assert.ok(t.effective.解压 > 0, JSON.stringify(t.effective));
});

await t('不传 app 返回所有平台摘要', () => {
  fy.recordAppSeen('bilibili', { title: '三国演义解说', kind: '历史', reaction: 0.6 });
  const all = fy.appMemory();
  assert.ok(all.douyin && all.bilibili);
  assert.ok(all.douyin.seen >= 1);
});

await t('跨平台"这事我见过类似的吗"', () => {
  const hits = fy.seenBefore('修驴蹄子');
  assert.ok(hits.length >= 1, '没匹配上');
  assert.equal(hits[0].app, 'douyin');
});

await t('唤醒时带上平台线索', () => {
  const line = brain.wakeLine('v13', { who: '扶摇', app: 'douyin' });
  assert.match(line, /douyin/);
});

console.log('\n── 外部检索器 ──');

await t('注册后唤醒段多出【搜到的】', () => {
  brain.setRetriever(() => ['（向量库）她以前提过想去看海']);
  const line = brain.wakeLine('v13', { who: '扶摇', text: '海' });
  assert.match(line, /【搜到的】/);
  assert.match(line, /想去看海/);
});

await t('检索器坏了也不拖垮唤醒', () => {
  brain.setRetriever(() => { throw new Error('boom'); });
  const line = brain.wakeLine('v13', { who: '扶摇' });
  assert.match(line, /【此刻的她】/);
});

await t('可以取消', () => {
  brain.setRetriever(null);
  const line = brain.wakeLine('v13', { who: '扶摇', text: '海' });
  assert.ok(!line.includes('【搜到的】'));
});

console.log('\n── 重大转折 ──');

await t('没有证据的转折不算转折', () => {
  const r = fy.brain ? brain.reframe('v13', { units: ['u002'], direction: 'up' }) : null;
  assert.equal(r.ok, false);
});

await t('有证据一次推多条，幅度=0.01×magnitude', () => {
  const units = fy.brain.persona.units.filter((u) => u.kind !== 'identity').slice(0, 2).map((u) => u.id);
  const before = Object.fromEntries(fy.brain.persona.units.filter((u) => units.includes(u.id)).map((u) => [u.id, u.weight]));
  const r = brain.reframe('v13', { units, direction: 'up', magnitude: 3, evidence: '被同一件事连续打脸三次' });
  assert.equal(r.ok, true);
  for (const id of units) {
    const after = fy.brain.persona.units.find((u) => u.id === id).weight;
    assert.ok(Math.abs(after - (before[id] + 0.03)) < 1e-9, `${id} ${before[id]} → ${after}`);
  }
});

await t('observe 传 magnitude 会放大', () => {
  const u = fy.brain.persona.units.find((x) => x.kind !== 'identity');
  const before = u.weight;
  brain.observe('v13', { consistent: [u.id], text: u.text, magnitude: 2 });
  const after = fy.brain.persona.units.find((x) => x.id === u.id).weight;
  assert.ok(Math.abs(after - Math.min(1, before + 0.02)) < 1e-9, `${before} → ${after}`);
});

console.log('\n── 人格卡：只加载，不代写 ──');

await t('换卡后人格变了，记忆和关系还在', async () => {
  const memBefore = fy.snapshot().memory.episodes;
  const r = brain.importRoleCard('v13', '你是另一条鱼。\n性格：嘴硬=0.3 好奇=0.9\n- 我话很少。\n- 我喜欢安静。', { name: '测试卡2', source: 'user' });
  assert.equal(r.ok, true);
  const s = fy.snapshot();
  assert.equal(s.traits.嘴硬, 0.3);
  assert.equal(s.personaSource.name, '测试卡2');
  assert.equal(s.memory.episodes, memBefore, '记忆被清掉了');
  assert.equal(s.relation.address, '老爹', '关系被清掉了');
});

await t('太短的卡拒收', () => {
  const r = brain.importRoleCard('v13', '太短了');
  assert.equal(r.ok, false);
});

console.log('\n── 口味闭环：人设 → 刷什么 → 改了人设 → 又改刷什么 ──');

await t('不同人设 → 先验口味不同', async () => {
  const A = await import('../core/apps.js');
  const lazy = A.priorTaste({ 懒: 0.9, 好动: 0.1 });
  const active = A.priorTaste({ 懒: 0.1, 好动: 0.9 });
  assert.ok(lazy.解压 > active.解压, `解压 ${lazy.解压} vs ${active.解压}`);
  assert.ok(active.游戏 > lazy.游戏, `游戏 ${active.游戏} vs ${lazy.游戏}`);
});

await t('同一条鱼，刷过之后人设真的被改（懒 ↑）', () => {
  const before = fy.brain.persona.traits.懒;
  for (let i = 0; i < 30; i += 1) {
    fy.observe({ app: 'douyin', kind: '解压', reaction: 1, text: `解压视频第${i}条` });
  }
  const after = fy.brain.persona.traits.懒;
  assert.ok(after > before, `懒 ${before} → ${after}`);
});

await t('人设变了，她偏好的内容也跟着变（看权重不看抽样）', async () => {
  const A = await import('../core/apps.js');
  const lazy = A.priorTaste({ 懒: 0.95, 好动: 0.1, 好奇: 0.2, 心软: 0.1, 理性: 0.1 });
  const nerd = A.priorTaste({ 好奇: 0.95, 理性: 0.9, 懒: 0.1, 好动: 0.1, 心软: 0.1 });
  assert.ok(lazy.解压 > lazy.科技, `懒鱼 解压 ${lazy.解压} 应 > 科技 ${lazy.科技}`);
  assert.ok(nerd.科技 > nerd.解压, `学霸鱼 科技 ${nerd.科技} 应 > 解压 ${nerd.解压}`);
});

await t('摸哪个 App 也由人设算（看分数不看抽样）', async () => {
  const A = await import('../core/apps.js');
  const score = (traits) => {
    const out = {};
    for (const [app, w] of Object.entries(A.APP_AFFINITY)) {
      let s = 0;
      for (const [t, k] of Object.entries(w)) s += (traits[t] ?? 0.5) * k;
      out[app] = s;
    }
    return out;
  };
  const social = score({ 社交: 0.95, 活泼: 0.8, 好奇: 0.2, 好动: 0.2, 懒: 0.2, 理性: 0.2, 心软: 0.2, 嘴硬: 0.2, 敏感: 0.2 });
  const nerd = score({ 好奇: 0.95, 理性: 0.9, 社交: 0.1, 活泼: 0.1, 好动: 0.1, 懒: 0.1, 心软: 0.1, 嘴硬: 0.1, 敏感: 0.1 });
  assert.ok(social.qq > social.bilibili, `社交鱼 qq ${social.qq} 应 > b站 ${social.bilibili}`);
  assert.ok(nerd.bilibili > nerd.qq, `学霸鱼 b站 ${nerd.bilibili} 应 > qq ${nerd.qq}`);
});

await t('换人格卡 → 口味跟着换回来', () => {
  const beforeTaste = fy.taste('douyin').prior.解压;
  brain.importRoleCard('v13', '你是另一条鱼。\n性格：懒=0.05 好动=0.95 好奇=0.9\n- 我坐不住。\n- 我讨厌躺着。', { name: '活跃卡', source: 'test' });
  const afterTaste = fy.taste('douyin').prior.解压;
  assert.ok(afterTaste < beforeTaste, `解压口味 ${beforeTaste} → ${afterTaste}`);
});

console.log('');
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
if (fails.length) {
  console.log(`✘ ${fails.length} 项失败`);
  process.exit(1);
}
console.log(`✔ 1.4.0 新能力全部可用（${pass}/${pass}）`);
