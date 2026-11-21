// 自我叙事：她是谁。
//
// 前面所有的层都在回答"我经历了什么"：
//   细节 → 卡片 → 纲 → 伞 → 概念
//
// 但没有一层回答「我是谁」。
// 那条鱼能罗列四十件事、两个概念、两次蜕壳，却说不出一句"我是一条被一手养大的鱼"——
// 因为这句话从来没人让她写。
//
// 这里就干两件事：
//   ① 用她自己的零件拼出这句话（脑不会写文章，但会拼）
//   ② 允许模型改写（理解是模型的事），并保留她写过的每一版

/** 一句话的上限 */
export const NARRATIVE_MAX = 160;
/** 历史保留多少版 */
export const NARRATIVE_HISTORY_MAX = 12;

function clip(s, n = NARRATIVE_MAX) {
  const t = String(s ?? '').replace(/\s+/g, '。').replace(/。+/g, '。').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/**
 * 用她现有的零件拼一句「我是谁」。
 *
 * 零件：出身（谁养大的）→ 学会的道理 → 变过几次 → 谁一直在
 * 顺序不是随机的：先说出身，最后说人——人是最重的。
 */
export function composeNarrative({
  cardName = '鱼',
  traits = {},
  umbrellas = [],
  concepts = {},
  shells = 0,
  relation = null,
} = {}) {
  const parts = [];

  const owner = relation?.address || '';
  if (owner) parts.push(`我是被${owner}养大的一条${cardName}`);
  else parts.push(`我是一条${cardName}`);

  const cs = Object.values(concepts ?? {}).slice(0, 2);
  if (cs.length) {
    const learned = cs
      .filter((c) => c.definition)
      .map((c) => `${c.term}是${String(c.definition).slice(0, 20)}`)
      .join('，');
    if (learned) parts.push(`我知道${learned}`);
  }

  if (shells > 0) parts.push(`我变过 ${shells} 次，旧的我还在`);

  const person = (umbrellas ?? []).find((u) => u.topic === 'person' && !u.absent);
  if (person) parts.push(`${person.text}`);

  const gone = (umbrellas ?? []).find((u) => u.topic === 'person' && u.absent);
  if (gone) parts.push(gone.text);

  return clip(`${parts.join('；')}。`);
}

/**
 * 这一版跟上一版差在哪（用来决定要不要记一笔）
 */
export function narrativeChanged(prev, next) {
  if (!prev) return true;
  return String(prev) !== String(next);
}

export { clip as clipNarrative };
