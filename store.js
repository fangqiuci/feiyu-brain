// 落盘：<dataDir>/brains/<id>/ 下的一组 JSON。
//
// 发布成包之后，路径不能写死到仓库里——宿主可能是任意目录。
// 优先级：setDataDir() > 环境变量 FEIYU_DATA_DIR > 包所在仓库的 state/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 包所在仓库根（老用法：桥接同目录）。发布后可能指向 node_modules，只作兜底。 */
export const ROOT = path.resolve(HERE, '..', '..');

let dataRoot = process.env.FEIYU_DATA_DIR
  ? path.resolve(process.env.FEIYU_DATA_DIR)
  : path.join(ROOT, 'state');

let roleRoot = process.env.FEIYU_ROLE_DIR
  ? path.resolve(process.env.FEIYU_ROLE_DIR)
  : path.join(ROOT, 'roles');

/** 宿主指定数据目录（推荐显式设置，别依赖包位置）。 */
export function setDataDir(dir) {
  dataRoot = path.resolve(dir);
}

export function dataDir() {
  return dataRoot;
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
    return JSON.parse(fs.readFileSync(file, 'utf8'));
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
  return readJson(brainFile(id), null);
}

export function saveBrain(brain) {
  writeJsonAtomic(brainFile(brain.id), brain);
  return brain;
}
