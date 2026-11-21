// HTTP 边车：让任何语言都能用这颗脑。
//
// AstrBot 是 Python，脑是 Node。以前只能每条消息 spawn 一个 node（100~300ms 冷启动），
// 现在起一个常驻进程，Python 侧三行就接上了：
//
//   r = requests.post('http://127.0.0.1:7788/wake',
//                     json={'id':'default','sender':who,'text':msg})
//
// 零依赖，只用 node:http。默认只绑 127.0.0.1。
//
// 安全：
//   · 默认只监听本机回环，外网连不上
//   · 设了 token 就必须带 x-feiyu-token 头
//   · 没设 token 时，只允许本机来源（remoteAddress 是回环）

import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function readBody(req, { limit = 1_000_000 } = {}) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error(`JSON 解析失败：${e.message}`)); }
    });
    req.on('error', reject);
  });
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

const isLocal = (req) => {
  const ip = req.socket.remoteAddress ?? '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
};

/**
 * 造一个边车（不启动）。
 *
 * @param {object} brain  index.js 的命名空间
 * @param {object} opts
 * @param {string} [opts.token]   设了就要求 x-feiyu-token
 * @param {string} [opts.id]      默认鱼 id
 */
export function createServer(brain, { token = '', id = 'default' } = {}) {
  const routes = {
    'GET /health': async () => ({ ok: true, name: 'feiyu-brain', id }),
    'GET /status': async (q) => brain.snapshot(q.id ?? id),
    'GET /version': async () => {
      const pkg = require('../package.json');
      return { version: pkg.version, name: pkg.name };
    },

    'POST /wake': async (_q, body) => {
      const text = brain.wakeLine(body.id ?? id, {
        sender: body.sender ?? '',
        text: body.text ?? '',
      }, {
        ...(Array.isArray(body.sections) ? { sections: body.sections } : {}),
        ...(Number.isFinite(Number(body.budget)) ? { budget: Number(body.budget) } : {}),
      });
      return { ok: true, text, chars: text.length };
    },

    'POST /observe': async (_q, body) => {
      if (!body.text) return { ok: false, code: 'E_ARGS', text: 'text 不能为空' };
      const app = body.app ?? '';
      const r = brain.observe(body.id ?? id, {
        who: body.who ?? '',
        text: String(body.text),
        what: String(body.text).slice(0, 80),
        feel: body.feel ?? '',
        via: app ? `app:${app}` : 'http',
        ...(app ? { app, kind: body.kind ?? '', reaction: Number(body.reaction) || 0 } : {}),
        ...(Number.isFinite(Number(body.valence)) ? { valence: Number(body.valence), intensity: Number(body.intensity) || 0.5 } : {}),
      }, { evolve: body.evolve !== false });
      return {
        ok: true,
        consistent: r.consistent?.length ?? 0,
        conflicting: r.conflicting?.length ?? 0,
        evolved: r.evolved,
        shadow: r.shadow === true,
      };
    },

    'POST /feel': async (_q, body) => brain.feel(body.id ?? id, {
      valence: Number(body.valence) || 0,
      intensity: Number.isFinite(Number(body.intensity)) ? Number(body.intensity) : 0.5,
      what: body.what ?? '',
    }),

    'POST /diary': async (_q, body) => {
      const action = String(body.action ?? 'digest').toLowerCase();
      if (action === 'write') return brain.writeDiary(body.id ?? id, { date: body.date ?? '', text: body.text ?? '' });
      if (action === 'read') return brain.readDiary(body.id ?? id, body.date ?? '') ?? { ok: false, code: 'E_NO_DIARY' };
      if (action === 'list') return { ok: true, days: brain.listDiary(body.id ?? id) };
      return { ok: true, digest: brain.diaryDigest(body.id ?? id, body.date ?? '') };
    },

    'POST /migrate': async (_q, body) => {
      if (Array.isArray(body.sources)) return brain.migrateAll(body.id ?? id, body.sources, { dryRun: body.dryRun === true });
      return brain.migrateMemory(body.id ?? id, {
        text: body.text ?? '', format: body.format ?? 'jsonl', dryRun: body.dryRun === true,
      });
    },

    'POST /snapshot': async (_q, body) => {
      const action = String(body.action ?? 'save').toLowerCase();
      const bid = body.id ?? id;
      if (action === 'list') return { ok: true, snapshots: brain.listSnapshots(bid) };
      if (action === 'restore') return brain.restoreBrain(bid, body.name ?? '');
      return brain.snapshotBrain(bid, body.name ?? '');
    },

    'GET /identity': async (q) => brain.identityCheck(q.id ?? id),
    'GET /verify': async (q) => brain.verifyMemory(q.id ?? id),
  };

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const key = `${req.method} ${url.pathname}`;

      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type,x-feiyu-token' });
        return res.end();
      }

      // 认证
      if (token) {
        if (req.headers['x-feiyu-token'] !== token) return json(res, 401, { ok: false, code: 'E_AUTH', text: '缺 token 或不对' });
      } else if (!isLocal(req)) {
        return json(res, 403, { ok: false, code: 'E_NOT_LOCAL', text: '没设 token 时只允许本机访问' });
      }

      const handler = routes[key];
      if (!handler) {
        return json(res, 404, {
          ok: false, code: 'E_NO_ROUTE', text: `${key} 没有`, routes: Object.keys(routes),
        });
      }

      const body = req.method === 'POST' ? await readBody(req) : {};
      const q = Object.fromEntries(url.searchParams.entries());
      const out = await handler(q, body);
      return json(res, 200, out);
    } catch (e) {
      return json(res, 500, { ok: false, code: 'E_SERVER', text: String(e?.message ?? e) });
    }
  });
}

/**
 * 起一个边车，返回 { url, close }。
 * 端口传 0 会随机分配（测试用）。
 */
export function serve(brain, { port = 7788, host = '127.0.0.1', token = '', id = 'default' } = {}) {
  const server = createServer(brain, { token, id });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const addr = server.address();
      resolve({
        server,
        url: `http://${host}:${addr.port}`,
        port: addr.port,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}
