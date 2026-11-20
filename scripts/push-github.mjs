// 用 GitHub API 把目录一次性提交进仓库（不需要 git）。
//
//   GITHUB_TOKEN=ghp_xxx node scripts/push-github.mjs [目录]
//
// 默认推 <仓库同级>/feiyu-brain-upload/。
// 走 Git Data API：blob → tree → commit → ref，一个 commit 搞定。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = process.argv[2] ? path.resolve(process.argv[2]) : path.join(path.dirname(HERE), 'feiyu-brain-upload');

const OWNER = 'fangqiuci';
const REPO = 'feiyu-brain';
const BRANCH = 'main';
const TOKEN = process.env.GITHUB_TOKEN;

if (!TOKEN) {
  console.error('缺 GITHUB_TOKEN');
  process.exit(1);
}
if (!fs.existsSync(SRC)) {
  console.error(`找不到目录：${SRC}\n先跑 node scripts/stage-upload.mjs`);
  process.exit(1);
}

const API = 'https://api.github.com';
const H = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'feiyu-brain-push',
  'Content-Type': 'application/json',
};

async function api(method, url, body) {
  const res = await fetch(`${API}${url}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data?.message ?? text.slice(0, 200);
    throw new Error(`${method} ${url} → ${res.status} ${msg}`);
  }
  return data;
}

function walk(dir, base = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), rel));
    else out.push(rel);
  }
  return out;
}

// ── 0. 身份确认 ──────────────────────────────────────────
const me = await api('GET', '/user');
console.log(`账号   ${me.login}`);

const repo = await api('GET', `/repos/${OWNER}/${REPO}`);
console.log(`仓库   ${repo.full_name}（${repo.private ? '私有' : '公开'}）`);
console.log(`分支   ${repo.default_branch}`);
console.log('');

// ── 1. 空仓库要先建一个 commit ───────────────────────────
// GitHub 对「完全空的仓库」拒绝 git/blobs（409 Git Repository is empty），
// 所以先用 Contents API 塞一个引导文件把 main 建出来。
let baseCommit = null;
try {
  const ref = await api('GET', `/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
  baseCommit = ref.object.sha;
  console.log(`基础   已有 ${BRANCH}（${baseCommit.slice(0, 7)}）`);
} catch {
  console.log('基础   空仓库 → 先建引导 commit');
  const boot = await api('PUT', `/repos/${OWNER}/${REPO}/contents/.bootstrap`, {
    message: 'bootstrap',
    content: Buffer.from('').toString('base64'),
    branch: BRANCH,
  });
  baseCommit = boot.commit.sha;
  console.log(`      引导 commit ${baseCommit.slice(0, 7)}`);
}

// ── 2. 攒文件 ────────────────────────────────────────────
const files = walk(SRC).sort();
console.log(`待推   ${files.length} 个文件`);
let bytes = 0;

// ── 3. blob ─────────────────────────────────────────────
const tree = [];
let n = 0;
for (const rel of files) {
  const full = path.join(SRC, rel);
  const buf = fs.readFileSync(full);
  bytes += buf.length;
  const blob = await api('POST', `/repos/${OWNER}/${REPO}/git/blobs`, {
    content: buf.toString('base64'),
    encoding: 'base64',
  });
  tree.push({ path: rel, mode: '100644', type: 'blob', sha: blob.sha });
  n += 1;
  if (n % 10 === 0 || n === files.length) process.stdout.write(`  已上传 ${n}/${files.length}\n`);
}

console.log('');
console.log(`共计   ${(bytes / 1024).toFixed(1)} KB`);

// ── 4. tree ─────────────────────────────────────────────
const newTree = await api('POST', `/repos/${OWNER}/${REPO}/git/trees`, { tree });

// ── 5. commit（父提交 = 引导 commit，.bootstrap 会被这棵树挤掉）──
const commit = await api('POST', `/repos/${OWNER}/${REPO}/git/commits`, {
  message: `feiyu-brain 1.1.1\n\n大脑内核 + 手机/平板/电脑三具身体。`,
  tree: newTree.sha,
  parents: [baseCommit],
});

// ── 6. 更新 ref ─────────────────────────────────────────
await api('PATCH', `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, { sha: commit.sha, force: true });

console.log('');
console.log(`✔ 推完了`);
console.log(`  commit  ${commit.sha}`);
console.log(`  页面    https://github.com/${OWNER}/${REPO}`);
console.log('');

// ── 6. 回读验证 ─────────────────────────────────────────
const check = await api('GET', `/repos/${OWNER}/${REPO}/git/trees/${BRANCH}?recursive=1`);
const count = (check.tree ?? []).filter((x) => x.type === 'blob').length;
console.log(`回读验证：仓库里现在有 ${count} 个文件${count === files.length ? ' ✔' : ' ⚠ 数量对不上'}`);
