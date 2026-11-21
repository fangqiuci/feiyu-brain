// 记忆：30 天窗口，提起续命，连续 15 天升级长期。
//
// 对应《大脑规范-定稿》§三 与《逻辑内核-定稿》§3.4 / §3.5。
// 核心：忘了就是真的没有（不是"想不起来"）。

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 记忆的三段生命周期（参数按需求定死）：
 *
 *   完整记忆 ──21 天没人提──→ 记忆卡片 ──2 年没人提──→ 遗忘
 *      ↑                        ↑ 有人提：+30 天
 *      └────────────────────────┘ 连续提 15 天：升级长期记忆（2 年）
 *                                             长期到期 → 降回卡片，重新走一圈
 *
 * 计时全部是「多久没人提」，不是「存了多久」。
 * 每条记忆上挂一个 `expiresAt`（绝对时间），到期就往下走一级。
 */
export const FULL_DAYS = 21;        // 完整记忆能躺多久
export const CARD_DAYS = 730;       // 卡片能躺多久（2 年）
export const LONG_DAYS = 730;       // 长期记忆能躺多久（2 年）
export const EXTEND_DAYS = 30;      // 被提一次，卡片续命多少天
export const PROMOTE_DAYS = 15;     // 连续提这么多天 → 长期

/** 兼容旧名字 */
export const COMPRESS_DAYS = FULL_DAYS;
export const FORGET_DAYS = CARD_DAYS;

export const TTL_DAYS = { episode: CARD_DAYS, impression: CARD_DAYS, imagination: CARD_DAYS, card: CARD_DAYS, fact: Infinity, taste: Infinity };

export const RETRIEVE_BUDGET_CHARS = 900; // ≈800 token（中文约 1.1~1.3 字/token）
export const CARD_THRESHOLD_CHARS = 6000;  // 上下文超过这个数就该压卡片
export const CARD_MAX_CHARS = 160;

/** 兼容老名字 */
export const TTL_COMPRESS_DAYS = FULL_DAYS;

/* ── 记忆层级：纲比细节活得久 ─────────────────────────────────
 *
 *   细节（episode）→ 卡片（card）→ **纲（gist）**
 *
 * 人记不住小学每节课，但知道"我上过小学"。
 * 那个"知道"就是纲——它不该跟细节一起烂掉。
 *
 * 纲是**提炼**出来的，不是人写的：
 *   · 人物纲：跟某人聊够 N 次 → 一条"认识他"的纲
 *   · 主题纲：同一个话题反复出现 → 一条"这事发生过 N 次"的纲
 *
 * 纲永不老化（但会随新事实更新文案）。
 */

export const GIST_MIN_COUNT = 3;
/** 多久没提就把名字降级成"有个认识的" */
export const NAME_FADE_DAYS = 1095; // 3 年

function dayStr(ms) {
  if (!ms) return '';
  try { return new Date(ms).toISOString().slice(0, 10); } catch { return ''; }
}

/**
 * 提炼纲。幂等：同一主题只会有一条，文案随次数更新。
 */
