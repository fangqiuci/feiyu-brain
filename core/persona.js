// 人设的三件事：怎么说自己（brief）、怎么变（evolve/decay）、怎么蜕皮（shed）。
//
// 对应《逻辑内核-定稿》§3.1 / §3.2 / §3.3。
// 全部是纯函数：给定输入 → 确定输出。没有 IO，没有随机。

export const WEIGHT_STEP = 0.01;      // 每次 ±0.01：100 次才显著 = "不知不觉"
// 每天 ×DAILY_DECAY。这个数不是拍的——它决定"多久没人提，这条性格就掉了"。
//   0.999   → 从 0.6 掉到 0.15 要 1386 天（3.8 年）→ 蜕皮永远不会发生
//   0.9975  → 约 730 天（2 年）→ 和"记忆两年遗忘"同一个尺度
// 人设淡忘不该比记忆慢：两年没人提的性格，就该沉进旧我。
export const DAILY_DECAY = 0.9975;
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
/**
 * 「规章制度」样子的行：讲的是怎么说话、能做什么不能做什么，
 * 不是她是什么人。
 *
 * 这类行在 brief 里占比一高，模型读到全是禁令，执行出来就是短、冷、不接话。
 */
const RULE_RE = /(允许|默认|禁止|必须|不要|不得|不能|可以.{0,6}吗|请(?:你)?|规则|原则|要求|设定|格式|回答时|回复时|每条|一条消息|字数|1~10|口癖|自称|短句|连发|隔几秒|省略主语)/;

function isRule(text) {
  return RULE_RE.test(String(text ?? ''));
}

/**
 * 她现在的样子（每次唤醒注入的唯一入口）。
 *
 * 规则：
 *   1. 按 kind 分层（身份 → 性格 → 偏好 → 约束）
 *   2. 同层按权重降序
 *   3. 每条压成一句短话，总字数 ≤ 300
 *   4. **"规章制度"类的行最多占 1/4**
 *
/**
 * 说话方式（含话多话少）—— **从人设算出来，不是规则**。
 *
 * 这一点很关键：话少不该是「默认 1~10 字」这种死规矩，
 * 它应该是「她懒、她敏感、她懒得解释」的自然结果。
 *
 * 算出来之后有两个用处：
 *   ① brief 本身跟着变短/变长——她连介绍自己都懒得说全
 *   ② 注入的"她"少 → 模型自然说得少
 *
 * 而且它会随 traits 漂移：一条活泼的鱼跑几年变懒了，brief 自己就缩了。
 */
export function speechProfile(traits = {}) {
  const g = (k) => Number(traits[k] ?? 0.5);
  const verbosity = Math.max(0.05, Math.min(1,
    0.15
    + 0.50 * g('活泼')
    + 0.40 * g('社交')
    + 0.15 * g('好奇')
    - 0.45 * g('懒')
    - 0.25 * g('敏感')
    - 0.20 * g('嘴硬'),
  ));

  // 独特的地方越多，越懒得解释（洁癖/工作狂那种人通常话少而直接）
  const KNOWN = new Set(['嘴硬', '心软', '好奇', '好动', '敏感', '固执', '自信', '爱反思', '理性', '社交', '活泼', '懒']);
  const customVals = Object.entries(traits || {}).filter(([k]) => !KNOWN.has(k)).map(([, v]) => Number(v) || 0);
  const customShare = customVals.length ? customVals.reduce((a, b) => a + b, 0) / customVals.length : 0;
  const finalVerbosity = Math.max(0.05, verbosity - 0.15 * customShare);

  // 话多 → brief 用满 300；话少 → 只有 130
  const chars = Math.round(130 + 170 * finalVerbosity);
  const label = finalVerbosity > 0.66 ? '话多' : finalVerbosity > 0.36 ? '话一般' : '话少';

  return {
    verbosity: Number(finalVerbosity.toFixed(2)),
    label,
    chars,
    // 给宿主/调试看的一句话，不进 brief
    note: `她${label}（verbosity ${verbosity.toFixed(2)}）`,
  };
}

/**
 * 她现在的样子（每次唤醒注入的唯一入口）。
 *
 * 规则：
 *   1. 按 kind 分层（身份 → 性格 → 偏好 → 约束）
 *   2. 同层按权重降序
 *   3. 每条压成一句短话，总字数由人设决定（见 speechProfile）
 *   4. "规章制度"类的行最多占 1/4
 *
 * 注意：**规章不该搬到别处，该删掉或者改写成性格。**
 *   「默认 1~10 字」  → 死规则，永远不会因为心情变
 *   「她懒，懒得多说」→ 性格，会被经历改变
 * ruleShare 传 0 就是一条规章都不要。
 */
export function brief(units, { maxChars = BRIEF_MAX_CHARS, ruleShare = 0.25 } = {}) {
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
  let ruleChars = 0;
  const ruleCap = Math.floor(maxChars * Math.max(0, Math.min(1, ruleShare)));

  // 先挑"她是谁"，再让规章挤剩下的空
  const pool = [...ordered.filter((u) => !isRule(u.text)), ...ordered.filter((u) => isRule(u.text))];

  for (const u of pool) {
    const t = condense(u.text);
    if (t.length < 5) continue;
    const key = t.slice(0, 10);
    if (seen.has(key)) continue;
    if (picked.some((p) => similar(p, t))) continue;
    const cut = t.length > 46 ? `${t.slice(0, 46)}…` : t;
    const add = cut.length + 1;
    if (used + add > maxChars) continue;
    const rule = isRule(u.text);
    if (rule && ruleChars + add > ruleCap) continue;
    seen.add(key);
    picked.push(cut);
    used += add;
    if (rule) ruleChars += add;
  }

  return picked.join('；');
}

