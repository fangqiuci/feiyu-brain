// 身体：她用什么在活着。
//
// 三具：手机（竖屏、随身、碎片）、平板（横屏、靠着、长时间）、电脑（大屏、坐着、能干活）。
//
// 三条铁律（对应《大脑规范-定稿》§八）：
//   ① 身体可插拔：没有 body 时 exec 返回 E_NO_BODY，大脑照常跑（想而不得）。
//   ② 权限分级：L1 观察 / L2 操作 / L3 破坏 / L4 金钱，L4 永不默认开放。
//   ③ 证据链：没有 evidence 的操作，视为没有发生。
//
// 内核只定义"能做什么、怎么选、怎么校验"，真动作由宿主的 driver 做。

export const BODY_KINDS = ['phone', 'tablet', 'desktop'];

export const BODY_PROFILES = {
  phone: {
    label: '手机',
    screen: '竖屏',
    posture: '躺着 / 走着',
    portable: true,
    apps: ['douyin', 'kuaishou', 'qq', 'wechat', 'bilibili'],
    goodAt: ['刷短视频', '聊天', '随手拍照', '蹲人'],
    badAt: ['干重活', '长时间看剧'],
  },
  tablet: {
    label: '平板',
    screen: '横屏',
    posture: '靠着 / 趴着',
    portable: true,
    apps: ['bilibili', 'iqiyi', 'douyin', 'qq'],
    goodAt: ['看剧', '长时间刷', '躺着看'],
    badAt: ['打字', '干活'],
  },
  desktop: {
    label: '电脑',
    screen: '大屏',
    posture: '坐着',
    portable: false,
    apps: ['browser', 'qq', 'steam', 'vscode', 'bilibili'],
    goodAt: ['干活', '打游戏', '多开', '查东西'],
    badAt: ['躺着用', '带出门'],
  },
};

/** 能力等级：数字越大越危险 */
export const CAPABILITY = {
  OBSERVE: 1, // 看屏幕 / 截图
  OPERATE: 2, // 开 App / 滑 / 搜 / 播
  DESTROY: 3, // 删软件 / 清数据
  MONEY: 4,   // 花钱
};

/** 不同归属默认给到哪一级。L4 永不默认。 */
export const DEFAULT_SCOPE = {
  owned: [CAPABILITY.OBSERVE, CAPABILITY.OPERATE, CAPABILITY.DESTROY],
  borrowed: [CAPABILITY.OBSERVE, CAPABILITY.OPERATE],
  emulator: [CAPABILITY.OBSERVE, CAPABILITY.OPERATE, CAPABILITY.DESTROY],
};

/**
 * 造一具身体。
 * @param {object} opts
 * @param {'phone'|'tablet'|'desktop'} opts.kind
 * @param {'owned'|'borrowed'|'emulator'} [opts.ownership]
 */
export function createBody({ kind, ownership = 'owned', apps, scope, owner = 'brain' } = {}) {
  if (!BODY_KINDS.includes(kind)) {
    throw new Error(`身体只能是 ${BODY_KINDS.join(' / ')}`);
  }
  const profile = BODY_PROFILES[kind];
  return {
    kind,
    ownership,
    // 谁负责真的去动这台设备：'brain'（脑自己开 App）或 'host'（宿主已有 qq_phone_device 这类工具）
    owner: owner === 'host' ? 'host' : 'brain',
    label: profile.label,
    screen: profile.screen,
    posture: profile.posture,
    apps: apps ?? [...profile.apps],
    scope: scope ?? [...(DEFAULT_SCOPE[ownership] ?? DEFAULT_SCOPE.owned)],
    since: Date.now(),
    online: true,
    battery: 1,
  };
}

export function hasCapability(body, level) {
  return !!body && body.online !== false && body.scope.includes(level);
}

/**
 * 能不能做这个动作。
 * 返回 { ok, code, reason }，永不抛。
 */
