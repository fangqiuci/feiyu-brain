// 外接嘴：不弹窗、不抢焦点，一条 HTTP 就发出去。
//
// 之前那套"窗口打字"体验差到不能看：要前台、要清空、打错窗口就发到别处。
// 真正的嘴应该是——**POST 一下就完事**。
//
// 支持三种外接：
//   onebot   OneBot 11（SnowLuma / NapCat / Lagrange / go-cqhttp 都认）
//   tencent  腾讯官方 API（走已有的 tencent-official 适配器）
//   http     宿主自己的发送接口
//
// 窗口打字留着，但只作最后兜底。

const DEFAULT_TIMEOUT = 15000;

/**
 * OneBot 11 发消息。
 *
 * 先试 POST JSON，失败再试 GET 查询串——各家实现兼容性不一样。
 *
 * @param {object} o
 * @param {string} o.baseUrl   例如 http://127.0.0.1:3000
 * @param {string} [o.token]   访问令牌（一般走 Authorization: Bearer）
 * @param {'group'|'private'} [o.kind]
 * @param {string|number} o.target  群号 / QQ 号
 * @param {string} o.text
 * @param {boolean} [o.dryRun]
 */
export async function sendOneBot({
  baseUrl = 'http://127.0.0.1:3000',
  token = '',
  kind = 'group',
  target = '',
  text = '',
  dryRun = false,
  timeoutMs = DEFAULT_TIMEOUT,
} = {}) {
  const t = String(target ?? '').trim();
  const body = String(text ?? '');
  if (!t) return { ok: false, code: 'E_ARGS', via: 'onebot', text: '要给群号或 QQ 号' };
  if (!body) return { ok: false, code: 'E_ARGS', via: 'onebot', text: '没什么可发的' };
  if (dryRun) {
    return { ok: true, via: 'onebot', dryRun: true, kind, target: t, chars: body.length, evidence: `onebot:dry:${t}` };
  }

  const action = kind === 'private' ? 'send_private_msg' : 'send_group_msg';
  const idKey = kind === 'private' ? 'user_id' : 'group_id';
  const url = `${String(baseUrl).replace(/\/$/, '')}/${action}`;
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;

  const attempt = async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ [idKey]: Number(t) || t, message: body, auto_escape: false }),
        signal: ctrl.signal,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, code: `E_ONEBOT_${res.status}`, text: String(json?.message ?? `HTTP ${res.status}`) };
      // OneBot 有些实现在 200 里带 retcode != 0
      if (json && typeof json.retcode === 'number' && json.retcode !== 0) {
        return { ok: false, code: 'E_ONEBOT_RET', text: String(json.message ?? `retcode ${json.retcode}`) };
      }
      const msgId = json?.data?.message_id ?? null;
      return { ok: true, messageId: msgId, evidence: `onebot:${action}:${t}:${msgId ?? '?'}` };
    } catch (e) {
      const aborted = String(e?.name ?? '') === 'AbortError';
      return { ok: false, code: aborted ? 'E_ONEBOT_TIMEOUT' : 'E_ONEBOT', text: String(e?.message ?? e).slice(0, 200) };
    } finally {
      clearTimeout(timer);
    }
  };

  const r = await attempt();
  if (r.ok) return { ...r, via: 'onebot', kind, target: t };
  // 退回 GET（少数实现不接 JSON 体）
  try {
    const qs = new URLSearchParams({ [idKey]: String(t), message: body });
    const u = `${url}?${qs.toString()}`;
    const h = token ? { authorization: `Bearer ${token}` } : {};
    const res = await fetch(u, { headers: h });
    const json = await res.json().catch(() => ({}));
    if (res.ok && !(typeof json?.retcode === 'number' && json.retcode !== 0)) {
      return { ok: true, via: 'onebot', kind, target: t, messageId: json?.data?.message_id ?? null, evidence: `onebot:get:${action}:${t}` };
    }
  } catch { /* 两种都失败，返回第一次的错误 */ }

  return { ...r, via: 'onebot', kind, target: t };
}

/** 探活：能连上、能拿到版本/登录信息 */
export async function pingOneBot({ baseUrl = 'http://127.0.0.1:3000', token = '', timeoutMs = 4000 } = {}) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  for (const p of ['get_login_info', 'get_version_info']) {
    try {
      const res = await fetch(`${String(baseUrl).replace(/\/$/, '')}/${p}`, { headers });
      if (!res.ok) continue;
      const json = await res.json().catch(() => ({}));
      if (json?.data) return { ok: true, endpoint: p, data: json.data };
    } catch { /* 试下一个 */ }
  }
  return { ok: false, code: 'E_ONEBOT_DOWN' };
}
