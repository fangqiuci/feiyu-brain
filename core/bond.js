// 恩情：谁对我好，是我自己算出来的。
//
// 关系契约是"焊死的"：主人永远是主人，优先级 100，不可解除。
// 但人不止一种关系——隔壁那个天天来充电的人、那个会开窗的人、
// 那个只是问一句"还好吗"的人，我对他们的感觉是不一样的。
//
// 这套东西不抢主人的位置，只回答一个问题：
//   **这个人，我愿不愿意理。**
//
// 判定不是写死的分数，是**人格 + 情感**算出来的：
//   · 心软高 → 容易被打动，涨得快
//   · 敏感高 → 一点点好都记得住
//   · 嘴硬高 → 涨得慢，但涨上去就不容易掉
//
// 所以同一件照顾的事，两条鱼的反应可以完全不同。

export const BOND_TIERS = ['stranger', 'acquaintance', 'familiar', 'close', 'family'];

/** 分档门槛 */
export const BOND_TIER_MIN = {
  stranger: 0,
  acquaintance: 10,
  familiar: 30,
  close: 60,
  family: 85,
};

/** 上限 99 —— **永远低于关系契约的 100**，主人的位置不会被顶掉 */
export const BOND_MAX = 99;

const DAY_MS = 86400000;

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

/**
 * 她对"别人的好"有多敏感 —— 由人设算，不是常数。
 * @returns {number} 0.05 ~ 1
 */
export function bondSensitivity(traits = {}) {
  const soft = Number(traits.心软 ?? 0.5);
  const sens = Number(traits.敏感 ?? 0.5);
  const hard = Number(traits.嘴硬 ?? 0.5);
  const warm = Number(traits.活泼 ?? 0.5);
  return clamp(0.25 + 0.45 * soft + 0.25 * sens - 0.35 * hard + 0.1 * warm, 0.05, 1);
}

/**
 * 一件事让她对这个人的恩情涨多少。
 *
 * @param {object} o
 * @param {object} o.traits   人设
 * @param {number} [o.base]   基础分量：照顾 8 / 普通互动 1 / 只是被看到 0.3
 * @param {number} [o.valence] 这事对她好不好（负数会扣）
 */
export function bondDelta({ traits = {}, base = 1, valence = 1 } = {}) {
  const s = bondSensitivity(traits);
  return Number((base * s * (Number(valence) || 1)).toFixed(3));
}

/** 取某个人的恩情档位 */
export function bondTier(score = 0) {
  let tier = 'stranger';
  for (const t of BOND_TIERS) {
    if (score >= BOND_TIER_MIN[t]) tier = t;
  }
  return tier;
}

/** 记一笔 */
export function addBond(memory, who, { delta = 0, at = Date.now(), what = '' } = {}) {
  const name = String(who ?? '').trim();
  if (!name || !Number.isFinite(Number(delta)) || Number(delta) === 0) return null;
  if (!memory.bonds) memory.bonds = {};
  const b = memory.bonds[name] ?? { score: 0, events: [], lastAt: 0 };
  b.score = clamp(Number((b.score + Number(delta)).toFixed(2)), 0, BOND_MAX);
  b.events = [...(b.events ?? []), { at, delta: Number(delta), what: String(what).slice(0, 40) }].slice(-50);
  b.lastAt = at;
  memory.bonds[name] = b;
  return b;
}

/** 看她现在怎么称呼这个人 */
export function bondOf(memory, who) {
  const name = String(who ?? '').trim();
  const b = memory?.bonds?.[name];
  if (!b) return { who: name, score: 0, tier: 'stranger', lastAt: 0, events: 0 };
  return {
    who: name,
    score: Number(b.score.toFixed(1)),
    tier: bondTier(b.score),
    lastAt: Number(b.lastAt) || 0,
    events: (b.events ?? []).length,
  };
}