/**
 * 一次经历，让命题们的权重动一动。
 *
 * consistent  与这些命题一致  → +0.01
 * conflicting 与这些命题冲突  → −0.01
 * step        幅度倍率（默认 1）。**只有重大转折才允许 >1**——平时必须是 1，
 *             否则"不知不觉"就没了。上限 5。
 *
 * identity 永不调整（I2）。
 */
export function evolve(units, { consistent = [], conflicting = [], at = 0, step = 1 } = {}) {
  const ok = new Set(consistent);
  const bad = new Set(conflicting);
  const k = Math.max(0, Math.min(5, Number(step) || 1));
  return units.map((u) => {
    if (u.kind === 'identity') return u;
    let w = u.weight;
    if (ok.has(u.id)) w = clamp01(w + WEIGHT_STEP * k);
    else if (bad.has(u.id)) w = clamp01(w - WEIGHT_STEP * k);
    if (w === u.weight) return u;
    return { ...u, weight: w, lastTouched: at };
  });
}

/**
 * 自然衰减：**长期没人碰**的命题才会褪色。
 *
 * 不是"每天都掉一点"——那等于还没活就先老了。
 * 一条命题最后一次被碰到（evolve 命中 / 被人聊到）之后，
 * 超过 quietDays 天没人再碰，才开始按天衰减；一碰就停。
 */
export function decay(units, days, at = 0, { quietDays = 30 } = {}) {
  if (!(days > 0)) return units;
  const factor = Math.pow(DAILY_DECAY, days);
  const quietMs = quietDays * 24 * 60 * 60 * 1000;
  return units.map((u) => {
    if (u.kind === 'identity') return u;
    const since = at - (u.lastTouched ?? u.born ?? 0);
    if (since <= quietMs) return u; // 还有人惦记，不掉
    const w = clamp01(u.weight * factor);
    if (w === u.weight) return u;
    return { ...u, weight: w };
  });
}

/**
 * 一年一度的蜕壳：把「这一年里掉出去的人设」打包成一张永久记忆卡片。
 *
 * 不是存整份快照——存的是**被忘掉的那部分**：
 *   · 今年蜕下来的皮（formerSelves 里今年的）
 *   · 现在还没掉到底、但已经明显变淡的（< 0.35）
 *
 * 这样她以后能说"我去年不是这样"，而不是只有一个当前版本。
 */
export function shellSummary(units, formerSelves, { year, at = 0, yearMoves = {} } = {}) {
  const shedThisYear = (formerSelves ?? []).filter((f) => {
    const y = new Date(f.shedAt ?? 0).getFullYear();
    return !year || y === year;
  });
  const faded = (units ?? []).filter((u) => u.kind !== 'identity' && u.weight < 0.35);

  // 这一年里掉得最多的几条（不用掉到底，只要"明显变了"）
  const dropped = Object.entries(yearMoves ?? {})
    .filter(([, d]) => Number(d) <= -0.05)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 6)
    .map(([unitId, d]) => {
      const u = (units ?? []).find((x) => x.id === unitId);
      return u ? { text: u.text, delta: Number(d) } : null;
    })
    .filter(Boolean);

  const bits = [];
  for (const f of shedThisYear.slice(0, 6)) {
    bits.push(`${String(f.memoir ?? f.text).slice(0, 24)}（掉了）`);
  }
  for (const d of dropped) {
    if (bits.length >= 8) break;
    bits.push(`${d.text.slice(0, 18)}（少了 ${Math.abs(d.delta).toFixed(2)}）`);
  }
  for (const u of faded.slice(0, 4)) {
    if (bits.length >= 10) break;
    bits.push(`${u.text.slice(0, 18)}（淡到 ${Number(u.weight).toFixed(2)}）`);
  }

  const head = `${year} 年的我`;
  if (!bits.length) {
    return { year, title: head, text: `${head}：这一年没什么大变化。`, changed: 0 };
  }
  return {
    year,
    title: head,
    text: `${head}：${[...new Set(bits)].join('；')}。这些后来都不太像我了。`.slice(0, 300),
    changed: shedThisYear.length + dropped.length + faded.length,
  };
}

/**
 * 「最近」——最近几天她哪一点更明显了。
 *
 * 每天 ±0.01 看不出来，但七天攒起来能说出来一句。
 */
export function recentShift(moves, units, { days = 7, at = 0, threshold = 0.02 } = {}) {
  const since = at - days * 24 * 60 * 60 * 1000;
  const acc = new Map();
  for (const m of moves ?? []) {
    if ((m.at ?? 0) < since) continue;
    acc.set(m.id, (acc.get(m.id) ?? 0) + (Number(m.delta) || 0));
  }
  let best = null;
  for (const [id, sum] of acc) {
    if (Math.abs(sum) < threshold) continue;
    if (!best || Math.abs(sum) > Math.abs(best.sum)) best = { id, sum };
  }
  if (!best) return null;
  const unit = (units ?? []).find((u) => u.id === best.id);
  if (!unit) return null;
  return {
    id: best.id,
    delta: Number(best.sum.toFixed(3)),
    text: unit.text.slice(0, 30),
    line: best.sum > 0
      ? `最近她「${unit.text.slice(0, 20)}」这一点比平时更明显`
      : `最近她「${unit.text.slice(0, 20)}」这一点淡了些`,
  };
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
