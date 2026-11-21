// 对外只有几个方法：出生 / 取 brief / 唤醒 / 观察 / 结算 / 快照。
//
// 两种用法：
//   ① 对象式（推荐给新用户）：createBrain({...}).wake(event)
//   ② 函数式（兼容老桥接）：wakeLine(id, cue) / observe(id, ev)
//
// 大脑不发送任何东西——发送是"身体"的事。这里只产出文本和记录。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { birthFromCard, lintCard, TRAIT_LEXICON } from './core/extract.js';
import { brief, decay, evolve, shed, weightReport, shellSummary, recentShift } from './core/persona.js';
import { styleVector, flowLevel, flowName, hashTraits, mulberry32 } from './core/derive.js';
import { createBody, chooseBody, bodyLine, canDo, hasCapability, CAPABILITY, BODY_KINDS, BODY_PROFILES, recordAction } from './core/body.js';
import { emptyMemory, addEpisode, addImagination, recall, settle, retrieve, touchByIds, distillGists, distillUmbrellas, nameFaded, detectRepeat, markImportant, markImportantByTopic, isRepeatNoise, textSimilarity, IMPORTANT_REPEAT, IMPORTANT_WINDOW_DAYS } from './core/memory.js';
import { addBond, bondDelta, bondOf, bondLine, decayBonds, bondSensitivity, markBondAbsent, clearBondAbsent, bondAbsentOf, ABSENT_MIN_TIER, BOND_TIERS, BOND_MAX } from './core/bond.js';
import { learnConcept, conceptOf, conceptAnswer, conceptsIn, makeQuestion } from './core/concept.js';
import { composeNarrative, narrativeChanged, NARRATIVE_MAX } from './core/self.js';
import { createContract, markAbsent as markAbsentContract, clearAbsent as clearAbsentRelation, relationLine, isAbsent } from './core/relation.js';
import { attribute, LABELS } from './core/attribution.js';
import { check } from './core/invariants.js';
import { toCue, toObservation, shouldObserve, normalizeEvent } from './core/event.js';
import * as emotion from './core/emotion.js';
import { makeCard, addCard, shouldCompact } from './core/memory.js';
import { parseAny, dedupe, MIGRATE_FORMATS } from './core/migrate.js';
import { dayKey, dayDigest } from './core/diary.js';
import { driverFor } from './core/driver.js';
import {
  recordSeen, recallApp, appTaste, appSummary, similarSeen, emptyApps,
  priorTaste, effectiveTaste, nudgeTraits, chooseApp, chooseContent, AFFINITY, APP_AFFINITY,
} from './core/apps.js';
import {
  ROOT, loadBrain, saveBrain, appendAudit, readAudit, listBrains,
  setDataDir, setRoleDir, dataDir, roleDir, brainDir, dataDirSource, isDataDirInsidePackage,
  setEpisodeWindow, episodeWindow, readYear, listYears,
} from './store.js';

const DEFAULT_ID = 'default';
const cache = new Map();

/* 全局开关（configure 改） */
let shadowMode = false;        // 影子模式：算但不写人设，全记进 shadow.jsonl
let ttlPolicy = 'hard';        // hard | summarize | archive | off
let moodPolicy = 'brain';      // 情绪双源：brain（脑说了算）| host（宿主说了算）| blend（各一半）
let compressDays = 21;         // 完整期：21 天没人提 → 压成卡片
let forgetDays = 730;          // 卡片期：2 年没人提 → 遗忘
let briefChars = 300;          // 「此刻的她」多长；老鱼可以调大
let maxEpisodes = 5000;        // 脑里最多存多少条，超了最老的压卡片

function nowMs() {
  return Date.now();
}

/** 同一条警告只打一次，别刷屏 */
const warnedOnce = new Set();
function logOnce(msg) {
  if (warnedOnce.has(msg)) return;
  warnedOnce.add(msg);
  try { console.warn(msg); } catch { /* 没有 console 也不影响 */ }
}

/**
 * 宿主初始化：指定数据目录和角色卡目录。
 *
 *   configure({ dataDir, roleDir })
 *   configure({ shadow: true })      影子模式：observe 只留审计，不动人设、不落盘
 *   configure({ ttlPolicy: 'off' })  hard(默认) | summarize(过期前压卡片) | off(永不遗忘)
 */
/**
 * 宿主初始化。
 *
 *   configure({ dataDir, roleDir })
 *   configure({ shadow: true })           影子模式：算但不写人设，全记进 shadow.jsonl
 *   configure({ ttlPolicy: 'off' })       hard(默认) | summarize | archive | off
 *   configure({ moodPolicy: 'host' })     brain | host | blend
 *   configure({ compressDays: 30 })       多少天没人提就压扁
 *   configure({ forgetDays: 90 })         多少天没人提就遗忘
 *   configure({ briefChars: 300 })        「此刻的她」多长（老鱼可以调到 600）
 *   configure({ maxEpisodes: 5000 })      脑里最多存多少条
 */
export function configure({
  dataDir: d, roleDir: r, shadow, ttl, mood,
  compressDays: cd, forgetDays: fd, briefChars: bc, maxEpisodes: me,
} = {}) {
  if (d) setDataDir(d);
  if (r) setRoleDir(r);
  if (typeof shadow === 'boolean') shadowMode = shadow;
  if (ttl && ['hard', 'summarize', 'archive', 'off'].includes(ttl)) ttlPolicy = ttl;
  if (mood && ['brain', 'host', 'blend'].includes(mood)) moodPolicy = mood;
  if (Number.isFinite(cd) && cd > 0) compressDays = Math.floor(cd);
  if (Number.isFinite(fd) && fd > compressDays) forgetDays = Math.floor(fd);
  // 经历按年分片：打开时只加载 forgetDays 窗口内的年份（16 年也不会越读越慢）
  setEpisodeWindow(forgetDays);
  if (Number.isFinite(bc) && bc >= 100) briefChars = Math.floor(bc);
  if (Number.isFinite(me) && me >= 100) maxEpisodes = Math.floor(me);
}

export function runtimeOptions() {
  return {
    shadow: shadowMode,
    ttlPolicy,
    moodPolicy,
    compressDays,
    forgetDays,
    briefChars,
    maxEpisodes,
    dataDir: dataDir(),
    dataDirSource: dataDirSource(),
    dataDirInsidePackage: isDataDirInsidePackage(),
    roleDir: roleDir(),
  };
}

/**
 * 情绪双源仲裁。
 *
 * 宿主往往已经有自己的情绪系统（比如 state/emotion.json）。两边都能改情绪时必须定个优先级：
 *
 *   brain （默认）  宿主推过来的直接忽略，脑说了算
 *   host          情绪以宿主为准，`feel()` 只算不写
 *   blend         各占一半
 */
export function syncMood(id = DEFAULT_ID, pad = [], { policy } = {}) {
  const brain = ensureBrain(id);
  const p = ['brain', 'host', 'blend'].includes(policy) ? policy : moodPolicy;
  const host = [0, 1, 2].map((i) => {
    const v = Number(pad?.[i]);
    return Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;
  });

  if (p === 'brain') {
    return { ok: true, ignored: true, policy: p, affect: brain.affect };
  }

  const cur = [Number(brain.affect?.p) || 0, Number(brain.affect?.a) || 0, Number(brain.affect?.d) || 0];
  const next = p === 'host' ? host : cur.map((c, i) => Number(((c + host[i]) / 2).toFixed(4)));

  brain.affect = {
    ...brain.affect,
    p: next[0],
    a: next[1],
    d: next[2],
    moodSource: p,
  };
  saveBrain(brain);
  appendAudit(id, { kind: 'mood-sync', policy: p, pad: next });
  return { ok: true, ignored: false, policy: p, affect: brain.affect };
}

/** 读角色卡：优先显式名字，否则读 state/current-role.json。 */
export function resolveRoleCard(roleName) {
  let name = roleName;
  if (!name) {
    try {
      const stateFile = path.join(dataDir(), 'current-role.json');
      // 记事本会写 BOM，先剥掉再解析
      const raw = fs.readFileSync(stateFile, 'utf8').replace(/^\uFEFF/, '');
      name = JSON.parse(raw).role;
    } catch {
      name = null;
    }
  }
  if (!name) return null;
  const file = path.join(roleDir(), `${name}.md`);
  if (!fs.existsSync(file)) return null;
  return { name, file, text: fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '') };
}

function refreshBrief(brain) {
  brain.persona.brief = brief(brain.persona.units, { maxChars: briefChars });
  return brain;
}

function roundTraits(traits) {
  const out = {};
  for (const [k, v] of Object.entries(traits)) out[k] = Number(v.toFixed(2));
  return out;
}

function dominantStyle(style) {
  return Object.entries(style).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'naive';
}

/**
 * 出生：从一张角色卡长出来。
 * 同一张卡 → 同一条鱼（确定性）。
 *
 * body 指定她第一具身体（phone / tablet / desktop）；不指定就按人设算出来。
 */
export function birth({ id = DEFAULT_ID, relation = 'parent', address = '', cardText, cardName, body } = {}) {
  const card = cardText
    ? { name: cardName ?? id, text: cardText }
    : resolveRoleCard();
  if (!card?.text) {
    throw new Error(`找不到角色卡：请传 cardText，或把 ${roleDir()}/<角色>.md 放好`);
  }

  // 特质旁挂文件：roles/<名字>.traits.json，用来精确指定（比自动统计准）
  let traitsOverride = null;
  try {
    const sidecar = path.join(roleDir(), `${card.name}.traits.json`);
    if (fs.existsSync(sidecar)) traitsOverride = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
  } catch { traitsOverride = null; }

  const { traits, units, knownTraits, openTraits } = birthFromCard(card.text, { traitsOverride });
  // 命题的"最后一次被碰到"从出生算起——不然一条新鱼第一天就开始褪色
  const born = nowMs();
  for (const u of units) { u.lastTouched = born; u.born = born; }
  const brain = {
    id,
    schema: 'brain/2',
    born: nowMs(),
    roleCard: card.name,
    persona: {
      seed: cardName ? `card:${card.name}` : `${roleDir()}/${card.name}.md`,
      traits,
      // 已知 12 维（先验）与她自己长出来的维度分开存，方便看"哪些是她的原话"
      knownTraits: knownTraits ?? traits,
      openTraits: openTraits ?? {},
      units,
      brief: '',
      // 一年一度蜕壳：把这一年掉出去的人设打包成永久记忆卡片
      shellYear: new Date(born).getFullYear(),
      shellAt: born,
      // 最近几天的权重变动，用来生成「最近」那一段
      moves: [],
      // 人格主档只有一个：这里。外部卡只是"导入源"，导过就记下来。
      source: {
        kind: cardText ? 'inline' : 'file',
        name: card.name,
        source: 'birth',
        hash: crypto.createHash('sha1').update(String(card.text)).digest('hex').slice(0, 12),
        importedAt: nowMs(),
      },
    },
    relation: createContract(relation, address),
    self: { style: styleVector(traits), divergence: 0, narrative: '', styleName: null },
    state: { energy: 0.8, fatigue: 0.2, sleep: 'awake', flow: 1 },
    affect: { p: 0, a: 0, d: 0, mood: '平静' },
    drive: { curiosity: Math.min(1, 0.4 + (traits.好奇 ?? 0.3)), boredom: 0.5, social: 0.6 },
    memory: emptyMemory(),
    // 情绪词表：出生时是空的。她没有"委屈"这个词，只有感受。
    vocab: {},
    // 身体：手机 / 平板 / 电脑。没指定就按人设算——好动的摸手机，爱折腾的开电脑。
    body: createBody({ kind: body ?? chooseBody(traits, {}, mulberry32(hashTraits(traits))) }),
    patience: 1,
    meta: {
      lastSettle: nowMs(),
      observations: 0,
      version: '1.5.0',
      shadow: shadowMode,
      contractWarnings: [],
    },
  };

  brain.self.styleName = dominantStyle(brain.self.style);
  brain.self.narrative = `我还是那个${traits.嘴硬 > 0.6 ? '嘴硬' : '爱较真'}的${card.name}`;
  refreshBrief(brain);

  saveBrain(brain);
  appendAudit(id, { kind: 'birth', card: card.name, units: units.length, traits: roundTraits(traits) });
  cache.set(id, brain);
  return brain;
}