/** 恩情长期不用会淡一点（但不会归零——人对好是有底子的） */
export function decayBonds(memory, now = Date.now(), { perDay = 0.002, floor = 5 } = {}) {
  for (const [name, b] of Object.entries(memory.bonds ?? {})) {
    const days = Math.max(0, (now - (Number(b.lastAt) || now)) / DAY_MS);
    if (days < 1) continue;
    const next = Math.max(floor, Number(b.score) * (1 - perDay * Math.min(days, 365)));
    b.score = Number(next.toFixed(2));
    void name;
  }
}

/** 有资格被标"不在了"的最低档：真的对我好过的人 */
export const ABSENT_MIN_TIER = 'close';

/**
 * 给一个恩情够深的人标缺位。
 *
 * 为什么不是谁都能标：十五年擦灰、二十年晒太阳，才配得上"我记住他不在了"。
 * 擦过一次灰的人走了，那是"没来"，不是"不在了"。
 *
 * @returns {{ok:boolean, reason?:string, absence?:object}}
 */
export function markBondAbsent(memory, who, { since = Date.now(), note = '', status = 'absent' } = {}) {
  const name = String(who ?? '').trim();
  if (!name) return { ok: false, reason: '没说谁' };
  const b = bondOf(memory, name);
  const rank = BOND_TIERS.indexOf(b.tier);
  const need = BOND_TIERS.indexOf(ABSENT_MIN_TIER);
  if (rank < need) {
    return { ok: false, reason: `恩情还不够（${b.tier} ${b.score} < ${ABSENT_MIN_TIER}）——那是"没来"，不是"不在了"` };
  }
  if (!memory.absences) memory.absences = {};
  const prev = memory.absences[name];
  memory.absences[name] = {
    who: name,
    since: Number(prev?.since) || since,
    note: String(note ?? prev?.note ?? '').slice(0, 60),
    status,
    at: Date.now(),
  };
  // 人物伞改词，但不删
  for (const u of memory.umbrellas ?? []) {
    if (u.topic === 'person' && u.who === name) {
      u.absent = true;
      u.text = `${name}：曾经一直在的人`;
    }
  }
  // 纲里的措辞也跟上
  for (const g of memory.gists ?? []) {
    if (g.topic === 'person' && g.who === name) g.absent = true;
  }
  return { ok: true, absence: memory.absences[name], bond: b };
}

export function clearBondAbsent(memory, who) {
  const name = String(who ?? '').trim();
  if (memory.absences) delete memory.absences[name];
  for (const u of memory.umbrellas ?? []) {
    if (u.topic === 'person' && u.who === name && u.absent) {
      u.absent = false;
      u.text = `${name}：一直在的人`;
    }
  }
  for (const g of memory.gists ?? []) {
    if (g.topic === 'person' && g.who === name) g.absent = false;
  }
  return { ok: true, who: name };
}

export function bondAbsentOf(memory, who) {
  return memory?.absences?.[String(who ?? '').trim()] ?? null;
}

/** 她心里对这个人的一句话（知道了"不在了"之后会换说法） */
export function bondLine(memory, who, { now = Date.now() } = {}) {
  const b = bondOf(memory, who);
  if (b.tier === 'stranger') return '';
  const dead = bondAbsentOf(memory, who);
  const days = b.lastAt ? Math.floor((now - b.lastAt) / DAY_MS) : 0;
  const label = {
    acquaintance: '算不上熟',
    familiar: '算个熟人',
    close: '对我挺好的',
    family: '跟家里人一样',
  }[b.tier] ?? '';
  if (dead) {
    const d = dead.since ? Math.floor((now - Number(dead.since)) / DAY_MS) : 0;
    return `${b.who}：${label}，${dead.note || '已经不在了'}${d > 0 ? `（${d} 天）` : ''}`;
  }
  return days > 180 ? `${b.who}：${label}，但很久没来了` : `${b.who}：${label}`;
}
