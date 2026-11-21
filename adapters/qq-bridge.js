// 适配器一：老用户 · QQ 桥接（SnowLuma/OneBot 那套）
//
// 这个文件只做一件事：把桥接内部的状态对象 map 成大脑认识的形状。
// 它不含任何 QQ 协议实现——协议在宿主（桥接）里，本包只提供大脑。
//
// 用法（宿主侧）：
//   import * as brain from 'feiyu-brain'
//   const ad = brain.createBridgeAdapter({ log })
//   ...
//   const line = ad.buildBrainLine(key, st, brain)   // 插进唤醒 prompt（顺带把新消息记进去）
//   ad.drainUnread(key, st, brain)                   // 手动批量经历
//
// 契约（宿主必须给什么）：
//   st.unread[]          推第一条：seq（或 messageId / time）、sender、text|plain|tail、isSelf
//   st.recentMessages[]  可选兜底：同上，但**经常没有 seq**——所以本适配器不要求 seq
//
// 缺字段不会静默消失：拿不到去重键时会记一条 contractWarning，宿主能查出来。

import { normalizeEvent } from '../core/event.js';

const SEEN_MAX = 500;

/**
 * 去重键：seq 优先，其次 messageId，最后 time+前十几个字。
 * **不能只认 seq**——桥接的 recentMessages 常常没有 seq，只认 seq 会让大脑永远不长大。
 */
export function dedupeKey(msg) {
  if (!msg) return null;
  const seq = Number(msg.seq);
  if (Number.isFinite(seq) && msg.seq !== null && msg.seq !== '') return `s:${seq}`;
  if (msg.messageId !== undefined && msg.messageId !== null && msg.messageId !== '') return `m:${msg.messageId}`;
  const t = Number(msg.time);
  if (Number.isFinite(t)) {
    const body = String(msg.tail || msg.plain || msg.text || '').slice(0, 16);
    return `t:${t}:${body}`;
  }
  return null;
}

function sortKey(msg) {
  const seq = Number(msg?.seq);
  if (Number.isFinite(seq) && msg?.seq !== null && msg?.seq !== '') return seq;
  const t = Number(msg?.time);
  return Number.isFinite(t) ? t : 0;
}

/**
 * @param {object} opts
 * @param {(msg:string)=>void} [opts.log]
 * @param {(s:string,n:number)=>string} [opts.truncateText]
 * @param {string} [opts.id] 鱼 id
 * @param {number} [opts.limit] 单次最多经历多少条（默认 20）
 */
