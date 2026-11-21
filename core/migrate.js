// 记忆搬迁：老鱼把过去搬进来，新鱼从零开始。
//
// 宿主的记忆和大脑的记忆不是一回事：
//   宿主日记 = 流水账（发生过什么）
//   brain    = 带情绪的经历（她记得什么）
//
// 所以搬迁不是"复制一份"，是**有损转换**：只搬那些真的会留下印象的，
// 并且每条都标 source:'import'，将来能分清"亲历"和"听说的"。

export const MIGRATE_FORMATS = ['jsonl', 'days', 'generic'];

/** 一条宿主记录 → 她的经历。缺正文的直接丢。 */
export function toEpisode(item, { source = 'import' } = {}) {
  if (!item) return null;
  const text = String(item.text ?? item.what ?? item.content ?? item.message ?? '').trim();
  if (!text) return null;
  const at = Number(item.at ?? item.time ?? item.ts ?? item.createdAt);
  return {
    who: String(item.who ?? item.sender ?? item.name ?? item.from ?? '').trim(),
    what: text.slice(0, 140),
    feel: String(item.feel ?? item.mood ?? '').trim(),
    mood: String(item.mood ?? '').trim(),
    emotion: Number(item.emotion ?? 0) || 0,
    outcome: item.outcome ?? null,
    context: item.context ?? null,
    at: Number.isFinite(at) ? at : 0,
    source,
  };
}

/**
 * 解析 JSONL（一行一条 JSON）。
 * 坏行不炸，记进 errors 里——搬迁最怕"因为一行坏了整批不进"。
 */
export function parseJsonl(text) {
  const out = [];
  const errors = [];
  const lines = String(text ?? '').split(/\r?\n/);
  lines.forEach((line, i) => {
    const s = line.replace(/^\uFEFF/, '').trim();
    if (!s || s.startsWith('//') || s.startsWith('#')) return;
    try {
      const obj = JSON.parse(s);
      const ep = toEpisode(obj);
      if (ep) out.push(ep);
      else errors.push({ line: i + 1, reason: '没有正文' });
    } catch {
      errors.push({ line: i + 1, reason: '不是合法 JSON' });
    }
  });
  return { episodes: out, errors };
}

/**
 * 解析日记式 markdown。
 *
 * 不指望通用的自然语言理解——只认几种明确写法的行：
 *   - 某人："说了什么"          （冒号 + 引号）
 *   - 2026-11-20 某人：说了什么  （日期头 + 冒号）
 *   - `- 说了什么`               （无主语，算旁白）
 *
 * 认不出来的行直接跳过，不猜。**搬迁宁可少搬，不能瞎搬。**
 */
export function parseDailyNotes(text) {
  const out = [];
  const errors = [];
  let currentDate = 0;
  let head = '';

  const lines = String(text ?? '').split(/\r?\n/);
  lines.forEach((line, i) => {
    const s = line.replace(/^\uFEFF/, '').trim();
    if (!s) return;

    // 日期标题：## 2026-11-20
    const d = /(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (d && (s.startsWith('#') || s.length < 24)) {
      currentDate = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), 12, 0, 0);
      return;
    }

    // 说话行：某人：「…」 / 某人：…
    const say = /^[-*]?\s*([^\s：:]{1,16})\s*[：:]\s*[「“"]?(.+?)[」”"]?$/.exec(s);
    if (say && !/^\d/.test(say[1])) {
      const who = say[1].trim();
      const body = say[2].trim();
      if (body.length >= 2 && who.length <= 12) {
        out.push({
          who,
          what: body.slice(0, 140),
          feel: '',
          mood: '',
          emotion: 0,
          outcome: null,
          context: null,
          // 没有 `## YYYY-MM-DD` 日期头就不编时间——宁可空着，也不假装知道几号
          at: currentDate ? currentDate + out.length * 60_000 : 0,
          source: 'import',
        });
        return;
      }
    }

    // 无主语的项目符号：算旁白，who 留空
    const bullet = /^[-*]\s+(.+)$/.exec(s);
    if (bullet && bullet[1].trim().length >= 4) {
      out.push({
        who: head,
        what: bullet[1].trim().slice(0, 140),
        feel: '',
        mood: '',
        emotion: 0,
        outcome: null,
        context: null,
        at: currentDate + out.length * 60_000,
        source: 'import',
      });
      return;
    }

    errors.push({ line: i + 1, reason: '认不出格式（跳过，不猜）' });
  });

  return { episodes: out, errors };
}

/** 已经是数组就直接用 */
export function parseGeneric(list) {
  const out = [];
  const errors = [];
  (Array.isArray(list) ? list : []).forEach((item, i) => {
    const ep = toEpisode(item);
    if (ep) out.push(ep);
    else errors.push({ line: i + 1, reason: '没有正文' });
  });
  return { episodes: out, errors };
}

/** 按格式选解析器 */
export function parseAny(text, format = 'jsonl') {
  if (format === 'days') return parseDailyNotes(text);
  if (format === 'generic') {
    try {
      const j = JSON.parse(text);
      return parseGeneric(Array.isArray(j) ? j : j.episodes);
    } catch {
      return { episodes: [], errors: [{ line: 0, reason: '不是合法 JSON 数组' }] };
    }
  }
  return parseJsonl(text);
}

/**
 * 去重：同一段对话可能导两次。
 * 键 = 谁 + 前 40 字 + 时间（没有时间就只按前两项）。
 */
export function dedupe(episodes, { existing = [] } = {}) {
  const key = (e) => `${e.who ?? ''}|${String(e.what ?? '').slice(0, 40)}|${e.at || 0}`;
  const seen = new Set();
  for (const e of existing) seen.add(key(e));
  const fresh = [];
  let dup = 0;
  for (const e of episodes) {
    const k = key(e);
    if (seen.has(k)) { dup += 1; continue; }
    seen.add(k);
    fresh.push(e);
  }
  return { episodes: fresh, duplicated: dup };
}
