// 演示：从一张人设卡，长出一条鱼，然后让她活几天。
//
//   node demo.mjs            → 用当前角色卡，id=demo
//   node demo.mjs 辞辞 小鲸鱼  → 指定卡名和 id
//
// 这个脚本会真的写 state/brains/<id>/，可以反复跑（会重置）。

import fs from 'node:fs';
import path from 'node:path';

import { ROOT } from './store.js';
import * as brain from './index.js';
import { styleVector, wakeReply, flowLevel, flowName, whimProbability, applyPatience, isOutburst, mulberry32 } from './core/derive.js';
import { attribute } from './core/attribution.js';
import { syntheticTraits } from './core/invariants.js';
import { settle } from './core/memory.js';

const roleName = process.argv[2] ?? null;
const id = process.argv[3] ?? 'demo';

const line = (s = '') => console.log(s);
const h = (s) => { line(); line(`━━ ${s} ━━`); };

// ── 0. 干净重开 ──────────────────────────────────────────────
const dir = path.join(ROOT, 'state', 'brains', id);
if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });

h(`出生：从 roles/${roleName ?? '<当前角色>'}.md 长出一条鱼`);

const b = brain.birth({ id, relation: 'parent', address: '妈' });

line(`角色卡：${b.roleCard}`);
line(`命题数：${b.persona.units.length}`);
line(`身份命题：${b.persona.units.filter((u) => u.kind === 'identity').length}`);
line();
line('抽出来的特质（从人设卡数出来的，不是配的）：');
for (const [k, v] of Object.entries(b.persona.traits).sort((a, c) => c[1] - a[1])) {
  line(`  ${k.padEnd(4, '　')} ${'█'.repeat(Math.round(v * 20))} ${v.toFixed(2)}`);
}

h('她怎么认识自己（四种方向的份量，不是四个格子）');
const st = b.self.style;
for (const [k, v] of Object.entries(st)) {
  const name = { aware: '知道自己变了', denial: '知道但死不承认', fixed: '坚信没变', naive: '压根没想过' }[k];
  line(`  ${name.padEnd(8, '　')} ${(v * 100).toFixed(1)}%  ${'▓'.repeat(Math.round(v * 30))}`);
}
line(`  → 主导：${b.self.styleName}`);

h('此刻的她（这就是每次唤醒注入的那 300 字）');
line(b.persona.brief);
line();
line(`长度：${b.persona.brief.length} 字`);

// ── 1. 活两天 ────────────────────────────────────────────────
h('活两天：说了一些话，被夸了一次，被怼了一次');

const ranked = b.persona.units
  .filter((u) => u.kind !== 'identity')
  .slice()
  .sort((a, x) => x.weight - a.weight);
const u1 = ranked[0];
const u2 = ranked[1];

line(`初始权重：${u1.id} = ${u1.weight.toFixed(2)}   ${u2.id} = ${u2.weight.toFixed(2)}`);

for (let i = 0; i < 12; i += 1) {
  brain.observe(id, {
    consistent: [u1.id, u2.id],
    text: '你嘴真硬啊，不过说得有意思',
    who: '扶摇',
    what: '说我嘴硬',
    feel: '有点得意',
    emotion: 0.4,
    action: { strategy: '嘴硬顶回去', context: '被怼', supported: true, plausible: true },
    outcome: 'good',
  });
}

const after = brain.ensureBrain(id);
const n1 = after.persona.units.find((u) => u.id === u1.id);
const n2 = after.persona.units.find((u) => u.id === u2.id);
line(`12 次之后：${n1.id} = ${n1.weight.toFixed(2)}（+${(n1.weight - u1.weight).toFixed(2)}）   ${n2.id} = ${n2.weight.toFixed(2)}（+${(n2.weight - u2.weight).toFixed(2)}）`);
line('→ 每次只 +0.01，要 100 次才看得出变化。这就是"不知不觉"。');

h('归因：不审批，只贴标签');
const goodMem = { episodes: [{ context: '被怼', strategy: '嘴硬顶回去', outcome: 'good' }], strategies: { 嘴硬顶回去: {} } };
const badMem = { episodes: [{ context: '被怼', strategy: '嘴硬顶回去', outcome: 'bad' }], strategies: { 嘴硬顶回去: {} } };
const cases = [
  ['她做过，结果好', { strategy: '嘴硬顶回去', context: '被怼', supported: true }, goodMem],
  ['不会，但临场想出来了', { strategy: '装傻岔开', context: '被怼', supported: true, plausible: true }, goodMem],
  ['状态不支持，还是顶了', { strategy: '嘴硬顶回去', context: '吵了一天', supported: false }, goodMem],
  ['知道会输，还是要', { strategy: '嘴硬顶回去', context: '被怼', supported: true }, badMem],
  ['归不到上面任何一类', { strategy: '???', context: '???', supported: true, plausible: false }, goodMem],
];
for (const [note, action, mem] of cases) {
  line(`  ${attribute(action, mem).padEnd(5, '　')} ← ${note}`);
}

