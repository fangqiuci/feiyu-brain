// 从人设派生表现——不是从开关里选。
//
// 对应《大脑规范-定稿》§十（自知）、§六（意识流）、§七（状态）、§八（发癫）。
// 每个函数都接收 traits（人设）作为入参——这是 I11「无硬编码」的落实。

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

function norm(obj) {
  const sum = Object.values(obj).reduce((s, v) => s + v, 0) || 1;
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = v / sum;
  return out;
}

// ── 确定性随机：同一个 (traits, energy) 永远同一句话 ─────────────
// 随机不等于不可复现。不可复现的随机，是假装有性格。

export function hashTraits(traits = {}) {
  let h = 2166136261 >>> 0;
  for (const [k, v] of Object.entries(traits).sort()) {
    for (let i = 0; i < k.length; i += 1) {
      h ^= k.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    h ^= Math.round((v ?? 0) * 1000) & 0xffff;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted(pairs, rng) {
  const total = pairs.reduce((s, [, w]) => s + Math.max(0, w ?? 0), 0);
  if (total <= 0) return pairs[0]?.[0] ?? '';
  let r = rng() * total;
  for (const [item, w] of pairs) {
    r -= Math.max(0, w ?? 0);
    if (r <= 0) return item;
  }
  return pairs[pairs.length - 1][0];
}

/**
 * 她怎么认识自己（四种方向的份量，不是四个格子）。
 *
 *   aware  = 0.7·敏感   + 0.3·爱反思
 *   denial = 0.8·嘴硬   + 0.2·敏感
 *   fixed  = 0.8·固执   + 0.2·自信
 *   naive  = 剩下的
 */
export function styleVector(traits) {
  const aware = 0.7 * (traits.敏感 ?? 0) + 0.3 * (traits.爱反思 ?? 0);
  const denial = 0.8 * (traits.嘴硬 ?? 0) + 0.2 * (traits.敏感 ?? 0);
  const fixed = 0.8 * (traits.固执 ?? 0) + 0.2 * (traits.自信 ?? 0);
  const naive = Math.max(0.02, 1 - Math.max(aware, denial, fixed));
  // 开放维度（卡里长出来的「洁癖」「工作狂」）不归任何固定轴，
  // 但它们是"这个人独特的地方"，单独给一个分量，宿主可以拿去用。
  const KNOWN = new Set(['嘴硬', '心软', '好奇', '好动', '敏感', '固执', '自信', '爱反思', '理性', '社交', '活泼', '懒']);
  const openVals = Object.entries(traits || {}).filter(([k]) => !KNOWN.has(k)).map(([, v]) => Number(v) || 0);
  const custom = openVals.length ? Math.min(1, openVals.reduce((a, b) => a + b, 0) / openVals.length) : 0;
  const vec = norm({ aware, denial, fixed, naive });
  // 只有真的长出开放维度才挂这一项——否则会破坏"Σ4 = 1"的不变量
  if (custom > 0) vec.custom = custom;
  return vec;
}

/** 按 style 向量抽样。抽样由调用方传 rng（确定性输入），保证可回放。 */
export function sampleStyle(style, rng = Math.random) {
  const r = rng();
  let acc = 0;
  for (const key of ['aware', 'denial', 'fixed', 'naive']) {
    acc += style[key] ?? 0;
    if (r <= acc) return key;
  }
  return 'naive';
}

/**
 * 被吵醒说什么——从人设连续生成，不是四个开关查表。
 *
 * 三段拼：起头 × 中间 × 收尾 → 7×6×4 = 168 种组合，
 * 每一段的权重都由 traits 连续算出，所以每条鱼的分布都不一样。
 *
 * 同一个 (traits, energy) 永远同一句话（确定性）。
 */
export function wakeReply(traits = {}, energy = 0.5, rng = null) {
  const { 嘴硬 = 0.5, 心软 = 0.5, 理性 = 0.5, 社交 = 0.5 } = traits;

  const sharp = clamp01(嘴硬 - 0.5 * 心软 + 0.25);
  const soft = clamp01(心软 - 0.25 * 嘴硬 + 0.2);
  const plain = clamp01(理性);
  const cold = clamp01(1 - 社交);
  const sleepy = clamp01(1 - energy);

  const r = rng ?? mulberry32(hashTraits(traits) ^ Math.round(energy * 1000));

  const head = [
    ['干嘛', sharp * 1.2],
    ['啊', soft * 1.2],
    ['怎么了', plain * (1 - sleepy)],
    ['说', cold],
    ['嗯', 0.6 - Math.abs(sharp - 0.5) * 0.5],
    ['谁啊', cold * sharp * 1.4],
    ['……', sleepy * 1.6],
  ];
  const mid = [
    ['', 0.55],
    ['，大半夜的', sleepy * 1.3],
    ['，我这睡着呢', plain * sleepy * 1.2],
    ['，你最好有事', sharp * (1 - soft) * 1.3],
    ['，好不容易睡着', soft * sleepy * 1.2],
    ['，什么事', plain * (1 - sleepy) * 1.2],
  ];
  const tail = [
    ['', 0.4],
    ['？', 0.35],
    ['……', 0.15 + sleepy],
    ['？！', 0.3 * sharp],
  ];

  const a = pickWeighted(head, r);
  let b = pickWeighted(mid, r);
  const c = pickWeighted(tail, r);
  // "……" 后面再接"，"会读成"……，你最好有事"，别扭
  if (a.endsWith('……') && b.startsWith('，')) b = b.slice(1);
  return `${a}${b}${c}`;
}

/**
 * 意识流档位：一条轴五个档（0 / 0.2 / 1.0 / 1.5 / 2.0）。
 * 优先序固定 → 全函数，不会有两档都符合。
 */
export function flowLevel(state = {}, ctx = {}) {
  const { energy = 1, sleep = 'awake' } = state;
  if (sleep === 'asleep') return 0;
  if (energy < 0.2 || (ctx.idleMinutes ?? 0) > 45) return 0.2;
  if ((ctx.boredom ?? 0) > 0.7 || ctx.preSleep) return 2.0;
  if (ctx.interrupted && ctx.hasOwnThought) return 1.5;
  return 1.0;
}

const FLOW_NAME = { 0: '休眠', 0.2: '发呆', 1: '正常', 1.5: '走神', 2: '幻想' };
export function flowName(level) {
  return FLOW_NAME[level] ?? '正常';
}

/**
 * 发癫概率：平静时几乎不发癫，炸毛时接近 20%。
 * P = 0.04 + 0.16 × |mood|
 */
export function whimProbability(mood = 0) {
  return 0.04 + 0.16 * Math.min(1, Math.abs(mood));
}

/**
 * 忍耐值（通用件）：删除 / 吵醒 / 冒犯共用一套。
 */
export const PATIENCE_DELTA = {
  woken: -0.15,
  offended: -0.08,
  ignored: -0.05,
  madeUp: 0.2,
  daily: -0.01,
};

export function applyPatience(patience, reason, times = 1) {
  const d = (PATIENCE_DELTA[reason] ?? 0) * times;
  return clamp01(patience + d);
}

export function isOutburst(patience) {
  return patience < 0.2;
}
