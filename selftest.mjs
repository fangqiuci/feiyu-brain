// 断言测试：跑通 = 内核成立。
//   node selftest.mjs
// 退出码 0 全过；非 0 有失败。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ROOT } from './store.js';
import * as brain from './index.js';
import { brief, evolve, decay, shed, SHED_THRESHOLD } from './core/persona.js';
import { styleVector, wakeReply, flowLevel, whimProbability, applyPatience, isOutburst } from './core/derive.js';
import { attribute, LABELS, intercept } from './core/attribution.js';
import { recall, settle, retrieve, PROMOTE_DAYS, TTL_DAYS } from './core/memory.js';
import { check, syntheticTraits } from './core/invariants.js';
import { createBody, chooseBody, bodyScores, canDo, CAPABILITY, BODY_KINDS } from './core/body.js';
import { mulberry32 } from './core/derive.js';
import { createContract, assertContractImmutable, attentionBoost, beginColdWar, sever, canSever } from './core/relation.js';

let pass = 0;
const fails = [];

function t(name, fn) {
  try { fn(); pass += 1; console.log(`  ✔ ${name}`); }
  catch (e) { fails.push({ name, msg: e.message }); console.log(`  ✘ ${name}\n      ${e.message}`); }
}

const ID = 'selftest';
const dir = path.join(ROOT, 'state', 'brains', ID);
if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });

console.log('\n── 出生 ──');
const b = brain.birth({ id: ID, relation: 'parent', address: '妈' });

t('从角色卡抽出命题', () => {
  assert.ok(b.persona.units.length > 20, `只抽到 ${b.persona.units.length} 条`);
});

t('有身份命题', () => {
  const ids = b.persona.units.filter((u) => u.kind === 'identity');
  assert.ok(ids.length >= 1, '没有 identity');
});

t('brief 不超过 300 字', () => {
  assert.ok(b.persona.brief.length <= 300, `实际 ${b.persona.brief.length}`);
  assert.ok(b.persona.brief.length > 50, 'brief 太短了');
});

