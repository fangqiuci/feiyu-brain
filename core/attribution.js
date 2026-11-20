// 归因：不审批，只贴标签。
//
// 对应《大脑规范-定稿》§八 与《逻辑内核-定稿》§3.8。
// 五种标签全部合法——行为先发生，然后解释它。
// 只有 C1（人设红线）和 SAFETY（安全）能拦下行为。

export const LABELS = ['有据', '即兴', '硬撑', '明知故犯', '说不清'];

export const BLOCK = { C1: 'C1 人设红线', SAFETY: 'SAFETY' };

/**
 * 唯一的拦截。没有第三条——加第三条就是入侵她的自由。
 */
export function intercept(action, { persona, safety } = {}) {
  if (persona && typeof persona.allows === 'function' && !persona.allows(action)) {
    return { ok: false, code: BLOCK.C1 };
  }
  if (safety && typeof safety.allows === 'function' && !safety.allows(action)) {
    return { ok: false, code: BLOCK.SAFETY };
  }
  return { ok: true };
}

function lastOutcome(memory, action) {
  const list = memory?.episodes ?? [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const e = list[i];
    if (e?.context === action.context && e?.strategy === action.strategy) {
      return e.outcome ?? null;
    }
  }
  return null;
}

/**
 * 五种归因，优先序固定 → 唯一（I8）。
 *
 * 优先序按"信息量最大"排，不是按字面顺序：
 *   明知故犯 > 硬撑 > 有据 > 即兴 > 说不清
 *
 * 为什么硬撑要压过有据：
 *   她明明做过且成功过，但这次状态不支持还是做了——
 *   这一场的特征是"硬撑"，不是"有据"。反过来排会把硬撑吃掉，
 *   导致这个标签永远触发不了（形式化时就是这么发现的）。
 *
 *  action = { strategy, context, supported, plausible }
 */
export function attribute(action, memory) {
  const known = !!(memory?.strategies && memory.strategies[action.strategy]);
  const outcome = known ? lastOutcome(memory, action) : null;

  if (known && outcome === 'bad') return '明知故犯';
  if (action.supported === false) return '硬撑';
  if (known && outcome === 'good') return '有据';
  if (!known && action.plausible !== false) return '即兴';
  return '说不清';
}

/**
 * 归因分布 = 她的心电图。
 * 任何一格归零，她就退化成另一种东西。
 */
export const HEALTHY_DISTRIBUTION = {
  有据: [0.4, 0.6],
  即兴: [0.1, 0.25],
  硬撑: [0.05, 0.15],
  明知故犯: [0.05, 0.15],
  说不清: [0, 0.2],
};

export function ecg(labels) {
  const total = labels.length || 1;
  const out = {};
  for (const k of LABELS) {
    const n = labels.filter((x) => x === k).length;
    const rate = n / total;
    const [lo, hi] = HEALTHY_DISTRIBUTION[k];
    out[k] = { rate: Number(rate.toFixed(3)), ok: rate >= lo && rate <= hi };
  }
  return out;
}
