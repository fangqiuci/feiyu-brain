/**
 * feiyu-brain —— DSH 插件入口
 * ============================================================================
 * 同一个包有两种用法：
 *   ① 库：`import { createBrain } from 'feiyu-brain'`（下面 re-export 了全部）
 *   ② 插件：`dsh plugin add feiyu-brain` → 注册 4 个工具，模型可以直接读写这条鱼
 *
 * 工具是**读写大脑**，不是"生成对话"——对话仍然由宿主自己的模型完成。
 *
 *   feiyu_status   她现在什么状态（人设/自知/意识流/身体/记忆/不变量）
 *   feiyu_wake     取"此刻的她"，宿主把它拼进 system prompt
 *   feiyu_observe  记一次经历（权重会动、记忆会进）
 *   feiyu_tick     每日结算（衰减 / 遗忘 / 蜕皮）
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
        `记忆   经历 ${s.memory.episodes} / 印象 ${s.memory.impressions} / 幻想 ${s.memory.imagination} / 蜕皮 ${s.memory.formerSelves} / 遗忘 ${s.memory.forgotten}`,
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
      },
      required: ['text'],
      additionalProperties: false,
    },
    async execute(args) {
      const id = idOf(args);
      const who = pickStr(args?.who);
      const text = pickStr(args?.text);
      if (!text) return fail('text 不能为空');

      const r = brain.observe(id, { who, text, what: text.slice(0, 80), feel: pickStr(args?.feel), via: 'dsh' });
      const changed = r.consistent.length + r.conflicting.length;
      return {
        ok: true,
        text: [
          `记下了：${who ? `${who}「${text}」` : `「${text}」`}`,
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

  /* ── 配置检查（不注册工具，只打一行日志）───────────── */
  try {
    const s = brain.snapshot(conf.brainId);
    ctx.logger?.info?.(`[feiyu-brain] ${s.id} · ${s.roleCard} · ${s.weights.count} 条命题 · ${s.styleName}`);
  } catch {
    ctx.logger?.warn?.('[feiyu-brain] 还没有角色卡，工具会提示你配置（见 docs/MIGRATION.md）');
  }
}

export { BODY_KINDS };
