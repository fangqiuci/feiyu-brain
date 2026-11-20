// 交互式发布向导：双击 publish.bat 就跑到这里。
//
// 为什么不在 .bat 里写中文：cmd 默认按 GBK 读批处理文件，
// UTF-8 的中文会被拆成乱码甚至会打断 if 块的解析。所以逻辑全放 Node。

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(fs.readFileSync(path.join(HERE, 'package.json'), 'utf8'));

const line = (s = '') => console.log(s);

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      try { rl.close(); } catch {}
      resolve(v);
    };
    rl.question(question, (answer) => finish(String(answer ?? '').trim()));
    // stdin 被关掉（管道 / Ctrl+Z）也要结束，否则顶层 await 永远挂着
    rl.on('close', () => finish(''));
  });
}

function run(script) {
  const res = spawnSync(process.execPath, [path.join(HERE, 'scripts', script)], {
    stdio: 'inherit',
    cwd: HERE,
    env: process.env,
  });
  return res.status ?? 1;
}

line('');
line('════════════════════════════════════════');
line(`  ${pkg.name}  一键发布`);
line('════════════════════════════════════════');
line('');
line('还没有 token？先去这里建一个：');
line('  https://www.npmjs.com/settings/~/tokens');
line('  类型选 Automation（会自动跳过 2FA，最省事）');
line('  复制下来——关掉页面就再也看不到了');
line('');

line('[1/3] 打包…');
line('');
const code1 = run('release.mjs');
if (code1 !== 0) {
  line('');
  line('✘ 打包失败，先别发。把上面的报错贴出来。');
  process.exit(1);
}

line('');
const token = await ask('把 token 粘这里（回车直接退出）：');
if (!token) {
  line('');
  line('已取消，什么都没发出去。');
  process.exit(0);
}

if (!token.startsWith('npm_')) {
  line('');
  line(`⚠️  这个看起来不像 npm token（应该是 npm_ 开头，现在是 ${token.slice(0, 8)}…）`);
  const go = await ask('还是要继续吗？(y/N) ');
  if (go.toLowerCase() !== 'y') {
    line('已取消。');
    process.exit(0);
  }
}

line('');
line('[2/3] 发布到 npm…');
line('');

process.env.NPM_TOKEN = token;
const code2 = run('publish-npm.mjs');
delete process.env.NPM_TOKEN;

line('');
line('[3/3]');
if (code2 === 0) {
  line('✔ 成了。');
  line('');
  line(`  包页面   https://www.npmjs.com/package/${pkg.name}`);
  line(`  别人装   npm i ${pkg.name}`);
  line('');
  line('  下一步（可选）：');
  line('    1. 传到 GitHub，代码给人看');
  line('    2. 提 DSH 市场 PR（模板在 market/）');
  line('    详见 docs/HOW-TO-PUBLISH.md');
} else {
  line(`✘ 失败，退出码 ${code2}。对照 docs/HOW-TO-PUBLISH.md 第 6 步的错误表：`);
  line('    401 → token 不对      403 → 邮箱没验证 / 权限不够 / 没开 2FA');
  line('    409 → 版本号已存在     把 package.json 的 version 改大一点');
}
line('');
