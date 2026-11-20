// 对外只有几个方法：出生 / 取 brief / 唤醒 / 观察 / 结算 / 快照。
//
// 两种用法：
//   ① 对象式（推荐给新用户）：createBrain({...}).wake(event)
//   ② 函数式（兼容老桥接）：wakeLine(id, cue) / observe(id, ev)
//
// 大脑不发送任何东西——发送是"身体"的事。这里只产出文本和记录。

import fs from 'node:fs';
import path from 'node:path';

import { birthFromCard } from './core/extract.js';
import { brief, decay, evolve, shed, weightReport } from './core/persona.js';
import { styleVector, flowLevel, flowName, hashTraits, mulberry32 } from './core/derive.js';
import { createBody, chooseBody, bodyLine, canDo, hasCapability, CAPABILITY, BODY_KINDS, BODY_PROFILES, recordAction } from './core/body.js';
import { emptyMemory, addEpisode, addImagination, recall, settle, retrieve } from './core/memory.js';
import { createContract } from './core/relation.js';
import { attribute, LABELS } from './core/attribution.js';
import { check } from './core/invariants.js';
import { toCue, toObservation, shouldObserve, normalizeEvent } from './core/event.js';
import {
  ROOT, loadBrain, saveBrain, appendAudit, readAudit, listBrains,
  setDataDir, setRoleDir, dataDir, roleDir,
} from './store.js';

const DEFAULT_ID = 'default';
const cache = new Map();

function nowMs() {
  return Date.now();
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
      name = JSON.parse(fs.readFileSync(stateFile, 'utf8')).role;
    } catch {
      name = null;
    }
  }
  if (!name) return null;
  const file = path.join(roleDir(), `${name}.md`);
  if (!fs.existsSync(file)) return null;
  return { name, file, text: fs.readFileSync(file, 'utf8') };
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

  const { traits, units } = birthFromCard(card.text);
  const brain = {
    id,
    schema: 'brain/2',
    born: nowMs(),
    roleCard: card.name,
    persona: { seed: cardName ? `card:${card.name}` : `${roleDir()}/${card.name}.md`, traits, units, brief: '' },
    relation: createContract(relation, address),
    self: { style: styleVector(traits), divergence: 0, narrative: '', styleName: null },
    state: { energy: 0.8, fatigue: 0.2, sleep: 'awake', flow: 1 },
    affect: { p: 0, a: 0, d: 0, mood: '平静' },
    drive: { curiosity: Math.min(1, 0.4 + (traits.好奇 ?? 0.3)), boredom: 0.5, social: 0.6 },
    memory: emptyMemory(),
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
  if (mood && mood !== '平静') parts.push(`【心情】${mood}`);

  const cue = eventOrCue?.who !== undefined ? eventOrCue : toCue(eventOrCue);
  if (cue) {
    const hit = retrieve(cue, brain.memory);
    if (hit.text) parts.push(`【想到的】\n${hit.text}`);
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

  brain.persona.units = evolve(brain.persona.units, { consistent, conflicting, at });

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
  const obs = ev.sender ? toObservation(ev) : (ev.what ? ev : null);
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
    memory: {
      episodes: brain.memory.episodes.length,
      imagination: brain.memory.imagination.length,
      formerSelves: brain.memory.formerSelves.length,
      forgotten: brain.memory.forgotten.length,
      impressions: Object.keys(brain.memory.impressions).length,
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

  if (options.cardText) {
    birth({ id, cardText: options.cardText, cardName: options.cardName ?? id, relation: options.relation ?? 'parent', address: options.address ?? '' });
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