/** 取（或按需出生）。 */
export function ensureBrain(id = DEFAULT_ID) {
  if (cache.has(id)) return cache.get(id);
  let brain = loadBrain(id);
  if (!brain) brain = birth({ id });
  cache.set(id, brain);
  return brain;
}

export function getBrief(id = DEFAULT_ID) {
  const brain = ensureBrain(id);
  if (!brain.persona.brief) refreshBrief(brain);
  return brain.persona.brief;
}

/**
 * 唤醒：产出宿主拼进 prompt 的那一段（定长）。
 * 接受两种入参：
 *   - 通用事件 { sender, text, ... }
 *   - 线索 { who, words }
 *
 * 第三参数用来"点菜"——叠加到别人已有的系统里时，只取你要的那几段：
 *
 *   wakeLine(id, cue)                                  // 全给（默认）
 *   wakeLine(id, cue, { sections: ['mood'] })          // 只要心情，约 20 字
 *   wakeLine(id, cue, { sections: ['mood','memory'], budget: 300 })
 *
 * sections 可选：persona / flow / body / mood / memory / search
 * budget 是**总字数上限**，超了就从低优先级的段开始砍（persona 保底不砍）。
 */
export const WAKE_SECTIONS = ['persona', 'self', 'relation', 'bond', 'concept', 'flow', 'body', 'mood', 'recent', 'memory', 'search'];
/** 预算不够时的砍法：越靠后越先砍 */
const WAKE_PRIORITY = ['persona', 'self', 'relation', 'concept', 'bond', 'mood', 'recent', 'flow', 'memory', 'body', 'search'];

export function wakeLine(id = DEFAULT_ID, eventOrCue = null, opts = {}) {
  const brain = ensureBrain(id);
  if (!brain.persona.brief) refreshBrief(brain);

  const want = Array.isArray(opts?.sections) && opts.sections.length
    ? new Set(opts.sections.filter((s) => WAKE_SECTIONS.includes(s)))
    : new Set(WAKE_SECTIONS);
  const budget = Number.isFinite(opts?.budget) ? Number(opts.budget) : Infinity;

  const level = flowLevel(brain.state, { boredom: brain.drive.boredom });
  brain.state.flow = level;

  const seg = { persona: `【此刻的她】${brain.persona.brief}` };

  // 「我是谁」——会跟着经历长的那一句
  const nar = brain.self?.narrativeText ?? brain.self?.narrative;
  if (nar) seg.self = `【我是谁】${nar}`;

  // 缺位：那个人不在了。关系没断，但状态要说出来——
  // 不写"想念"，只给事实，怎么感受由她的人设决定。
  const relLine = relationLine(brain.relation);
  if (relLine) seg.relation = `【他】${relLine}`;

  // 恩情：除了主人，还有谁对她好过——这是她自己算的，不是标签
  const bonded = Object.keys(brain.memory.bonds ?? {})
    .filter((w) => w !== brain.relation?.address)
    .map((w) => bondOf(brain.memory, w))
    .filter((b) => b.tier !== 'stranger')
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);
  if (bonded.length) {
    seg.bond = `【他们】${bonded.map((b) => bondLine(brain.memory, b.who)).join('；')}`;
  }
  if (level !== 1) seg.flow = `【意识流】${flowName(level)}`;

  const bodyText = bodyLine(brain.body);
  if (bodyText) seg.body = `【手上的东西】${bodyText}`;

  // 心情段：还没学会词的时候不能说"不知道"，要给出身体感受——
  // 否则只要心情的宿主会拿到一个空段。
  const mood = brain.affect?.mood;
  if (mood && mood !== '平静') {
    seg.mood = mood === '说不上来'
      ? `【心情】${emotion.describeSensation([brain.affect.p ?? 0, brain.affect.a ?? 0, brain.affect.d ?? 0])}`
      : `【心情】${mood}`;
  }

  const cue = eventOrCue?.who !== undefined ? eventOrCue : toCue(eventOrCue);

  // 概念：这次聊到的东西她到底懂不懂
  const cs = conceptsIn(brain.memory, cue?.text ?? '');
  if (cs.length) {
    seg.concept = `【她懂的】${cs.map((c) => `${c.term}：${c.definition}${c.why ? `（${c.why}）` : ''}`).join('；')}`;
  }

  // 「最近」：每天 ±0.01 看不出来，七天攒起来就能说一句
  const shift = recentShift(brain.persona.moves, brain.persona.units, { at: nowMs() });
  if (shift) seg.recent = `【最近】${shift.line}`;
  if (cue) {
    const hit = retrieve(cue, brain.memory);
    if (hit.text) seg.memory = `【想到的】\n${hit.text}`;
    // 「被想起来」也算提起：检索命中的记忆会续命，一直没人想起的才会老化
    if (hit.items?.length) touchByIds(brain.memory, hit.items.map((i) => i.id), nowMs());

    // 外部检索器（向量/图谱）：同步读缓存，不 await
    if (extraRetriever) {
      try {
        const extra = extraRetriever(cue, brain.memory) ?? [];
        const lines = (Array.isArray(extra) ? extra : []).filter(Boolean).slice(0, 3);
        if (lines.length) seg.search = `【搜到的】\n${lines.join('\n')}`;
      } catch (e) {
        // 检索器坏了不能拖垮唤醒
        logOnce(`[brain] 外部检索器出错（已忽略）：${e?.message ?? e}`);
      }
    }
  }

  const out = [];
  let used = 0;
  for (const key of WAKE_PRIORITY) {
    if (!want.has(key)) continue;
    const text = seg[key];
    if (!text) continue;
    // persona 是根，再穷也得给；其余按预算砍
    if (key !== 'persona' && used + text.length > budget) continue;
    out.push(text);
    used += text.length;
  }
  return out.join('\n');
}

/**
 * 一次经历。接受通用事件，或显式字段。
 *
 *   event = { sender, text, ... }               ← 适配器直接传
 *   event = { consistent, conflicting, ... }    ← 高级用法
 *
 * 第三参数 opts：
 *   evolve   = true   记经历的同时，改人设权重（默认）
 *            = false  **只记经历，不碰人设** —— 叠加到别人已有的人格系统时用这个，
 *                     免得两套各说各话、token 翻倍
 *   remember = true   写进记忆（默认）
 */
