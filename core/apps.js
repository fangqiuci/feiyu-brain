// 平台记忆：她在每个平台上看过什么、喜欢什么、上次停在哪。
//
// 这一层是"闭环"的下半截：
//
//   用户写的卡 → 决定先看什么 → 刷到 → 有反应 → 人设被改 → 口味变 → 刷的不一样
//        ↑                                                              │
//        └──────────────────── 下一轮还是从人设出发 ────────────────────┘
//
// 所以这里有两套数：
//   · 先验 priorTaste(traits)  —— 从**当前**人设算，人设变了它立刻跟着变
//   · 后验 seen[].reaction     —— 她真的刷过、真的有反应
//   合起来 effectiveTaste()，再拿去 chooseContent()。
//
// 关键：人设是变量。新鱼的人格是用户写死的；刷得多了，traits 会被 nudgeTraits()
// 一点点改，于是下一次她爱看的东西就不一样了。

export const SEEN_MAX = 200;
export const TASTE_STEP = 0.05;
export const TRAIT_NUDGE = 0.004; // 每刷一条，特质最多动这么多

function clamp1(n) {
  return Math.max(-1, Math.min(1, n));
}
function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

/** 内容类型 ↔ 特质：谁爱看什么。这是"人设决定口味"的那张表。 */
export const AFFINITY = {
  解压: { 懒: 0.8, 理性: 0.3, 好动: -0.3 },
  搞笑: { 活泼: 0.9, 嘴硬: 0.4, 好奇: 0.3 },
  动物: { 心软: 0.9, 活泼: 0.3 },
  做饭: { 心软: 0.5, 懒: 0.4 },
  游戏: { 好动: 0.8, 好奇: 0.4 },
  科技: { 好奇: 0.9, 理性: 0.6 },
  情感: { 心软: 0.7, 敏感: 0.8 },
  历史: { 理性: 0.7, 好奇: 0.5 },
  离谱新闻: { 好奇: 0.6, 活泼: 0.4, 敏感: 0.2 },
  带货: { 理性: -0.6, 懒: -0.3 },
};

/**
 * 刷这类内容会把她变成什么样。
 *
 * 跟 AFFINITY 不是同一张表——AFFINITY 是"什么样的人爱看什么"（选片用），
 * NUDGE 是"看了会变成什么样"（改人设用）。混用会出事：
 * 解压类里带 0.3 的"理性"权重，如果拿去做 nudge，看 100 条解压视频她会变理性——
 * 这不对。看得多只会更懒。
 */
export const NUDGE = {
  解压: { 懒: 1.0, 好动: -0.6 },
  搞笑: { 活泼: 1.0, 嘴硬: 0.4 },
  动物: { 心软: 1.0 },
  做饭: { 心软: 0.5, 懒: 0.5 },
  游戏: { 好动: 1.0, 好奇: 0.3 },
  科技: { 好奇: 0.8, 理性: 0.5 },
  情感: { 敏感: 1.0, 心软: 0.5 },
  历史: { 理性: 0.8, 好奇: 0.4 },
  离谱新闻: { 好奇: 0.8, 活泼: 0.4 },
  带货: { 理性: -0.6 },
};

/** 平台 ↔ 特质：她会先摸哪个 App。 */
export const APP_AFFINITY = {
  douyin: { 好动: 0.7, 活泼: 0.6, 懒: 0.3 },
  bilibili: { 好奇: 0.6, 理性: 0.5, 懒: 0.4 },
  qq: { 社交: 0.8, 活泼: 0.3 },
  wechat: { 社交: 0.7, 心软: 0.4 },
  kuaishou: { 活泼: 0.5, 好动: 0.5 },
  weibo: { 好奇: 0.5, 活泼: 0.4, 敏感: 0.3 },
};

export function emptyApps() {
  return {};
}

