/**
 * lib/hostdeps.mjs —— 从**宿主那棵树**里取 `@deepseek-ai/*`（取不到就降级）
 *
 * 为什么不能直接 `import '@deepseek-ai/dsh-tools'`：
 *   插件是以 `link:` 装进 profile 的，Node 默认按真实路径解析 ⇒ 从
 *   `~/.dsh/plugins/<插件>/lib/` 往上找 node_modules，进不到 profile 的树。
 *   裸 import 会静默失败，工具就一个都注册不上。
 *
 * 顺序：① 直接 import（自己带了依赖）→ ② 宿主 profile 树 → ③ null（降级）
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh');
}

/** 可能藏着 @deepseek-ai 的目录，按可能性排序 */
export function candidateRoots() {
  const roots = [];
  const push = (p) => { if (p && !roots.includes(p)) roots.push(p); };

  if (process.env.DSH_HOST_MODULES) push(process.env.DSH_HOST_MODULES);

  try {
    for (const profile of readdirSync(join(dshHome(), 'profiles'))) {
      push(join(dshHome(), 'profiles', profile, 'node_modules', '@deepseek-ai'));
    }
  } catch { /* 没有 profiles 就算了 */ }

  push(join(dshHome(), 'node_modules', '@deepseek-ai'));
  return roots;
}

function entryUrlFor(root, name) {
  try {
    const dir = join(root, name);
    const pkgFile = join(dir, 'package.json');
    if (!existsSync(pkgFile)) return null;
    const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
    const dot = pkg.exports?.['.'];
    const rel = typeof dot === 'string' ? dot : (dot?.import || dot?.default || pkg.module || pkg.main);
    if (!rel) return null;
    const file = join(dir, String(rel).replace(/^\.\//, ''));
    return existsSync(file) ? pathToFileURL(file).href : null;
  } catch { return null; }
}

/**
 * 取一个 @deepseek-ai 包。
 * @param {string} name 例如 'dsh-tools'
 * @returns {Promise<any|null>}
 */
export async function loadHostPackage(name) {
  try {
    return await import(`@deepseek-ai/${name}`);
  } catch { /* 继续往下找 */ }

  for (const root of candidateRoots()) {
    const url = entryUrlFor(root, name);
    if (!url) continue;
    try { return await import(url); } catch { /* 换下一个 */ }
  }

  return null;
}