export function distillGists(memory, now = Date.now(), { minCount = GIST_MIN_COUNT } = {}) {
  const gists = new Map((memory.gists ?? []).map((g) => [g.id, g]));

  // ① 人物纲：聊够次数的人，不能因为细节烂掉就"查无此人"
  for (const [who, im] of Object.entries(memory.impressions ?? {})) {
    const count = Number(im.count ?? 0);
    if (!who || count < minCount) continue;
    const id = `g_person_${who}`;
    const stale = now - Number(im.lastAt ?? 0) > NAME_FADE_DAYS * DAY_MS;
    gists.set(id, {
      id,
      kind: 'gist',
      topic: 'person',
      who,
      text: stale
        ? `有个认识的（${who}），聊过 ${count} 次，最后一次是 ${dayStr(im.lastAt)}——名字有点想不起来了`
        : `${who}：认识，聊过 ${count} 次，最近一次 ${dayStr(im.lastAt)}`,
      count,
      lastAt: Number(im.lastAt ?? 0),
      at: gists.get(id)?.at ?? now,
    });
  }

  // ② 主题纲：反复出现的词，从卡片和细节里提炼
  //    只认"实词"——含虚词的二元组（「了上」「的第」「学的」）一律不要
  const FUNC = new Set('的了是我你他她它这那就都也还很不在有和与或但而并没被把给对从到为着过吗呢吧啊呀嘛哦嗯一个些么什怎样'.split(''));
  const isRealWord = (g) => g.length === 2 && !FUNC.has(g[0]) && !FUNC.has(g[1]) && !STOP_GRAMS.has(g);

  const df = new Map();   // 出现在多少条不同经历里
  const days = new Map(); // 横跨多少天（同一天刷十遍不算"反复出现的主题"）
  for (const e of [...(memory.episodes ?? []), ...(memory.cards ?? [])]) {
    const t = String(e.what ?? e.text ?? '');
    if (t.length < 4) continue;
    const day = dayStr(e.at ?? e.cardedAt ?? now);
    const seen = new Set();
    for (const g of bigrams(t)) {
      if (!isRealWord(g) || seen.has(g)) continue;
      seen.add(g);
      df.set(g, (df.get(g) ?? 0) + 1);
      if (!days.has(g)) days.set(g, new Set());
      days.get(g).add(day);
    }
  }
  // 要同时满足：出现够多次 + 横跨至少两天。跨天是关键——同一天重复是刷屏，不是主题。
  const topics = [...df.entries()]
    .filter(([g, n]) => n >= minCount && (days.get(g)?.size ?? 0) >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2);

  // 主题的时间跨度：横跨半年以上才可能长成"伞"
  const spanOf = (g) => {
    let first = Infinity;
    let last = 0;
    for (const e of [...(memory.episodes ?? []), ...(memory.cards ?? [])]) {
      const t = String(e.what ?? e.text ?? '');
      if (!t.includes(g)) continue;
      const at = Number(e.at ?? e.cardedAt ?? 0);
      if (!at) continue;
      if (at < first) first = at;
      if (at > last) last = at;
    }
    if (!Number.isFinite(first)) return { firstAt: 0, lastAt: 0, spanDays: 0 };
    return { firstAt: first, lastAt: last, spanDays: Math.round((last - first) / DAY_MS) };
  };
  for (const [word, n] of topics) {
    const id = `g_topic_${word}`;
    const span = spanOf(word);
    gists.set(id, {
      id,
      kind: 'gist',
      topic: 'theme',
      keyword: word,
      text: `「${word}」这件事，前后出现过 ${n} 次`,
      count: n,
      firstAt: span.firstAt,
      lastAt: span.lastAt,
      spanDays: span.spanDays,
      at: gists.get(id)?.at ?? now,
    });
  }
  // 已经不成立的主题纲要清掉（比如旧话题再没出现）
  for (const [id, g] of gists) {
    if (g.topic === 'theme' && !topics.some(([w]) => `g_topic_${w}` === id)) gists.delete(id);
  }

  memory.gists = [...gists.values()];
  return memory.gists.length;
}

/** 名字还能不能想起来 */
export function nameFaded(impression, now = Date.now()) {
  if (!impression) return true;
  return now - Number(impression.lastAt ?? 0) > NAME_FADE_DAYS * DAY_MS;
}

/* ── 伞：纲之上那一层，不可再分 ───────────────────────────────
 *
 *   细节 → 卡片 → 纲 → **伞**
 *
 * 纲是"这事出现过 5 次"，伞是"我上过学""扶摇是我熟人"。
 * 伞不记次数、不记日期，只记**结构**——它是你介绍自己时说的那种话。
 *
 * 什么时候长出来：
 *   · 一个主题横跨半年以上、反复出现 → 它已经是你人生的一段
 *   · 一个人聊过十次以上 → 他已经在你生活里
 */

export const UMBRELLA_MIN_SPAN_DAYS = 180;
export const UMBRELLA_MIN_PERSON_COUNT = 10;
export const UMBRELLA_MAX = 24;

function ym(ms) {
  if (!ms) return '';
  try { return new Date(ms).toISOString().slice(0, 7); } catch { return ''; }
}

