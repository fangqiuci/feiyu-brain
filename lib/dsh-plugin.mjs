/**
 * feiyu-brain —— DSH 插件入口
 * ============================================================================
 * 同一个包有两种用法：
 *   ① 库：`import { createBrain } from 'feiyu-brain'`（下面 re-export 了全部）
 *   ② 插件：`dsh plugin add feiyu-brain` → 注册 6 个工具，模型可以直接读写这条鱼
 *
 * 工具是**读写大脑**，不是"生成对话"——对话仍然由宿主自己的模型完成。
 *
 *   feiyu_status   她现在什么状态（人设/自知/意识流/身体/记忆/不变量）
 *   feiyu_wake     取"此刻的她"，宿主把它拼进 system prompt
 *   feiyu_observe  记一次经历（权重会动、记忆会进）
 *   feiyu_tick     每日结算（衰减 / 遗忘 / 蜕皮）
 *   feiyu_feel     对一件事产生感受（PAD → 找词）
 *   feiyu_app      真的开 App / 截屏 / 卸载（adb 或 PowerShell，留证据）
 *
 * 设计约束：
 *   - `@deepseek-ai/dsh-tools` 是 optional peer，桌面版可能没有 ⇒ 取不到就降级，
 *     用 identity 透传，**不能让整条插件不激活**。
 *   - 工具返回值必须是无损 JSON（宿主会对函数/循环引用报错）。
 *   - 找不到角色卡时不是抛异常，而是返回一句话说明怎么配。
 * ============================================================================
 */
import { loadHostPackage } from './hostdeps.mjs';
import * as brain from '../index.js';
import { BODY_KINDS } from '../core/body.js';

export * from '../index.js';

export const name = 'feiyu-brain';
// 只声明 tools：没有 webServer 也要能装
export const inject = ['tools'];

let defineTool = null;
try {
  const dshTools = await loadHostPackage('dsh-tools');
  if (typeof dshTools?.defineTool === 'function') defineTool = dshTools.defineTool;
} catch { /* 降级 */ }
if (typeof defineTool !== 'function') defineTool = (options) => options;