/**
 * 从**当前**人设推出先验口味。
 * 注意：每次调用都按最新的 traits 算——所以人设一漂，口味立刻跟着漂。
 */
export function priorTaste(traits = {}) {
  const out = {};
  for (const [kind, weights] of Object.entries(AFFINITY)) {
    let score = 0;
    for (const [trait, w] of Object.entries(weights)) {
      score += (traits[trait] ?? 0.5) * w;
    }
    out[kind] = clamp1(score / 2);
  }
  return out;
}

/** 先验 + 经历 → 她"现在"的口味。人设占七成，刷出来的占三成。 */
export function effectiveTaste(memory, app, traits = {}) {
  const prior = priorTaste(traits);
  const learned = memory?.apps?.[app]?.taste ?? {};
  const out = {};
  for (const kind of new Set([...Object.keys(prior), ...Object.keys(learned)])) {
    out[kind] = clamp1((prior[kind] ?? 0) * 0.7 + (learned[kind] ?? 0) * 0.3);
  }
  return out;
}

/**
 * 刷到一条内容，反过来改人设。
 *
 * 这就是用户说的"人设是因为刷了视频才慢慢变的"：
 * 看了 100 条解压视频，她"懒"的那条特质就真的涨了一点。
 *
 * @returns {{traits:object, delta:object}} 新的 traits 和各特质变化量
 */
export function nudgeTraits(traits = {}, kind = '', reaction = 0) {
  const aff = NUDGE[kind];
  if (!aff || !reaction) return { traits, delta: {} };
  const next = { ...traits };
  const delta = {};
  for (const [trait, w] of Object.entries(aff)) {
    const d = clamp1(reaction) * w * TRAIT_NUDGE;
    if (!d) continue;
    const before = next[trait] ?? 0.5;
    next[trait] = clamp01(before + d);
    delta[trait] = Number((next[trait] - before).toFixed(4));
  }
  return { traits: next, delta };
}

/** 取某个平台的桶（没有就建） */
export function appBucket(memory, app) {
  const name = String(app || '').trim();
  if (!name) return null;
  if (!memory.apps) memory.apps = {};
  if (!memory.apps[name]) {
    memory.apps[name] = { minutes: 0, seen: [], taste: {}, lastLeft: null, firstAt: Date.now(), lastAt: 0 };
  }
  return memory.apps[name];
}

/**
 * 记一条"她在某平台看到了什么"。
 *
 * @param {object} memory
 * @param {string} app      平台名：douyin / bilibili / wechat / qq / kuaishou / 任意
 * @param {object} item
 * @param {string} item.title     看到的东西
 * @param {string} [item.kind]    类型（解压/搞笑/做饭…），决定口味
 * @param {number} [item.reaction] 她的反应，-1 ~ 1
 * @param {number} [item.minutes]  这次待了多久
 */
export function recordSeen(memory, app, item = {}) {
  const b = appBucket(memory, app);
  if (!b) return null;

  const at = Date.now();
  const entry = {
    at,
    title: String(item.title ?? '').slice(0, 80),
    kind: String(item.kind ?? ''),
    reaction: Number.isFinite(item.reaction) ? clamp1(item.reaction) : 0,
  };
  b.seen.push(entry);
  if (b.seen.length > SEEN_MAX) b.seen.splice(0, b.seen.length - SEEN_MAX);

  if (entry.kind && entry.reaction !== 0) {
    b.taste[entry.kind] = clamp1((b.taste[entry.kind] ?? 0) + TASTE_STEP * entry.reaction);
  }

  b.minutes = Number(b.minutes ?? 0) + Math.max(0, Number(item.minutes) || 0);
  b.lastAt = at;
  b.lastLeft = { at, item: entry.title, kind: entry.kind };
  return entry;
}

