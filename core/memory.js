// 记忆：30 天窗口，提起续命，连续 15 天升级长期。
//
// 对应《大脑规范-定稿》§三 与《逻辑内核-定稿》§3.4 / §3.5。
// 核心：忘了就是真的没有（不是"想不起来"）。

export const DAY_MS = 24 * 60 * 60 * 1000;
export const TTL_DAYS = { episode: 30, impression: 90, imagination: 30, card: 30, fact: Infinity, taste: Infinity };
export const PROMOTE_DAYS = 15;
export const RETRIEVE_BUDGET_CHARS = 900; // ≈800 token（中文约 1.1~1.3 字/token）
export const CARD_THRESHOLD_CHARS = 6000;  // 上下文超过这个数就该压卡片
export const CARD_MAX_CHARS = 160;

export function emptyMemory() {
  return {
    facts: {},        // key → { text, kind:'fact', weight, lastRecall, consecutiveDays, longTerm }
    taste: {},        // key → score（她的口味：解压 0.9 / 带货 -0.8）
    impressions: {},  // name → { traits:[], count, lastAt, kind:'impression', ... }
    apps: {},         // 平台记忆：douyin / bilibili / wechat / qq / … 各一桶
    episodes: [],     // { id, at, who, what, feel, outcome, context, strategy, kind:'episode' }
    imagination: [],  // 幻想：永不进 episodes（I6）
    cards: [],        // 记忆卡片：上下文过长时的中段锚点
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
 * 同一天内多次提起不重复计数（按自然日算"连续天数"）。
 */
export function recall(item, now = Date.now()) {
  if (!item) return item;
  const lastDay = Math.floor((item.lastRecall ?? now) / DAY_MS);
  const today = Math.floor(now / DAY_MS);
  const consecutiveDays = today === lastDay
    ? item.consecutiveDays ?? 1
    : (item.consecutiveDays ?? 0) + 1;
  const longTerm = item.longTerm || consecutiveDays >= PROMOTE_DAYS;
  return { ...item, lastRecall: now, consecutiveDays, longTerm };
}

/**
 * 每日结算：到期且没升级的，进 forgotten。
 * 不是删除，是"认知上不存在了"。
 */
export function settle(memory, now = Date.now()) {
  const expired = (item) => {
    if (!item || item.longTerm) return false;
    const ttl = TTL_DAYS[item.kind] ?? TTL_DAYS.episode;
    if (!Number.isFinite(ttl)) return false;
    return now - (item.lastRecall ?? item.at ?? now) > ttl * DAY_MS;
  };

  const keepE = [];
  for (const e of memory.episodes) (expired(e) ? memory.forgotten : keepE).push(e);
  memory.episodes = keepE;

  const keepI = [];
  for (const i of memory.imagination) (expired(i) ? memory.forgotten : keepI).push(i);
  memory.imagination = keepI;

  const keepC = [];
  for (const c of memory.cards ?? []) (expired(c) ? memory.forgotten : keepC).push(c);
  memory.cards = keepC;

  for (const bucket of ['facts', 'impressions']) {
    const src = memory[bucket] ?? {};
    const kept = {};
    for (const [k, v] of Object.entries(src)) {
      const item = { kind: bucket === 'facts' ? 'fact' : 'impression', ...v };
      if (expired(item)) memory.forgotten.push({ key: k, ...item });
      else kept[k] = v;
    }
    memory[bucket] = kept;
  }

  return memory;
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
    out.push({ lane, text: t });
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

  // ① 人：这人是谁 + 跟他的最近三次
  if (who) {
    const im = memory.impressions?.[who];
    if (im) {
      const traits = (im.traits ?? []).filter(Boolean);
      push(`${who}：${traits.length ? traits.join('、') : '还不熟'}（${im.count ?? 0} 次）`, 'person');
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
