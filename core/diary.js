// 日记 = 她自己的心房。
//
// 不是宿主的流水账，是她用自己口吻写下来的东西。
// 脑子不生成文笔（那是嘴的事），脑子负责三件事：
//   ① 把今天发生了什么整理成素材（dayDigest）
//   ② 给一个第一人称的骨架，**带上当时的心情**
//   ③ 写好的存回去，将来能被检索到（writeDiary / readDiary）
//
// 心情从哪来：每条经历在 observe 时就记下了 mood（当时她什么感觉）。
// 搬进来的老记忆没有 mood —— 那就老实写"那天没记"，不编。

const DAY_MS = 24 * 60 * 60 * 1000;
const MEANINGLESS = new Set(['', '平静', '说不上来']);

export function dayKey(at = Date.now()) {
  const d = new Date(at);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function dayRange(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const start = new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0).getTime();
  return { start, end: start + DAY_MS };
}

function meaningful(mood) {
  return typeof mood === 'string' && !MEANINGLESS.has(mood.trim());
}

/** 这一天她经历了什么（按时间升序） */
export function episodesOfDay(memory, dateStr) {
  const { start, end } = dayRange(dateStr);
  return (memory.episodes ?? [])
    .filter((e) => (e.at ?? 0) >= start && (e.at ?? 0) < end)
    .sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
}

/** 当天出现过的情绪，按次数排，最多三个 */
export function moodsOfDay(memory, dateStr) {
  const eps = episodesOfDay(memory, dateStr);
  const freq = new Map();
  for (const e of eps) {
    const m = String(e.mood ?? '').trim();
    if (!meaningful(m)) continue;
    freq.set(m, (freq.get(m) ?? 0) + 1);
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([mood, n]) => ({ mood, count: n }));
}

/**
 * 今天的素材：发生了啥、见了谁、看了什么、**当时什么心情**。
 * 宿主拿这段去让模型用她的口吻写成日记，再调 writeDiary 存回来。
 */
export function dayDigest(brain, dateStr = dayKey()) {
  const eps = episodesOfDay(brain.memory, dateStr);
  const people = [...new Set(eps.map((e) => e.who).filter(Boolean))];

  // 那天刷过什么
  const { start, end } = dayRange(dateStr);
  const apps = {};
  for (const [app, bucket] of Object.entries(brain.memory?.apps ?? {})) {
    const items = (bucket.seen ?? []).filter((s) => (s.at ?? 0) >= start && (s.at ?? 0) < end);
    if (items.length) {
      apps[app] = {
        count: items.length,
        titles: items.slice(-3).map((i) => i.title),
        kinds: [...new Set(items.map((i) => i.kind).filter(Boolean))],
      };
    }
  }

  const moods = moodsOfDay(brain.memory, dateStr);
  // 当天没有经历情绪时，才退回"现在的心情"（只对今天成立）
  const nowMood = brain.affect?.mood ?? '';
  const isToday = dateStr === dayKey();
  const moodLine = moods.length
    ? moods.map((m) => m.mood).slice(0, 3).join(' / ')
    : (isToday && meaningful(nowMood) ? nowMood : '');

  const lines = [];
  lines.push(`# ${dateStr}`);
  lines.push('');
  if (people.length) lines.push(`今天跟${people.slice(0, 4).join('、')}说了话。`);
  if (eps.length) {
    lines.push('');
    for (const e of eps.slice(-12)) {
      const who = e.who ? `${e.who}：` : '';
      const feel = meaningful(e.mood) ? `（当时${e.mood}）` : '';
      lines.push(`- ${who}「${String(e.what ?? '').slice(0, 60)}」${feel}`);
    }
  }
  const appNames = Object.keys(apps);
  if (appNames.length) {
    lines.push('');
    for (const app of appNames) {
      const a = apps[app];
      lines.push(`在${app}上待了会儿，看了${a.count}条${a.kinds.length ? `（${a.kinds.join('/')}）` : ''}。`);
    }
  }
  lines.push('');
  lines.push(`心情：${moodLine || '（那天没记）'}`);
  lines.push('');

  return {
    date: dateStr,
    episodes: eps.length,
    people,
    apps,
    mood: moodLine,
    moods,
    /** 那天有记录的条数，用来区分"真的平静"和"没记" */
    moodRecorded: moods.length > 0,
    /** 第一人称骨架 —— 她自己往下写，别照抄 */
    draft: lines.join('\n'),
    /** 给模型的一句话提示 */
    hint: '用她自己的口吻把今天写成日记，别用第三人称，别总结升华；有心情就写进去，那天没记就别编。',
  };
}
