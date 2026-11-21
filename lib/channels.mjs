// 通道：面对无数条鱼，不能只认一种网关。
//
// 现实里用户的 QQ 通道五花八门：
//   SnowLuma / NapCat / Lagrange / go-cqhttp / 官方机器人 / 自己的 webhook
//
// 这套东西要做三件事：
//   ① 自动发现：扫常见端口 + 读常见配置目录，找到能用的通道
//   ② 记住：写进 ~/.feiyu-brain/channels.json，下次直接用
//   ③ 排优先级：谁先试谁后试，失败自动往下掉
//
// 目标是**零配置**：装完 `feiyu mouth detect` 就能找到你的网关。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** 常见的 OneBot 实现及其默认端口/配置位置 */
export const KNOWN_IMPLS = [
  {
    id: 'snowluma',
    name: 'SnowLuma',
    ports: [3000],
    configDirs: ['~/SnowLuma/config', '~/snowluma/config', '~/.snowluma/config'],
    pattern: /^onebot_\d+\.json$/,
  },
  {
    id: 'napcat',
    name: 'NapCat',
    ports: [3000, 6099],
    configDirs: [
      '~/AppData/Roaming/napcat/config',
      '~/AppData/Local/napcat/config',
      '~/.config/napcat',
      '~/napcat/config',
    ],
    pattern: /onebot.*\.json$/i,
  },
  {
    id: 'lagrange',
    name: 'Lagrange.OneBot',
    ports: [8080, 3000],
    configDirs: ['~/.config/Lagrange', '~/Lagrange', '~/Lagrange.OneBot'],
    pattern: /appsettings.*\.json$/i,
  },
  {
    id: 'gocqhttp',
    name: 'go-cqhttp',
    ports: [5700],
    configDirs: ['~/go-cqhttp', '~/.go-cqhttp'],
    pattern: /^config\.yml$/,
  },
  {
    id: 'generic',
    name: '通用 OneBot',
    ports: [3000, 5700, 6700, 8080, 8888],
    configDirs: [],
    pattern: null,
  },
];

const HOME = os.homedir();
const expand = (p) => (p.startsWith('~') ? path.join(HOME, p.slice(1)) : p);

/** 所有要试的端口（去重保序） */
export function candidatePorts() {
  const seen = new Set();
  const out = [];
  for (const impl of KNOWN_IMPLS) {
    for (const p of impl.ports) {
      if (!seen.has(p)) { seen.add(p); out.push(p); }
    }
  }
  return out;
}

/** 从各实现的配置文件里挖 token / 端口 */
export function harvestTokens() {
  const found = [];
  for (const impl of KNOWN_IMPLS) {
    if (!impl.pattern) continue;
    for (const dirRaw of impl.configDirs) {
      const dir = expand(dirRaw);
      let names = [];
      try { names = fs.readdirSync(dir); } catch { continue; }
      for (const name of names) {
        if (!impl.pattern.test(name)) continue;
        let text = '';
        try { text = fs.readFileSync(path.join(dir, name), 'utf8'); } catch { continue; }
        const tokens = [...text.matchAll(/"accessToken"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
        const ports = [...text.matchAll(/"port"\s*:\s*(\d+)/g)].map((m) => Number(m[1]));
        for (const token of tokens) {
          found.push({ impl: impl.id, implName: impl.name, token, ports, file: path.join(dir, name) });
        }
      }
    }
  }
  return found;
}

async function probe(baseUrl, token, timeoutMs = 2500) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/get_login_info`, { headers, signal: ctrl.signal });
    if (!res.ok) return { ok: false, status: res.status };
    const json = await res.json().catch(() => ({}));
    if (json?.retcode && json.retcode !== 0) return { ok: false, status: json.retcode };
    return { ok: true, data: json?.data ?? null };
  } catch {
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 扫一遍，把能用的通道全找出来。
 * @returns {Promise<Array<{impl,implName,baseUrl,token,uin,nickname,source}>>}
 */
export async function detect({ extraTokens = [], timeoutMs = 2500 } = {}) {
  const results = [];
  const seeds = [...harvestTokens(), ...extraTokens];
  const tokenPool = [...new Set([...seeds.map((s) => s.token), '', ...(process.env.FEISHU_ONEBOT_TOKEN ? [process.env.FEISHU_ONEBOT_TOKEN] : [])])];

  for (const port of candidatePorts()) {
    const baseUrl = `http://127.0.0.1:${port}`;
    for (const token of tokenPool) {
      const r = await probe(baseUrl, token, timeoutMs);
      if (!r.ok) continue;
      const seed = seeds.find((s) => s.token === token);
      results.push({
        impl: seed?.impl ?? 'generic',
        implName: seed?.implName ?? '通用 OneBot',
        baseUrl,
        token,
        uin: r.data?.user_id ?? null,
        nickname: r.data?.nickname ?? '',
        source: seed ? `config:${seed.file}` : 'probe',
      });
      break; // 这个端口通了就不试别的 token
    }
  }
  return results;
}

/* ── 记住 ───────────────────────────────────────────────── */

function channelsDir(dataDir) {
  return dataDir || path.join(HOME, '.feiyu-brain');
}

function channelsFile(dataDir) {
  return path.join(channelsDir(dataDir), 'channels.json');
}

export function loadChannels(dataDir) {
  try {
    const j = JSON.parse(fs.readFileSync(channelsFile(dataDir), 'utf8'));
    return Array.isArray(j.channels) ? j.channels : [];
  } catch {
    return [];
  }
}

export function saveChannels(dataDir, channels) {
  fs.mkdirSync(channelsDir(dataDir), { recursive: true });
  fs.writeFileSync(channelsFile(dataDir), `${JSON.stringify({ version: 1, channels }, null, 2)}\n`, 'utf8');
  return channels.length;
}

/**
 * 拿一张能用的嘴：先用手工配的，再用发现的，最后扫一遍。
 */
export async function resolveMouth({ dataDir, prefer = '' } = {}) {
  const saved = loadChannels(dataDir).filter((c) => c && c.baseUrl);
  const ordered = prefer ? [...saved.filter((c) => c.impl === prefer), ...saved.filter((c) => c.impl !== prefer)] : saved;

  for (const c of ordered) {
    const r = await probe(c.baseUrl, c.token);
    if (r.ok) return { ...c, alive: true, source: 'saved' };
  }
  const found = await detect();
  if (!found.length) return null;
  // 发现到了就存下来，下次直接用
  saveChannels(dataDir, found.map(({ impl, implName, baseUrl, token, uin, nickname }) => ({ impl, implName, baseUrl, token, uin, nickname })));
  return { ...found[0], source: 'detected' };
}

/** 探活所有已存的通道 */
export async function statusOf(dataDir) {
  const saved = loadChannels(dataDir);
  const out = [];
  for (const c of saved) {
    const r = await probe(c.baseUrl, c.token);
    out.push({ ...c, alive: r.ok, uin: r.data?.user_id ?? c.uin, nickname: r.data?.nickname ?? c.nickname });
  }
  return out;
}
