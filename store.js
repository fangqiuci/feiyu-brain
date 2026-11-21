// 落盘：<dataDir>/brains/<id>/ 下的一组 JSON。
//
// 发布成包之后，路径不能写死到仓库里——宿主可能是任意目录。
// 优先级：setDataDir() > 环境变量 FEIYU_DATA_DIR > 用户目录（装进 node_modules 时）> 仓库 state/

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 包所在仓库根（老用法：桥接同目录）。发布后可能指向 node_modules，只作兜底。 */
export const ROOT = path.resolve(HERE, '..', '..');

/**
 * 装进 node_modules 时，ROOT 会指到 node_modules 里面——
 * 数据写进去等于：升级/重装就丢，而且常常是只读。
 * 这时改用用户目录。仓库内开发（不在 node_modules 里）保持原行为。
 */
const IN_NODE_MODULES = /[\\/]node_modules[\\/]/.test(ROOT);
const USER_FALLBACK = path.join(os.homedir(), '.feiyu-brain');

function defaultDataRoot() {
  return IN_NODE_MODULES ? path.join(USER_FALLBACK, 'state') : path.join(ROOT, 'state');
}

function defaultRoleRoot() {
  return IN_NODE_MODULES ? path.join(USER_FALLBACK, 'roles') : path.join(ROOT, 'roles');
}

let dataRoot = process.env.FEIYU_DATA_DIR
  ? path.resolve(process.env.FEIYU_DATA_DIR)
  : defaultDataRoot();

let roleRoot = process.env.FEIYU_ROLE_DIR
  ? path.resolve(process.env.FEIYU_ROLE_DIR)
  : defaultRoleRoot();

/** 宿主指定数据目录（推荐显式设置，别依赖包位置）。 */
export function setDataDir(dir) {
  dataRoot = path.resolve(dir);
}

export function dataDir() {
  return dataRoot;
}

/** 数据目录是从哪来的：env / explicit / default */
export function dataDirSource() {
  if (process.env.FEIYU_DATA_DIR) return 'env:FEIYU_DATA_DIR';
  return IN_NODE_MODULES ? 'default:user-home' : 'default:repo';
}

/** 装进 node_modules 且在写包里——这是要报警的情况 */
export function isDataDirInsidePackage() {
  return IN_NODE_MODULES && dataRoot.startsWith(ROOT + path.sep);
}

/** 宿主指定角色卡目录（roles/<名字>.md）。 */
export function setRoleDir(dir) {
  roleRoot = path.resolve(dir);
}

export function roleDir() {
  return roleRoot;
}

export function brainsDir() {
  return path.join(dataRoot, 'brains');
}

/** 兼容老代码：以前是常量，现在是函数。 */
export const STATE_DIR = dataRoot;
export const BRAINS_DIR = brainsDir();

export function brainDir(id) {
  return path.join(brainsDir(), id);
}

export function brainFile(id) {
  return path.join(brainDir(id), 'brain.json');
}

export function auditFile(id) {
  return path.join(brainDir(id), 'audit.jsonl');
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function readJson(file, fallback = null) {
  try {
    if (!fs.existsSync(file)) return fallback;
    // Windows 记事本默认写 BOM，JSON.parse 会直接炸——先剥掉
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

/* ── 按年分片存 ───────────────────────────────────────────────
 *
 * brain.json 只放"她是谁"（人设/情绪/关系/卡片…），**不放经历**。
 * 经历按年落进 brains/<id>/years/2026.jsonl。
 *
 * 为什么：一条活 16 年的鱼会有 1.7 万条经历，全塞一个 json 里
 * 打开一次要解析几百 KB，越活越慢。分片 + 按窗口懒加载才是长期解。
 */

const DAY = 24 * 60 * 60 * 1000;
let episodeWindowDays = 730; // 打开时加载最近多少天的经历

export function setEpisodeWindow(days) {
  const n = Number(days);
  if (Number.isFinite(n) && n > 0) episodeWindowDays = Math.floor(n);
}

export function episodeWindow() {
  return episodeWindowDays;
}

export function yearsDir(id) {
  return path.join(brainDir(id), 'years');
}

export function yearFile(id, year) {
  return path.join(yearsDir(id), `${year}.jsonl`);
}

function yearOf(ms) {
  return new Date(Number(ms) || Date.now()).getFullYear();
}

/** 把一个年份的经历写成 jsonl（整年重写：一年最多一千多条，可接受） */
function writeYearShard(id, year, list) {
  ensureDir(yearsDir(id));
  const file = yearFile(id, year);
  if (!list.length) {
    try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch { /* 删不掉也无所谓 */ }
    return null;
  }
  const body = `${list.map((e) => JSON.stringify(e)).join('\n')}\n`;
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, body, 'utf8');
  fs.renameSync(tmp, file);
  const ats = list.map((e) => Number(e.at) || 0).filter(Boolean);
  return {
    count: list.length,
    from: ats.length ? Math.min(...ats) : 0,
    to: ats.length ? Math.max(...ats) : 0,
  };
}

function readYearShard(id, year) {
  const file = yearFile(id, year);
  if (!fs.existsSync(file)) return [];
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s)); } catch { /* 坏行跳过，不整年报废 */ }
  }
  return out;
}
export function writeJsonAtomic(file, data) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}