export function createBridgeAdapter({
  log = () => {},
  truncateText = (s, n) => String(s ?? '').slice(0, n),
  id = 'default',
  limit = 20,
} = {}) {
  const seenKeys = new Map();  // key(会话) -> Set(去重键)
  const warnings = [];         // 契约问题，宿主可读

  function seenOf(key) {
    if (!seenKeys.has(key)) seenKeys.set(key, new Set());
    return seenKeys.get(key);
  }

  function warn(code, detail) {
    const item = { at: Date.now(), code, detail, key: null };
    warnings.push(item);
    if (warnings.length > 200) warnings.shift();
    log(`[brain] 契约告警 ${code}：${detail}`);
    return item;
  }

  function incomingList(st) {
    if (!st) return [];
    const unread = Array.isArray(st.unread) ? st.unread : [];
    const recent = Array.isArray(st.recentMessages) ? st.recentMessages : [];
    const all = [...unread, ...recent].filter((m) => m && !m.isSelf);
    // 去重（同一会话内 unread 和 recent 会有重叠）
    const byKey = new Map();
    for (const m of all) {
      const k = dedupeKey(m);
      if (!k) continue;
      byKey.set(k, m);
    }
    return [...byKey.entries()]
      .sort((a, b) => sortKey(a[1]) - sortKey(b[1]))
      .map(([, m]) => m);
  }

  function newestIncoming(st) {
    const list = incomingList(st);
    return list.length ? list[list.length - 1] : null;
  }

  /** 桥接消息 → 通用事件 */
  function toEvent(msg) {
    if (!msg) return null;
    return normalizeEvent({
      kind: 'message',
      platform: 'qq-bridge',
      chatId: msg.chatId ?? msg.groupId ?? 'unknown',
      chatKind: msg.chatKind ?? 'group',
      sender: msg.sender ?? msg.nickname ?? '',
      senderId: msg.user_id ?? msg.userId ?? msg.senderId ?? '',
      text: String(msg.tail || msg.plain || msg.text || ''),
      at: Number(msg.time) || Date.now(),
      isSelf: msg.isSelf === true,
      seq: msg.seq ?? msg.messageId,
    }, 'qq-bridge');
  }

  /**
   * 批量"经历"。
   *
   * 补发 7 条就是 7 条，不再只记最新那条。
   * 超过 limit 的合并成一条「补看」，并明确告诉你跳过了几条。
   */
  function drainUnread(key, st, brainApi, { limit: cap } = {}) {
    const max = Math.max(1, Number(cap) || limit);
    const seen = seenOf(key);
    const list = incomingList(st).filter((m) => {
      const k = dedupeKey(m);
      return k && !seen.has(k);
    });

    if (!list.length) return { observed: 0, skipped: 0, merged: 0, remaining: 0, ok: true };

    const take = list.slice(0, max);
    const rest = list.slice(max);

    let observed = 0;
    let failed = 0;
    for (const msg of take) {
      const k = dedupeKey(msg);
      const ev = toEvent(msg);
      if (!ev?.text) { failed += 1; continue; }
      try {
        brainApi.observe(id, ev);
        seen.add(k);
        observed += 1;
      } catch (error) {
        failed += 1;
        log(`[brain] observe 失败（已忽略）：${error?.message ?? error}`);
      }
    }

    // 超出的合并成一条，别让它们凭空蒸发
    let merged = 0;
    if (rest.length) {
      const first = rest[0];
      const last = rest[rest.length - 1];
      const ev = toEvent(last);
      if (ev) {
        try {
          brainApi.observe(id, {
            ...ev,
            text: `（补看）${rest.length} 条积压消息：从「${truncateText(String(first.tail || first.plain || first.text || ''), 24)}」到「${truncateText(String(last.tail || last.plain || last.text || ''), 24)}」`,
            what: `（补看）${rest.length} 条积压消息`,
          });
          for (const m of rest) {
            const k = dedupeKey(m);
            if (k) seen.add(k);
          }
          merged = rest.length;
        } catch (error) {
          log(`[brain] 补看合并失败（已忽略）：${error?.message ?? error}`);
        }
      }
    }

    if (seen.size > SEEN_MAX) {
      // 只保留最近的，避免无限涨
      const keep = [...seen].slice(-SEEN_MAX);
      seenKeys.set(key, new Set(keep));
    }

    return {
      observed,
      skipped: failed,
      merged,
      remaining: Math.max(0, rest.length - merged),
      ok: true,
    };
  }

  /** 兼容旧调用：等价于 drainUnread 只取一条 */
  function observeOnce(key, st, brainApi) {
    const r = drainUnread(key, st, brainApi, { limit: 1 });
    return r.observed ? true : null;
  }

  return {
    id,
    toEvent,
    newestIncoming,
    incomingList,
    observeOnce,
    drainUnread,

    /** 契约告警：宿主可以打个接口暴露出去，别让"没长大"变成玄学 */
    warnings() {
      return [...warnings];
    },
    clearWarnings() {
      warnings.length = 0;
    },

    /**
     * 生成唤醒 prompt 里的那一段。
     * 永远不抛：失败就返回空串——没有内心也要能说话。
     */
    buildBrainLine(key, st, brainApi) {
      try {
        const r = drainUnread(key, st, brainApi);
        if (r.observed === 0 && r.merged === 0) {
          const has = incomingList(st).length;
          if (has > 0) warn('E_NO_NEW_KEYS', `本回合有 ${has} 条消息但都没取到去重键`);
        }
        const ev = toEvent(newestIncoming(st));
        const text = brainApi.wakeLine(id, ev ?? null);
        return text ? `${text}\n\n` : '';
      } catch (error) {
        log(`[brain] 唤醒段生成失败（已忽略）：${error?.message ?? error}`);
        return '';
      }
    },
  };
}