export function observe(id = DEFAULT_ID, event = {}, opts = {}) {
  const brain = ensureBrain(id);
  const at = nowMs();
  const doEvolve = opts?.evolve !== false;
  const doRemember = opts?.remember !== false;

  const ev = event.consistent || event.conflicting || !event.sender
    ? event
    : normalizeEvent(event, event.platform);

  const consistent = ev.consistent ?? matchUnits(brain.persona.units, ev.text ?? '').consistent;
  const conflicting = ev.conflicting ?? matchUnits(brain.persona.units, ev.text ?? '').conflicting;

  // ── 影子模式 ──
  // 算但不写：人设权重、记忆、brain.json 一个字不动。
  // 但**不是空跑**——这一次的「本来会发生什么」全记进 shadow.jsonl，
  // 跑一百轮之后能看见她会长成什么样，再决定要不要真接。
  if (shadowMode || brain.meta.shadow) {
    const would = brain.persona.units
      .filter((u) => consistent.includes(u.id) || conflicting.includes(u.id))
      .map((u) => ({
        id: u.id,
        text: u.text.slice(0, 30),
        from: Number(u.weight.toFixed(3)),
        to: Number(Math.max(0, Math.min(1, u.weight + (consistent.includes(u.id) ? 1 : -1) * 0.01)).toFixed(3)),
      }));

    const entry = {
      at,
      text: String(ev.text ?? ev.what ?? '').slice(0, 100),
      wouldChange: would,
      wouldRemember: String(ev.what ?? ev.text ?? '').slice(0, 80),
      app: ev.app ?? null,
    };
    appendAudit(id, { kind: 'shadow', shadow: true, at, text: entry.text, wouldChange: would });
    try {
      fs.appendFileSync(path.join(brainDir(id), 'shadow.jsonl'), `${JSON.stringify(entry)}\n`, 'utf8');
    } catch (e) {
      logOnce(`[brain] shadow 写入失败（已忽略）：${e?.message ?? e}`);
    }
    return {
      brain, consistent, conflicting, label: null, shadow: true, evolved: false, remembered: false, wouldChange: would, shadowFile: path.join(brainDir(id), 'shadow.jsonl'),
    };
  }

  // step：默认 1（每次 ±0.01）。只有传了 magnitude（重大转折）才放大，上限 5。
  const step = Math.max(1, Math.min(5, Number(ev.magnitude) || 1));
  if (doEvolve) {
    const beforeW = new Map(brain.persona.units.map((u) => [u.id, u.weight]));
    brain.persona.units = evolve(brain.persona.units, { consistent, conflicting, at, step });

    // 记下这次的变动，攒成「最近」
    const moves = [];
    for (const u of brain.persona.units) {
      const b = beforeW.get(u.id);
      if (b !== undefined && b !== u.weight) {
        moves.push({ id: u.id, delta: Number((u.weight - b).toFixed(4)), at });
      }
    }
    if (moves.length) {
      brain.persona.moves = [...(brain.persona.moves ?? []), ...moves].slice(-300);
      // 按年累计，供年底蜕壳时总结"这一年我变了什么"
      const ym = brain.persona.yearMoves ?? {};
      for (const m of moves) ym[m.id] = Number(((ym[m.id] ?? 0) + m.delta).toFixed(4));
      brain.persona.yearMoves = ym;
    }

    // 蜕皮
    const sh = shed(brain.persona.units, { at });
    if (sh.formerSelves.length) {
      brain.persona.units = sh.units;
      brain.memory.formerSelves.push(...sh.formerSelves);
      for (const f of sh.formerSelves) {
        appendAudit(id, { kind: 'shed', id: f.id, weight: Number(f.weight.toFixed(3)), memoir: f.memoir });
      }
    }
  }

  // 带情绪的事件：先让她有感受，再记下来。
  // 否则 episode 记的是"这件事之前"的心情，日记里就变成时间错位。
  if (doRemember && Number.isFinite(Number(ev.valence))) {
    try {
      feel(id, {
        valence: Math.max(-1, Math.min(1, Number(ev.valence))),
        intensity: Number.isFinite(Number(ev.intensity)) ? Math.max(0, Math.min(1, Number(ev.intensity))) : 0.5,
        what: ev.what ?? ev.text ?? '',
      });
    } catch (e) {
      logOnce(`[brain] 事件自带情绪但算失败（已忽略）：${e?.message ?? e}`);
    }
  }

  // 记忆
  const obs = ev.what
    ? ev
    : (ev.text ? { who: ev.who ?? ev.sender ?? '', what: String(ev.text).slice(0, 80), feel: ev.feel ?? '', via: ev.via ?? 'api' } : null);
  if (doRemember && obs?.what) {
    // 反复出现的事 → 重要记忆，永不压扁
    const rep = detectRepeat(brain.memory, { who: obs.who ?? '', what: obs.what }, at);
    const ep = addEpisode(brain.memory, {
      who: obs.who ?? '',
      what: obs.what,
      feel: ev.feel ?? '',
      mood: ev.mood ?? brain.affect.mood,
      emotion: ev.emotion ?? brain.affect.a,
      outcome: ev.outcome ?? null,
      context: ev.context ?? null,
      strategy: ev.action?.strategy ?? null,
      evidence: obs.via ?? 'chat',
      source: 'live',
      ...(rep.important ? { important: true, longTerm: true, importantCount: rep.count, importantSample: rep.sample } : {}),
    }, at);
    if (rep.important) {
      // 追溯：之前提过的同话题也转重要，别让前两次被压成卡片
      const back = markImportantByTopic(brain.memory, { who: obs.who ?? '', what: obs.what }, at);
      appendAudit(id, { kind: 'important', count: rep.count, backfilled: back, what: String(obs.what).slice(0, 40) });
      void ep;
    }
  }

  if (doRemember && ev.action) {
    const label = attribute(ev.action, brain.memory);
    appendAudit(id, { kind: 'attribution', label, strategy: ev.action.strategy });
    brain.meta.lastLabel = label;
    if (!brain.memory.strategies[ev.action.strategy]) {
      brain.memory.strategies[ev.action.strategy] = { learnedAt: at, uses: 0 };
    }
    brain.memory.strategies[ev.action.strategy].uses += 1;
  }

  // 平台记忆：她刷到过什么（有 app 才记）
  if (doRemember && ev.app && (ev.title || ev.text)) {
    recordSeen(brain.memory, ev.app, {
      title: ev.title ?? String(ev.text).slice(0, 60),
      kind: ev.kind ?? '',
      reaction: Number.isFinite(ev.reaction) ? ev.reaction : 0,
      minutes: Number(ev.minutes) || 0,
    });
    appendAudit(id, { kind: 'seen', app: ev.app, title: String(ev.title ?? ev.text).slice(0, 40) });

    // ── 闭环：刷到的东西反过来改人设 ──
    // 看的解压视频多了，"懒"这条特质就真的涨一点；人设变了，下次爱看的就不一样。
    // evolve:false 时这条也关掉——只当记忆库用，就不该偷偷改人设。
    if (doEvolve) {
      const { traits: nextTraits, delta } = nudgeTraits(brain.persona.traits, ev.kind ?? '', Number(ev.reaction) || 0);
      if (Object.keys(delta).length) {
        brain.persona.traits = nextTraits;
        brain.self.style = styleVector(nextTraits);
        brain.self.styleName = dominantStyle(brain.self.style);
        appendAudit(id, { kind: 'trait-drift', app: ev.app, contentKind: ev.kind, delta });
      }
    }
  }

  // 关系记忆：互动次数
  const who = ev.who ?? ev.sender;
  if (doRemember && who) {
    const im = brain.memory.impressions[who] ?? { traits: [], count: 0, lastAt: at };
    im.count += 1;
    im.lastAt = at;
    if (ev.feel) im.traits = [...new Set([...(im.traits ?? []), ev.feel])].slice(-6);
    brain.memory.impressions[who] = im;

    // 恩情：谁对我好，是算出来的，不是写死的
    //   care   = 真的照顾（充电、开窗、修我）base 8
    //   普通互动 base 1；被凶了会扣
    const isOwner = brain.relation?.address && who === brain.relation.address;
    if (!isOwner) {
      const base = ev.care ? 8 : 1;
      const valence = Number.isFinite(Number(ev.valence)) ? Number(ev.valence) : 1;
      const d = bondDelta({ traits: brain.persona.traits, base, valence });
      if (d) {
        addBond(brain.memory, who, { delta: d, at, what: ev.care ? 'care' : 'talk' });
        const b = bondOf(brain.memory, who);
        if (b.tier !== 'stranger') appendAudit(id, { kind: 'bond', who, delta: d, score: b.score, tier: b.tier });
      }
    }
  }

  brain.meta.observations += 1;
  brain.meta.lastObservationAt = at;
  refreshBrief(brain);
  saveBrain(brain);
  return { brain, consistent, conflicting, label: brain.meta.lastLabel, evolved: doEvolve, remembered: doRemember };
}

/** 关键词匹配：粗但确定（中文按二元组）。 */
export function matchUnits(units, text = '') {
  const consistent = [];
  const conflicting = [];
  if (!text) return { consistent, conflicting };
  const grams = bigrams(text);
  for (const u of units) {
    const uGrams = bigrams(u.text);
    let hit = 0;
    for (const g of grams) if (uGrams.has(g)) hit += 1;
    const score = hit / Math.max(1, Math.min(grams.size, 8));
    if (score >= 0.5) consistent.push(u.id);
    else if (score >= 0.3 && /不|别|没/.test(text)) conflicting.push(u.id);
  }
  return { consistent, conflicting };
}

