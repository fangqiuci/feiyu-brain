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

/** 原子写：先写临时文件再 rename，避免半截文件。 */
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
  const main = readJson(file, null);
  if (main) return main;
  // 主文件坏了就退到备份——评审说得对，单文件损坏不该等于丢档
  const bak = readJson(`${file}.bak`, null);
  if (bak) {
    try { writeJsonAtomic(file, bak); } catch { /* 修不回来也不影响这次读 */ }
    return bak;
  }
  return null;
}

export function saveBrain(brain) {
  const file = brainFile(brain.id);
  try {
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
  } catch { /* 备份失败不影响写入 */ }
  writeJsonAtomic(file, brain);
  return brain;
}
