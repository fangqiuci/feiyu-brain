// 适配器一：老用户 · QQ 桥接（SnowLuma/OneBot 那套）
//
// 这个文件只做一件事：把桥接内部的状态对象 map 成大脑认识的形状。
// 它不含任何 QQ 协议实现——协议在宿主（桥接）里，本包只提供大脑。
//
// 用法（宿主侧）：
//   import * as brain from 'feiyu-brain'
//   const ad = brain.createBridgeAdapter({ log, truncateText })
//   ...
//   const line = ad.buildBrainLine(key, st)   // 插进唤醒 prompt
//   ad.observeOnce(key, st)                   // 她"看到"了最新那条

import { normalizeEvent } from '../core/event.js';

/**
 * @param {object} opts
 * @param {(msg:string)=>void} [opts.log]
 * @param {(s:string,n:number)=>string} [opts.truncateText]
 * @param {string} [opts.id] 鱼 id
 */
export function createBridgeAdapter({ log = () => {}, truncateText = (s, n) => String(s ?? '').slice(0, n), id = 'default' } = {}) {
  const observedSeq = new Map(); // key -> 已"经历"到的 seq

  function newestIncoming(st) {
    if (!st) return null;
    return [...(Array.isArray(st.unread) ? st.unread : [])].reverse().find((m) => m && !m.isSelf)
      || [...(Array.isArray(st.recentMessages) ? st.recentMessages : [])].reverse().find((m) => m && !m.isSelf)
      || null;
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
      seq: msg.seq,
    }, 'qq-bridge');
  }

  /** 一条只算一次：同一个 seq 不重复"经历"。 */
  function observeOnce(key, st, brainApi) {
    const newest = newestIncoming(st);
    if (!newest) return null;
    const seq = Number(newest.seq);
    if (!Number.isFinite(seq)) return null;
    if (seq <= (observedSeq.get(key) ?? 0)) return null;
    observedSeq.set(key, seq);
    const ev = toEvent(newest);
    if (!ev?.text) return null;
    try {
      return brainApi.observe(id, ev);
    } catch (error) {
      log(`[brain] observe 失败（已忽略）：${error?.message ?? error}`);
      return null;
    }
  }

  return {
    id,
    toEvent,
    newestIncoming,
    observeOnce,

    /**
     * 生成唤醒 prompt 里的那一段。
     * 永远不抛：失败就返回空串——没有内心也要能说话。
     */
    buildBrainLine(key, st, brainApi) {
      try {
        observeOnce(key, st, brainApi);
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