function bigrams(text) {
  const clean = String(text).replace(/[\s，。；、！？,.!?;:"'（）()【】\[\]「」]/g, '');
  const set = new Set();
  for (let i = 0; i < clean.length - 1; i += 1) set.add(clean.slice(i, i + 2));
  return set;
}

/**
 * 每日结算：人设衰减 + 记忆两层老化（压扁 → 遗忘）+ 蜕皮。幂等，可以随便跑。
 *
 * 老化不是"到期删除"：先压扁成一句"大概"，再更久没人提才真正遗忘。
 * 全程把原文摊进 archive.jsonl——**忘的是检索，不是档案。**
 */
export function settleBrain(id = DEFAULT_ID, now = nowMs()) {
  const brain = ensureBrain(id);
  const days = Math.max(0, (now - (brain.meta.lastSettle ?? now)) / (24 * 60 * 60 * 1000));
  if (days >= 1) {
    // ── 一年一度蜕壳：跨自然年时，把这一年掉出去的人设收进永久卡片 ──
    const thisYear = new Date(now).getFullYear();
    const prevYear = brain.persona.shellYear ?? thisYear;
    if (thisYear > prevYear) {
      const s = shellSummary(brain.persona.units, brain.memory.formerSelves, {
        year: prevYear, at: now, yearMoves: brain.persona.yearMoves ?? {},
      });
      if (s.changed > 0) {
        addCard(brain.memory, {
          id: `shell_${prevYear}`,
          kind: 'card',
          title: s.title,
          text: s.text,
          at: now,
          lastRecall: now,
          expiresAt: now + 1000 * 365 * 24 * 60 * 60 * 1000,
          consecutiveDays: 1,
          longTerm: true,
          // 永久：这是"我以前是谁"的唯一凭证，不许老化
          important: true,
          source: 'shell',
        });
        appendAudit(id, { kind: 'shell', year: prevYear, changed: s.changed, text: s.text.slice(0, 60) });
      }
      brain.persona.shellYear = thisYear;
      brain.persona.shellAt = now;
      brain.persona.yearMoves = {};
      // 蜕了壳，「我是谁」要跟着重写
      refreshNarrative(brain, 'shell');
    }

    // 人设：只有长期没人碰的命题才褪色
    brain.persona.units = decay(brain.persona.units, Math.floor(days), now, { quietDays: compressDays });
    const sh = shed(brain.persona.units, { at: now });
    if (sh.formerSelves.length) {
      brain.persona.units = sh.units;
      brain.memory.formerSelves.push(...sh.formerSelves);
      for (const f of sh.formerSelves) {
        appendAudit(id, { kind: 'shed', id: f.id, weight: Number(f.weight.toFixed(3)), memoir: f.memoir });
      }
    }

    if (ttlPolicy === 'summarize' || ttlPolicy === 'archive') {
      const card = makeCard(brain.memory.episodes.slice(-12));
      if (card) addCard(brain.memory, card);
    }

    const archived = [];
    if (ttlPolicy !== 'off') {
      settle(brain.memory, now, {
        compressDays,
        forgetDays,
        onArchive: (item, reason) => archived.push({ ...item, archiveReason: reason }),
      });
    }

    // 原文一律留档：压扁的和遗忘的都写进 archive.jsonl
    if (archived.length) {
      try {
        fs.appendFileSync(
          path.join(brainDir(id), 'archive.jsonl'),
          `${archived.map((x) => JSON.stringify(x)).join('\n')}\n`,
          'utf8',
        );
      } catch (e) {
        logOnce(`[brain] 归档写入失败（已忽略）：${e?.message ?? e}`);
      }
    }
    if (brain.memory.forgotten.length > 500) {
      brain.memory.forgotten = brain.memory.forgotten.slice(-500);
    }

    // 提炼纲和伞：细节会烂，但"我认识他""这事发生过""我上过学"不能跟着烂
    try {
      distillGists(brain.memory, now);
      distillUmbrellas(brain.memory, now);
    } catch (e) {
      logOnce(`[brain] 纲/伞提炼失败（已忽略）：${e?.message ?? e}`);
    }

    brain.meta.lastSettle = now;
    refreshBrief(brain);
    saveBrain(brain);
    if (archived.length) appendAudit(id, { kind: 'aging', archived: archived.length });
  }
  return brain;
}

/* ── 快照 / 回滚 ─────────────────────────────────────────────── */

/** 给现在的她存个档，坏了能退回来。 */
export function snapshotBrain(id = DEFAULT_ID, name = '') {
  const brain = ensureBrain(id);
  const dir = path.join(brainDir(id), 'snapshots');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(dir, `${name || stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(brain, null, 2), 'utf8');
  appendAudit(id, { kind: 'snapshot', name: path.basename(file, '.json') });
  return { ok: true, name: path.basename(file, '.json'), file };
}

/** 退回到某个快照。权重逐条还原。 */
export function restoreBrain(id = DEFAULT_ID, name = '') {
  if (!name) return { ok: false, reason: '要说退回到哪个快照' };
  const dir = path.join(brainDir(id), 'snapshots');
  const file = name.endsWith('.json') ? path.join(dir, name) : path.join(dir, `${name}.json`);
  if (!fs.existsSync(file)) {
    const list = listSnapshots(id).map((s) => s.name);
    return { ok: false, reason: `没有这个快照：${name}`, available: list };
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  data.id = id;
  saveBrain(data);
  cache.set(id, data);
  appendAudit(id, { kind: 'restore', name });
  return { ok: true, restored: name, check: identityCheck(id) };
}

export function listSnapshots(id = DEFAULT_ID) {
  const dir = path.join(brainDir(id), 'snapshots');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({
      name: f.replace(/\.json$/, ''),
      size: fs.statSync(path.join(dir, f)).size,
      at: fs.statSync(path.join(dir, f)).mtimeMs,
    }))
    .sort((a, b) => b.at - a.at);
}

/* ── 导入历史 ───────────────────────────────────────────────── */

/**
 * 把宿主已有的历史经历灌进来。
 *
 * 宿主那边往往已经有日记/经验库，不导进来就是"两套记忆各记一套"，
 * 用户问「你记得吗」会出现两个答案。
 *
 * @param {Array} list [{ who, text|what, at, feel, mood, emotion }]
 */
export function importEpisodes(id = DEFAULT_ID, list = [], { source = 'import' } = {}) {
  const brain = ensureBrain(id);
  let imported = 0;
  let skipped = 0;
  const touched = new Map(); // who → 次数

  for (const it of Array.isArray(list) ? list : []) {
    const what = String(it?.text ?? it?.what ?? '').trim();
    if (!what) { skipped += 1; continue; }
    const at = Number(it?.at) || nowMs();
    // ⚠️ 第三个参数必须是「现在」，不是 at。
    // 它同时决定 lastRecall（多久没被提起）；传历史时间会让刚搬进来的记忆
    // 一出生就过期，第一次结算就被清空。
    addEpisode(brain.memory, {
      at,
      who: it.who ?? '',
      what: what.slice(0, 140),
      feel: it.feel ?? '',
      mood: it.mood ?? '',
      emotion: Number(it.emotion) || 0,
      outcome: it.outcome ?? null,
      context: it.context ?? null,
      strategy: it.strategy ?? null,
      evidence: it.via ?? source,
      source, // live | import | diary
      // 搬进来的是「已经沉淀过的」——它在宿主那边活过了，不该再按新经历老化
      ...(source === 'import' ? { longTerm: Boolean(it.longTerm ?? false) } : {}),
    }, nowMs());
    imported += 1;
    const who = String(it.who ?? '').trim();
    if (who) touched.set(who, (touched.get(who) ?? 0) + 1);
  }

  // 搬进来的也要"认识这个人"——否则检索里永远"还不熟"
  for (const [who, n] of touched) {
    const im = brain.memory.impressions[who] ?? { traits: [], count: 0, lastAt: 0 };
    im.count += n;
    im.lastAt = Math.max(Number(im.lastAt) || 0, nowMs());
    brain.memory.impressions[who] = im;
  }

  saveBrain(brain);
  appendAudit(id, { kind: 'import-episodes', imported, skipped, source, people: touched.size });
  return { ok: true, imported, skipped, people: touched.size, total: brain.memory.episodes.length };
}

/** 记一次"想起"（续命）。 */
export function touch(id, key, { pool = 'facts' } = {}) {
  const brain = ensureBrain(id);
  if (pool === 'facts' && brain.memory.facts[key]) {
    brain.memory.facts[key] = recall(brain.memory.facts[key]);
  }
  return brain;
}

/**
 * 换身体：放下手机坐到电脑前，或者反过来。
 * 没有身体也能活着——只是"想而不得"。
 */
export function setBody(id = DEFAULT_ID, kind, { ownership, apps, scope } = {}) {
  const brain = ensureBrain(id);
  const prev = brain.body?.kind ?? null;
  brain.body = createBody({
    kind,
    ownership: ownership ?? brain.body?.ownership ?? 'owned',
    apps,
    scope,
  });
  saveBrain(brain);
  appendAudit(id, { kind: 'body', from: prev, to: kind, ownership: brain.body.ownership });
  return brain.body;
}

/** 她想做一件事——这具身体能不能做。永远不抛。 */
export function tryBody(id = DEFAULT_ID, action = {}) {
  const brain = ensureBrain(id);
  const res = canDo(brain.body, action);
  if (!res.ok) appendAudit(id, { kind: 'body-deny', action: action?.type ?? 'unknown', code: res.code });
  return res;
}

/* ── 情绪：按当前情况演变 ─────────────────────────────────────── */

/**
 * 一件事发生了，她此刻是什么感受。
 *
 * 同一件事，人设 + 状态决定坐标：
 *   有劲的鱼 → 掌控感高 → 靠近"生气"
 *   累垮的鱼 → 掌控感低 → 靠近"委屈"
 *
 * @param {object} event { valence:-1~1, intensity:0~1, what?, who? }
 * @param {object} [opts] { blend=0.65 } 新情绪占多少，剩下的是余温
 */
export function feel(id = DEFAULT_ID, event = {}, { blend = 0.65 } = {}) {
  const brain = ensureBrain(id);
  const r = emotion.feel({
    event,
    traits: brain.persona.traits,
    state: brain.state,
    vocab: brain.vocab,
  });

  // 情绪有余温：新感受占 65%，上一次剩 35%。
  // 否则每件事都把心情冲成新的，人会像开关而不是像有情绪惯性的活物。
  const k = Math.max(0, Math.min(1, Number(blend)));

  // 双源仲裁：宿主说了算时，只算不写——免得两套情绪系统互相覆盖
  if (moodPolicy === 'host') {
    brain.meta.lastFeel = { at: Date.now(), pad: r.pad, label: r.label, stage: r.stage, text: r.text, applied: false };
    saveBrain(brain);
    return { ...r, applied: false, reason: 'moodPolicy=host，情绪以宿主为准，这里只算不写' };
  }

  const prev = brain.affect ?? {};
  const effBlend = moodPolicy === 'blend' ? Math.min(k, 0.5) : k;
  const mix = (next, before) => {
    const old = Number(before);
    const base = Number.isFinite(old) ? old : 0;
    return Number((next * effBlend + base * (1 - effBlend)).toFixed(4));
  };

  brain.affect = {
    p: mix(r.pad[0], prev.p),
    a: mix(r.pad[1], prev.a),
    d: mix(r.pad[2], prev.d),
    // 名字按**这次**的感受叫：旧的余温不该拖住命名
    mood: r.label.kind === 'word' ? r.label.word : (r.label.kind === 'variant' ? `${r.label.word}（变体）` : '说不上来'),
    // 余温多少，方便调试时看"她还没缓过来"
    carryover: Number((1 - effBlend).toFixed(2)),
    moodSource: moodPolicy,
  };
  brain.meta.lastFeel = { at: Date.now(), pad: r.pad, blended: [brain.affect.p, brain.affect.a, brain.affect.d], label: r.label, stage: r.stage, text: r.text, applied: true };
  saveBrain(brain);
  return { ...r, applied: true, blended: [brain.affect.p, brain.affect.a, brain.affect.d] };
}

/**
 * 学一个情绪词。**必须两个以上来源一致**才采纳。
 * @param {string[]} sources 例如 ['user:扶摇','douyin'] / ['user:老爹','群聊']
 */
export function learnEmotion(id = DEFAULT_ID, word, { pad, sources = [], cause = '' } = {}) {
  const brain = ensureBrain(id);
  const r = emotion.learn(brain.vocab, word, { pad, sources, cause });
  if (r.learned) {
    brain.vocab = r.vocab;
    saveBrain(brain);
    appendAudit(id, { kind: 'learn-emotion', word, sources: r.sources });
  }
  return { ...r, stage: emotion.stageOf(brain.vocab), knownWords: Object.keys(brain.vocab).length };
}

/** 阶段三：从 ≥3 个实例里自己归纳出这个词的含义。 */
export function induceEmotion(id = DEFAULT_ID, word) {  const brain = ensureBrain(id);
  const r = emotion.induce(brain.vocab, word);
  if (r.induced) {
    brain.vocab = r.vocab;
    saveBrain(brain);
    appendAudit(id, { kind: 'induce-emotion', word, cause: r.definition.cause });
  }
  return r;
}

export function vocabOf(id = DEFAULT_ID) {
  const brain = ensureBrain(id);
  return {
    stage: emotion.stageOf(brain.vocab),
    words: Object.keys(brain.vocab),
    detail: brain.vocab,
  };
}

/**
 * 给老鱼预装一份情绪词表。
 *
 * **新鱼用不到**——她该从"说不清"开始学。
 * 但一条活了两年的鱼搬进来，不该从"哼哼"开始。
 */
export const BASIC_VOCAB = ['委屈', '生气', '高兴', '失落', '烦', '慌', '得意', '无聊', '累', '暖'];

export function seedVocab(id = DEFAULT_ID, words = BASIC_VOCAB) {
  const brain = ensureBrain(id);
  let added = 0;
  for (const w of words) {
    if (brain.vocab[w]) continue;
    const p = emotion.PROTOTYPES[w];
    if (!p) continue;
    brain.vocab[w] = {
      pad: [...p.pad],
      cause: p.cause,
      body: p.body,
      action: p.action,
      instances: [],
      sources: ['seed'],
      learnedAt: Date.now(),
    };
    added += 1;
  }
  saveBrain(brain);
  appendAudit(id, { kind: 'seed-vocab', added, total: Object.keys(brain.vocab).length });
  return { ok: true, added, total: Object.keys(brain.vocab).length, stage: emotion.stageOf(brain.vocab) };
}

/**
 * 精确导入词表（来自 exportPack，或别的系统导出的）。
 * @param {Array} list [{ word, pad:[p,a,d], cause, body, action, instances }]
 */
export function importVocab(id = DEFAULT_ID, list = []) {
  const brain = ensureBrain(id);
  let imported = 0;
  for (const it of Array.isArray(list) ? list : []) {
    const word = String(it?.word ?? it?.name ?? '').trim();
    if (!word) continue;
    const proto = emotion.PROTOTYPES[word] ?? {};
    const pad = Array.isArray(it.pad)
      ? [0, 1, 2].map((i) => Math.max(-1, Math.min(1, Number(it.pad[i]) || 0)))
      : (proto.pad ?? [0, 0, 0]);
    brain.vocab[word] = {
      pad,
      cause: it.cause ?? proto.cause ?? '',
      body: it.body ?? proto.body ?? '',
      action: it.action ?? proto.action ?? '',
      instances: Array.isArray(it.instances) ? it.instances.slice(-20) : [],
      sources: [...new Set([...(it.sources ?? []), 'import'])].slice(-8),
      learnedAt: Number(it.learnedAt) || Date.now(),
    };
    imported += 1;
  }
  saveBrain(brain);
  appendAudit(id, { kind: 'import-vocab', imported, total: Object.keys(brain.vocab).length });
  return { ok: true, imported, total: Object.keys(brain.vocab).length, stage: emotion.stageOf(brain.vocab) };
}

/* ── 记忆卡片：上下文过长时压缩中段 ───────────────────────────── */

export function needsCard(id = DEFAULT_ID, contextChars = 0) {
  return shouldCompact(contextChars);
}

/**
 * 把最近的一段经历压成一张卡片（≈160 字）。
 * 原文可以裁掉，卡片留在上下文里。
 */
export function compactNow(id = DEFAULT_ID, { episodes } = {}) {
  const brain = ensureBrain(id);
  const list = Array.isArray(episodes) ? episodes : brain.memory.episodes.slice(-12);
  const card = makeCard(list);
  if (!card) return { ok: false, reason: '没有可压缩的经历' };
  addCard(brain.memory, card);
  saveBrain(brain);
  appendAudit(id, { kind: 'card', chars: card.chars, from: card.from.length });
  return { ok: true, card };
}

export function cardsOf(id = DEFAULT_ID) {
  return ensureBrain(id).memory.cards ?? [];
}

/* ── 身体驱动：真的去开 App ───────────────────────────────────── */

const drivers = new Map(); // id -> driver

function getDriver(brain) {
  const key = `${brain.id}:${brain.body?.kind}:${brain.body?.ownership}`;
  if (drivers.has(key)) return drivers.get(key);
  const d = driverFor(brain.body, {
    adbPath: process.env.FEISHU_ADB || 'adb',
    deviceId: process.env.FEISHU_DEVICE || '',
    evidenceDir: path.join(dataDir(), 'evidence', brain.body?.kind ?? 'none'),
  });
  drivers.set(key, d);
  return d;
}

/**
 * 让她真的做一件事。
 *
 *   execAction('default', { type:'open_app', package:'com.ss.android.ugc.aweme', app:'douyin', capability:2 })
 *   execAction('default', { type:'screenshot' })
 *
 * 先过权限闸，再调驱动，最后记账——**没有 evidence 的动作不算发生**。
 */
export async function execAction(id = DEFAULT_ID, action = {}) {
  const brain = ensureBrain(id);
  const gate = canDo(brain.body, action);
  if (!gate.ok) {
    appendAudit(id, { kind: 'deny', code: gate.code, action: action.type });
    return gate;
  }

  const driver = getDriver(brain);
  const res = await driver.exec(action);
  const rec = recordAction(brain.body, action, res, res.evidence);
  brain.memory.lastActions = [...(brain.memory.lastActions ?? []), rec].slice(-50);
  saveBrain(brain);
  appendAudit(id, {
    kind: 'action',
    type: action.type,
    ok: res.ok !== false,
    code: res.code ?? 'OK',
    evidence: res.evidence ?? null,
  });
  return res;
}

/**
 * 卸载：**临界点 + 三问**，两个都过才动手。
 *
 * @param {object} q  { why:'追到的事件', fits:true, consequence:'删了会怎样' }
 */
export async function requestUninstall(id = DEFAULT_ID, pkg, q = {}) {
  const brain = ensureBrain(id);
  if (!pkg) return { ok: false, code: 'E_ARGS', reason: '缺 package' };

  const threshold = 0.5 + 0.4 * (brain.persona.traits?.心软 ?? 0.5);
  if ((brain.patience ?? 1) < threshold) {
    return {
      ok: false,
      code: 'E_NOT_YET',
      reason: `还没攒够（忍耐 ${Number(brain.patience ?? 1).toFixed(2)} < 临界 ${threshold.toFixed(2)}）——那只是情绪，不是决定`,
    };
  }

  if (!q.why) return { ok: false, code: 'Q1', reason: 'Q1 没过：说不出为什么想删' };
  if (q.fits === false) return { ok: false, code: 'Q2', reason: 'Q2 没过：这不像她会做的事' };
  if (!q.consequence) return { ok: false, code: 'Q3', reason: 'Q3 没过：没想过删了会怎样' };

  return execAction(id, { type: 'uninstall', package: pkg, capability: CAPABILITY.DESTROY });
}

/* ── 重大转折：一次改多条，但必须留证据 ───────────────────────── */

/**
 * 她想通了一件事——允许一次推动多条命题，不像日常那样只动 0.01。
 *
 * @param {object} o
 * @param {string[]} o.units     要动的命题 id
 * @param {'up'|'down'} o.direction
 * @param {number} [o.magnitude] 1~5，对应 ±0.01×magnitude
 * @param {string} o.evidence    凭什么改（必填，没有证据不许改）
 */
export function reframe(id = DEFAULT_ID, { units = [], direction = 'up', magnitude = 3, evidence = '' } = {}) {
  const brain = ensureBrain(id);
  if (!evidence) return { ok: false, reason: '没有证据的转折不算转折' };
  if (!units.length) return { ok: false, reason: '没指定要动哪几条命题' };

  const before = Object.fromEntries(brain.persona.units.filter((u) => units.includes(u.id)).map((u) => [u.id, u.weight]));
  brain.persona.units = evolve(brain.persona.units, {
    consistent: direction === 'up' ? units : [],
    conflicting: direction === 'down' ? units : [],
    at: nowMs(),
    step: magnitude,
  });
  const after = Object.fromEntries(brain.persona.units.filter((u) => units.includes(u.id)).map((u) => [u.id, u.weight]));

  refreshBrief(brain);
  saveBrain(brain);
  appendAudit(id, { kind: 'reframe', direction, magnitude, evidence: String(evidence).slice(0, 120), before, after });
  return { ok: true, direction, magnitude, before, after };
}

/* ── 人格卡：只加载，不代写 ───────────────────────────────────── */

/**
 * 换一张人格卡。这是"已经写好的鱼只需要加载卡"的入口。
 *
 * **不生成卡，只接收卡。** 卡必须由用户写（或别的工具写），这里只负责装进来。
 * 记忆、关系、身体、情绪词表全部保留——只换人格部分。
 */
export function importRoleCard(id = DEFAULT_ID, cardText, { name = 'imported', source = 'manual' } = {}) {
  if (!cardText || String(cardText).trim().length < 20) {
    return { ok: false, reason: '卡太短了，至少 20 字' };
  }
  const brain = ensureBrain(id);
  const prev = {
    units: brain.persona.units.length,
    traits: roundTraits(brain.persona.traits),
    source: brain.persona.source ?? null,
  };

  const { traits, units } = birthFromCard(String(cardText));
  const hash = crypto.createHash('sha1').update(String(cardText)).digest('hex').slice(0, 12);

  brain.persona = {
    ...brain.persona,
    traits,
    units,
    brief: '',
    source: { kind: 'card', name, source, hash, importedAt: nowMs() },
  };
  brain.self.style = styleVector(traits);
  brain.self.styleName = dominantStyle(brain.self.style);

  refreshBrief(brain);
  saveBrain(brain);
  appendAudit(id, { kind: 'import-card', name, hash, units: units.length, prevUnits: prev.units });

  return { ok: true, name, hash, units: units.length, previous: prev, traits: roundTraits(traits) };
}

/* ── 检索：内置关键词 + 可插拔的语义检索 ─────────────────────── */

let extraRetriever = null;

/**
 * 接一个外部检索器（向量库、图谱都行）。
 *
 * 约定：**同步**返回字符串数组，按相关度从高到低。
 * 异步检索（向量/网络）请在宿主侧预取成缓存，这里只读缓存——
 * 因为唤醒是同步路径，await 会把桥接卡住。
 *
 * @param {(cue:object, memory:object) => string[]} fn  传 null 取消
 */
export function setRetriever(fn) {
  extraRetriever = typeof fn === 'function' ? fn : null;
  return extraRetriever !== null;
}

export function currentRetriever() {
  return extraRetriever;
}

/* ── 平台记忆：她刷过什么 ─────────────────────────────────────── */

/** 记一条"她在某平台看到了什么"（不吃人设，只进记忆） */
export function recordAppSeen(id = DEFAULT_ID, app, item = {}) {
  const brain = ensureBrain(id);
  const entry = recordSeen(brain.memory, app, item);
  if (!entry) return { ok: false, reason: '缺 app 名' };
  saveBrain(brain);
  return { ok: true, app, entry };
}

/** 某个平台的印象；不传 app 就返回全部平台的摘要 */
export function appMemory(id = DEFAULT_ID, app = null) {
  const brain = ensureBrain(id);
  const traits = brain.persona.traits;
  if (!app) return appSummary(brain.memory, traits);
  return {
    taste: appTaste(brain.memory, app, { traits, limit: 8 }),
    recent: recallApp(brain.memory, app, { limit: 10 }),
    summary: appSummary(brain.memory, traits)[app] ?? null,
  };
}

/** 她此刻更想摸哪个 App（由当前人设算） */
export function pickApp(id = DEFAULT_ID, rng = Math.random) {
  return chooseApp(ensureBrain(id).persona.traits, rng);
}

/**
 * 从那批内容里挑一条她想看的。
 * pool = [{ title, kind }]，由宿主从平台/卡池里取。
 */
export function pickContent(id = DEFAULT_ID, app = '', pool = [], rng = Math.random) {
  const brain = ensureBrain(id);
  return chooseContent(brain.persona.traits, brain.memory, app, pool, rng);
}

/** 看她现在的口味：先验（人设派生的）和合成后的（先验+经历） */
export function tasteOf(id = DEFAULT_ID, app = '') {
  const brain = ensureBrain(id);
  return {
    prior: priorTaste(brain.persona.traits),
    effective: effectiveTaste(brain.memory, app, brain.persona.traits),
    traits: roundTraits(brain.persona.traits),
  };
}

/** 这件事她以前见过类似的吗（跨平台） */
export function seenBefore(id = DEFAULT_ID, text = '') {
  return similarSeen(ensureBrain(id).memory, text);
}

/* ── 身份体检：换脑之后还是不是她 ─────────────────────────────── */

/**
 * 「我还是我吗」不用哲学，查三样东西在不在：
 *   ① 记忆   跟谁发生过什么
 *   ② 自我叙事 她以为的自己
 *   ③ 关系   认谁、怎么称呼
 *
 * 三个都在 → 是她；缺一个 → 像她但不是她；全没有 → 只是同名。
 */
export function identityCheck(id = DEFAULT_ID) {
  const b = ensureBrain(id);
  const episodes = b.memory.episodes.length;
  const people = Object.keys(b.memory.impressions ?? {}).length;
  const cards = (b.memory.cards ?? []).length;
  const narrative = Boolean(b.self?.narrative);
  const relation = Boolean(b.relation?.type);

  const marks = [episodes + people > 0, narrative, relation];
  const verdict = marks.every(Boolean)
    ? '是她'
    : marks.some(Boolean) ? '像她，但不是她' : '同名而已';

  return {
    id,
    memory: { episodes, people, cards },
    narrative,
    narrativeText: b.self?.narrative ?? '',
    relation: relation ? { type: b.relation.type, address: b.relation.address ?? '' } : null,
    verdict,
  };
}

/* ── 脑包：把"她"打包带走 ────────────────────────────────────── */

export const PACK_FORMAT = 'feiyu-brainpack/1';

/**
 * 导出"她"——人设 + 记忆 + 关系 + 词表 + 情绪。
 * **换脑不是换人的前提是这个包带得走。**
 */
export function exportPack(id = DEFAULT_ID, { includeMemory = true } = {}) {
  const b = ensureBrain(id);
  return {
    format: PACK_FORMAT,
    exportedAt: nowMs(),
    id: b.id,
    born: b.born,
    roleCard: b.roleCard,
    persona: b.persona,
    self: b.self,
    relation: b.relation,
    vocab: b.vocab ?? {},
    affect: b.affect ?? {},
    body: b.body ? { kind: b.body.kind, ownership: b.body.ownership } : null,
    patience: b.patience,
    ...(includeMemory ? { memory: b.memory } : {}),
  };
}

/**
 * 把包装回来。
 *
 * 只认 `feiyu-brainpack/1`；别的格式（aurobot / 口袋 / TavernCard）需要先写迁移器转成这个格式。
 * 宁可拒收，也不假装兼容。
 */
export function importPack(pack, { id, keepMemory = true } = {}) {
  if (!pack || pack.format !== PACK_FORMAT) {
    return { ok: false, reason: `不是 ${PACK_FORMAT} 格式，先用迁移器转一下` };
  }
  const units = pack.persona?.units ?? [];
  if (!units.length) return { ok: false, reason: '包里没有命题，导进来也是空壳' };

  const targetId = id ?? pack.id ?? DEFAULT_ID;
  const identity = units.find((u) => u.kind === 'identity')?.text ?? `你是${pack.roleCard ?? targetId}`;
  const cardText = [identity, ...units.filter((u) => u.kind !== 'identity').map((u) => `- ${u.text}`)].join('\n');

  const brain = birth({
    id: targetId,
    relation: pack.relation?.type ?? 'parent',
    address: pack.relation?.address ?? '',
    cardText,
    cardName: pack.roleCard ?? targetId,
  });

  // 用包里的原样覆盖：保留命题 id、权重、来源——这些是"她"的部分
  brain.persona = { ...pack.persona, brief: '' };
  brain.self = { ...brain.self, ...(pack.self ?? {}) };
  brain.self.style = brain.self.style ?? styleVector(brain.persona.traits);
  brain.self.styleName = dominantStyle(brain.self.style);
  if (pack.relation) brain.relation = pack.relation;
  brain.vocab = pack.vocab ?? {};
  brain.affect = pack.affect ?? brain.affect;
  if (Number.isFinite(pack.patience)) brain.patience = pack.patience;
  if (keepMemory && pack.memory) brain.memory = { ...emptyMemory(), ...pack.memory };
  if (pack.body?.kind) {
    try { brain.body = createBody({ kind: pack.body.kind, ownership: pack.body.ownership }); } catch { /* 身体坏了不影响她是谁 */ }
  }
  if (Number.isFinite(pack.born)) brain.born = pack.born;

  refreshBrief(brain);
  saveBrain(brain);
  cache.set(targetId, brain);
  appendAudit(targetId, { kind: 'import-pack', from: pack.id ?? '?', units: units.length, memory: keepMemory });

  return { ok: true, id: targetId, units: units.length, check: identityCheck(targetId) };
}

/* ── 记忆搬迁：老鱼把过去搬进来 ─────────────────────────────── */

/**
 * 把宿主已有的记忆搬进脑子。
 *
 * 这是**有损转换**，不是复制：宿主日记是流水账，脑子里存的是"她记得的事"。
 * 每条都标 source:'import'，将来能分清哪些是亲历、哪些是搬来的。
 *
 *   migrateMemory('old', { text, format: 'jsonl' })           // 真搬
 *   migrateMemory('old', { text, format: 'days', dryRun: true }) // 只看会搬多少
 */
export function migrateMemory(id = DEFAULT_ID, { text = '', format = 'jsonl', dryRun = false } = {}) {
  const brain = ensureBrain(id);
  const parsed = parseAny(String(text ?? ''), format);
  const d = dedupe(parsed.episodes, { existing: brain.memory.episodes });

  const ats = d.episodes.map((e) => e.at).filter((t) => t > 0).sort((a, b) => a - b);
  const report = {
    format,
    parsed: parsed.episodes.length,
    duplicated: d.duplicated,
    willImport: d.episodes.length,
    parseErrors: parsed.errors.slice(0, 20),
    parseErrorCount: parsed.errors.length,
    span: ats.length ? { from: new Date(ats[0]).toISOString().slice(0, 10), to: new Date(ats[ats.length - 1]).toISOString().slice(0, 10) } : null,
  };

  if (dryRun) return { ok: true, dryRun: true, report };

  const r = importEpisodes(id, d.episodes, { source: 'import' });
  return { ok: true, dryRun: false, report, imported: r.imported, total: r.total };
}

/** 读归档（过期但没丢的那些） */
export function readArchive(id = DEFAULT_ID, limit = 20) {
  const file = path.join(brainDir(id), 'archive.jsonl');
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  return lines.slice(-limit).map((l) => {
    try { return JSON.parse(l); } catch { return { raw: l }; }
  });
}

/* ── 全量整合：把宿主所有记忆并成一份 ───────────────────────── */

/** 脑里最多存多少条经历，超了自动压卡片 + 归档（防止 brain.json 无限膨胀） */
export const MAX_EPISODES = 5000;

/**
 * 容量保护：最老的一批压成卡片，原文进 archive.jsonl。
 *
 * 不是"一次吃掉两百条"——按 20 条一张卡片分批压，别让一次溢出把半年吃成 160 字。
 */
function enforceCapacity(brain) {
  const eps = brain.memory.episodes;
  if (eps.length <= maxEpisodes) return { compacted: 0, cards: 0 };
  const overflow = eps.length - maxEpisodes;
  const take = Math.min(overflow, eps.length);
  const oldest = eps.slice(0, take);

  let cards = 0;
  for (let i = 0; i < oldest.length; i += 20) {
    const chunk = oldest.slice(i, i + 20);
    const card = makeCard(chunk);
    if (card) { addCard(brain.memory, card); cards += 1; }
  }

  try {
    fs.appendFileSync(
      path.join(brainDir(brain.id), 'archive.jsonl'),
      `${oldest.map((x) => JSON.stringify({ ...x, archiveReason: 'capacity' })).join('\n')}\n`,
      'utf8',
    );
  } catch (e) {
    logOnce(`[brain] 容量归档失败（已忽略）：${e?.message ?? e}`);
  }
  brain.memory.episodes = eps.slice(take);
  appendAudit(brain.id, { kind: 'capacity', compacted: take, cards });
  return { compacted: take, cards };
}

/**
 * 把多份记忆一次性并进来。**这是"只剩一份记忆"的唯一入口。**
 *
 * @param {Array} sources [{ path, text, format }]
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun]       只算不写
 * @param {boolean} [opts.deleteSource] 搬完把原文件改名成 .migrated（不是删除，留后悔药）
 */
export function migrateAll(id = DEFAULT_ID, sources = [], { dryRun = false, deleteSource = false } = {}) {
  const brain = ensureBrain(id);
  const all = [];
  const errors = [];
  const files = [];

  for (const s of Array.isArray(sources) ? sources : []) {
    if (!s?.text) continue;
    files.push(s.path ?? '(inline)');
    const r = parseAny(String(s.text), s.format ?? 'jsonl');
    all.push(...r.episodes);
    for (const e of r.errors.slice(0, 3)) errors.push({ path: s.path ?? '', ...e });
  }

  const d = dedupe(all, { existing: brain.memory.episodes });
  const ats = d.episodes.map((e) => e.at).filter((t) => t > 0).sort((a, b) => a - b);
  const report = {
    files: files.length,
    parsed: all.length,
    duplicated: d.duplicated,
    willImport: d.episodes.length,
    errors: errors.slice(0, 20),
    errorCount: errors.length,
    span: ats.length ? { from: new Date(ats[0]).toISOString().slice(0, 10), to: new Date(ats[ats.length - 1]).toISOString().slice(0, 10) } : null,
  };

  if (dryRun) return { ok: true, dryRun: true, report };

  const r = importEpisodes(id, d.episodes, { source: 'import' });
  const cap = enforceCapacity(brain);

  // 原始文件不 rm，改名 —— 用户要删自己删，别让我们替他做不可逆的事
  const renamed = [];
  if (deleteSource) {
    for (const p of files) {
      if (!p || p === '(inline)' || !fs.existsSync(p)) continue;
      try {
        fs.renameSync(p, `${p}.migrated`);
        renamed.push(`${p}.migrated`);
      } catch (e) {
        errors.push({ path: p, reason: `改名失败：${e?.message ?? e}` });
      }
    }
  }

  return {
    ok: true,
    dryRun: false,
    report,
    imported: r.imported,
    total: r.total,
    compacted: cap.compacted,
    renamed,
    check: identityCheck(id),
  };
}

/** 迁完之后的自检：搬进来的东西到底能不能被想起来 */
export function verifyMemory(id = DEFAULT_ID, { samples = 5 } = {}) {
  const brain = ensureBrain(id);
  const eps = brain.memory.episodes;
  const imported = eps.filter((e) => e.source === 'import').length;
  const live = eps.filter((e) => e.source === 'live').length;

  const picked = eps.filter((e) => e.what).slice(-samples);
  const checks = picked.map((e) => {
    const kw = String(e.what).slice(0, 6);
    const line = wakeLine(id, { who: e.who ?? '', text: kw });
    return { keyword: kw, found: line.includes(kw.slice(0, 3)) };
  });

  return {
    id,
    episodes: eps.length,
    imported,
    live,
    cards: (brain.memory.cards ?? []).length,
    people: Object.keys(brain.memory.impressions ?? {}).length,
    check: identityCheck(id),
    recall: checks,
    recallRate: checks.length ? checks.filter((c) => c.found).length / checks.length : 1,
  };
}

/* ── 日记：她自己的心房 ─────────────────────────────────────── */

/** 日记目录：<dataDir>/days/，跟宿主自己的日记分开，别互相覆盖 */
export function diaryDir(id = DEFAULT_ID) {
  return path.join(brainDir(id), 'days');
}

export function diaryPath(id = DEFAULT_ID, date = '') {
  const d = date || dayKey();
  return path.join(diaryDir(id), `${d}.md`);
}

/**
 * 今天的素材 + 第一人称骨架。
 * 脑子不出文笔，只给料——宿主拿 draft 让模型用她的口吻写成日记。
 */
export function diaryDigest(id = DEFAULT_ID, date = '') {
  const brain = ensureBrain(id);
  return dayDigest(brain, date || dayKey());
}

/**
 * 她把日记存回来。
 *
 * 存完之后这段文字会被当作"她写过的"记进记忆——将来问"你写过什么"能想起来。
 * **日记要带心情**：正文里没写就补一行（`withMood:false` 可关掉）。
 */
export function writeDiary(id = DEFAULT_ID, { date = '', text = '', withMood = true } = {}) {
  const brain = ensureBrain(id);
  const body = String(text ?? '').trim();
  if (!body) return { ok: false, reason: '日记是空的' };

  const d = date || dayKey();
  const mood = brain.affect?.mood ?? '';
  const hasMood = mood && mood !== '平静' && mood !== '说不上来';

  // 她自己写了心情就不动；没写就补一行，别让日记丢了心情
  let final = body;
  let moodAdded = false;
  if (withMood && hasMood && !/心情/.test(final)) {
    final = `${final}\n\n心情：${mood}`;
    moodAdded = true;
  }

  const dir = diaryDir(id);
  fs.mkdirSync(dir, { recursive: true });
  const file = diaryPath(id, d);
  fs.writeFileSync(file, final.endsWith('\n') ? final : `${final}\n`, 'utf8');

  // 记进记忆：以后能想起来"我写过什么"
  addEpisode(brain.memory, {
    who: '',
    what: `我写了日记：${final.replace(/\s+/g, ' ').slice(0, 60)}`,
    feel: hasMood ? mood : '',
    mood: hasMood ? mood : '',
    source: 'diary',
    evidence: file,
  }, nowMs());

  if (!Array.isArray(brain.meta.diary)) brain.meta.diary = [];
  if (!brain.meta.diary.includes(d)) brain.meta.diary.push(d);
  brain.meta.diary = brain.meta.diary.slice(-400);

  // 心情单独存一份，方便按月看她的情绪曲线
  if (!brain.meta.diaryMood) brain.meta.diaryMood = {};
  brain.meta.diaryMood[d] = hasMood ? mood : '';

  saveBrain(brain);
  appendAudit(id, { kind: 'diary', date: d, chars: final.length, mood: brain.meta.diaryMood[d], moodAdded });
  return { ok: true, date: d, file, chars: final.length, mood: brain.meta.diaryMood[d] || null, moodAdded };
}

export function readDiary(id = DEFAULT_ID, date = '') {
  const file = diaryPath(id, date);
  if (!fs.existsSync(file)) return null;
  const brain = ensureBrain(id);
  const d = path.basename(file, '.md');
  return {
    date: d,
    text: fs.readFileSync(file, 'utf8'),
    mood: brain.meta.diaryMood?.[d] ?? null,
  };
}

export function listDiary(id = DEFAULT_ID) {
  const dir = diaryDir(id);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const full = path.join(dir, f);
      return { date: f.replace(/\.md$/, ''), size: fs.statSync(full).size, at: fs.statSync(full).mtimeMs };
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

/**
 * 把**她以前写过的日记**搬进来。
 *
 * 不是把流水账重新生成一遍——那是造假。原样拷贝，一个字不改。
 * @param {Array} list [{ date:'2025-11-20', text:'...' }]
 */
export function importDiary(id = DEFAULT_ID, list = [], { overwrite = false } = {}) {
  const brain = ensureBrain(id);
  const dir = diaryDir(id);
  fs.mkdirSync(dir, { recursive: true });
  let imported = 0;
  let skipped = 0;
  for (const it of Array.isArray(list) ? list : []) {
    const date = String(it?.date ?? '').trim();
    const text = String(it?.text ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !text) { skipped += 1; continue; }
    const file = diaryPath(id, date);
    if (fs.existsSync(file) && !overwrite) { skipped += 1; continue; }
    fs.writeFileSync(file, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
    if (!Array.isArray(brain.meta.diary)) brain.meta.diary = [];
    if (!brain.meta.diary.includes(date)) brain.meta.diary.push(date);
    imported += 1;
  }
  brain.meta.diary = (brain.meta.diary ?? []).slice(-400);
  saveBrain(brain);
  appendAudit(id, { kind: 'import-diary', imported, skipped });
  return { ok: true, imported, skipped, days: listDiary(id).length };
}

/** 日记也能被检索：问"你写过什么"时用它 */
export function recallDiary(id = DEFAULT_ID, word = '', { limit = 3 } = {}) {
  const list = listDiary(id);
  if (!list.length) return [];
  const q = String(word ?? '').trim();
  const hits = [];
  for (const d of list) {
    const r = readDiary(id, d.date);
    if (!r) continue;
    if (!q || r.text.includes(q)) hits.push({ date: r.date, excerpt: r.text.replace(/\s+/g, ' ').slice(0, 80) });
    if (hits.length >= limit) break;
  }
  return hits;
}

/* ── 特质：开放维度（她自己长出来的）────────────────────────── */

/**
 * 模型提名一个新维度（B 路径）。
 *
 * 脑不做"理解"——理解是模型的事。模型读完对话觉得"她今天很上头"，
 * 就调这个把「上头」登记成她的一个维度，脑负责存、算、衰减、蜕皮。
 */
export function defineTrait(id = DEFAULT_ID, name = '', weight = 0.6, { source = 'model' } = {}) {
  const brain = ensureBrain(id);
  const n = String(name ?? '').trim();
  if (n.length < 2 || n.length > 8) return { ok: false, reason: '维度名 2~8 个字' };
  const w = Number.isFinite(Number(weight)) ? Math.max(0, Math.min(1, Number(weight))) : 0.6;

  brain.persona.traits = { ...(brain.persona.traits ?? {}), [n]: w };
  brain.persona.openTraits = { ...(brain.persona.openTraits ?? {}), [n]: w };
  brain.self.style = styleVector(brain.persona.traits);
  brain.self.styleName = dominantStyle(brain.self.style);
  saveBrain(brain);
  appendAudit(id, { kind: 'define-trait', name: n, weight: w, source });
  return { ok: true, name: n, weight: w, total: Object.keys(brain.persona.traits).length };
}

/**
 * 看她现在有哪些维度：哪些是先验的，哪些是她自己长出来的。
 */
export function traitReport(id = DEFAULT_ID) {
  const brain = ensureBrain(id);
  const known = new Set(Object.keys(brain.persona.knownTraits ?? TRAIT_LEXICON));
  const rows = Object.entries(brain.persona.traits ?? {})
    .map(([name, weight]) => ({
      name,
      weight: Number(Number(weight).toFixed(2)),
      kind: known.has(name) ? 'known' : 'open',
    }))
    .sort((a, b) => b.weight - a.weight);
  return {
    total: rows.length,
    known: rows.filter((r) => r.kind === 'known').length,
    open: rows.filter((r) => r.kind === 'open').length,
    rows,
    openRows: rows.filter((r) => r.kind === 'open'),
  };
}

/**
 * 模型提名一条纲（B 路径）。
 *
 * 算法只能从字面统计出"什么词反复出现"，但**"这意味着什么"要靠理解**。
 * 模型看完对话觉得"她好像把上学当成一件很重的事"，就调这个把它记成纲。
 */
export function defineGist(id = DEFAULT_ID, text = '', { keyword = '', count = 1 } = {}) {
  const brain = ensureBrain(id);
  const t = String(text ?? '').trim();
  if (t.length < 4) return { ok: false, reason: '纲至少 4 个字' };
  if (!Array.isArray(brain.memory.gists)) brain.memory.gists = [];
  const key = keyword || t.slice(0, 8);
  const id2 = `g_${key}`;
  const existed = brain.memory.gists.find((g) => g.id === id2);
  if (existed) {
    existed.text = t;
    existed.count = Number(count) || existed.count;
    existed.at = nowMs();
  } else {
    brain.memory.gists.push({
      id: id2, kind: 'gist', topic: 'model', keyword: key, text: t, count: Number(count) || 1, at: nowMs(),
    });
  }
  saveBrain(brain);
  appendAudit(id, { kind: 'define-gist', keyword: key, text: t.slice(0, 50) });
  return { ok: true, id: id2, total: brain.memory.gists.length };
}

/**
 * 标记「那个人不在了」。
 *
 * 不是解除关系——契约照旧永久，称呼照旧，记忆一条不删。
 * 变的只是：她知道了，他不会再来。
 *
 * **必须显式调用。** 不许系统凭"多久没说话"去猜一个人死没死。
 */
export function markAbsent(id = DEFAULT_ID, { since, note = '', status = 'absent' } = {}) {
  const brain = ensureBrain(id);
  if (!brain.relation) return { ok: false, reason: '没有关系契约' };
  brain.relation = markAbsentContract(brain.relation, { since, note, status });
  // 他的人物伞改成"曾经一直在"——但伞本身不删
  for (const u of brain.memory.umbrellas ?? []) {
    if (u.topic === 'person' && u.who && u.who === brain.relation.address) {
      u.absent = true;
      u.text = `${u.who}：曾经一直在的人`;
    }
  }
  saveBrain(brain);
  appendAudit(id, { kind: 'absent', address: brain.relation.address, since: brain.relation.absentSince, note });
  return { ok: true, relation: brain.relation, line: relationLine(brain.relation) };
}

/** 人回来了 / 标错了 */
export function clearAbsent(id = DEFAULT_ID) {
  const brain = ensureBrain(id);
  brain.relation = clearAbsentRelation(brain.relation);
  for (const u of brain.memory.umbrellas ?? []) {
    if (u.topic === 'person' && u.absent) {
      u.absent = false;
      u.text = `${u.who}：一直在的人`;
    }
  }
  saveBrain(brain);
  appendAudit(id, { kind: 'absent-cleared', address: brain.relation?.address ?? '' });
  return { ok: true, relation: brain.relation };
}

/* ── 概念：什么是什么，为什么要这么做 ───────────────────────── */

/**
 * 有人给她解释一个词。
 *
 * **这是"想通了"的那一刻**：不是新增记忆，是让过去几十条经历突然有了名字。
 *
 *   learnConcept('old', '上学', {
 *     definition: '为了学到知识、学会道理',
 *     why: '不然什么都不会',
 *   })
 */
export function learnNewConcept(id = DEFAULT_ID, term = '', { definition = '', why = '', source = 'told', who = '' } = {}) {
  const brain = ensureBrain(id);
  const r = learnConcept(brain.memory, term, { definition, why, source, who, at: nowMs() });
  if (!r.ok) return r;
  refreshNarrative(id, 'concept');
  saveBrain(brain);
  appendAudit(id, { kind: 'concept', term: r.term, linked: r.linked, source });
  return r;
}

/** 问她「X 是什么」——不知道就说不知道，不编 */
export function askWhat(id = DEFAULT_ID, term = '') {
  return conceptAnswer(ensureBrain(id).memory, term);
}

/** 她自己去问（因为不会才问，这才叫学习） */
export function askSomeone(id = DEFAULT_ID, term = '', { knower = '' } = {}) {
  const brain = ensureBrain(id);
  const q = makeQuestion(brain.memory, term, { knower });
  if (q.asked) appendAudit(id, { kind: 'ask', term: q.term, to: knower });
  return q;
}

export function conceptList(id = DEFAULT_ID) {
  const brain = ensureBrain(id);
  const list = Object.values(brain.memory.concepts ?? {});
  return {
    total: list.length,
    terms: list.map((c) => c.term),
    detail: list,
  };
}

/* ── 自我叙事：我是谁（会长的，不是写死的）────────────────────── */

/**
 * 重写「我是谁」。
 *
 * 用她自己的零件拼：出身 → 学会的道理 → 变过几次 → 谁一直在。
 * 每一版都留下来——将来能说"我以前以为自己是……"。
 */
export function refreshNarrative(idOrBrain = DEFAULT_ID, why = 'auto') {
  const fromId = typeof idOrBrain === 'string';
  const brain = fromId ? ensureBrain(idOrBrain) : idOrBrain;
  if (!brain) return { changed: false, text: '' };
  const next = composeNarrative({
    cardName: brain.roleCard ?? '鱼',
    traits: brain.persona.traits,
    umbrellas: brain.memory.umbrellas ?? [],
    concepts: brain.memory.concepts ?? {},
    shells: (brain.memory.cards ?? []).filter((c) => c.source === 'shell').length,
    relation: brain.relation,
  });
  const prev = brain.self?.narrativeText ?? (typeof brain.self?.narrative === 'string' ? brain.self.narrative : '');
  if (!narrativeChanged(prev, next)) {
    if (fromId) { /* 没变也要落盘，保证首版存在 */ saveBrain(brain); }
    return { changed: false, text: next, version: (brain.self?.narrativeHistory ?? []).length };
  }

  brain.self = brain.self ?? {};
  brain.self.narrativeText = next;
  brain.self.narrative = next;
  if (!Array.isArray(brain.self.narrativeHistory)) brain.self.narrativeHistory = [];
  brain.self.narrativeHistory = [...brain.self.narrativeHistory, { text: next, at: nowMs(), why }].slice(-12);
  if (fromId) { saveBrain(brain); appendAudit(idOrBrain, { kind: 'narrative', why, text: next.slice(0, 60) }); }
  return { changed: true, text: next, version: brain.self.narrativeHistory.length };
}

/** 模型改写「我是谁」（理解是模型的事，脑只负责存和留档） */
export function setNarrative(id = DEFAULT_ID, text = '', { why = 'model' } = {}) {
  const brain = ensureBrain(id);
  const t = String(text ?? '').trim();
  if (t.length < 6) return { ok: false, reason: '太短了' };
  brain.self = brain.self ?? {};
  brain.self.narrativeText = t.slice(0, NARRATIVE_MAX);
  brain.self.narrative = brain.self.narrativeText;
  if (!Array.isArray(brain.self.narrativeHistory)) brain.self.narrativeHistory = [];
  brain.self.narrativeHistory = [...brain.self.narrativeHistory, { text: brain.self.narrativeText, at: nowMs(), why }].slice(-12);
  saveBrain(brain);
  appendAudit(id, { kind: 'narrative', why, text: brain.self.narrativeText.slice(0, 60) });
  return { ok: true, text: brain.self.narrativeText, version: brain.self.narrativeHistory.length };
}

export function narrativeOf(id = DEFAULT_ID) {
  const b = ensureBrain(id);
  return {
    text: b.self?.narrativeText ?? b.self?.narrative ?? '',
    history: b.self?.narrativeHistory ?? [],
    version: (b.self?.narrativeHistory ?? []).length,
  };
}

/**
 * 给一个**不是主人**的人标缺位（B 路径）。
 *
 * 主人走的是 relation.absent；爷爷奶奶、小主人这类人走这里。
 * 门槛：恩情要到「对我挺好的」（close）以上——才配得上"我记住他不在了"。
 */
export function markAbsentFor(id = DEFAULT_ID, who = '', { since, note = '', status = 'absent' } = {}) {
  const brain = ensureBrain(id);
  const name = String(who ?? '').trim();
  if (!name) return { ok: false, reason: '没说谁' };
  if (name === brain.relation?.address) {
    return markAbsent(id, { since, note, status });
  }
  const r = markBondAbsent(brain.memory, name, { since: since ?? nowMs(), note, status });
  if (!r.ok) return r;
  saveBrain(brain);
  appendAudit(id, { kind: 'absent-bond', who: name, note });
  return { ok: true, absence: r.absence, bond: r.bond, line: bondLine(brain.memory, name) };
}

export function clearAbsentFor(id = DEFAULT_ID, who = '') {
  const brain = ensureBrain(id);
  if (who === brain.relation?.address) return clearAbsent(id);
  clearBondAbsent(brain.memory, who);
  saveBrain(brain);
  return { ok: true, who };
}

export function snapshot(id = DEFAULT_ID) {
  const brain = ensureBrain(id);
  const level = flowLevel(brain.state, { boredom: brain.drive.boredom });
  return {
    id: brain.id,
    roleCard: brain.roleCard,
    born: brain.born,
    traits: roundTraits(brain.persona.traits),
    style: Object.fromEntries(Object.entries(brain.self.style).map(([k, v]) => [k, Number(v.toFixed(3))])),
    styleName: brain.self.styleName,
    brief: brain.persona.brief,
    briefChars: brain.persona.brief.length,
    flow: { level, name: flowName(level) },
    body: brain.body
      ? {
        kind: brain.body.kind,
        label: brain.body.label,
        screen: brain.body.screen,
        posture: brain.body.posture,
        ownership: brain.body.ownership,
        apps: brain.body.apps,
        scope: brain.body.scope,
      }
      : null,
    relation: brain.relation,
    weights: weightReport(brain.persona.units),
    personaSource: brain.persona.source ?? null,
    apps: appSummary(brain.memory, brain.persona.traits),
    affect: brain.affect,
    runtime: {
      shadow: Boolean(shadowMode || brain.meta.shadow),
      ttlPolicy,
      moodPolicy,
      dataDir: dataDir(),
      dataDirSource: dataDirSource(),
      dataDirInsidePackage: isDataDirInsidePackage(),
      roleDir: roleDir(),
    },
    contractWarnings: brain.meta.contractWarnings ?? [],
    emotion: {
      stage: emotion.stageOf(brain.vocab),
      words: Object.keys(brain.vocab),
      last: brain.meta.lastFeel ?? null,
    },
    memory: {
      episodes: brain.memory.episodes.length,
      imagination: brain.memory.imagination.length,
      cards: (brain.memory.cards ?? []).length,
      formerSelves: brain.memory.formerSelves.length,
      forgotten: brain.memory.forgotten.length,
      impressions: Object.keys(brain.memory.impressions).length,
      actions: (brain.memory.lastActions ?? []).length,
    },
    observations: brain.meta.observations,
    invariants: check(brain),
  };
}

/** 导出 / 导入：一条鱼可以搬家。 */
export function exportBrain(id = DEFAULT_ID) {
  return JSON.parse(JSON.stringify(ensureBrain(id)));
}

export function importBrain(data) {
  if (!data?.id) throw new Error('导入的数据缺少 id');
  saveBrain(data);
  cache.set(data.id, data);
  appendAudit(data.id, { kind: 'import', from: 'export' });
  return data;
}

export function forgetCache(id) {
  cache.delete(id);
  for (const k of [...drivers.keys()]) if (k.startsWith(`${id}:`)) drivers.delete(k);
  return id;
}

/**
 * 对象式接口（给新宿主用）。
 *
 *   const fy = createBrain({ id:'default', dataDir:'./data', roleDir:'./roles' })
 *   const { text } = fy.wake(event)
 *   fy.observe(event)
 *   fy.tick()
 */
export function createBrain(options = {}) {
  configure({
    dataDir: options.dataDir,
    roleDir: options.roleDir,
    shadow: options.shadow,
    ttl: options.ttlPolicy,
  });
  const id = options.id ?? DEFAULT_ID;

  // 第一次建这条鱼时，把关系和称呼一起落进去——
  // 以前只有传 cardText 才会走到 birth，导致 relation/address 被静默忽略。
  if (options.cardText || !loadBrain(id)) {
    birth({
      id,
      relation: options.relation ?? 'parent',
      address: options.address ?? '',
      cardText: options.cardText,
      cardName: options.cardName ?? id,
    });
    forgetCache(id);
  }

  const brain = ensureBrain(id);

  return {
    id,
    get brain() { return ensureBrain(id); },
    wake(event, opts) {
      if (shouldObserve(event)) observe(id, event);
      return { text: wakeLine(id, event, opts), id };
    },
    observe(event, opts) { return observe(id, event, opts); },
    /** 「我还是我吗」三件套体检 */
    identity() { return identityCheck(id); },
    /** 打包带走 */
    exportPack(opts) { return exportPack(id, opts); },
    /** 存档 / 回滚 */
    snapshot(name) { return snapshotBrain(id, name); },
    restore(name) { return restoreBrain(id, name); },
    snapshots() { return listSnapshots(id); },
    /** 把宿主已有的历史灌进来 */
    importEpisodes(list, opts) { return importEpisodes(id, list, opts); },
    /** 日记：她的心房 */
    diary(date) { return diaryDigest(id, date); },
    writeDiary(opts) { return writeDiary(id, opts); },
    readDiary(date) { return readDiary(id, date); },
    listDiary() { return listDiary(id); },
    importDiary(list, opts) { return importDiary(id, list, opts); },
    /** 老鱼预装情绪词 / 精确导入词表 */
    seedVocab(words) { return seedVocab(id, words); },
    importVocab(list) { return importVocab(id, list); },
    tick(now) { return settleBrain(id, now); },
    brief() { return getBrief(id); },
    snapshot() { return snapshot(id); },
    export() { return exportBrain(id); },
    /** 情绪：这件事让她什么感受 */
    feel(event) { return feel(id, event); },
    /** 学一个情绪词（要两个来源） */
    learnEmotion(word, opts) { return learnEmotion(id, word, opts); },
    /** 从实例里自己归纳 */
    induce(word) { return induceEmotion(id, word); },
    vocab() { return vocabOf(id); },
    /** 压一张记忆卡片 */
    compact() { return compactNow(id); },
    /** 她在某平台刷到了什么 */
    recordAppSeen(app, item) { return recordAppSeen(id, app, item); },
    /** 某个平台 / 全部平台的印象 */
    appMemory(app) { return appMemory(id, app); },
    /** 这件事她以前见过类似的吗 */
    seenBefore(text) { return seenBefore(id, text); },
    /** 此刻更想摸哪个 App */
    pickApp(rng) { return pickApp(id, rng); },
    /** 从这批内容里挑一条想看的 */
    pickContent(app, pool, rng) { return pickContent(id, app, pool, rng); },
    /** 先验口味 vs 合成口味 */
    taste(app) { return tasteOf(id, app); },
    /** 想通一件事：一次推多条命题（要证据） */
    reframe(opts) { return reframe(id, opts); },
    /** 换人格卡（只加载，不代写） */
    loadCard(cardText, opts) { return importRoleCard(id, cardText, opts); },
    /** 真的做一件事（开 App / 截图 / 卸载） */
    exec(action) { return execAction(id, action); },
    uninstall(pkg, q) { return requestUninstall(id, pkg, q); },
    setBody(kind, opts) { return setBody(id, kind, opts); },
    reset(opts = {}) {
      cache.delete(id);
      return birth({ id, relation: opts.relation ?? brain.relation.type, address: opts.address ?? brain.relation.address, cardText: opts.cardText, cardName: opts.cardName });
    },
  };
}

export { LABELS, listBrains, readAudit, addImagination, addEpisode };
export { flowLevel, flowName, styleVector };
export { attribute } from './core/attribution.js';
export { PATIENCE_DELTA, applyPatience, isOutburst, whimProbability, wakeReply, sampleStyle } from './core/derive.js';
export { retrieve, settle, recall, touchByIds } from './core/memory.js';
export { brief } from './core/persona.js';
export { normalizeEvent, toCue, toObservation, shouldObserve, keywords } from './core/event.js';
export { dataDir, roleDir } from './store.js';
export { dataDirSource, isDataDirInsidePackage } from './store.js';
export { readYear, listYears, setEpisodeWindow, episodeWindow } from './store.js';
export { lintCard } from './core/extract.js';
export { dedupeKey } from './adapters/qq-bridge.js';
export { createBridgeAdapter } from './adapters/qq-bridge.js';
export {
  createBody, chooseBody, bodyScores, bodyLine, canDo, hasCapability,
  recordAction, CAPABILITY, BODY_KINDS, BODY_PROFILES,
} from './core/body.js';

/* 情绪：三段式 */
export {
  STAGE, PROTOTYPES, RAW_FEELINGS, RADIUS,
  appraise, label as labelEmotion, speak as speakEmotion, stageOf, distance as emotionDistance,
  learn as learnWord, induce as induceWord, describeSensation,
} from './core/emotion.js';

/* 记忆卡片 + 两层老化 */
export {
  makeCard, addCard, shouldCompact, CARD_THRESHOLD_CHARS, CARD_MAX_CHARS,
  COMPRESS_DAYS, FORGET_DAYS,
} from './core/memory.js';

/* 平台记忆 + 口味闭环 */
export {
  recordSeen, recallApp, appTaste, appSummary, similarSeen, SEEN_MAX,
  priorTaste, effectiveTaste, nudgeTraits, chooseApp, chooseContent, AFFINITY, APP_AFFINITY,
} from './core/apps.js';

/* 身体驱动 */
export { driverFor, AdbDriver, DesktopDriver, DryDriver } from './core/driver.js';