export function appendAudit(id, entry) {
  ensureDir(brainDir(id));
  fs.appendFileSync(auditFile(id), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, 'utf8');
}

export function readAudit(id, limit = 20) {
  const file = auditFile(id);
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
  return lines.slice(-limit).map((l) => {
    try { return JSON.parse(l); } catch { return { raw: l }; }
  });
}

export function listBrains() {
  try {
    return fs.readdirSync(brainsDir()).filter((n) => fs.existsSync(brainFile(n)));
  } catch {
    return [];
  }
}

export function loadBrain(id) {
  const file = brainFile(id);
  let main = readJson(file, null);
  if (!main) {
    // 主文件坏了就退到备份——单文件损坏不该等于丢档
    const bak = readJson(`${file}.bak`, null);
    if (bak) {
      main = bak;
      try { writeJsonAtomic(file, bak); } catch { /* 修不回来也不影响这次读 */ }
    }
  }
  if (!main) return null;

  // ── 把窗口内的年份读回内存（更早的留在磁盘上，不加载）──
  main.memory = main.memory ?? {};
  const shards = main.memory.shards ?? {};
  const cutoff = Date.now() - episodeWindowDays * DAY;
  const eps = [];
  for (const [y, meta] of Object.entries(shards)) {
    const to = Number(meta?.to) || 0;
    if (to && to < cutoff) continue;              // 太老的年份：不加载
    eps.push(...readYearShard(id, Number(y)));
  }
  // 防御：万一旧版本留下的 brain.json 里还有 episodes，也并进来
  if (Array.isArray(main.memory.episodes) && main.memory.episodes.length) {
    eps.push(...main.memory.episodes);
  }
  main.memory.episodes = eps.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  return main;
}

/** 显式读某一年（翻旧账用） */
export function readYear(id, year) {
  return readYearShard(id, Number(year));
}

/** 她有哪些年份的经历 */
export function listYears(id) {
  const main = readJson(brainFile(id), null);
  return Object.entries(main?.memory?.shards ?? {})
    .map(([year, meta]) => ({ year: Number(year), ...meta }))
    .sort((a, b) => a.year - b.year);
}

export function saveBrain(brain) {
  const file = brainFile(brain.id);
  try {
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
  } catch { /* 备份失败不影响写入 */ }

  // ── 经历按年分片，不进 brain.json ──
  const eps = Array.isArray(brain.memory?.episodes) ? brain.memory.episodes : [];
  const byYear = new Map();
  for (const e of eps) {
    const y = yearOf(e.at);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(e);
  }

  const shards = {};
  for (const [y, list] of byYear) {
    const meta = writeYearShard(brain.id, y, list);
    if (meta) shards[y] = meta;
  }
  // 这一年被清空了（忘光了/搬家后没剩）→ 把文件删掉
  try {
    const dir = yearsDir(brain.id);
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir)) {
        const y = Number(f.replace(/\.jsonl$/, ''));
        if (Number.isFinite(y) && !shards[y]) {
          try { fs.unlinkSync(path.join(dir, f)); } catch { /* 忽略 */ }
        }
      }
    }
  } catch { /* 读不到目录就算了 */ }

  const out = {
    ...brain,
    memory: { ...(brain.memory ?? {}), shards },
  };
  delete out.memory.episodes;         // 经历在 years/*.jsonl
  delete out.memory.shards?.episodes; // 防御

  writeJsonAtomic(file, out);
  brain.memory = brain.memory ?? {};
  brain.memory.shards = shards;       // 内存对象保持一致
  return brain;
}
