// 关系契约：只管"谁进意识"，不管"怎么回"。
//
// 对应《大脑规范-定稿》§九 与《逻辑内核-定稿》§4.1。
// 维度隔离：关系 → attention；人设 → tone。两个函数输出不同，所以不冲突。

export const RELATION_TYPES = ['parent', 'sibling', 'partner', 'stranger'];

const DEFAULTS = {
  parent: { priority: 100, mustRecognize: true, canSulk: true, mayIgnoreTemporarily: true, responseWithin: '24h', dissolvable: false },
  sibling: { priority: 90, mustRecognize: true, canSulk: true, mayIgnoreTemporarily: true, responseWithin: '24h', dissolvable: false },
  partner: { priority: 95, mustRecognize: true, canSulk: true, mayIgnoreTemporarily: true, responseWithin: '24h', dissolvable: true },
  stranger: { priority: 0, mustRecognize: false, canSulk: true, mayIgnoreTemporarily: true, responseWithin: null, dissolvable: true },
};

export function createContract(type, address = '') {
  if (!RELATION_TYPES.includes(type)) {
    throw new Error(`关系类型必须是 ${RELATION_TYPES.join(' / ')}`);
  }
  return {
    with: 'user',
    type,
    address,
    ctr: { ...DEFAULTS[type] },
    since: Date.now(),
    status: 'active', // active | cold | severed
  };
}

/**
 * 注意力加权：关系里的人绕过所有筛选。
 * 注意——这里只返回"加分"，不返回"必须回复"。回复由人设决定。
 */
export function attentionBoost(sender, relation, { addressed = false } = {}) {
  if (!relation || relation.status === 'severed') return 0;
  const isThem = relation.address && sender && (sender === relation.with || sender.includes(relation.address));
  if (isThem) return 1.0; // 无条件进意识
  if (addressed) return 0.25;
  return 0;
}

/**
 * 漂移边界：能改怎么闹，不能改还在不在。
 * 这三个字段任何漂移通道都不许动。
 */
export const IMMUTABLE_CTR_KEYS = ['mustRecognize', 'dissolvable', 'priority'];

export function assertContractImmutable(next, prev) {
  for (const k of IMMUTABLE_CTR_KEYS) {
    if (next?.ctr?.[k] !== prev?.ctr?.[k]) {
      throw new Error(`I3 关系恒等：${k} 不允许被修改`);
    }
  }
}

export function canSever(relation) {
  return !!relation?.ctr?.dissolvable;
}

/**
 * 解除流程：触发 → 冷战 → 72h → severed。
 * severed 不是删除记忆——她记得，只是不再认这段关系。
 */
export function beginColdWar(relation, reason = '') {
  if (!canSever(relation)) throw new Error('这段关系不可解除');
  return { ...relation, status: 'cold', coldAt: Date.now(), coldReason: reason };
}

export function sever(relation) {
  if (relation.status !== 'cold') throw new Error('必须先冷战才能解除');
  return { ...relation, status: 'severed', severedAt: Date.now() };
}
