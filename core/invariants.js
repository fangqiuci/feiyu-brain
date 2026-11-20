// 十二条不变量的运行时检查。
//
// 对应《逻辑内核-定稿》§二。
// 失败不是警告，是非法状态：回滚 + 告警 + 落 audit。

import { styleVector } from './derive.js';
import { LABELS, BLOCK } from './attribution.js';

export const INVARIANT_IDS = [
  'I1 人设唯一', 'I2 身份恒等', 'I3 关系恒等', 'I4 写入权限',
  'I5 维度隔离', 'I6 幻想隔离', 'I7 拦截唯一', 'I8 归因唯一',
  'I9 状态不绑情绪', 'I10 内心不外显', 'I11 无硬编码', 'I12 可回放',
];

/**
 * 能静态/运行时验证的部分全部验证。
 * 返回 violations 数组；空数组 = 合法。
 */
export function check(brain, ctx = {}) {
  const v = [];
  const add = (id, msg) => v.push({ id, msg });

  const units = brain?.persona?.units ?? [];

  // I1 人设唯一
  if (!Array.isArray(brain?.persona?.units)) add('I1 人设唯一', 'units 必须是数组');

  // I2 身份恒等
  for (const u of units) {
    if (u.kind === 'identity' && u.weight !== 1) add('I2 身份恒等', `${u.id} 权重 ${u.weight}`);
  }

  // Σ1 权重范围
  for (const u of units) {
    if (!(u.weight > 0 && u.weight <= 1)) add('Σ1 权重范围', `${u.id} = ${u.weight}`);
  }

  // I3 关系恒等（与上一份快照比）
  if (ctx.prevRelation && brain?.relation) {
    for (const k of ['mustRecognize', 'dissolvable', 'priority']) {
      if (brain.relation.ctr?.[k] !== ctx.prevRelation.ctr?.[k]) {
        add('I3 关系恒等', `ctr.${k} 被改了`);
      }
    }
  }

  // I6 幻想隔离
  const imagIds = new Set((brain?.memory?.imagination ?? []).map((i) => i.id));
  for (const e of brain?.memory?.episodes ?? []) {
    if (imagIds.has(e.id)) add('I6 幻想隔离', `${e.id} 同时出现在两个池子`);
  }
  for (const i of brain?.memory?.imagination ?? []) {
    if (i.isReal !== false) add('I6 幻想隔离', `${i.id} 被标成真实的`);
  }

  // I7 拦截唯一
  const blocks = ctx.blocks ?? [];
  for (const b of blocks) {
    if (b !== BLOCK.C1 && b !== BLOCK.SAFETY) add('I7 拦截唯一', `出现了第三种拦截：${b}`);
  }

  // I8 归因唯一
  for (const label of ctx.labels ?? []) {
    if (!LABELS.includes(label)) add('I8 归因唯一', `未知标签 ${label}`);
  }

  // Σ4 风格向量归一
  const style = brain?.self?.style;
  if (style) {
    const sum = Object.values(style).reduce((s, x) => s + x, 0);
    if (Math.abs(sum - 1) > 1e-6) add('Σ4 风格归一', `sum = ${sum}`);
    for (const [k, val] of Object.entries(style)) {
      if (!(val > 0)) add('Σ4 风格归一', `${k} = ${val}（每项必须 > 0）`);
    }
  }

  // I11 无硬编码：每个生成器必须接收 persona/traits
  for (const g of ctx.generators ?? []) {
    const src = String(g);
    if (!/persona|traits/.test(src)) add('I11 无硬编码', `${g.name || 'anonymous'} 没有接收人设`);
  }

  return v;
}

/** 派生检验：100 条随机人设跑同一情境，看输出散度。散度太低 = 在用查找表。 */
export function derivationSpread(traitsList, fn) {
  const outs = traitsList.map((t) => fn(t));
  const uniq = new Set(outs).size;
  return { total: outs.length, unique: uniq, ratio: uniq / outs.length, samples: outs.slice(0, 8) };
}

/** 造一批假人设，用于派生检验。 */
export function syntheticTraits(seed = 1, n = 100) {
  let s = seed >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
  const keys = ['嘴硬', '心软', '好奇', '好动', '敏感', '固执', '自信', '爱反思', '理性', '社交'];
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const t = {};
    for (const k of keys) t[k] = 0.15 + rand() * 0.85;
    out.push(t);
  }
  return out;
}

export { styleVector };
