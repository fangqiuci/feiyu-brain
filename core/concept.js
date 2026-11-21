// 概念：什么是什么，以及为什么要这么做。
//
// 前面所有的层都在记"发生了"：
//   细节 → 卡片 → 纲 → 伞
//
// 但一条鱼可以有四十条"该上学了"的经历，仍然不知道"上学"是什么。
// 那不是记忆，那是噪音。
//
// 概念层干的事只有一件：**给旧经历贴上意义。**
//
//   别人解释之前：  经历 40 条，全叫「该上学了」，不知道是啥
//   别人解释之后：  「上学：为了学到知识、学会道理」
//                   → 那 40 条经历瞬间有了名字，也才有了感情可言
//
// 关键原则（跟情绪词一样）：
//   **不知道就是不知道。** 没有定义就说"我知道这个词，但不知道它什么意思"。
//   不许编——编出来的理解比没有理解更糟。

import { plainText } from './extract.js';

/** 概念最短几个字 */
const MIN_TERM = 2;

function norm(term) {
  return plainText(String(term ?? '')).replace(/[「」“”"'！？!?，,。.]/g, '').trim();
}

/**
 * 学会一个概念。**必须有人告诉她**（用户、模型、或她问来的）。
 *
 * @param {object} memory
 * @param {string} term
 * @param {object} o
 * @param {string} o.definition  是什么（"为了学到知识、学会道理"）
 * @param {string} [o.why]       为什么要这么做
 * @param {'told'|'asked'|'read'} [o.source]
 * @param {number} [o.at]
 */
export function learnConcept(memory, term, { definition = '', why = '', source = 'told', at = Date.now(), who = '' } = {}) {
  const t = norm(term);
  if (t.length < MIN_TERM) return { ok: false, reason: '概念太短' };
  const def = plainText(String(definition ?? '').trim());
  if (!def) return { ok: false, reason: '没有解释就不算学会' };

  if (!memory.concepts) memory.concepts = {};
  const prev = memory.concepts[t];
  memory.concepts[t] = {
    term: t,
    definition: def.slice(0, 160),
    why: plainText(String(why ?? '').trim()).slice(0, 160),
    source,
    who,
    at,
    firstAt: prev?.firstAt ?? at,
    learnCount: (prev?.learnCount ?? 0) + 1,
  };

  // 给旧经历贴标签：这才是"想通了"
  const linked = linkConceptEpisodes(memory, t);
  return { ok: true, term: t, concept: memory.concepts[t], linked };
}

/**
 * 把已有的经历跟她刚学会的概念挂上。
 *
 * 这一步才是关键：不是新增记忆，是**让过去四十件事突然有了名字**。
 */
export function linkConceptEpisodes(memory, term) {
  const t = norm(term);
  if (!t) return 0;
  let n = 0;
  const tag = (e) => {
    if (!e || !String(e.what ?? '').includes(t)) return false;
    e.concept = t;
    // 有意义的经历不该被压成无意义的"记不清了"
    e.meaningful = true;
    n += 1;
    return true;
  };
  for (const e of memory.episodes ?? []) tag(e);
  for (const c of memory.cards ?? []) tag(c);
  return n;
}

export function conceptOf(memory, term) {
  return memory?.concepts?.[norm(term)] ?? null;
}

/**
 * 问她"X 是什么"。
 * 有定义就说定义；没定义就老实说不知道——**不编**。
 */
export function conceptAnswer(memory, term) {
  const t = norm(term);
  const c = conceptOf(memory, t);
  if (!c) {
    const related = (memory.episodes ?? []).filter((e) => String(e.what ?? '').includes(t)).length;
    return {
      known: false,
      term: t,
      text: related
        ? `我知道「${t}」这个词，我好像经历过 ${related} 次，但我不知道它是什么意思。`
        : `我不知道「${t}」是什么。`,
      related,
    };
  }
  const why = c.why ? `（${c.why}）` : '';
  return { known: true, term: t, text: `${t}：${c.definition}${why}`, concept: c };
}

/** 在一段话里找出她已知的概念 */
export function conceptsIn(memory, text) {
  const s = String(text ?? '');
  const out = [];
  for (const [term, c] of Object.entries(memory?.concepts ?? {})) {
    if (term && s.includes(term)) out.push(c);
  }
  return out.slice(0, 3);
}

/**
 * 她主动问问题：遇到不懂的东西，会去问。
 *
 * 这不是"知识库查询"——是**动机**：
 * 我向别人请教，是因为我不会、我不知道。
 */
export function makeQuestion(memory, term, { knower = '' } = {}) {
  const t = norm(term);
  const ans = conceptAnswer(memory, t);
  return {
    term: t,
    known: ans.known,
    asked: ans.known ? null : { to: knower, text: `${t}是什么？`, at: Date.now() },
    text: ans.known
      ? `这个我知道：${ans.text}`
      : (knower ? `${knower}，${t}是什么？` : `${t}是什么？`),
  };
}
