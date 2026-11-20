// 给仓库打 topic（市场收录硬性要求 `dsh-plugin`）。
//
//   GITHUB_TOKEN=ghp_xxx node scripts/set-topics.mjs
//
// 会保留已有 topic，只补上缺的。

const OWNER = 'fangqiuci';
const REPO = 'feiyu-brain';
const WANT = ['dsh-plugin', 'deepseek-harness', 'persona', 'memory', 'qq-bot'];
const TOKEN = process.env.GITHUB_TOKEN;

if (!TOKEN) {
  console.error('缺 GITHUB_TOKEN');
  process.exit(1);
}

const API = 'https://api.github.com';
const H = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'feiyu-brain-topics',
  'Content-Type': 'application/json',
};

const cur = await fetch(`${API}/repos/${OWNER}/${REPO}/topics`, { headers: H });
if (!cur.ok) {
  console.error(`读 topic 失败：${cur.status} ${await cur.text()}`);
  process.exit(1);
}
const before = (await cur.json()).names ?? [];
const names = [...new Set([...before, ...WANT])].slice(0, 20);

const res = await fetch(`${API}/repos/${OWNER}/${REPO}/topics`, {
  method: 'PUT',
  headers: H,
  body: JSON.stringify({ names }),
});
const text = await res.text();
if (!res.ok) {
  console.error(`写 topic 失败：${res.status} ${text.slice(0, 300)}`);
  process.exit(1);
}
const after = (JSON.parse(text).names ?? []);
console.log(`topic  ${before.length ? before.join(', ') : '（空）'} → ${after.join(', ')}`);
console.log(after.includes('dsh-plugin') ? '✔ dsh-plugin 已打上' : '✘ dsh-plugin 没打上');