/** 她在某平台最喜欢什么（传 traits 就按当前人设算，不传就看纯经历） */
export function appTaste(memory, app, { limit = 5, traits = null } = {}) {
  const b = memory?.apps?.[app];
  if (!b) return [];
  const table = traits ? effectiveTaste(memory, app, traits) : (b.taste ?? {});
  return Object.entries(table)
    .sort((a, z) => z[1] - a[1])
    .slice(0, limit)
    .map(([kind, score]) => ({ kind, score: Number(score.toFixed(2)) }));
}

/** 某平台最近的印象（新的在前） */
export function recallApp(memory, app, { limit = 5 } = {}) {
  const b = memory?.apps?.[app];
  if (!b) return [];
  return b.seen.slice(-limit).reverse();
}

/**
 * 她此刻会更想刷哪个 App —— 由当前人设算。
 * 换了卡、或者刷久了人设变了，摸出来的 App 就不一样。
 */
export function chooseApp(traits = {}, rng = Math.random) {
  const scores = {};
  for (const [app, weights] of Object.entries(APP_AFFINITY)) {
    let s = 0;
    for (const [trait, w] of Object.entries(weights)) s += (traits[trait] ?? 0.5) * w;
    scores[app] = Math.max(0, s);
  }
  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  if (total <= 0) return 'douyin';
  let r = rng() * total;
  for (const [app, s] of Object.entries(scores)) {
    r -= s;
    if (r <= 0) return app;
  }
  return 'douyin';
}

/**
 * 从那批内容里挑一条她想看的。
 *
 * pool = [{ title, kind }]
 * 权重 = 当前口味（先验 0.7 + 经历 0.3），负分也能抽，只是概率低。
 */
export function chooseContent(traits = {}, memory = null, app = '', pool = [], rng = Math.random) {
  if (!Array.isArray(pool) || !pool.length) return null;
  const taste = memory ? effectiveTaste(memory, app, traits) : priorTaste(traits);
  const weighted = pool.map((item) => {
    const kind = String(item.kind ?? '');
    const t = taste[kind] ?? 0;
    return { item, w: Math.max(0.02, t + 0.8) }; // 再不喜欢也有 2% 概率，别锁死
  });
  const total = weighted.reduce((a, b) => a + b.w, 0);
  let r = rng() * total;
  for (const { item, w } of weighted) {
    r -= w;
    if (r <= 0) return item;
  }
  return weighted[weighted.length - 1].item;
}

/** 她在这件事上"见过类似的吗"——跨平台找最接近的标题 */
export function similarSeen(memory, text, { limit = 3 } = {}) {
  const q = String(text ?? '').trim();
  if (!q) return [];
  const hits = [];
  for (const [app, b] of Object.entries(memory?.apps ?? {})) {
    for (const item of b.seen ?? []) {
      if (!item.title) continue;
      const overlap = bigramOverlap(q, item.title);
      if (overlap >= 0.3) hits.push({ app, ...item, score: overlap });
    }
  }
  return hits.sort((a, z) => z.score - a.score || z.at - a.at).slice(0, limit);
}

function bigrams(s) {
  const clean = String(s).replace(/[\s，。；、！？,.!?;:"'（）()【】\[\]]/g, '');
  const set = new Set();
  for (let i = 0; i < clean.length - 1; i += 1) set.add(clean.slice(i, i + 2));
  return set;
}

function bigramOverlap(a, b) {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const g of A) if (B.has(g)) n += 1;
  return n / Math.min(A.size, B.size);
}

/** 一页摘要：每个平台刷了多久、最爱什么、最后停在什么 */
export function appSummary(memory, traits = null) {
  const out = {};
  for (const [app, b] of Object.entries(memory?.apps ?? {})) {
    out[app] = {
      seen: (b.seen ?? []).length,
      minutes: Math.round(b.minutes ?? 0),
      favorite: appTaste(memory, app, { limit: 2, traits }),
      lastLeft: b.lastLeft?.item ?? null,
      lastAt: b.lastAt ?? null,
    };
  }
  return out;
}
