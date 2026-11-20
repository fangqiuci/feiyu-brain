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

import { birthFromCard } from './core/extract.js';
import { brief, decay, evolve, shed, weightReport } from './core/persona.js';
import { styleVector, flowLevel, flowName, hashTraits, mulberry32 } from './core/derive.js';
import { createBody, chooseBody, bodyLine, canDo, hasCapability, CAPABILITY, BODY_KINDS, BODY_PROFILES, recordAction } from './core/body.js';
import { emptyMemory, addEpisode, addImagination, recall, settle, retrieve } from './core/memory.js';
import { createContract } from './core/relation.js';
import { attribute, LABELS } from './core/attribution.js';
import { check } from './core/invariants.js';
import { toCue, toObservation, shouldObserve, normalizeEvent } from './core/event.js';
import * as emotion from './core/emotion.js';
import { makeCard, addCard, shouldCompact } from './core/memory.js';
import { driverFor } from './core/driver.js';
import {
  recordSeen, recallApp, appTaste, appSummary, similarSeen, emptyApps,
  priorTaste, effectiveTaste, nudgeTraits, chooseApp, chooseContent, AFFINITY, APP_AFFINITY,
} from './core/apps.js';
import {
  ROOT, loadBrain, saveBrain, appendAudit, readAudit, listBrains,
  setDataDir, setRoleDir, dataDir, roleDir,
} from './store.js';

const DEFAULT_ID = 'default';
const cache = new Map();

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

