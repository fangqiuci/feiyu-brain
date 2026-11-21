// 装不上 / 装上了不工作 —— 自检 + 自动修。
//
// 这三件事插件自己碰不到，但可以替你去改：
//   ① pnpm 有没有        （只能告诉你装什么，不能替你装）
//   ② profile 的 bundles 有没有登记（能自动加）
//   ③ tool-allow 白名单    （能自动加）
//
// 剩下的（数据目录、角色卡）本来就归它自己管。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const TOOLS = [
  'feiyu_status', 'feiyu_wake', 'feiyu_observe', 'feiyu_tick',
  'feiyu_feel', 'feiyu_app', 'feiyu_lint', 'feiyu_snapshot', 'feiyu_diary',
];

export function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
}

function readJsonSafe(file, fallback = null) {
  try {
    const t = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(t);
  } catch {
    return fallback;
  }
}

function writeJsonSafe(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}

function hasPnpm() {
  try {
    const out = execFileSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['-v'], {
      encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'],
    });
    return String(out).trim();
  } catch {
    return null;
  }
}

/**
 * 体检。只读，不改任何东西。
 * @returns {{ok:boolean, checks:Array}}
 */
export function diagnose({ profile = 'desktop', packageName = 'feiyu-brain' } = {}) {
  const home = dshHome();
  const profileFile = path.join(home, 'profiles', profile, 'package.json');
  const allowFile = path.join(home, 'state', 'tool-allow.json');
  const checks = [];

  // ① pnpm
  const pnpm = hasPnpm();
  checks.push({
    id: 'pnpm',
    level: pnpm ? 'ok' : 'block',
    title: 'pnpm',
    detail: pnpm ? `已安装 ${pnpm}` : '没装 pnpm —— dsh plugin add 底层要用它',
    fixable: false,
    fix: pnpm ? '' : 'npm i -g pnpm   （或 corepack enable pnpm）',
  });

  // ② profile bundles + dependencies
  const profileJson = readJsonSafe(profileFile, null);
  if (!profileJson) {
    checks.push({
      id: 'profile',
      level: 'warn',
      title: 'DSH profile',
      detail: `没找到 ${profileFile}`,
      fixable: false,
      fix: '确认 DSH 装过、profile 名字对不对（默认 desktop）',
    });
  } else {
    const deps = profileJson.dependencies ?? {};
    const bundles = profileJson.dsh?.profile?.bundles ?? [];
    const inDeps = Boolean(deps[packageName]);
    const inBundles = bundles.includes(packageName);
    const level = inDeps && inBundles ? 'ok' : 'block';
    checks.push({
      id: 'bundles',
      level,
      title: '插件登记',
      detail: inDeps && inBundles
        ? `dependencies + bundles 都有（${deps[packageName]}）`
        : `dependencies ${inDeps ? '有' : '缺'} / bundles ${inBundles ? '有' : '缺'}（缺 bundles 等于装了不加载）`,
      fixable: true,
      fix: '把 feiyu-brain 补进 dsh.profile.bundles',
      _file: profileFile,
    });
  }

  // ③ tool-allow
  const allow = readJsonSafe(allowFile, null);
  if (!allow) {
    checks.push({
      id: 'allow',
      level: 'warn',
      title: '工具白名单',
      detail: `没找到 ${allowFile}（有些 DSH 版本没有闸门，属正常）`,
      fixable: false,
      fix: '',
    });
  } else {
    const exact = Array.isArray(allow.exact) ? allow.exact : [];
    const prefixes = Array.isArray(allow.prefix) ? allow.prefix : (Array.isArray(allow.prefixes) ? allow.prefixes : []);
    const missing = TOOLS.filter((t) => !exact.includes(t));
    const covered = prefixes.includes('feiyu_') || prefixes.includes('feiyu');
    const level = covered || missing.length === 0 ? 'ok' : 'block';
    checks.push({
      id: 'allow',
      level,
      title: '工具白名单',
      detail: covered
        ? '前缀 feiyu_ 已放行'
        : (missing.length ? `少了 ${missing.length} 个：${missing.join(', ')}` : `9 个都在`),
      fixable: !covered && missing.length > 0,
      fix: '把 9 个 feiyu_* 加进 exact',
      _file: allowFile,
    });
  }

  return { ok: checks.every((c) => c.level !== 'block'), home, profile, checks };
}

/**
 * 自动修能修的（bundles + 白名单）。
 * pnpm 和角色卡不修——一个是系统级，一个是「卡必须用户自己写」。
 */
export function applyFixes(report, { packageName = 'feiyu-brain' } = {}) {
  const done = [];
  for (const c of report.checks) {
    if (!c.fixable || !c._file) continue;

    if (c.id === 'bundles') {
      const json = readJsonSafe(c._file, null);
      if (!json) continue;
      json.dsh = json.dsh ?? {};
      json.dsh.profile = json.dsh.profile ?? {};
      const bundles = Array.isArray(json.dsh.profile.bundles) ? json.dsh.profile.bundles : [];
      if (!bundles.includes(packageName)) bundles.push(packageName);
      json.dsh.profile.bundles = bundles;
      json.dependencies = json.dependencies ?? {};
      if (!json.dependencies[packageName]) json.dependencies[packageName] = 'latest';
      writeJsonSafe(c._file, json);
      done.push(`已在 ${path.basename(c._file)} 里登记 ${packageName}`);
    }

    if (c.id === 'allow') {
      const json = readJsonSafe(c._file, null);
      if (!json) continue;
      const exact = Array.isArray(json.exact) ? json.exact : [];
      for (const t of TOOLS) if (!exact.includes(t)) exact.push(t);
      json.exact = exact;
      writeJsonSafe(c._file, json);
      done.push(`已把 ${TOOLS.length} 个工具加进白名单`);
    }
  }
  return done;
}

export function formatReport(report) {
  const icon = { ok: '✔', warn: '!', block: '✘' };
  const lines = [`DSH 目录：${report.home}（profile: ${report.profile}）`, ''];
  for (const c of report.checks) {
    lines.push(`${icon[c.level] || '?'} ${c.title}  ${c.detail}`);
    if (c.level !== 'ok' && c.fix) lines.push(`    → ${c.fix}`);
  }
  lines.push('');
  lines.push(report.ok ? '没有硬阻断。' : '有硬阻断，先修上面的 ✘。');
  return lines.join('\n');
}
