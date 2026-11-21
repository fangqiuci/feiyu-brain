// 嘴：把话**发出去**。
//
// 之前我把"生成文本"当成嘴——那是错的。
// 生成是思考，模型本来就有；嘴是**把思考的结果送到别人屏幕上**。
//
// 三种嘴：
//   window  往一个窗口打字 + 回车（微信、QQ 客户端、任何输入框）
//   qq      走已有的 QQ 适配器（桥接 / 官方 API）
//   http    POST 到宿主自己的发送接口
//
// 手和嘴不是一回事：手是"点哪里"，嘴是"说什么"。

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * 往一个窗口里"打一段字并回车"。
 *
 * 用剪贴板粘贴而不是逐键模拟——中文逐键会乱。
 *
 * @param {object} o
 * @param {string} o.title   窗口标题（部分匹配即可，如 "微信" / "QQ"）
 * @param {string} o.text    要发的内容
 * @param {boolean} [o.enter] 发完按不按回车（默认按）
 * @param {boolean} [o.dryRun]
 */
export async function sendToWindow({ title = '', text = '', enter = true, dryRun = false } = {}) {
  const t = String(title ?? '').trim();
  const body = String(text ?? '');
  if (!t) return { ok: false, code: 'E_ARGS', via: 'window', text: '要说明发到哪个窗口（标题）' };
  if (!body) return { ok: false, code: 'E_ARGS', via: 'window', text: '没什么可发的' };

  if (dryRun) {
    return { ok: true, via: 'window', dryRun: true, title: t, chars: body.length, evidence: `window:dry:${t}` };
  }

  // ① 聚焦窗口 → ② 放剪贴板 → ③ Ctrl+V → ④ 回车
  const ps = [
    '$ErrorActionPreference="Stop";',
    'Add-Type -AssemblyName System.Windows.Forms;',
    `$ws = New-Object -ComObject WScript.Shell;`,
    `if (-not $ws.AppActivate(${JSON.stringify(t)})) { Write-Output "NO_WINDOW"; exit 2 };`,
    'Start-Sleep -Milliseconds 250;',
    `Set-Clipboard -Value ${JSON.stringify(body)};`,
    'Start-Sleep -Milliseconds 120;',
    '[System.Windows.Forms.SendKeys]::SendWait("^v");',
    'Start-Sleep -Milliseconds 150;',
    enter ? '[System.Windows.Forms.SendKeys]::SendWait("{ENTER}");' : '',
  ].filter(Boolean).join(' ');

  try {
    const { stdout } = await run('powershell', ['-NoProfile', '-Command', ps], { timeout: 20000 });
    if (String(stdout).includes('NO_WINDOW')) {
      return { ok: false, code: 'E_NO_WINDOW', via: 'window', text: `没找到标题含「${t}」的窗口` };
    }
    return {
      ok: true,
      via: 'window',
      title: t,
      chars: body.length,
      evidence: `window:${t}:${body.slice(0, 24)}`,
    };
  } catch (e) {
    return { ok: false, code: 'E_SEND', via: 'window', text: String(e?.message ?? e).slice(0, 200) };
  }
}

/**
 * 说话的唯一入口。
 *
 * @param {object} o
 * @param {'window'|'qq'|'http'} [o.via]
 * @param {object} deps  { log, bridgeAdapter, brain, id }
 */
export async function say({ text = '', via = 'auto', title = '', target = '', enter = true, dryRun = false, kind = 'group', baseUrl = '', token = '', dataDir = '', allowDirect = false } = {}, deps = {}) {
  // 直连网关会绕过宿主桥接的白名单/限流/审计。
  // 所以默认不许直连，必须显式 allowDirect:true 或 FEIYU_ALLOW_DIRECT=1。
  const directAllowed = deps.allowDirect === true || allowDirect === true || process.env.FEISHU_ALLOW_DIRECT === '1';
  const wantsDirect = via === 'auto' || via === 'onebot';
  if (wantsDirect && !directAllowed) {
    return {
      ok: false,
      code: 'E_NEED_OPT_IN',
      via,
      text: '直连 OneBot 会绕过宿主的白名单/限流/审计。要发请显式传 allowDirect:true，'
        + '或设环境变量 FEISHU_ALLOW_DIRECT=1；走桥接则用 via:"http" 指向桥接的发送接口。',
    };
  }

  // auto：先找用户配过的/能扫到的 OneBot，找不到再退回窗口
  if (via === 'auto') {
    const { resolveMouth } = await import('./channels.mjs');
    const m = await resolveMouth({ dataDir: dataDir || deps.dataDir || '' }).catch(() => null);
    if (m) {
      const { sendOneBot } = await import('./onebot.mjs');
      return sendOneBot({ baseUrl: m.baseUrl, token: m.token, kind, target, text, dryRun });
    }
    via = 'window';
  }
  if (via === 'onebot') {
    const { sendOneBot } = await import('./onebot.mjs');
    return sendOneBot({
      baseUrl: baseUrl || deps.baseUrl || process.env.FEISHU_ONEBOT || 'http://127.0.0.1:3000',
      token: token || deps.token || process.env.FEISHU_ONEBOT_TOKEN || '',
      kind,
      target,
      text,
      dryRun,
    });
  }
  if (via === 'qq') {
    const ad = deps.bridgeAdapter;
    if (!ad || typeof ad.send !== 'function') {
      return { ok: false, code: 'E_NO_QQ', via, text: 'QQ 通道没接（需要宿主传入 bridgeAdapter）' };
    }
    return ad.send(target, text);
  }
  if (via === 'http') {
    if (!target) return { ok: false, code: 'E_ARGS', via, text: 'http 通道要给 target 地址' };
    try {
      const res = await fetch(target, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      return { ok: res.ok, via, status: res.status, evidence: `http:${target}` };
    } catch (e) {
      return { ok: false, code: 'E_SEND', via, text: String(e?.message ?? e).slice(0, 200) };
    }
  }
  return sendToWindow({ title, text, enter, dryRun });
}