/** 宿主只吃无损 JSON */
const safe = (v) => {
  if (v === undefined || v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  try { return JSON.parse(JSON.stringify(v)); } catch { return String(v); }
};

const textOutput = {
  schema: { type: 'object', properties: {}, additionalProperties: true },
  render: (_args, value) => {
    const text = value && typeof value === 'object' && typeof value.text === 'string'
      ? value.text
      : JSON.stringify(value, null, 2);
    return [{ type: 'text', text }];
  },
};

const pickStr = (v, fallback = '') => (typeof v === 'string' && v.trim() ? v.trim() : fallback);

function fail(text, code = 'E_BRAIN') {
  return { ok: false, code, text: `❌ ${text}` };
}

/** 大脑抛错时，翻成人能照着做的话 */
function explain(error) {
  const msg = String(error?.message ?? error);
  if (/找不到角色卡/.test(msg)) {
    return `${msg}

怎么配（二选一）：
  · 把角色卡放到 <dataDir>/../roles/<名字>.md，并在插件设置里填 roleDir
  · 或者把 current-role.json 放进 dataDir：{"role":"辞辞"}

这块的规则见 docs/MIGRATION.md。`;
  }
  return msg;
}

const fmtPct = (n) => `${(Number(n) * 100).toFixed(1)}%`;

export function apply(ctx, entryConfig = {}) {
  const conf = {
    brainId: pickStr(entryConfig?.brainId, 'default'),
    dataDir: pickStr(entryConfig?.dataDir, process.env.FEIYU_DATA_DIR || ''),
    roleDir: pickStr(entryConfig?.roleDir, process.env.FEIYU_ROLE_DIR || ''),
  };

  if (conf.dataDir || conf.roleDir) {
    brain.configure({
      dataDir: conf.dataDir || undefined,
      roleDir: conf.roleDir || undefined,
    });
  }

  if (!ctx?.tools?.register) {
    return;
  }

  const tool = (spec) => ctx.tools.register(defineTool({
    ...spec,
    output: spec.output || textOutput,
    async execute(args = {}) {
      try {
        return safe(await spec.execute(args));
      } catch (e) {
        return safe(fail(`工具执行出错：${explain(e)}`, 'E_THROWN'));
      }
    },
  }));

  const idOf = (args) => pickStr(args?.id, conf.brainId);

  /* ── 1. 状态 ─────────────────────────────────────────── */
  tool({
    name: 'feiyu_status',
    description:
      '看这条鱼现在的状态：人设卡、自知风格（四种方向的份量）、意识流档位、身体（手机/平板/电脑）、'
      + '命题数量、记忆计数、以及十二条不变量的自检结果。不修改任何东西。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '鱼的 id，默认 default' },
      },
      additionalProperties: false,
    },
    async execute(args) {
      const id = idOf(args);
      const s = brain.snapshot(id);
      const style = Object.entries(s.style)
        .map(([k, v]) => `${k} ${fmtPct(v)}`)
        .join(' / ');

      const lines = [
        `🐟 ${s.id} · 人设卡 ${s.roleCard}`,
        `自知   ${s.styleName}（${style}）`,
        `意识流 ${s.flow.name}（${s.flow.level}）`,
        `身体   ${s.body ? `${s.body.label}（${s.body.screen}，${s.body.posture}，${s.body.ownership}）` : '无'}`,
        `命题   ${s.weights.count} 条（身份 ${s.weights.identity} 条，总权重 ${s.weights.totalWeight}）`,
        `记忆   经历 ${s.memory.episodes} / 印象 ${s.memory.impressions} / 卡片 ${s.memory.cards} / 蜕皮 ${s.memory.formerSelves} / 遗忘 ${s.memory.forgotten}`,
        `平台   ${Object.keys(s.apps ?? {}).length ? Object.entries(s.apps).map(([k, v]) => `${k} ${v.seen}条`).join(' · ') : '还没在任何平台上有记录'}`,
        `情绪   ${s.emotion.stage === 1 ? '只会说"说不清"' : `会 ${s.emotion.words.length} 个词`}`,
        `观察   ${s.observations} 次`,
        '',
        '权重最高的五条：',
        ...s.weights.top.map((u) => `  ${u.id}  ${u.weight}  ${u.text}`),
        '',
        s.invariants.length ? `不变量违规 ${s.invariants.length} 条：\n${s.invariants.map((v) => `  ✘ ${v.id}: ${v.msg}`).join('\n')}` : '不变量：全部通过 ✔',
      ];
      return { ok: true, text: lines.join('\n'), snapshot: s };
    },
  });

  /* ── 2. 唤醒段 ───────────────────────────────────────── */
  tool({
    name: 'feiyu_wake',
    description:
      '取"此刻的她"——一段可直接拼进 system prompt 的定长文本（人设 brief + 手上的东西 + 想到的事）。'
      + '不记录经历。触发者为谁、说了什么，传 sender / text 能让检索更准。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '鱼的 id，默认 default' },
        sender: { type: 'string', description: '当前说话的人，用于检索对他的记忆' },
        text: { type: 'string', description: '他说的话，用于关键词检索' },
      },
      additionalProperties: false,
    },
    async execute(args) {
      const id = idOf(args);
      const text = brain.wakeLine(id, {
        sender: pickStr(args?.sender),
        text: pickStr(args?.text),
      });
      if (!text.trim()) return fail('大脑没有产出内容，先跑 feiyu_status 看看');
      return { ok: true, text, chars: text.length };
    },
  });

  /* ── 3. 记一次经历 ───────────────────────────────────── */
  tool({
    name: 'feiyu_observe',
    description:
      '让她"经历"一件事：相关的命题权重 ±0.01，记忆里进一条 episode，印象里的互动次数 +1。'
      + '这是她长大的唯一途径——不调用，人设就永远不变。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '鱼的 id，默认 default' },
        who: { type: 'string', description: '和谁发生了这件事' },
        text: { type: 'string', description: '发生了什么（她听到/看到的那句话）' },
        feel: { type: 'string', description: '她当时的感受，可留空' },
        app: { type: 'string', description: '如果是某个平台上的事：douyin / bilibili / wechat / qq' },
        kind: { type: 'string', description: '内容类型，例如 解压 / 搞笑 / 做饭，用来累计口味' },
        reaction: { type: 'number', description: '她的反应，-1 到 1，正数表示喜欢' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    async execute(args) {
      const id = idOf(args);
      const who = pickStr(args?.who);
      const text = pickStr(args?.text);
      if (!text) return fail('text 不能为空');

      const app = pickStr(args?.app);
      const r = brain.observe(id, {
        who,
        text,
        what: text.slice(0, 80),
        feel: pickStr(args?.feel),
        via: app ? `app:${app}` : 'dsh',
        ...(app ? { app, kind: pickStr(args?.kind), reaction: Number(args?.reaction ?? 0) } : {}),
      });

      const changed = r.consistent.length + r.conflicting.length;
      return {
        ok: true,
        text: [
          `记下了：${who ? `${who}「${text}」` : `「${text}」`}`,
          app ? `平台   ${app}${pickStr(args?.kind) ? ` / ${pickStr(args?.kind)}` : ''}` : '',
          `权重   一致 ${r.consistent.length} 条 / 冲突 ${r.conflicting.length} 条${changed ? '' : '（没匹配到命题，人设不动）'}`,
          r.label ? `归因   ${r.label}` : '',
        ].filter(Boolean).join('\n'),
        matched: changed,
      };
    },
  });

  /* ── 4. 每日结算 ─────────────────────────────────────── */
  tool({
    name: 'feiyu_tick',
    description:
      '跑一次每日结算：命题衰减、记忆 TTL 到期遗忘、权重到底的蜕皮成"我以前……"。幂等，一天跑多次也只结算一次。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '鱼的 id，默认 default' },
      },
      additionalProperties: false,
    },
    async execute(args) {
      const id = idOf(args);
      const before = brain.snapshot(id);
      const b = brain.settleBrain(id);
      const after = brain.snapshot(id);
      const shed = after.memory.formerSelves - before.memory.formerSelves;
      const forgot = after.memory.forgotten - before.memory.forgotten;
      return {
        ok: true,
        text: [
          '结算完成。',
          `蜕皮   ${shed > 0 ? `+${shed} 条沉进"我以前……"` : '0'}`,
          `遗忘   ${forgot > 0 ? `+${forgot} 条（真的没有了）` : '0'}`,
          `命题   ${after.weights.count} 条，总权重 ${after.weights.totalWeight}`,
        ].join('\n'),
        shed,
        forgot,
      };
    },
  });

  /* ── 5. 情绪 ─────────────────────────────────────────── */
  tool({
    name: 'feiyu_feel',
    description:
      '让她对一件事产生感受：先算 PAD 三维（愉悦/唤醒/掌控），再找词。'
      + '同一件事，有劲的鱼偏向生气，累了的鱼偏向委屈——由人设和当前状态算出来，不查表。'
      + '词表空的时候只会说「我不知道，就是很不舒服」，这是正常的。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '鱼的 id，默认 default' },
        valence: { type: 'number', description: '这件事对她好不好，-1 到 1' },
        intensity: { type: 'number', description: '强度，0 到 1' },
        what: { type: 'string', description: '发生了什么' },
      },
      required: ['valence'],
      additionalProperties: false,
    },
    async execute(args) {
      const id = idOf(args);
      const v = Math.max(-1, Math.min(1, Number(args?.valence ?? 0)));
      const i = Math.max(0, Math.min(1, Number(args?.intensity ?? 0.5)));
      const r = brain.feel(id, { valence: v, intensity: i, what: pickStr(args?.what) });
      return {
        ok: true,
        text: `${r.text}\n（PAD ${r.pad.map((x) => x.toFixed(2)).join(' / ')}，阶段 ${r.stage}，会 ${r.knownWords} 个词）`,
        pad: r.pad,
        stage: r.stage,
        label: r.label,
      };
    },
  });

  /* ── 6. 身体动作 ─────────────────────────────────────── */
  tool({
    name: 'feiyu_app',
    description:
      '让她真的动起来：开 App、截屏、卸载（卸载要过临界点 + 三问）。'
      + '走真实设备——手机/平板用 adb，电脑用 PowerShell。没有设备返回 E_NO_DEVICE。'
      + '每个动作都留证据；没有证据的动作不算发生。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '鱼的 id，默认 default' },
        action: { type: 'string', description: 'open / screenshot / uninstall' },
        package: { type: 'string', description: 'Android 包名，例如 com.ss.android.ugc.aweme' },
        target: { type: 'string', description: '电脑上要启动的程序' },
        why: { type: 'string', description: '卸载 Q1：为什么想删' },
        consequence: { type: 'string', description: '卸载 Q3：删了会怎样' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    async execute(args) {
      const id = idOf(args);
      const action = pickStr(args?.action).toLowerCase();

      if (action === 'uninstall') {
        const r = await brain.requestUninstall(id, pickStr(args?.package), {
          why: pickStr(args?.why),
          fits: true,
          consequence: pickStr(args?.consequence),
        });
        if (r.ok === false) return { ok: false, code: r.code, text: `❌ ${r.reason ?? r.code}` };
        return { ok: true, text: `已卸载 ${args.package}\n证据：${r.evidence}` };
      }

      const map = {
        open: { type: 'open_app', package: pickStr(args?.package), target: pickStr(args?.target), capability: 2 },
        screenshot: { type: 'screenshot', capability: 1 },
      };
      const act = map[action];
      if (!act) return { ok: false, code: 'E_ARGS', text: '❌ action 只能是 open / screenshot / uninstall' };

      const r = await brain.execAction(id, act);
      if (r.ok === false) return { ok: false, code: r.code, text: `❌ ${r.reason ?? r.code}` };
      return { ok: true, text: `✔ 做完了（${action}）\n证据：${r.evidence ?? '（无）'}` };
    },
  });

  /* ── 配置检查（不注册工具，只打一行日志）───────────── */
  try {
    const s = brain.snapshot(conf.brainId);
    ctx.logger?.info?.(`[feiyu-brain] ${s.id} · ${s.roleCard} · ${s.weights.count} 条命题 · ${s.styleName}`);
  } catch {
    ctx.logger?.warn?.('[feiyu-brain] 还没有角色卡，工具会提示你配置（见 docs/MIGRATION.md）');
  }
}

export { BODY_KINDS };
