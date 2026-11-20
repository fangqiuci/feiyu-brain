// 适配器二：新用户 · 腾讯官方机器人开放平台
//
// 只依赖官方公开的 HTTP/WS 接口，不含任何逆向或私有协议。
// ⚠️ 本文件未经线上联调（没有 appId/appSecret），字段以官方文档为准；
//    第一次接入请先用 sandbox + 单群验证，再放量。
//
// 用法：
//   import { TencentOfficialAdapter } from 'feiyu-brain/adapters/tencent-official'
//   const bot = new TencentOfficialAdapter({ appId, clientSecret, intents })
//   bot.onMessage(async (ev) => {
//     const { text } = brain.wake(ev)
//     const reply = await callYourLLM(text)       // 你的模型
//     await bot.reply(ev, reply)
//   })
//   await bot.start()

import { normalizeEvent } from '../core/event.js';

const API_BASE = 'https://api.sgroup.qq.com';
const TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken';
const WS_URL = 'wss://api.sgroup.qq.com/websocket';

/** 官方 intents 位 */
export const INTENTS = {
  GUILDS: 1 << 0,
  GUILD_MEMBERS: 1 << 1,
  PUBLIC_MESSAGES: 1 << 25,
  DIRECT_MESSAGE: 1 << 12,
  GROUP_AND_C2C: 1 << 25, // 群/C2C 消息事件
};

export class TencentOfficialAdapter {
  /**
   * @param {object} opts
   * @param {string} opts.appId
   * @param {string} opts.clientSecret
   * @param {number} [opts.intents]
   * @param {(m:string)=>void} [opts.log]
   */
  constructor({ appId, clientSecret, intents = INTENTS.GROUP_AND_C2C, log = () => {} } = {}) {
    if (!appId || !clientSecret) throw new Error('缺少 appId / clientSecret');
    this.appId = appId;
    this.clientSecret = clientSecret;
    this.intents = intents;
    this.log = log;

    this.token = null;
    this.tokenExpiresAt = 0;
    this.ws = null;
    this.seq = null;
    this.sessionId = null;
    this.heartbeatTimer = null;
    this.handlers = { message: [] };
    this.stopped = false;
  }

  onMessage(fn) {
    this.handlers.message.push(fn);
    return this;
  }