t('brief 不含 Markdown（QQ 上会乱码）', () => {
  assert.ok(!/\*\*|`|^#/m.test(b.persona.brief), b.persona.brief.slice(0, 80));
});

t('brief 不含"关于这张卡"的元描述', () => {
  assert.ok(!/本卡|提示词|角色卡/.test(b.persona.brief), b.persona.brief.slice(0, 80));
});

t('风格向量归一（Σ4）', () => {
  const s = Object.values(b.self.style).reduce((a, x) => a + x, 0);
  assert.ok(Math.abs(s - 1) < 1e-9, `sum=${s}`);
  assert.ok(Object.values(b.self.style).every((x) => x > 0), '有 0 项');
});

t('辞辞的主导风格是 denial', () => {
  assert.equal(b.self.styleName, 'denial', `实际 ${b.self.styleName}`);
});

console.log('\n── 权重演化 ──');
t('一致 +0.01 / 冲突 -0.01', () => {
  const u = { id: 'x', text: 't', kind: 'trait', weight: 0.5 };
  assert.equal(evolve([u], { consistent: ['x'] })[0].weight, 0.51);
  assert.equal(evolve([u], { conflicting: ['x'] })[0].weight, 0.49);
});

t('身份命题权重永不变（I2）', () => {
  const u = { id: 'i', text: 't', kind: 'identity', weight: 1 };
  assert.equal(evolve([u], { conflicting: ['i'] })[0].weight, 1);
  assert.equal(decay([u], 10000)[0].weight, 1);
});

t('权重不掉出 [0,1]', () => {
  const u = { id: 'x', text: 't', kind: 'trait', weight: 0.005 };
  let units = [u];
  for (let i = 0; i < 50; i += 1) units = evolve(units, { conflicting: ['x'] });
  assert.ok(units[0].weight >= 0);
});

console.log('\n── 蜕皮 ──');
t('低于阈值沉进 formerSelves，不是删除', () => {
  const u = { id: 's', text: '我嘴硬', kind: 'trait', weight: SHED_THRESHOLD - 0.01 };
  const r = shed([u], { at: 1 });
  assert.equal(r.units.length, 0);
  assert.equal(r.formerSelves.length, 1);
  assert.match(r.formerSelves[0].memoir, /以前/);
});

t('蜕皮后 memory.formerSelves 里查得到', () => {
  const units = b.persona.units.map((u) => (u.kind !== 'identity' ? { ...u, weight: 0.01 } : u));
  const r = shed(units, { at: 2 });
  assert.ok(r.formerSelves.length >= 1, '一条都没蜕');
  assert.ok(r.units.every((u) => u.kind === 'identity' || u.weight >= SHED_THRESHOLD));
});

console.log('\n── 记忆 ──');
t('TTL 30 天到期进 forgotten', () => {
  const m = { episodes: [{ id: 'a', kind: 'episode', lastRecall: Date.now() - 31 * 86400000, consecutiveDays: 1, longTerm: false }], imagination: [], facts: {}, impressions: {}, forgotten: [] };
  settle(m);
  assert.equal(m.episodes.length, 0);
  assert.equal(m.forgotten.length, 1);
});

t('连续 15 天升级长期，永不衰减', () => {
  const m = { episodes: [{ id: 'b', kind: 'episode', lastRecall: Date.now() - 400 * 86400000, consecutiveDays: PROMOTE_DAYS, longTerm: true }], imagination: [], facts: {}, impressions: {}, forgotten: [] };
  settle(m);
  assert.equal(m.episodes.length, 1);
});

t('提起一次续命', () => {
  const item = { lastRecall: Date.now() - 20 * 86400000, consecutiveDays: 2 };
  assert.ok(recall(item).lastRecall > item.lastRecall);
});

t('检索不超预算', () => {
  const mem = { episodes: [], facts: {}, taste: {}, impressions: {} };
  for (let i = 0; i < 200; i += 1) mem.episodes.push({ id: `e${i}`, who: 'A', what: 'x'.repeat(50), feel: 'y'.repeat(30), at: Date.now() - i * 1000 });
  const r = retrieve({ who: 'A', words: [] }, mem);
  assert.ok(r.chars <= 900, `用了 ${r.chars}`);
});

console.log('\n── 情绪 / 意识流 ──');
t('发呆档：能量低', () => assert.equal(flowLevel({ energy: 0.1 }), 0.2));
t('休眠档：睡着', () => assert.equal(flowLevel({ energy: 0.9, sleep: 'asleep' }), 0));
t('幻想档：无聊', () => assert.equal(flowLevel({ energy: 0.9 }, { boredom: 0.8 }), 2));
t('走神档：被打断但有心事', () => assert.equal(flowLevel({ energy: 0.9 }, { interrupted: true, hasOwnThought: true }), 1.5));
t('发癫上限 20%', () => assert.ok(Math.abs(whimProbability(1) - 0.2) < 1e-9));

console.log('\n── 归因（不审批，只贴标签）──');
t('五种归因都能出现', () => {
  const good = { episodes: [{ context: 'c', strategy: 's', outcome: 'good' }], strategies: { s: {} } };
  const bad = { episodes: [{ context: 'c', strategy: 's', outcome: 'bad' }], strategies: { s: {} } };
  assert.equal(attribute({ strategy: 's', context: 'c', supported: true }, good), '有据');
  assert.equal(attribute({ strategy: 'new', context: 'c', supported: true, plausible: true }, good), '即兴');
  assert.equal(attribute({ strategy: 's', context: 'c', supported: false }, good), '硬撑');
  assert.equal(attribute({ strategy: 's', context: 'c', supported: true }, bad), '明知故犯');
  assert.equal(attribute({ strategy: 'z', context: 'q', supported: true, plausible: false }, good), '说不清');
});

t('硬撑优先于有据（状态不支持是这一刻的特征）', () => {
  const good = { episodes: [{ context: 'c', strategy: 's', outcome: 'good' }], strategies: { s: {} } };
  assert.equal(attribute({ strategy: 's', context: 'c', supported: false }, good), '硬撑');
});

t('标签唯一（I8）', () => {
  const good = { episodes: [], strategies: { s: {} } };
  const a = attribute({ strategy: 's', context: 'c', supported: true }, good);
  const again = attribute({ strategy: 's', context: 'c', supported: true }, good);
  assert.equal(a, again);
  assert.ok(LABELS.includes(a));
});

t('拦截只有两条（I7）', () => {
  const ok = intercept({}, {});
  assert.equal(ok.ok, true);
  const c1 = intercept({}, { persona: { allows: () => false } });
  assert.equal(c1.code, 'C1 人设红线');
  const safe = intercept({}, { safety: { allows: () => false } });
  assert.equal(safe.code, 'SAFETY');
});

console.log('\n── 关系 ──');
t('关系里的人无条件进意识', () => {
  const r = createContract('parent', '妈');
  assert.equal(attentionBoost('妈', r), 1);
});

t('关系字段不可漂移（I3）', () => {
  const r = createContract('parent', '妈');
  assert.throws(() => assertContractImmutable({ ctr: { ...r.ctr, mustRecognize: false } }, r));
});

t('父母不能解除，情侣可以', () => {
  assert.equal(canSever(createContract('parent')), false);
  assert.equal(canSever(createContract('partner')), true);
  const p = createContract('partner');
  assert.equal(sever(beginColdWar(p)).status, 'severed');
});

t('解除不删记忆（只改 status）', () => {
  const p = createContract('partner');
  const s = sever(beginColdWar(p));
  assert.equal(s.status, 'severed');
  assert.ok(s.since > 0);
});

console.log('\n── 派生检验（不是查找表）──');
t('100 条人设 → 被吵醒的反应散度 ≥ 20%', () => {
  const list = syntheticTraits(11, 100);
  const uniq = new Set(list.map((tr) => wakeReply(tr, 0.8))).size;
  assert.ok(uniq >= 20, `只有 ${uniq} 种（<20 说明退化成查找表了）`);
});

t('同一条鱼同一状态 → 同一句话（可回放）', () => {
  const tr = b.persona.traits;
  assert.equal(wakeReply(tr, 0.6), wakeReply(tr, 0.6));
});

t('100 条人设 → 风格配方各不相同', () => {
  const list = syntheticTraits(13, 100);
  const uniq = new Set(list.map((tr) => JSON.stringify(styleVector(tr)))).size;
  assert.ok(uniq >= 50, `只有 ${uniq} 种`);
});

console.log('\n── 身体（手机 / 平板 / 电脑）──');
t('三具身体都能造出来', () => {
  for (const kind of BODY_KINDS) {
    const b = createBody({ kind });
    assert.equal(b.kind, kind);
    assert.ok(b.label && b.screen && b.posture);
    assert.ok(b.apps.length > 0);
  }
});

t('借来的手机不能删软件（没有 L3）', () => {
  const b = createBody({ kind: 'phone', ownership: 'borrowed' });
  assert.equal(canDo(b, { capability: CAPABILITY.OPERATE }).ok, true);
  assert.equal(canDo(b, { capability: CAPABILITY.DESTROY }).ok, false);
});

t('自己的电脑能干活也能删东西', () => {
  const b = createBody({ kind: 'desktop', ownership: 'owned' });
  assert.equal(canDo(b, { capability: CAPABILITY.DESTROY }).ok, true);
  assert.equal(canDo(b, { app: 'vscode' }).ok, true);
});

t('花钱是两道门：身体要有 L4，且每次要批准', () => {
  const b = createBody({ kind: 'phone', ownership: 'owned' });
  // 第一道：身体默认没有 L4
  assert.equal(canDo(b, { capability: CAPABILITY.MONEY, approved: true }).code, 'E_NO_PERMISSION');
  // 第二道：就算身体开了 L4，没批准也不行
  const b2 = createBody({ kind: 'phone', ownership: 'owned', scope: [...b.scope, CAPABILITY.MONEY] });
  assert.equal(canDo(b2, { capability: CAPABILITY.MONEY }).code, 'E_NEED_APPROVAL');
  // 两道都过才放行
  assert.equal(canDo(b2, { capability: CAPABILITY.MONEY, approved: true }).ok, true);
});

t('电脑上没有抖音——app 检查生效', () => {
  const b = createBody({ kind: 'desktop' });
  assert.equal(canDo(b, { app: 'douyin' }).ok, false);
  assert.equal(canDo(b, { app: 'browser' }).ok, true);
});

t('没有身体 = 想而不得（不抛异常）', () => {
  const r = canDo(null, {});
  assert.equal(r.ok, false);
  assert.equal(r.code, 'E_NO_BODY');
});

t('不同的鱼会摸出不同的身体', () => {
  const list = syntheticTraits(21, 100);
  const counts = { phone: 0, tablet: 0, desktop: 0 };
  list.forEach((tr, i) => { counts[chooseBody(tr, {}, mulberry32(1000 + i))] += 1; });
  for (const k of BODY_KINDS) assert.ok(counts[k] > 0, `${k} 一次都没被选到：${JSON.stringify(counts)}`);
});

t('同样想刷视频，累的拿平板、有劲的拿手机', () => {
  const lazy = bodyScores({ 好动: 0.2, 心软: 0.9, 理性: 0.2 }, { fatigue: 0.9, energy: 0.2, activity: '刷短视频' });
  const busy = bodyScores({ 好动: 0.9, 心软: 0.2, 理性: 0.9 }, { fatigue: 0.1, energy: 0.9, activity: '刷短视频' });
  assert.ok(lazy.tablet > lazy.desktop, '累的时候该更想拿平板');
  assert.ok(busy.phone > busy.tablet, '有劲的时候该更想摸手机');
});

console.log('\n── 不变量 ──');
t('自检无违规', () => {
  const v = check(brain.ensureBrain(ID));
  assert.equal(v.length, 0, JSON.stringify(v));
});

console.log('\n── 落盘 ──');
t('brain.json 写出来了', () => {
  assert.ok(fs.existsSync(path.join(dir, 'brain.json')));
});

t('audit.jsonl 有出生记录', () => {
  const rows = brain.readAudit(ID, 50);
  assert.ok(rows.some((r) => r.kind === 'birth'));
});

t('observe 后权重变了', () => {
  const u = brain.ensureBrain(ID).persona.units.find((x) => x.kind !== 'identity');
  const before = u.weight;
  for (let i = 0; i < 5; i += 1) {
    brain.observe(ID, { consistent: [u.id], text: u.text, who: '测试' });
  }
  const after = brain.ensureBrain(ID).persona.units.find((x) => x.id === u.id).weight;
  assert.ok(after > before, `${before} → ${after}`);
});

t('wakeLine 能生成注入文本', () => {
  const line = brain.wakeLine(ID, { who: '测试' });
  assert.match(line, /【此刻的她】/);
  assert.ok(line.length > 50);
});

console.log(`\n${'─'.repeat(40)}`);
console.log(`通过 ${pass} 项，失败 ${fails.length} 项`);
if (fails.length) {
  for (const f of fails) console.log(`  ✘ ${f.name}: ${f.msg}`);
  process.exit(1);
}
console.log('全部通过 ✔');