// ── 2. 意识流五档 ────────────────────────────────────────────
h('意识流：一条轴五个档位');
const flows = [
  [{ energy: 0.9, sleep: 'awake' }, {}, '平常'],
  [{ energy: 0.9, sleep: 'awake' }, { idleMinutes: 60 }, '太久没人说话'],
  [{ energy: 0.9, sleep: 'awake' }, { boredom: 0.8 }, '无聊'],
  [{ energy: 0.9, sleep: 'awake' }, { interrupted: true, hasOwnThought: true }, '被打断但心里有事'],
  [{ energy: 0.1, sleep: 'awake' }, {}, '没电了'],
  [{ energy: 0.9, sleep: 'asleep' }, {}, '睡着'],
];
for (const [s, c, note] of flows) {
  const lv = flowLevel(s, c);
  line(`  ${String(flowName(lv)).padEnd(4, '　')} ${String(lv).padEnd(4)} ← ${note}`);
}

h('被吵醒说什么：从人设连续生成，不是四个开关');
const t = b.persona.traits;
for (const e of [0.1, 0.4, 0.9]) {
  line(`  能量 ${e}：${wakeReply(t, e)}`);
}
const variants = new Set();
for (let i = 0; i < 12; i += 1) {
  variants.add(wakeReply(t, 0.7, mulberry32(1000 + i)));
}
line(`  → 同一条鱼，12 次不同的随机，说了 ${variants.size} 种：${[...variants].slice(0, 5).map((x) => `「${x}」`).join(' ')}`);
line('  → 组合空间 168 种，权重由她的嘴硬/心软/理性/社交连续算出。');

h('发癫概率');
for (const m of [0, 0.5, 1]) {
  line(`  |情绪| = ${m}  →  P = ${(whimProbability(m) * 100).toFixed(0)}%  ${'▮'.repeat(Math.round(whimProbability(m) * 100 / 4))}`);
}

// ── 3. 忍耐与爆发 ────────────────────────────────────────────
h('忍耐值：一直吵就会骂');
let p = 1;
for (let i = 1; i <= 7; i += 1) {
  p = applyPatience(p, 'woken');
  line(`  第 ${i} 次被吵醒 → 忍耐 ${p.toFixed(2)}  ${isOutburst(p) ? '【爆发】' : ''}`);
}

// ── 4. TTL：忘了就是真的没有 ────────────────────────────────
h('记忆：30 天窗口，提起续命，连续 15 天升级');
const m = {
  episodes: [
    { id: 'e1', at: Date.now(), lastRecall: Date.now() - 40 * 86400000, consecutiveDays: 3, longTerm: false, what: '四十天前的事' },
    { id: 'e2', at: Date.now(), lastRecall: Date.now() - 40 * 86400000, consecutiveDays: 20, longTerm: true, what: '连续被提二十天的事' },
  ],
  imagination: [], facts: {}, impressions: {}, forgotten: [],
};
settle(m);
line(`  40 天没提的：${m.forgotten.some((x) => x.id === 'e1') ? '已遗忘（连想起来都做不到）' : '还在'}`);
line(`  连续被提 20 天的：${m.episodes.some((x) => x.id === 'e2') ? '升级长期，不再衰减' : '被误删'}`);

// ── 5. 派生检验：100 条鱼 ───────────────────────────────────
h('派生检验：100 条不同人设，同一件事');
const traitsList = syntheticTraits(7, 100);
const replies = traitsList.map((tr) => wakeReply(tr, 0.8));
const uniq = new Set(replies).size;
line(`  被吵醒的 100 种反应 → ${uniq} 种不同的说法`);
line(`  样本：${[...new Set(replies)].slice(0, 6).map((x) => `「${x}」`).join(' ')}`);
line(`  散度：${(uniq / 100 * 100).toFixed(0)}%（太低就说明在用查找表）`);

const styles = traitsList.map((tr) => {
  const v = styleVector(tr);
  return `${Math.round(v.aware * 10)}-${Math.round(v.denial * 10)}-${Math.round(v.fixed * 10)}`;
});
line(`  自知配方的组合数：${new Set(styles).size} / 100`);

// ── 6. 自检 ────────────────────────────────────────────────
h('自检（十二条不变量里能跑的部分）');
const snap = brain.snapshot(id);
if (snap.invariants.length === 0) line('  全部通过 ✔');
else for (const v of snap.invariants) line(`  ✘ ${v.id}: ${v.msg}`);

h('快照');
line(JSON.stringify({
  id: snap.id,
  styleName: snap.styleName,
  style: snap.style,
  briefChars: snap.briefChars,
  weights: snap.weights,
  memory: snap.memory,
  observations: snap.observations,
}, null, 2));

line();
line(`数据落在：state/brains/${id}/`);