/**
 * 从已有的纲提炼伞。幂等，重复调用不会重复长。
 */
export function distillUmbrellas(memory, now = Date.now()) {
  const umbrellas = new Map((memory.umbrellas ?? []).map((u) => [u.id, u]));

  for (const g of memory.gists ?? []) {
    if (g.topic === 'person') {
      if ((g.count ?? 0) < UMBRELLA_MIN_PERSON_COUNT) continue;
      const id = `u_person_${g.who}`;
      umbrellas.set(id, {
        id,
        kind: 'umbrella',
        topic: 'person',
        who: g.who,
        text: `${g.who}：一直在的人`,
        at: umbrellas.get(id)?.at ?? now,
      });
      continue;
    }

    if (g.topic === 'theme' || g.topic === 'model') {
      const span = Number(g.spanDays ?? 0);
      const count = Number(g.count ?? 0);
      if (span < UMBRELLA_MIN_SPAN_DAYS && g.topic !== 'model') continue;
      if (count < 6 && g.topic !== 'model') continue;
      const id = `u_theme_${g.keyword ?? g.id}`;
      const from = ym(g.firstAt);
      const to = ym(g.lastAt);
      umbrellas.set(id, {
        id,
        kind: 'umbrella',
        topic: 'theme',
        keyword: g.keyword ?? '',
        text: from && to && from !== to
          ? `「${g.keyword}」：${from} 到 ${to} 之间的事，前后 ${count} 次`
          : `「${g.keyword}」：我人生里有过这么一段`,
        at: umbrellas.get(id)?.at ?? now,
      });
    }
  }

  // 数量封顶：伞是"介绍自己"，不该有几十条
  memory.umbrellas = [...umbrellas.values()].slice(-UMBRELLA_MAX);
  return memory.umbrellas.length;
}

/** 21 天内同一个话题出现这么多次 → 判定为重要 */
export const IMPORTANT_REPEAT = 3;
export const IMPORTANT_WINDOW_DAYS = 21;
/** 相似度下限（换说法也算同一件事，所以不能太高） */
export const IMPORTANT_SIM = 0.3;