/** 宿主初始化：指定数据目录和角色卡目录 */
export function configure({ dataDir: d, roleDir: r } = {}) {
  if (d) setDataDir(d);
  if (r) setRoleDir(r);
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
  brain.persona.brief = brief(brain.persona.units);
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

  const { traits, units } = birthFromCard(card.text, { traitsOverride });
  const brain = {
    id,
    schema: 'brain/2',
    born: nowMs(),
    roleCard: card.name,
    persona: {
      seed: cardName ? `card:${card.name}` : `${roleDir()}/${card.name}.md`,
      traits,
      units,
      brief: '',
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
    meta: { lastSettle: nowMs(), observations: 0, version: '1.1.0' },
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
 */
export function wakeLine(id = DEFAULT_ID, eventOrCue = null) {
  const brain = ensureBrain(id);
  if (!brain.persona.brief) refreshBrief(brain);

  const level = flowLevel(brain.state, { boredom: brain.drive.boredom });
  brain.state.flow = level;
  const parts = [`【此刻的她】${brain.persona.brief}`];
  const bodyText = bodyLine(brain.body);
  if (bodyText) parts.push(`【手上的东西】${bodyText}`);

  if (level !== 1) parts.push(`【意识流】${flowName(level)}`);
  const mood = brain.affect?.mood;
  if (mood && mood !== '平静' && mood !== '说不上来') parts.push(`【心情】${mood}`);

  const cue = eventOrCue?.who !== undefined ? eventOrCue : toCue(eventOrCue);
  if (cue) {
    const hit = retrieve(cue, brain.memory);
    if (hit.text) parts.push(`【想到的】\n${hit.text}`);

    // 外部检索器（向量/图谱）：同步读缓存，不 await
    if (extraRetriever) {
      try {
        const extra = extraRetriever(cue, brain.memory) ?? [];
        const lines = (Array.isArray(extra) ? extra : []).filter(Boolean).slice(0, 3);
        if (lines.length) parts.push(`【搜到的】\n${lines.join('\n')}`);
      } catch (e) {
        // 检索器坏了不能拖垮唤醒
        logOnce(`[brain] 外部检索器出错（已忽略）：${e?.message ?? e}`);
      }
    }
  }
  return parts.join('\n');
}

/**
 * 一次经历。接受通用事件，或显式字段。
 *
 *   event = { sender, text, ... }               ← 适配器直接传
 *   event = { consistent, conflicting, ... }    ← 高级用法
 */
export function observe(id = DEFAULT_ID, event = {}) {
  const brain = ensureBrain(id);
  const at = nowMs();

  const ev = event.consistent || event.conflicting || !event.sender
    ? event
    : normalizeEvent(event, event.platform);

  const consistent = ev.consistent ?? matchUnits(brain.persona.units, ev.text ?? '').consistent;
  const conflicting = ev.conflicting ?? matchUnits(brain.persona.units, ev.text ?? '').conflicting;

  // step：默认 1（每次 ±0.01）。只有传了 magnitude（重大转折）才放大，上限 5。
  const step = Math.max(1, Math.min(5, Number(ev.magnitude) || 1));
  brain.persona.units = evolve(brain.persona.units, { consistent, conflicting, at, step });

  // 蜕皮
  const sh = shed(brain.persona.units, { at });
  if (sh.formerSelves.length) {
    brain.persona.units = sh.units;
    brain.memory.formerSelves.push(...sh.formerSelves);
    for (const f of sh.formerSelves) {
      appendAudit(id, { kind: 'shed', id: f.id, weight: Number(f.weight.toFixed(3)), memoir: f.memoir });
    }
  }

  // 记忆
  const obs = ev.what
    ? ev
    : (ev.text ? { who: ev.who ?? ev.sender ?? '', what: String(ev.text).slice(0, 80), feel: ev.feel ?? '', via: ev.via ?? 'api' } : null);
  if (obs?.what) {
    addEpisode(brain.memory, {
      who: obs.who ?? '',
      what: obs.what,
      feel: ev.feel ?? '',
      mood: ev.mood ?? brain.affect.mood,
      emotion: ev.emotion ?? brain.affect.a,
      outcome: ev.outcome ?? null,
      context: ev.context ?? null,
      strategy: ev.action?.strategy ?? null,
      evidence: obs.via ?? 'chat',
    }, at);
  }

  if (ev.action) {
    const label = attribute(ev.action, brain.memory);
    appendAudit(id, { kind: 'attribution', label, strategy: ev.action.strategy });
    brain.meta.lastLabel = label;
    if (!brain.memory.strategies[ev.action.strategy]) {
      brain.memory.strategies[ev.action.strategy] = { learnedAt: at, uses: 0 };
    }
    brain.memory.strategies[ev.action.strategy].uses += 1;
  }

  // 平台记忆：她刷到过什么（有 app 才记）
  if (ev.app && (ev.title || ev.text)) {
    recordSeen(brain.memory, ev.app, {
      title: ev.title ?? String(ev.text).slice(0, 60),
      kind: ev.kind ?? '',
      reaction: Number.isFinite(ev.reaction) ? ev.reaction : 0,
      minutes: Number(ev.minutes) || 0,
    });
    appendAudit(id, { kind: 'seen', app: ev.app, title: String(ev.title ?? ev.text).slice(0, 40) });

    // ── 闭环：刷到的东西反过来改人设 ──
    // 看的解压视频多了，"懒"这条特质就真的涨一点；人设变了，下次爱看的就不一样。
    const { traits: nextTraits, delta } = nudgeTraits(brain.persona.traits, ev.kind ?? '', Number(ev.reaction) || 0);
    if (Object.keys(delta).length) {
      brain.persona.traits = nextTraits;
      brain.self.style = styleVector(nextTraits);
      brain.self.styleName = dominantStyle(brain.self.style);
      appendAudit(id, { kind: 'trait-drift', app: ev.app, contentKind: ev.kind, delta });
    }
  }

  // 关系记忆：互动次数
  const who = ev.who ?? ev.sender;
  if (who) {
    const im = brain.memory.impressions[who] ?? { traits: [], count: 0, lastAt: at };
    im.count += 1;
    im.lastAt = at;
    if (ev.feel) im.traits = [...new Set([...(im.traits ?? []), ev.feel])].slice(-6);
    brain.memory.impressions[who] = im;
  }

  brain.meta.observations += 1;
  brain.meta.lastObservationAt = at;
  refreshBrief(brain);
  saveBrain(brain);
  return { brain, consistent, conflicting, label: brain.meta.lastLabel };
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

/** 每日结算：衰减 + TTL + 蜕皮检查。幂等，可以随便跑。 */
export function settleBrain(id = DEFAULT_ID, now = nowMs()) {
  const brain = ensureBrain(id);
  const days = Math.max(0, (now - (brain.meta.lastSettle ?? now)) / (24 * 60 * 60 * 1000));
  if (days >= 1) {
    brain.persona.units = decay(brain.persona.units, Math.floor(days), now);
    const sh = shed(brain.persona.units, { at: now });
    if (sh.formerSelves.length) {
      brain.persona.units = sh.units;
      brain.memory.formerSelves.push(...sh.formerSelves);
    }
    settle(brain.memory, now);
    brain.meta.lastSettle = now;
    refreshBrief(brain);
    saveBrain(brain);
  }
  return brain;
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
  const prev = brain.affect ?? {};
  const mix = (next, before) => {
    const old = Number(before);
    const base = Number.isFinite(old) ? old : 0;
    return Number((next * k + base * (1 - k)).toFixed(4));
  };

  brain.affect = {
    p: mix(r.pad[0], prev.p),
    a: mix(r.pad[1], prev.a),
    d: mix(r.pad[2], prev.d),
    // 名字按**这次**的感受叫：旧的余温不该拖住命名
    mood: r.label.kind === 'word' ? r.label.word : (r.label.kind === 'variant' ? `${r.label.word}（变体）` : '说不上来'),
    // 余温多少，方便调试时看"她还没缓过来"
    carryover: Number((1 - k).toFixed(2)),
  };
  brain.meta.lastFeel = { at: Date.now(), pad: r.pad, blended: [brain.affect.p, brain.affect.a, brain.affect.d], label: r.label, stage: r.stage, text: r.text };
  saveBrain(brain);
  return { ...r, blended: [brain.affect.p, brain.affect.a, brain.affect.d] };
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
export function induceEmotion(id = DEFAULT_ID, word) {
  const brain = ensureBrain(id);
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
    apps: appSummary(brain.memory),
    affect: brain.affect,
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
  configure({ dataDir: options.dataDir, roleDir: options.roleDir });
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
    wake(event) {
      if (shouldObserve(event)) observe(id, event);
      return { text: wakeLine(id, event), id };
    },
    observe(event) { return observe(id, event); },
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
export { retrieve } from './core/memory.js';
export { brief } from './core/persona.js';
export { normalizeEvent, toCue, toObservation, shouldObserve, keywords } from './core/event.js';
export { dataDir, roleDir } from './store.js';
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

/* 记忆卡片 */
export {
  makeCard, addCard, shouldCompact, CARD_THRESHOLD_CHARS, CARD_MAX_CHARS,
} from './core/memory.js';

/* 平台记忆 + 口味闭环 */
export {
  recordSeen, recallApp, appTaste, appSummary, similarSeen, SEEN_MAX,
  priorTaste, effectiveTaste, nudgeTraits, chooseApp, chooseContent, AFFINITY, APP_AFFINITY,
} from './core/apps.js';

/* 身体驱动 */
export { driverFor, AdbDriver, DesktopDriver, DryDriver } from './core/driver.js';
