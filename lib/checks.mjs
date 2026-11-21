// 数据侧体检：不是"装没装上"，是"能不能长期跑"。
//
// 铺到无数条鱼之后，真正出事的是这些：
//   没有 current-role.json / 口令权限太松 / 审计无限长 / 有隔离档没处理

import fs from 'node:fs';
import path from 'node:path';

const ok = (key, text) => ({ level: 'ok', key, text });
const warn = (key, text, fix) => ({ level: 'warn', key, text, fix });

export function dataChecks({ dataDir, id = 'default' } = {}) {
  const out = [];
  if (!dataDir) return out;

  // ① 角色卡指针
  const cur = path.join(dataDir, 'current-role.json');
  if (!fs.existsSync(cur)) {
    out.push(warn(
      'current-role',
      '没有 current-role.json —— 光把卡放进 roles/ 还不行，她不知道用哪一张',
      `写 {"role":"<卡名>"} 到 ${cur}`,
    ));
  } else {
    out.push(ok('current-role', 'current-role.json 存在'));
  }

  // ② 通道口令
  const ch = path.join(dataDir, 'channels.json');
  if (fs.existsSync(ch)) {
    let mode = 0;
    try { mode = fs.statSync(ch).mode & 0o777; } catch { /* 忽略 */ }
    // Windows 上 chmod 基本无效（只映射成只读属性），别给假警告
    if (process.platform !== 'win32' && mode && mode !== 0o600) {
      out.push(warn('channels-mode', `channels.json 权限 ${mode.toString(8)}，太松`, `chmod 600 ${ch}`));
    } else {
      out.push(ok('channels-mode', process.platform === 'win32' ? 'channels.json 权限（Windows 由 ACL 决定）' : `channels.json 权限 ${mode.toString(8)}`));
    }
    try {
      const raw = fs.readFileSync(ch, 'utf8');
      if (/"(?:token|accessToken)"\s*:\s*"[^"]{8,}"/.test(raw)) {
        out.push(warn('channels-plain', 'channels.json 里还有明文口令', '重跑 npx feiyu mouth detect（会改存引用）'));
      } else {
        out.push(ok('channels-plain', 'channels.json 没有明文口令'));
      }
    } catch { /* 读不了跳过 */ }
  }

  // ③ 审计体积
  const audit = path.join(dataDir, 'brains', id, 'audit.jsonl');
  if (fs.existsSync(audit)) {
    const size = fs.statSync(audit).size;
    const mb = size / 1024 / 1024;
    out.push(mb > 4
      ? warn('audit-size', `audit.jsonl ${mb.toFixed(1)} MB，该轮转了`)
      : ok('audit-size', `audit.jsonl ${mb.toFixed(1)} MB`));
  }

  // ④ 隔离档（坏过）
  try {
    const broken = fs.readdirSync(path.join(dataDir, 'brains', id)).filter((f) => f.includes('.broken-'));
    if (broken.length) {
      out.push(warn('broken', `有 ${broken.length} 个隔离档没处理：${broken.join(', ')}`, 'npx feiyu restore <快照名>，或手工看'));
    } else {
      out.push(ok('broken', '没有隔离档'));
    }
  } catch { /* 没有这个鱼 */ }

  return out;
}