function bigrams(s) {
  const clean = String(s ?? '').replace(/[\s，。；、！？,.!?;:"'（）()【】\[\]「」]/g, '');
  const set = new Set();
  for (let i = 0; i < clean.length - 1; i += 1) set.add(clean.slice(i, i + 2));
  return set;
}

/** 两句话像不像（0~1） */
export function textSimilarity(a, b) {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const g of A) if (B.has(g)) n += 1;
  return n / Math.min(A.size, B.size);
}

/** 虚词二元组：它们重合说明不了"同一件事" */
const STOP_GRAMS = new Set([
  '什么', '这个', '那个', '一下', '可以', '就是', '然后', '现在', '今天', '真的',
  '不是', '没有', '一个', '我们', '你们', '他们', '怎么', '为什么', '知道', '觉得',
  '时候', '已经', '还是', '但是', '因为', '所以', '如果', '这样', '那样', '可以',
]);

function topicGrams(s) {
  const out = [];
  for (const g of bigrams(s)) if (!STOP_GRAMS.has(g)) out.push(g);
  return out;
}

/**
 * 是不是同一件事。
 *
 * 不要求一字不差——「辞辞，该上学了」和「辞辞 快去上学」算同一件事，
 * 因为它们共享「辞辞」「上学」两个实词二元组。
 */
export function sameTopic(a, b, { minShared = 2, minSim = 0.3 } = {}) {
  if (textSimilarity(a, b) < minSim) return false;
  const A = topicGrams(a);
  const B = new Set(topicGrams(b));
  let shared = 0;
  const used = new Set();
  for (const g of A) {
    if (B.has(g) && !used.has(g)) { shared += 1; used.add(g); }
  }
  return shared >= minShared;
}

/**
 * 噪声过滤：刷屏、纯表情、太短的都不算"反复提起"。
 *
 * 喊名字、让你去上学、反复交代的事 —— 这些是有内容的重复；
 * "哈哈哈哈"×20 条不是。
 */
export function isRepeatNoise(text) {
  const t = String(text ?? '').trim();
  if (t.length < 4) return true;                       // 太短
  const content = t.replace(/[\s\p{P}\p{S}\p{Emoji_Presentation}]/gu, '');
  if (content.length < 3) return true;                 // 纯符号/表情
  if (/^(哈|嘿|嗯|哦|啊|草|好|在){2,}$/u.test(content)) return true; // 单字刷屏
  return false;
}

/**
 * 这件事最近是不是被反复提过。
 *
 * 只统计"有内容、不是刷屏"的重复；同一个人 60 秒内的连发只算一次。
 *
 * @returns {{important:boolean, count:number, who:string, sample:string}}
 */
export function detectRepeat(memory, { who = '', what = '' } = {}, now = Date.now(), {
  repeat = IMPORTANT_REPEAT, windowDays = IMPORTANT_WINDOW_DAYS, sim = IMPORTANT_SIM,
} = {}) {
  const text = String(what ?? '').trim();
  if (!text || isRepeatNoise(text)) return { important: false, count: 0, who, sample: '' };

  const since = now - windowDays * DAY_MS;
  const hits = [];
  for (const e of memory.episodes ?? []) {
    if ((e.at ?? 0) < since) continue;
    if (who && e.who && e.who !== who) continue;      // 不同人说的同一句话，不算同一件事
    if (isRepeatNoise(e.what)) continue;
    if (sameTopic(text, e.what, { minSim: sim })) hits.push(e);
  }

  // 防刷屏：同一人 60 秒内**一字不差**的连发只算一次。
  // 但换个说法地反复交代（「该上学了」「快去上学」「要迟到了」）要算——
  // 那恰恰是"重要"的信号，不是噪声。
  const distinct = [];
  for (const h of hits.sort((a, b) => (a.at ?? 0) - (b.at ?? 0))) {
    const dup = distinct.some((d) => d.who === h.who
      && Math.abs((d.at ?? 0) - (h.at ?? 0)) < 60000
      && textSimilarity(d.what, h.what) > 0.9);
    if (!dup) distinct.push(h);
  }

  const count = distinct.length + 1; // + 这次自己
  return {
    important: count >= repeat,
    count,
    who,
    sample: distinct[0]?.what ?? text,
  };
}

/** 把一条经历标成重要（永不压扁、永不遗忘） */
export function markImportant(memory, id, now = Date.now()) {
  let n = 0;
  memory.episodes = (memory.episodes ?? []).map((e) => {
    if (e.id !== id) return e;
    n += 1;
    return { ...e, important: true, longTerm: true, compressed: false, expiresAt: now + LONG_DAYS * DAY_MS };
  });
  return n;
}

/**
 * 追溯标记：这件事一旦被判定为重要，**之前提过的同话题也一并转重要**。
 *
 * 不然会出现"第 3 次才记住，前两次已经被压成卡片"的割裂。
 */
export function markImportantByTopic(memory, { who = '', what = '' } = {}, now = Date.now(), { sim = IMPORTANT_SIM } = {}) {
  let n = 0;
  const text = String(what ?? '').trim();
  if (!text) return 0;
  memory.episodes = (memory.episodes ?? []).map((e) => {
    if (e.important) return e;
    if (who && e.who && e.who !== who) return e;
    if (!sameTopic(text, e.what, { minSim: sim })) return e;
    n += 1;
    return { ...e, important: true, longTerm: true, compressed: false, expiresAt: now + LONG_DAYS * DAY_MS };
  });
  return n;
}

export function emptyMemory() {
  return {
    facts: {},        // key → { text, kind:'fact', weight, lastRecall, consecutiveDays, longTerm }
    taste: {},        // key → score（她的口味：解压 0.9 / 带货 -0.8）
    impressions: {},  // name → { traits:[], count, lastAt, kind:'impression', ... }
    apps: {},         // 平台记忆：douyin / bilibili / wechat / qq / … 各一桶
    episodes: [],     // { id, at, who, what, feel, outcome, context, strategy, kind:'episode' }
    imagination: [],  // 幻想：永不进 episodes（I6）
    cards: [],        // 记忆卡片：上下文过长时的中段锚点
    gists: [],        // 纲：从细节/卡片提炼出的一层，永不老化
    umbrellas: [],    // 伞：纲之上那一层，不可再分（"我上过学""他是我熟人"）
    concepts: {},     // 概念：什么是什么 + 为什么要这么做（有人教才会）
    bonds: {},        // 恩情：谁对我好（主人不走这套，他的位置是焊死的）
    formerSelves: [], // 蜕下来的皮
    forgotten: [],    // 真的忘了
    pending: [],      // 想说没说的
    strategies: {},   // 她会什么（归因用）
  };
}

export function addEpisode(memory, episode, now = Date.now()) {
  const e = {
    id: episode.id ?? `ep_${now}_${memory.episodes.length}`,
    kind: 'episode',
    at: now,
    lastRecall: now,
    // 完整期到什么时候结束 —— 到期才压扁，不是一存进来就开始老
    expiresAt: now + FULL_DAYS * DAY_MS,
    consecutiveDays: 1,
    longTerm: false,
    ...episode,
  };
  memory.episodes.push(e);
  return e;
}

/** 幻想：单独的池子，永不进 episodes。 */
export function addImagination(memory, thought, now = Date.now()) {
  const t = {
    id: thought.id ?? `im_${now}_${memory.imagination.length}`,
    kind: 'imagination',
    at: now,
    lastRecall: now,
    consecutiveDays: 1,
    longTerm: false,
    isReal: false, // 永久标记
    ...thought,
  };
  memory.imagination.push(t);
  return t;
}

/**
 * 上下文过长时，把最旧的那段压成一张卡片。
 *
 * 卡片 = { 时间, 在场的人, 聊了什么, 她什么感受, 没说完的事 }，≈160 字。
 * 原文可以裁掉，卡片留在上下文里——**长对话不爆靠的是压缩，不是截断**。
 */
export function shouldCompact(chars, { threshold = CARD_THRESHOLD_CHARS } = {}) {
  return Number(chars) > threshold;
}

export function makeCard(episodes = [], { maxChars = CARD_MAX_CHARS, now = Date.now() } = {}) {
  const list = episodes.filter(Boolean).slice(-12);
  if (!list.length) return null;

  const who = [...new Set(list.map((e) => e.who).filter(Boolean))].slice(0, 3);
  const feels = [...new Set(list.map((e) => e.feel).filter(Boolean))].slice(0, 2);
  const topics = list.map((e) => String(e.what ?? '').trim()).filter(Boolean);

  const summary = [];
  if (who.length) summary.push(`跟${who.join('、')}`);
  if (topics.length) {
    const head = topics[0].slice(0, 24);
    const tail = topics.length > 1 ? topics[topics.length - 1].slice(0, 24) : '';
    summary.push(tail ? `聊了「${head}」到「${tail}」` : `聊了「${head}」`);
  }
  if (feels.length) summary.push(`我当时${feels.join('、')}`);

  const open = list.filter((e) => e.open).map((e) => String(e.what).slice(0, 20));
  if (open.length) summary.push(`还没说完：${open.slice(0, 2).join('、')}`);

  const text = summary.join('，').slice(0, maxChars);
  return {
    id: `card_${now}`,
    kind: 'card',
    at: now,
    lastRecall: now,
    consecutiveDays: 1,
    longTerm: false,
    from: list.map((e) => e.id).filter(Boolean),
    who,
    text,
    chars: text.length,
  };
}

/** 把卡片塞进记忆（同名去重，最多留 30 张） */
export function addCard(memory, card) {
  if (!card) return null;
  const dup = memory.cards.find((c) => c.text === card.text);
  if (dup) return dup;
  memory.cards.push(card);
  if (memory.cards.length > 30) memory.cards.splice(0, memory.cards.length - 30);
  return card;
}

/**
 * 被提起一次：续命。
 *
 * 「提起」包括：有人又聊到这件事、她自己想起来（检索命中）、手动 touch。
 *
 * 续命规则按需求定：
 *   · 完整期 → 计时归零，继续当完整记忆
 *   · 卡片期 → **+30 天**（不是重置，是加时；被提得越多活得越久）
 *   · 长期期 → 同样 +30 天，但保底还有 2 年
 */
export function recall(item, now = Date.now()) {
  if (!item) return item;
  const lastDay = Math.floor((item.lastRecall ?? now) / DAY_MS);
  const today = Math.floor(now / DAY_MS);
  const consecutiveDays = today === lastDay
    ? item.consecutiveDays ?? 1
    : (item.consecutiveDays ?? 0) + 1;

  if (item.longTerm) {
    return { ...item, lastRecall: now, consecutiveDays, expiresAt: now + LONG_DAYS * DAY_MS };
  }

  if (item.compressed) {
    // 卡片被提：从"现在的到期时间"往后加 30 天
    const base = Math.max(Number(item.expiresAt) || now, now);
    return {
      ...item,
      lastRecall: now,
      consecutiveDays,
      expiresAt: base + EXTEND_DAYS * DAY_MS,
      recallCount: (item.recallCount ?? 0) + 1,
      // 连续提够 15 天 → 升级长期
      ...(consecutiveDays >= PROMOTE_DAYS ? { longTerm: true, compressed: false, expiresAt: now + LONG_DAYS * DAY_MS } : {}),
    };
  }

  // 完整期：归零 + 够 15 天升级长期
  const longTerm = item.longTerm || consecutiveDays >= PROMOTE_DAYS;
  return {
    ...item,
    lastRecall: now,
    consecutiveDays,
    longTerm,
    compressed: false,
    expiresAt: longTerm ? now + LONG_DAYS * DAY_MS : now + FULL_DAYS * DAY_MS,
  };
}

/** 压扁一条/一组经历：留下"大概"，丢掉细节 */
function compressGroup(list, now) {
  const first = list[0];
  const head = String(first.what ?? '').slice(0, 18);
  const who = first.who ?? '';
  const summary = list.length === 1
    ? `（记不清了）${who ? `${who}：` : ''}${head}`
    : `（记不清了）${who ? `${who}：` : ''}${head}…前后还有 ${list.length - 1} 件`;

  return {
    id: `cmp_${first.id ?? now}`,
    kind: 'episode',
    at: first.at ?? now,
    lastRecall: first.lastRecall ?? first.at ?? now,
    compressed: true,
    cardedAt: now,
    expiresAt: now + CARD_DAYS * DAY_MS, // 卡片从压扁这一刻起算 2 年
    consecutiveDays: first.consecutiveDays ?? 1,
    longTerm: false,
    who,
    what: summary.slice(0, 60),
    feel: '',
    mood: '',
    emotion: 0,
    source: first.source ?? 'live',
    from: list.map((x) => x.id).filter(Boolean),
  };
}

function isPermanent(item) {
  // 「重要记忆」不老化：反复被交代的事、喊她名字、让她去上学——这些不许变成卡片
  return Boolean(item?.important);
}

/**
 * 每日结算：三段生命周期。
 *
 *   [完整] --21 天--> [卡片] --2 年--> [遗忘]
 *   [长期] --2 年--> [降回卡片] --2 年--> [遗忘]
 *
 * @param {object} [opts]
 * @param {number} [opts.compressDays] 完整期多长（默认 21）
 * @param {number} [opts.forgetDays]   卡片/长期期多长（默认 730 = 2 年）
 * @param {(item, reason)=>void} [opts.onArchive]
 */
export function settle(memory, now = Date.now(), opts = {}) {
  const fullDays = Number.isFinite(opts.compressDays) ? opts.compressDays : FULL_DAYS;
  const cardDays = Number.isFinite(opts.forgetDays) ? opts.forgetDays : CARD_DAYS;
  const onArchive = typeof opts.onArchive === 'function' ? opts.onArchive : null;
  const archive = (item, reason) => { if (onArchive) onArchive(item, reason); };

  const fullExpiry = (item) => Number(item.expiresAt)
    || ((item.lastRecall ?? item.at ?? now) + fullDays * DAY_MS);
  const cardExpiry = (item) => Number(item.expiresAt)
    || ((item.lastRecall ?? item.at ?? now) + cardDays * DAY_MS);

  // ── 第一段：完整期到期 → 压扁（同一人同一天合成一条"大概"）──
  const keep = [];
  const groups = new Map();
  for (const e of memory.episodes ?? []) {
    if (isPermanent(e) || e.longTerm || e.compressed) { keep.push(e); continue; }
    if (now < fullExpiry(e)) { keep.push(e); continue; }
    const day = new Date(e.at ?? now).toISOString().slice(0, 10);
    const key = `${e.who ?? ''}|${day}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  for (const [key, list] of groups) {
    const g = compressGroup(list, now);
    g.expiresAt = now + cardDays * DAY_MS;
    keep.push(g);
    void key;
    for (const it of list) archive(it, 'compressed');
  }
  memory.episodes = keep;

  // ── 第二段：长期到期 → 降回卡片，重新走一圈（不是遗忘）──
  memory.episodes = (memory.episodes ?? []).map((e) => {
    if (!e.longTerm || isPermanent(e)) return e;
    if (now < cardExpiry(e)) return e;
    return {
      ...e,
      longTerm: false,
      compressed: true,
      cardedAt: now,
      expiresAt: now + cardDays * DAY_MS,
      demotedAt: now,
    };
  });

  // ── 第三段：卡片到期 → 遗忘 ──
  const shouldForget = (item) => {
    if (!item) return false;
    if (isPermanent(item)) return false;
    if (item.longTerm) return false;
    return now >= cardExpiry(item);
  };

  const keepE = [];
  for (const e of memory.episodes) {
    if (shouldForget(e)) { memory.forgotten.push(e); archive(e, 'forgotten'); }
    else keepE.push(e);
  }
  memory.episodes = keepE;

  const keepI = [];
  for (const i of memory.imagination ?? []) {
    if (shouldForget(i)) { memory.forgotten.push(i); archive(i, 'forgotten'); }
    else keepI.push(i);
  }
  memory.imagination = keepI;

  const keepC = [];
  for (const c of memory.cards ?? []) {
    if (shouldForget(c)) { memory.forgotten.push(c); archive(c, 'forgotten'); }
    else keepC.push(c);
  }
  memory.cards = keepC;

  for (const bucket of ['facts', 'impressions']) {
    const src = memory[bucket] ?? {};
    const kept = {};
    for (const [k, v] of Object.entries(src)) {
      const item = { kind: bucket === 'facts' ? 'fact' : 'impression', ...v };
      if (shouldForget(item)) { memory.forgotten.push({ key: k, ...item }); archive({ key: k, ...item }, 'forgotten'); }
      else kept[k] = v;
    }
    memory[bucket] = kept;
  }

  return memory;
}

/** 检索命中的经历算「被想起来」——记忆靠被想起活着 */
export function touchByIds(memory, ids = [], now = Date.now()) {
  const set = new Set(ids.filter(Boolean));
  if (!set.size) return 0;
  let n = 0;
  memory.episodes = (memory.episodes ?? []).map((e) => {
    if (!set.has(e.id)) return e;
    n += 1;
    return recall(e, now);
  });
  return n;
}

/**
 * 四路线索检索 —— 只取相关的，定长。
 * 人脑不是扫描记忆的，记忆是被线索勾出来的。
 */
export function retrieve(cue, memory, { budget = RETRIEVE_BUDGET_CHARS, now = Date.now() } = {}) {
  const out = [];
  const seen = new Set(); // 同一条经历不要在多个通道里重复出现
  let used = 0;

  const push = (text, lane, id) => {
    const t = String(text ?? '').trim();
    if (!t || t.length < 2) return;
    if (id && seen.has(id)) return;
    if (out.some((x) => x.text === t)) return; // 同一条别念两遍
    if (used + t.length > budget) return;
    if (id) seen.add(id);
    out.push({ lane, text: t, id: id ?? null });
    used += t.length;
  };

  const { who = '', words = [], mood = null, withCards = true, app = null } = cue ?? {};

  // ⓪ 平台记忆：她在那个 App 里刷过什么、爱看什么、上次停在哪
  if (app && memory.apps?.[app]) {
    const b = memory.apps[app];
    const fav = Object.entries(b.taste ?? {}).sort((a, z) => z[1] - a[1])[0];
    if (fav) push(`在${app}上我比较爱看${fav[0]}`, 'app');
    if (b.lastLeft?.item) push(`上次在${app}停在「${b.lastLeft.item}」`, 'app');
    for (const it of (b.seen ?? []).slice(-2)) {
      if (it.title) push(`在${app}刷到过「${it.title}」`, 'app');
    }
  }

  // ⓪ 卡片：上下文压过之后留下的大意，优先于细枝末节
  if (withCards && Array.isArray(memory.cards) && memory.cards.length) {
    const latest = memory.cards.slice(-2);
    for (const c of latest) push(`（之前）${c.text}`, 'card', c.id);
  }

  // ⓪ 伞：结构层，最先给位置（"我上过学""他是我熟人"是介绍自己的话）
  if (Array.isArray(memory.umbrellas) && memory.umbrellas.length) {
    const mine = memory.umbrellas.filter((u) => u.topic === 'person' && u.who && u.who === who);
    const rest = memory.umbrellas.filter((u) => !mine.includes(u));
    for (const u of [...mine, ...rest].slice(0, 3)) push(u.text, 'umbrella', u.id);
  }

  // ⓪ 纲：比细节活得久的那一层，先给它位置
  if (Array.isArray(memory.gists) && memory.gists.length) {
    // 跟这个人有关的纲优先，其余按次数
    const mine = memory.gists.filter((g) => g.topic === 'person' && g.who && g.who === who);
    const rest = memory.gists.filter((g) => !mine.includes(g)).sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
    for (const g of [...mine, ...rest].slice(0, 4)) push(g.text, 'gist', g.id);
  }

  // ① 人：这人是谁 + 跟他的最近三次
  if (who) {
    const im = memory.impressions?.[who];
    if (im) {
      const traits = (im.traits ?? []).filter(Boolean);
      const faded = nameFaded(im, now);
      // 太久没提：名字想不起来，但"认识这个人"这件事不能没
      push(faded
        ? `有个认识的（大概是${who}）——名字有点想不起来了`
        : `${who}：${traits.length ? traits.join('、') : '还不熟'}（${im.count ?? 0} 次）`, 'person');
    }
    const mine = memory.episodes.filter((e) => e.who === who).slice(-3);
    for (const e of mine) {
      push(`${who}说过「${e.what}」${e.feel ? `，我当时${e.feel}` : ''}`, 'person', e.id);
    }
  }

  // ② 关键词：概念 + 我对这词的态度
  for (const w of words) {
    const f = memory.facts?.[w];
    if (f) push(`${w}：${f.text}`, 'keyword');
    const taste = memory.taste?.[w];
    if (typeof taste === 'number' && Math.abs(taste) > 0.3) {
      push(`${w}我${taste > 0 ? '挺喜欢' : '不太喜欢'}`, 'keyword');
    }
  }

  // ③ 情绪：同情绪的旧事
  if (mood) {
    const same = memory.episodes.filter((e) => e.mood === mood).slice(-2);
    for (const e of same) push(`上次也这样：${e.what}`, 'mood', e.id);
  }

  // ④ 最近：近 7 天情绪最重的三件
  const week = now - 7 * DAY_MS;
  const recent = memory.episodes
    .filter((e) => (e.at ?? 0) >= week)
    .slice()
    .sort((a, b) => Math.abs(b.emotion ?? 0) - Math.abs(a.emotion ?? 0))
    .slice(0, 3);
  for (const e of recent) push(`${e.what}${e.feel ? `（${e.feel}）` : ''}`, 'recent', e.id);

  return { items: out, chars: used, text: out.map((x) => x.text).join('\n') };
}

/** 记忆只增不凭空：每条 episode 必须有来源（I6 的一半）。 */
export function hasEvidence(item) {
  return Boolean(item?.evidence || item?.from || item?.who || item?.at);
}
