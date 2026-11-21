// 嘴：让她能说话。
//
// 之前我死守"嘴是宿主的事"，结果就是——装上了，但她一句都说不出来。
// 那不是内核，那是零件。
//
// 这里接一个 OpenAI 兼容接口（你自己的 key、你自己的模型），
// 流程只有四步：
//
//   ① 取「此刻的她」（wake 段）
//   ② 拼成 system prompt
//   ③ 调模型
//   ④ 把回复记回去（observe）
//
// **不给 key 也不崩**：会明确告诉你"她张了张嘴，但没地方说话"。

const DEFAULTS = {
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  timeoutMs: 60000,
};

/**
 * 造一张嘴。
 *
 * @param {object} o
 * @param {string} [o.baseUrl] OpenAI 兼容的 /v1 地址
 * @param {string} [o.apiKey]  也可以走环境变量 FEIYU_LLM_KEY
 * @param {string} [o.model]
 */
export function createMouth({
  baseUrl = process.env.FEIYU_LLM_BASE || DEFAULTS.baseUrl,
  apiKey = process.env.FEIYU_LLM_KEY || process.env.OPENAI_API_KEY || '',
  model = process.env.FEIYU_LLM_MODEL || DEFAULTS.model,
  timeoutMs = DEFAULTS.timeoutMs,
} = {}) {
  const configured = Boolean(apiKey && baseUrl);

  /**
   * 说一句。
   * @param {object} o
   * @param {string} o.system  她此刻的状态（wake 段）
   * @param {Array<{role:string,content:string}>} o.messages 往来
   */
  async function say({ system = '', messages = [], maxTokens = 200, temperature = 0.9 } = {}) {
    if (!configured) {
      return {
        ok: false,
        code: 'E_NO_LLM',
        text: '她张了张嘴，但没地方说话（没配模型：设 FEIYU_LLM_KEY 或用 mouth({apiKey})）',
        configured: false,
      };
    }
    const url = `${String(baseUrl).replace(/\/$/, '')}/chat/completions`;
    const body = {
      model,
      temperature,
      max_tokens: maxTokens,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        ...messages,
      ],
    };

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, code: `E_LLM_${res.status}`, text: String(json?.error?.message ?? `HTTP ${res.status}`), configured: true };
      }
      const text = String(json?.choices?.[0]?.message?.content ?? '').trim();
      if (!text) return { ok: false, code: 'E_LLM_EMPTY', text: '模型回了空话', configured: true };
      return { ok: true, text, model, usage: json?.usage ?? null, configured: true };
    } catch (e) {
      const aborted = String(e?.name ?? '') === 'AbortError';
      return {
        ok: false,
        code: aborted ? 'E_LLM_TIMEOUT' : 'E_LLM',
        text: aborted ? `模型 ${timeoutMs}ms 没回来` : String(e?.message ?? e),
        configured: true,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return { say, configured, baseUrl, model };
}

/** 把 wake 段变成 system prompt —— 这是"她的嘴"唯一的输入 */
export function buildSystemPrompt(stateText, { extra = '' } = {}) {
  const parts = [
    stateText || '',
    '',
    '用她的口吻回一句。不要客服腔，不要解释你在做什么，不要复述上面的资料。',
  ];
  if (extra) parts.push(extra);
  return parts.filter(Boolean).join('\n');
}
