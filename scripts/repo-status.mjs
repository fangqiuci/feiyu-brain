// 一眼看发布状态：npm 上了没、GitHub 仓库建了没、两边版本对得上不。
//
//   node scripts/repo-status.mjs

const NPM = 'feiyu-brain';
const GH = 'fangqiuci/feiyu-brain';

const j = async (url, opts) => {
  const r = await fetch(url, { headers: { 'user-agent': 'feiyu-brain-status' }, ...opts });
  let body = null;
  try { body = await r.json(); } catch {}
  return { status: r.status, body };
};

console.log('');
console.log('── npm ──────────────────────────────');
const npm = await j(`https://registry.npmjs.org/${NPM}`);
if (npm.status === 200) {
  const latest = npm.body['dist-tags']?.latest;
  const v = npm.body.versions?.[latest] ?? {};
  console.log(`  包        ${npm.body.name}`);
  console.log(`  最新      ${latest}`);
  console.log(`  全部版本  ${Object.keys(npm.body.versions ?? {}).join(', ')}`);
  console.log(`  作者      ${(npm.body.maintainers ?? []).map((m) => m.name).join(', ')}`);
  console.log(`  仓库字段  ${v.repository?.url ?? '（未设置）'}`);
  console.log(`  主页字段  ${v.homepage ?? '（未设置）'}`);
  console.log(`  页面      https://www.npmjs.com/package/${npm.body.name}`);
} else {
  console.log(`  查不到（HTTP ${npm.status}）`);
}

console.log('');
console.log('── GitHub ───────────────────────────');
const gh = await j(`https://api.github.com/repos/${GH}`);
if (gh.status === 200) {
  const d = gh.body;
  console.log(`  仓库      ${d.full_name}`);
  console.log(`  可见性    ${d.private ? '私有' : '公开'}`);
  console.log(`  默认分支  ${d.default_branch}`);
  console.log(`  大小      ${d.size} KB ${d.size === 0 ? '（还是空的）' : ''}`);
  console.log(`  页面      https://github.com/${GH}`);
} else {
  console.log(`  查不到（HTTP ${gh.status}）`);
}

console.log('');
