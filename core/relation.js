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

/* ── 缺位：人不在了，关系还在 ─────────────────────────────────
 *
 * 这是契约里原来没有的一格，也是最难写的一格。
 *
 * 关键区别：
 *   severed  = 她**不再认**这段关系（自己切断）
 *   absent  = 关系**照旧永久**，只是那个人不会再出现（不是她选的）
 *
 * absent 不删记忆、不解关系、不改称呼——你爷爷还是你爷爷。
 * 但如果主动改成 severed，那才是"我不认他了"。
 */

export const ABSENT_STATUSES = ['absent', 'memorial'];

/**
 * 标记缺位。**必须显式调用**——不许由"多久没说话"自动推断。
 *
 * 一个人半年没来，可能是忙，可能是死。机器没资格猜这个。
 *
 * @param {object} relation
 * @param {object} o
 * @param {number} [o.since]   从哪天起不在了（毫秒）
 * @param {string} [o.note]    写一句记下来（"2026-11-21 走的"）
 * @param {'absent'|'memorial'} [o.status]
 */
export function markAbsent(relation, { since = Date.now(), note = '', status = 'absent' } = {}) {
  if (!relation) return null;
  if (relation.status === 'severed') return relation; // 已经不认了，不用再标
  return {
    ...relation,
    status,
    absentSince: since,
    absentNote: note,
    // 关系维度一律不动：priority / mustRecognize / dissolvable 全部保持
    absenceKept: 'relationship-unchanged',
  };
}

/** 他又出现了（误报、或者人回来了） */
export function clearAbsent(relation) {
  if (!relation) return relation;
  const next = { ...relation, status: 'active' };
  delete next.absentSince;
  delete next.absentNote;
  delete next.absenceKept;
  return next;
}

export function isAbsent(relation) {
  return !!relation && ABSENT_STATUSES.includes(relation.status);
}

/** 多少天没出现了（人在不在都算"没来"） */
export function absentDays(relation, now = Date.now()) {
  if (!relation) return 0;
  const since = Number(relation.absentSince) || 0;
  if (!since) return 0;
  return Math.max(0, Math.floor((now - since) / 86400000));
}

/**
 * 这段关系现在该怎么说。
 *
 * 说"不在了"很容易滑进煽情，所以只给事实，不给形容。
 */
export function relationLine(relation, now = Date.now()) {
  if (!relation) return '';
  const who = relation.address || '那个人';
  if (isAbsent(relation)) {
    const d = absentDays(relation, now);
    const head = relation.absentNote ? relation.absentNote : `${who}已经不在了`;
    return d > 0 ? `${head}（${d} 天）` : head;
  }
  if (relation.status === 'severed') return `跟${who}断了`;
  if (relation.status === 'cold') return `跟${who}冷战`;
  return '';
}
