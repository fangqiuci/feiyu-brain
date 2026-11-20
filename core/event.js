// 通用事件协议：任何平台的消息都先变成这个形状，再进大脑。
//
// 大脑不认 QQ、不认腾讯、不认 Discord——它只认这一种 event。
// 换平台 = 换一个把平台消息映射成 event 的适配器，大脑一行不动。

/**
 * @typedef {Object} BrainEvent
 * @property {'message'|'timer'|'poke'|'notice'} kind
 * @property {string} chatId      会话 id（group:123 / private:456）
 * @property {'group'|'private'} chatKind
 * @property {string} sender      显示名
 * @property {string} senderId    平台用户 id
 * @property {string} text        正文
 * @property {number} at          毫秒时间戳
 * @property {boolean} isSelf     是不是她自己发的
 * @property {boolean} isAtMe     有没有点名她
 * @property {string[]} mentions  被提到的名字
 * @property {number} [seq]       平台序号（用于去重）
 */

export const EVENT_KINDS = ['message', 'timer', 'poke', 'notice'];

export function normalizeEvent(raw = {}, platform = 'unknown') {
  const text = String(raw.text ?? raw.content ?? raw.message ?? '').trim();
  return {
    kind: raw.kind ?? 'message',
    platform: raw.platform ?? platform,
    chatId: String(raw.chatId ?? raw.channelId ?? 'unknown'),
    chatKind: raw.chatKind ?? (String(raw.chatId ?? '').startsWith('group') ? 'group' : 'private'),
    sender: String(raw.sender ?? raw.userName ?? raw.from ?? ''),
    senderId: String(raw.senderId ?? raw.userId ?? raw.fromId ?? ''),
    text,
    at: Number(raw.at ?? raw.time ?? Date.now()),
    isSelf: raw.isSelf === true,
    isAtMe: raw.isAtMe === true,
    mentions: Array.isArray(raw.mentions) ? raw.mentions : [],
    seq: Number.isFinite(Number(raw.seq)) ? Number(raw.seq) : undefined,
  };
}

/** 从中文句子里抽几个"能当检索线索"的词（粗，但确定）。 */
export function keywords(text, limit = 5) {
  return String(text)
    .split(/[，。！？、；：\s,.!?;:]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2)
    .slice(0, limit);
}

/** 事件 → 检索线索。 */
export function toCue(event) {
  if (!event) return null;
  return { who: event.sender ?? '', words: keywords(event.text ?? '') };
}

/** 事件 → 一条经历。没正文的事件（定时器/拍一拍）不记。 */
export function toObservation(event) {
  if (!event || !event.text) return null;
  return {
    text: event.text,
    who: event.sender ?? '',
    what: event.text.slice(0, 80),
    via: event.platform ?? 'unknown',
  };
}

/** 这条消息值得让她"经历"吗（自己的不算）。 */
export function shouldObserve(event) {
  return !!event && !event.isSelf && event.kind === 'message' && !!event.text;
}