  // ── 鉴权 ────────────────────────────────────────────────────────────
  async getToken() {
    if (this.token && Date.now() < this.tokenExpiresAt - 60_000) return this.token;
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: this.appId, clientSecret: this.clientSecret }),
    });
    if (!res.ok) throw new Error(`取 token 失败：HTTP ${res.status}`);
    const data = await res.json();
    if (!data.access_token) throw new Error(`取 token 失败：${JSON.stringify(data)}`);
    this.token = data.access_token;
    this.tokenExpiresAt = Date.now() + (Number(data.expires_in) || 7200) * 1000;
    return this.token;
  }

  async request(method, path, body) {
    const token = await this.getToken();
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `QQBot ${token}`,
        'Content-Type': 'application/json',
        'X-Union-Appid': this.appId,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!res.ok) throw new Error(`API ${method} ${path} → ${res.status} ${text.slice(0, 200)}`);
    return data;
  }

  // ── 发消息（被动回复要带 msg_id）────────────────────────────────────
  sendGroupMessage(groupOpenid, content, msgId, msgSeq = 1) {
    return this.request('POST', `/v2/groups/${encodeURIComponent(groupOpenid)}/messages`, {
      content: String(content).slice(0, 2000),
      msg_type: 0,
      ...(msgId ? { msg_id: msgId, msg_seq: msgSeq } : {}),
    });
  }

  sendC2CMessage(openid, content, msgId, msgSeq = 1) {
    return this.request('POST', `/v2/users/${encodeURIComponent(openid)}/messages`, {
      content: String(content).slice(0, 2000),
      msg_type: 0,
      ...(msgId ? { msg_id: msgId, msg_seq: msgSeq } : {}),
    });
  }

  /** 用大脑事件直接回复 */
  async reply(event, content, msgSeq = 1) {
    if (event.chatKind === 'group') {
      return this.sendGroupMessage(event.chatId.replace(/^group:/, ''), content, event.sourceMsgId, msgSeq);
    }
    return this.sendC2CMessage(event.chatId.replace(/^private:/, ''), content, event.sourceMsgId, msgSeq);
  }

  // ── 事件映射 ────────────────────────────────────────────────────────
  /**
   * 官方事件 → 通用事件。
   * 支持：C2C_MESSAGE_CREATE / GROUP_AT_MESSAGE_CREATE
   */
  toBrainEvent(type, d = {}) {
    const author = d.author ?? {};
    if (type === 'C2C_MESSAGE_CREATE') {
      return normalizeEvent({
        kind: 'message',
        platform: 'tencent-official',
        chatId: `private:${author.user_openid ?? author.id ?? ''}`,
        chatKind: 'private',
        sender: author.username ?? author.id ?? '',
        senderId: author.user_openid ?? author.id ?? '',
        text: d.content ?? '',
        at: Number(d.timestamp) || Date.now(),
        isSelf: false,
        seq: undefined,
      }, 'tencent-official');
    }
    if (type === 'GROUP_AT_MESSAGE_CREATE') {
      return normalizeEvent({
        kind: 'message',
        platform: 'tencent-official',
        chatId: `group:${d.group_openid ?? ''}`,
        chatKind: 'group',
        sender: author.member_openid ?? author.id ?? '',
        senderId: author.member_openid ?? author.id ?? '',
        text: d.content ?? '',
        at: Number(d.timestamp) || Date.now(),
        isSelf: false,
        isAtMe: true, // 群里的 @ 消息才算事件
      }, 'tencent-official');
    }
    return null;
  }

  // ── 连接 ────────────────────────────────────────────────────────────
  async start() {
    this.stopped = false;
    await this.connect();
    return this;
  }

  async connect() {
    const gateway = await this.request('GET', '/gateway').catch(() => null);
    const url = gateway?.url || WS_URL;
    const token = await this.getToken();

    const ws = new WebSocket(url);
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.log('[tencent] ws 已连接，发送 identify');
    });

    ws.addEventListener('message', (frame) => this.onFrame(String(frame.data)));
    ws.addEventListener('close', () => {
      this.stopHeartbeat();
      if (!this.stopped) {
        this.log('[tencent] ws 断开，5 秒后重连');
        setTimeout(() => this.connect().catch((e) => this.log(`[tencent] 重连失败：${e.message}`)), 5000);
      }
    });
    ws.addEventListener('error', () => this.log('[tencent] ws 错误'));

    // identify 在 Hello(10) 之后发，见 onFrame
    this.identifyToken = token;
  }

  onFrame(raw) {
    let payload;
    try { payload = JSON.parse(raw); } catch { return; }
    const { op, d, s, t } = payload;
    if (Number.isFinite(s)) this.seq = s;

    switch (op) {
      case 10: { // Hello
        const interval = Number(d?.heartbeat_interval) || 30000;
        this.startHeartbeat(interval);
        this.send({ op: 2, d: { token: `QQBot ${this.identifyToken}`, intents: this.intents, shard: [0, 1], properties: {} } });
        break;
      }
      case 0: { // Dispatch
        if (t === 'READY') this.sessionId = d?.session_id ?? null;
        this.dispatch(t, d);
        break;
      }
      case 11: break;                     // Heartbeat ACK
      case 7: this.log('[tencent] 收到重连指令'); this.ws?.close(); break;
      case 9: this.log('[tencent] identify 被拒，检查 intents'); break;
      default: break;
    }
  }

  dispatch(type, d) {
    const ev = this.toBrainEvent(type, d);
    if (!ev) return;
    ev.sourceMsgId = d?.id; // 被动回复要带这个
    for (const fn of this.handlers.message) {
      try { Promise.resolve(fn(ev)).catch((e) => this.log(`[tencent] 处理失败：${e?.message ?? e}`)); }
      catch (e) { this.log(`[tencent] 处理失败：${e?.message ?? e}`); }
    }
  }

  send(payload) {
    try { this.ws?.send(JSON.stringify(payload)); } catch (e) { this.log(`[tencent] 发送失败：${e.message}`); }
  }

  startHeartbeat(interval) {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => this.send({ op: 1, d: this.seq }), interval);
    this.heartbeatTimer.unref?.();
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  async stop() {
    this.stopped = true;
    this.stopHeartbeat();
    try { this.ws?.close(); } catch {}
  }
}