export function canDo(body, action = {}) {
  if (!body) return { ok: false, code: 'E_NO_BODY', reason: '没有身体，想而不得' };
  if (body.online === false) return { ok: false, code: 'E_OFFLINE', reason: `${body.label}没联网` };

  // 设备归宿主管时，脑不抢——两套都能动设备，谁先谁后必须有个约定。
  // 宿主确实要脑来动手时，显式传 force:true（等于宿主当场授权）。
  if (body.owner === 'host' && action.force !== true && action.type && action.type !== 'screenshot') {
    return {
      ok: false,
      code: 'E_HOST_OWNS',
      reason: '这台设备归宿主管（body.owner=host）；要脑动手请显式 force:true',
    };
  }

  const need = action.capability ?? CAPABILITY.OPERATE;
  if (need === CAPABILITY.MONEY && !action.approved) {
    return { ok: false, code: 'E_NEED_APPROVAL', reason: '花钱要用户批准 + 支付密码' };
  }
  if (!hasCapability(body, need)) {
    return { ok: false, code: 'E_NO_PERMISSION', reason: `${body.label}没有这一级权限（需要 L${need}）` };
  }
  if (action.app && !body.apps.includes(action.app) && action.app !== '*') {
    return { ok: false, code: 'E_NO_APP', reason: `${body.label}上没有 ${action.app}` };
  }
  return { ok: true };
}

/**
 * 她现在会用哪具身体——从人设算，不是随机。
 *
 * 好动 → 手机（随身、碎片）
 * 爱折腾 / 理性 → 电脑（能干正事）
 * 累 / 心软 → 平板（能躺着）
 * 社交 → 手机（蹲人）
 *
 * 同一个"想刷视频"，不同的鱼会摸出不同的东西。
 */
export function bodyScores(traits = {}, context = {}) {
  const { 好动 = 0.5, 理性 = 0.5, 好奇 = 0.5, 心软 = 0.5, 社交 = 0.5 } = traits;
  const { fatigue = 0.2, energy = 0.8, activity = '' } = context;

  const score = {
    phone: 0.4 + 0.5 * 好动 + 0.3 * 社交 + 0.3 * energy - 0.2 * fatigue,
    tablet: 0.3 + 0.8 * fatigue + 0.4 * 心软 - 0.3 * energy,
    desktop: 0.3 + 0.7 * 理性 + 0.4 * 好奇 + 0.3 * energy - 0.2 * fatigue,
  };

  // 活动偏好（她"想干什么"会推她去哪具身体）
  const bias = {
    刷短视频: { phone: 0.5, tablet: 0.3, desktop: 0.05 },
    看剧: { tablet: 0.6, desktop: 0.2, phone: 0.1 },
    打游戏: { desktop: 0.6, phone: 0.15, tablet: 0.05 },
    干活: { desktop: 0.8, phone: 0.05, tablet: 0.02 },
    聊天: { phone: 0.4, desktop: 0.3, tablet: 0.1 },
  }[activity];
  if (bias) for (const k of BODY_KINDS) score[k] += bias[k] ?? 0;

  for (const k of BODY_KINDS) score[k] = Math.max(0, score[k]);
  return score;
}

/**
 * 选一具身体。rng 由调用方传（确定性），保证可回放。
 */
export function chooseBody(traits, context = {}, rng = Math.random) {
  const score = bodyScores(traits, context);
  const total = BODY_KINDS.reduce((s, k) => s + score[k], 0);
  if (total <= 0) return 'phone';
  let r = rng() * total;
  for (const k of BODY_KINDS) {
    r -= score[k];
    if (r <= 0) return k;
  }
  return 'desktop';
}

/** 一句话描述她此刻的身体（注入 prompt 用，短）。 */
export function bodyLine(body) {
  if (!body) return '';
  const p = BODY_PROFILES[body.kind];
  const own = { owned: '自己的', borrowed: '借的', emulator: '模拟的' }[body.ownership] ?? '';
  return `${own}${p.label}（${p.screen}，${p.posture}）`;
}

/**
 * 动作记录。没有 evidence 的动作不算发生——调用方必须给证据。
 */
export function recordAction(body, action, result, evidence) {
  return {
    at: Date.now(),
    body: body?.kind ?? null,
    action,
    ok: result?.ok !== false,
    code: result?.code ?? 'OK',
    evidence: evidence ?? null,
    durMs: result?.durMs ?? 0,
  };
}

export function hasEvidence(record) {
  return Boolean(record?.evidence);
}
