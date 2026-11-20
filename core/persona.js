// 人设的三件事：怎么说自己（brief）、怎么变（evolve/decay）、怎么蜕皮（shed）。
//
// 对应《逻辑内核-定稿》§3.1 / §3.2 / §3.3。
// 全部是纯函数：给定输入 → 确定输出。没有 IO，没有随机。

export const WEIGHT_STEP = 0.01;      // 每次 ±0.01：100 次才显著 = "不知不觉"
export const DAILY_DECAY = 0.999;     // 每天 ×0.999
export const SHED_THRESHOLD = 0.15;   // 低于此值沉进 formerSelves

const BRIEF_MAX_CHARS = 300;

/** 先"我是谁"，再"我什么性格"，再"我偏好什么"，最后才是"我不能做什么"。
 *  倒过来的话，brief 会读成一本人事手册。 */
const KIND_RANK = { identity: 0, trait: 1, preference: 2, constraint: 3 };

function bigrams(text) {
  const clean = String(text).replace(/[\s，。；、！？,.!?;:"'（）()【】「」\[\]]/g, '');
  const set = new Set();
  for (let i = 0; i < clean.length - 1; i += 1) set.add(clean.slice(i, i + 2));
  return set;
}

/** 两句话是不是在说同一件事（防止"本体是……"重复两遍）。 */
function similar(a, b) {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.size || !B.size) return false;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter += 1;
  return inter / Math.min(A.size, B.size) >= 0.5;
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

/**
 * 把一条命题压成一句短话。
 * 先去掉括号里的补充说明（对大意的贡献很小），再取第一个分句。
 */
function condense(text, max = 46) {
  const t = String(text)
    .replace(/（[^）]*）/g, '')
    .replace(/\([^)]*\)/g, '')
    .trim();
  const clause = (t.split(/[；。]/)[0] ?? '').trim();
  // 大多数分句本来就不长——整句保留，读起来才像人话。
  if (clause.length <= max) return clause;
  // 太长才按逗号逐段拼，拼到放不下为止
  const parts = clause.split('，').map((s) => s.trim()).filter(Boolean);
  let out = parts[0] ?? clause;
  for (let i = 1; i < parts.length; i += 1) {
    if (out.length + parts[i].length + 1 > max) break;
    out += `，${parts[i]}`;
  }
  return out.length > max ? `${out.slice(0, max)}…` : out;
}

/**
 * 她现在的样子（每次唤醒注入的唯一入口）。
 *
 * 规则：
 *   1. 按 kind 分层（身份 → 性格 → 偏好 → 约束）
 *   2. 同层按权重降序
 *   3. 每条压成一句短话，总字数 ≤ 300
 */
export function brief(units, { maxChars = BRIEF_MAX_CHARS } = {}) {
  if (!Array.isArray(units) || units.length === 0) return '';

  const ordered = units.slice().sort((a, b) => {
    const ra = KIND_RANK[a.kind] ?? 9;
    const rb = KIND_RANK[b.kind] ?? 9;
    if (ra !== rb) return ra - rb;
    return b.weight - a.weight || a.id.localeCompare(b.id);
  });

  const picked = [];
  const seen = new Set();
  let used = 0;

  for (const u of ordered) {
    const t = condense(u.text);
    if (t.length < 5) continue;
    const key = t.slice(0, 10);
    if (seen.has(key)) continue;
    if (picked.some((p) => similar(p, t))) continue;
    const cut = t.length > 46 ? `${t.slice(0, 46)}…` : t;
    const add = cut.length + 1; // +1 for separator
    if (used + add > maxChars) continue;
    seen.add(key);
    picked.push(cut);
    used += add;
  }

  return picked.join('；');
}

/**
 * 一次经历，让命题们的权重动一动。
 *
 * consistent  与这些命题一致  → +0.01
 * conflicting 与这些命题冲突  → −0.01
 *
 * identity 永不调整（I2）。
 */
export function evolve(units, { consistent = [], conflicting = [], at = 0 } = {}) {
  const ok = new Set(consistent);
  const bad = new Set(conflicting);
  return units.map((u) => {
    if (u.kind === 'identity') return u;
    let w = u.weight;
    if (ok.has(u.id)) w = clamp01(w + WEIGHT_STEP);
    else if (bad.has(u.id)) w = clamp01(w - WEIGHT_STEP);
    if (w === u.weight) return u;
    return { ...u, weight: w, lastTouched: at };
  });
}

/**
 * 自然衰减：没被用到的命题会慢慢褪色。
 * 注意这是"时间"的衰减；被提起（evolve 命中）会把它拉回来。
 */
export function decay(units, days, at = 0) {
  if (!(days > 0)) return units;
  const factor = Math.pow(DAILY_DECAY, days);
  return units.map((u) => {
    if (u.kind === 'identity') return u;
    const w = clamp01(u.weight * factor);
    if (w === u.weight) return u;
    return { ...u, weight: w, lastTouched: at };
  });
}

/**
 * 蜕皮：权重掉到底的命题，降级成"我以前……"，进记忆，不再是人格。
 *
 * 不是删除，是降级。她记得自己以前什么样，但已经不是那样了。
 */
export function shed(units, { threshold = SHED_THRESHOLD, at = 0 } = {}) {
  const kept = [];
  const fallen = [];
  for (const u of units) {
    if (u.kind !== 'identity' && u.weight < threshold) {
      fallen.push({
        id: u.id,
        text: u.text,
        // 变成回忆的口吻
        memoir: `我以前${memoirize(u.text)}`,
        weight: u.weight,
        section: u.section,
        shedAt: at,
      });
    } else {
      kept.push(u);
    }
  }
  return { units: kept, formerSelves: fallen };
}

function memoirize(text) {
  const t = text.replace(/^我/, '').trim();
  // "是……的" 这类可以直接接；其余加个"会/是"的过渡更自然
  if (/^(是|有|会|不|很|总|老|特别)/.test(t)) return t;
  return `是${t}`;
}

/**
 * 权重体检——给 demo 和自检用。
 */
export function weightReport(units) {
  const total = units.reduce((s, u) => s + u.weight, 0);
  const top = units
    .filter((u) => u.kind !== 'identity')
    .slice()
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5)
    .map((u) => ({ id: u.id, weight: Number(u.weight.toFixed(3)), text: u.text.slice(0, 30) }));
  return {
    count: units.length,
    totalWeight: Number(total.toFixed(3)),
    identity: units.filter((u) => u.kind === 'identity').length,
    top,
  };
}
