#!/usr/bin/env node
// 大肥鱼大脑 · 运维命令行
//
//   npx feiyu status              看她现在什么状态
//   npx feiyu brief               打印"此刻的她"（唤醒时注入的那段）
//   npx feiyu observe 扶摇 "你嘴真硬"   手动记一次经历
//   npx feiyu settle              跑一次每日结算（衰减 / TTL / 蜕皮）
//   npx feiyu audit 20            最近 20 条审计
//   npx feiyu spread              派生检验：100 条鱼是不是 100 种样子
//   npx feiyu body [phone]        看身体 / 换身体
//   npx feiyu rebirth parent 老爹 重开一条鱼（会清空记忆，慎用）

import fs from 'node:fs';
import path from 'node:path';

import * as brain from './index.js';
import { brainsDir } from './store.js';
import { wakeReply, styleVector } from './core/derive.js';
import { syntheticTraits } from './core/invariants.js';
import { BODY_KINDS, BODY_PROFILES, bodyLine } from './core/body.js';

const [, , rawCmd = '', ...args] = process.argv;
const ID = process.env.FEIYU_ID || 'default';

const line = (s = '') => console.log(s);

function printStatus() {
  const s = brain.snapshot(ID);
  line(`鱼：${s.id}   人设卡：${s.roleCard}   出生：${new Date(s.born).toLocaleString('zh-CN')}`);
  line(`自知：${s.styleName}  (aware ${s.style.aware} / denial ${s.style.denial} / fixed ${s.style.fixed} / naive ${s.style.naive})`);
  line(`意识流：${s.flow.name}（${s.flow.level}）`);
  line(`命题：${s.weights.count} 条，身份 ${s.weights.identity} 条，总权重 ${s.weights.totalWeight}`);
  line(`记忆：经历 ${s.memory.episodes} / 印象 ${s.memory.impressions} / 卡片 ${s.memory.cards ?? 0} / 蜕皮 ${s.memory.formerSelves} / 遗忘 ${s.memory.forgotten}`);
  line(`观察次数：${s.observations}`);
  line(`关系：${s.relation.type}（称呼「${s.relation.address || '—'}」，可解除 ${s.relation.ctr.dissolvable ? '是' : '否'}）`);
  const apps = Object.keys(s.apps ?? {});
  line(`平台：${apps.length ? apps.map((k) => `${k} ${s.apps[k].seen}条`).join(' · ') : '还没在任何平台上有记录'}`);
  line();
  line('权重最高的五条：');
  for (const u of s.weights.top) line(`  ${u.id}  ${String(u.weight).padEnd(5)}  ${u.text}`);
  line();
  if (s.invariants.length) {
    line('不变量违规：');
    for (const v of s.invariants) line(`  ✘ ${v.id}: ${v.msg}`);
  } else {
    line('不变量：全部通过 ✔');
  }
}

/**
 * 没配角色卡时的第一体验。
 *
 * 用户装完第一件事通常就是 `npx feiyu status`，这时盘上什么都没有。
 * 直接抛栈会让人以为坏了——给一段能照着做的引导，正常退出（exit 0）。
 */
function firstRunGuide() {
  const roles = brain.roleDir();
  line('');
  line('🐟 这里还没有鱼——第一次运行要先给她一张人格卡。');
  line('');
  line('人格卡必须你自己写（这个包不代写，也不猜你想让她是什么样）。');
  line('准备两样东西：');
  line('');
  line(`  ① 卡文件    ${path.join(roles, '<名字>.md')}`);
  line('     第一行：你是……（她是谁）');
  line('     可加一行：性格：嘴硬=0.85 心软=0.7 好奇=0.8');
  line('     之后一句一条：她的性格 / 偏好 / 遇到什么事会怎么反应');
  line('');
  line(`  ② 指名      ${path.join(brain.dataDir(), 'current-role.json')}`);
  line('     内容：{"role":"<名字>"}');
  line('');
  line('  两样齐了再跑：npx feiyu status');
  line('');
  line('不想写卡、只想先看效果：');
  line("  node -e \"import('feiyu-brain').then(m=>{const f=m.createBrain({cardText:'你是鱼。\\n- 我嘴硬。',cardName:'鱼'});console.log(f.wake({sender:'A',text:'在吗'}).text)})\"");
  line('');
  line(`数据目录：${brain.dataDir()}`);
  line(`角色目录：${roles}`);
  line('');
}

function isNoCard(e) {
  return /找不到角色卡/.test(String(e?.message ?? e));
}

async function run() {
  const cmd = rawCmd || 'status';

  switch (cmd) {
    case 'status':
      printStatus();
      return;

    case 'brief': {
      const text = brain.getBrief(ID);
      line(text);
      line();
      line(`—— ${text.length} 字`);
      return;
    }

    case 'observe': {
      const who = args[0] || '';
      const text = args.slice(1).join(' ') || '';
      if (!text) {
        line('用法：npx feiyu observe <谁> "<他说了什么>"');
        line('     加平台：npx feiyu observe 扶摇 "刷到个驴蹄子" --app douyin --kind 解压 --reaction 0.9');
        return;
      }
      const pick = (flag) => {
        const i = args.indexOf(flag);
        return i >= 0 ? args[i + 1] : undefined;
      };
      const app = pick('--app');
      const kind = pick('--kind');
      const reaction = Number(pick('--reaction') ?? 0);
      const r = brain.observe(ID, {
        text,
        who,
        via: app ? `app:${app}` : 'cli',
        ...(app ? { app, kind, reaction } : {}),
      });
      line(`记下了：${who}「${text}」`);
      if (app) line(`平台：${app}${kind ? ` / ${kind}` : ''}`);
      line(`一致：${r.consistent.length} 条  冲突：${r.conflicting.length} 条${r.label ? `  归因：${r.label}` : ''}`);
      return;
    }

    case 'settle': {
      brain.settleBrain(ID);
      line('结算完成。');
      printStatus();
      return;
    }

    case 'audit': {
      const n = Number(args[0] || 20);
      const rows = brain.readAudit(ID, n);
      if (!rows.length) line('（还没有审计记录）');
      for (const r of rows) line(JSON.stringify(r));
      return;
    }

    case 'spread': {
      const list = syntheticTraits(7, 100);
      const replies = list.map((t) => wakeReply(t, 0.8));
      const styles = list.map((t) => JSON.stringify(styleVector(t)));
      const uniqR = new Set(replies).size;
      const uniqS = new Set(styles).size;
      line('100 条不同人设，同一情境（被吵醒，能量 0.8）：');
      line(`  反应种类：${uniqR} / 100`);
      line(`  自知配方：${uniqS} / 100`);
      line(`  样本：${[...new Set(replies)].slice(0, 8).map((x) => `「${x}」`).join(' ')}`);
      line();
      line(uniqR >= 20 ? '✔ 不是查找表' : '✘ 散度太低，退化成查找表了');
      return;
    }

    case 'snapshot': {
      const r = brain.snapshotBrain(ID, args[0]);
      line(`已存档：${r.name}`);
      line(r.file);
      return;
    }

    case 'restore': {
      const r = brain.restoreBrain(ID, args[0]);
      if (!r.ok) {
        line(`✘ ${r.reason}`);
        if (r.available?.length) line(`可用：${r.available.join(', ')}`);
        return;
      }
      line(`已退回 ${r.restored}`);
      line(`体检：${r.check.verdict}`);
      return;
    }

    case 'snapshots': {
      const list = brain.listSnapshots(ID);
      if (!list.length) { line('还没有快照。'); return; }
      for (const s of list) line(`  ${s.name}  ${(s.size / 1024).toFixed(1)} KB`);
      return;
    }

    case 'lint': {
      const file = args[0];
      let text = '';
      if (file && fs.existsSync(file)) {
        text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
      } else {
        const card = brain.resolveRoleCard();
        if (!card?.text) { line('没有卡可体检；用法：npx feiyu lint <卡的路径>'); return; }
        text = card.text;
        line(`（体检当前卡：${card.file}）`);
        line();
      }
      const r = brain.lintCard(text);
      line(`可抽成命题 ${r.units} 条：${Object.entries(r.byKind).map(([k, v]) => `${k} ${v}`).join(' / ') || '无'}`);
      line(`被忽略 ${r.dropped.length} 行`);
      line();
      line('命题预览：');
      for (const p of r.preview) line(`  ${p}`);
      if (r.suggestSplit.length) {
        line();
        line(`⚠️ 有 ${r.suggestSplit.length} 行更像操作手册，建议拆出人设：`);
        for (const s of r.suggestSplit.slice(0, 10)) line(`  · ${s.text}`);
      }
      return;
    }

    case 'import': {
      const file = args[0];
      if (!file || !fs.existsSync(file)) { line('用法：npx feiyu import <episodes.json>'); return; }
      const list = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
      const r = brain.importEpisodes(ID, Array.isArray(list) ? list : list.episodes);
      line(`导入了 ${r.imported} 条（跳过 ${r.skipped}），现在共 ${r.total} 条经历。`);
      return;
    }

    case 'migrate': {
      const target = args[0];
      if (!target || !fs.existsSync(target)) {
        line('用法：npx feiyu migrate <文件或目录> [选项]');
        line('');
        line('  --all            整个目录一起搬（自动认格式）');
        line('  --format jsonl|days|generic   只对单个文件生效');
        line('  --dry-run        只看会搬多少，不写');
        line('  --delete-source  搬完把原文件改名成 .migrated（不是删除）');
        line('');
        line('支持的格式：');
        line('  jsonl    一行一条 {"sender":"谁","text":"说了什么","time":时间戳}');
        line('  days     日记式 markdown：- 某人：说了什么');
        line('  generic  JSON 数组');
        return;
      }

      const flag = (f) => {
        const i = args.indexOf(f);
        return i >= 0 ? args[i + 1] : undefined;
      };
      const dryRun = args.includes('--dry-run');
      const deleteSource = args.includes('--delete-source');
      const all = args.includes('--all') || fs.statSync(target).isDirectory();

      const sniff = (f) => {
        if (/\.jsonl$/i.test(f)) return 'jsonl';
        if (/\.(md|txt)$/i.test(f)) return 'days';
        if (/\.json$/i.test(f)) return 'generic';
        return 'jsonl';
      };
      const collect = (p) => {
        const st = fs.statSync(p);
        if (!st.isDirectory()) return [p];
        const out = [];
        for (const name of fs.readdirSync(p)) {
          const full = path.join(p, name);
          if (fs.statSync(full).isDirectory()) out.push(...collect(full));
          else if (/\.(md|jsonl|json|txt)$/i.test(name) && !name.endsWith('.migrated')) out.push(full);
        }
        return out.sort();
      };

      const files = collect(target);
      if (!files.length) { line('这个目录里没有 .md / .jsonl / .json 可搬。'); return; }

      if (!all) {
        // 单文件：沿用原来的行为
        const file = files[0];
        const format = flag('--format') ?? sniff(file);
        const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
        const r = brain.migrateMemory(ID, { text, format, dryRun });
        const p = r.report;
        line(`格式 ${p.format}　解析出 ${p.parsed} 条　重复 ${p.duplicated} 条　将导入 ${p.willImport} 条`);
        if (p.span) line(`时间跨度 ${p.span.from} → ${p.span.to}`);
        if (p.parseErrorCount) {
          line(`跳过 ${p.parseErrorCount} 行：`);
          for (const e of p.parseErrors.slice(0, 5)) line(`  第 ${e.line} 行 ${e.reason}`);
        }
        if (dryRun) { line(''); line('（dry-run，什么都没写。去掉 --dry-run 才真搬）'); return; }
        line('');
        line(`✔ 导入了 ${r.imported} 条，现在共 ${r.total} 条经历。`);
        line(`体检：${brain.identityCheck(ID).verdict}`);
        return;
      }

      // 全量整合
      const sources = files.map((f) => ({ path: f, text: fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''), format: sniff(f) }));
      const r = brain.migrateAll(ID, sources, { dryRun, deleteSource });
      const p = r.report;
      line(`扫到 ${p.files} 个文件　解析出 ${p.parsed} 条　重复 ${p.duplicated} 条　将导入 ${p.willImport} 条`);
      if (p.span) line(`时间跨度 ${p.span.from} → ${p.span.to}`);
      if (p.errorCount) {
        line(`跳过 ${p.errorCount} 处：`);
        for (const e of p.errors.slice(0, 5)) line(`  ${path.basename(e.path || '?')} 第 ${e.line} 行 ${e.reason}`);
      }
      if (dryRun) {
        line('');
        line('（dry-run，什么都没写）');
        line('真搬：去掉 --dry-run；想连原文件一起收走，加 --delete-source（改名 .migrated，不是删）');
        return;
      }
      line('');
      line(`✔ 全量导入 ${r.imported} 条，现在共 ${r.total} 条经历。`);
      if (r.compacted) line(`  容量保护：最老的 ${r.compacted} 条已压成卡片 + 归档`);
      if (r.renamed.length) {
        line(`  原文件已改名 ${r.renamed.length} 个：`);
        for (const n of r.renamed.slice(0, 5)) line(`    ${path.basename(n)}`);
      }
      line(`体检：${r.check.verdict}`);
      line('');
      line('自检：npx feiyu verify');
      return;
    }

    case 'verify': {
      const r = brain.verifyMemory(ID);
      line(`经历 ${r.episodes} 条（亲历 ${r.live} / 搬来 ${r.imported}）　卡片 ${r.cards}　认识 ${r.people} 个人`);
      line(`体检：${r.check.verdict}`);
      line(`回忆抽检：${Math.round(r.recallRate * 100)}%（${r.recall.filter((c) => c.found).length}/${r.recall.length}）`);
      for (const c of r.recall) line(`  ${c.found ? '✔' : '✘'} 「${c.keyword}」`);
      return;
    }

    case 'diary': {
      const sub = args[0] || 'digest';
      if (sub === 'write') {
        const file = args[1];
        if (!file || !fs.existsSync(file)) { line('用法：npx feiyu diary write <文本文件> [YYYY-MM-DD]'); return; }
        const r = brain.writeDiary(ID, { date: args[2], text: fs.readFileSync(file, 'utf8') });
        if (!r.ok) { line(`✘ ${r.reason}`); return; }
        line(`${r.date} 的日记存好了（${r.chars} 字）`);
        line(r.file);
        return;
      }
      if (sub === 'read') {
        const r = brain.readDiary(ID, args[1]);
        if (!r) { line(`${args[1] || '今天'}还没有日记。`); return; }
        line(r.text);
        return;
      }
      if (sub === 'import') {
        const dir = args[1];
        if (!dir || !fs.existsSync(dir)) { line('用法：npx feiyu diary import <旧的日记目录>'); return; }
        const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
        const list = [];
        for (const f of files) {
          const m = /(\d{4}-\d{2}-\d{2})/.exec(f);
          if (!m) continue;
          list.push({ date: m[1], text: fs.readFileSync(path.join(dir, f), 'utf8') });
        }
        const r = brain.importDiary(ID, list);
        line(`认出的日记 ${list.length} 篇，导入 ${r.imported}，跳过 ${r.skipped}（已存在的不覆盖）`);
        line(`现在一共有 ${r.days} 天日记。`);
        return;
      }
      if (sub === 'list') {
        const list = brain.listDiary(ID);
        if (!list.length) { line('还没写过日记。'); return; }
        for (const d of list) line(`  ${d.date}  ${(d.size / 1024).toFixed(1)} KB`);
        return;
      }
      const d = brain.diaryDigest(ID, args[1]);
      line(`【${d.date} 的素材】经历 ${d.episodes} 条，见了 ${d.people.length ? d.people.join('、') : '没人'}，心情 ${d.mood || '平静'}`);
      line();
      line(d.draft);
      line();
      line(`👉 ${d.hint}`);
      return;
    }

    case 'doctor': {
      const { diagnose, applyFixes, formatReport } = await import('./lib/doctor.mjs');
      const profile = args[0] || 'desktop';
      const report = diagnose({ profile });
      line(formatReport(report));
      if (args.includes('--fix')) {
        line('');
        const done = applyFixes(report);
        if (done.length) {
          for (const d of done) line(`✔ ${d}`);
          line('');
          line('改完了。**完全退出 DSH 再启动**（宿主需要冷启动才认新 bundles）。');
        } else {
          line('没有能自动修的项。');
        }
      } else if (!report.ok) {
        line('');
        line('能自动修的加 --fix：npx feiyu doctor --fix（会改 profile 的 bundles 和工具白名单）');
      }
      return;
    }

    case 'serve': {
      const { serve } = await import('./lib/serve.mjs');
      const flag = (f) => {
        const i = args.indexOf(f);
        return i >= 0 ? args[i + 1] : undefined;
      };
      const port = Number(flag('--port') ?? 7788);
      const token = flag('--token') ?? process.env.FEIYU_TOKEN ?? '';
      const host = flag('--host') ?? '127.0.0.1';
      const s = await serve(brain, { port, host, token, id: ID });
      line(`边车起来了：${s.url}`);
      line(`鱼：${ID}　 token：${token ? '已设（要求 x-feiyu-token 头）' : '没设（只允许本机）'}`);
      line('');
      line('Python 这么接：');
      line(`  requests.post('${s.url}/wake', json={'id':'${ID}','sender':who,'text':msg})`);
      line('');
      line('接口：GET /health /status /version /identity /verify');
      line('      POST /wake /observe /feel /diary /migrate /snapshot');
      line('Ctrl+C 停。');
      // 常驻
      await new Promise(() => {});
      return;
    }

    case 'vocab': {
      const sub = args[0] || 'show';
      if (sub === 'seed') {
        const r = brain.seedVocab(ID);
        line(`预装了 ${r.added} 个情绪词，现在会 ${r.total} 个，阶段 ${r.stage}`);
        line('（新鱼用不到；老鱼搬进来不该从"哼哼"开始）');
        return;
      }
      const v = brain.vocabOf(ID);
      line(`阶段 ${v.stage}　会 ${v.words.length} 个词`);
      if (v.words.length) line(v.words.join('、'));
      if (v.stage === 1) line('（词不够 10 个，只会说"说不清"；老鱼可以 npx feiyu vocab seed）');
      return;
    }

    case 'mouth': {
      const C = await import('./lib/channels.mjs');
      const sub = args[0] || 'status';
      if (sub === 'detect') {
        line('扫一遍常见网关…');
        const found = await C.detect();
        if (!found.length) {
          line('✘ 一个都没找到。');
          line('  确认一下：OneBot 的 HTTP 服务开着吗？（SnowLuma/NapCat/Lagrange/go-cqhttp）');
          line('  或者手工指定：npx feiyu say --via onebot --base http://127.0.0.1:3000 --token xxx');
          return;
        }
        C.saveChannels(brain.dataDir(), found.map(({ impl, implName, baseUrl, token, uin, nickname }) => ({ impl, implName, baseUrl, token, uin, nickname })));
        line(`✔ 找到 ${found.length} 个，已记住`);
        for (const f of found) line(`  ${f.implName.padEnd(16)} ${f.baseUrl}  ${f.uin ?? ''} ${f.nickname ?? ''}`);
        return;
      }
      if (sub === 'list') {
        const saved = C.loadChannels(brain.dataDir());
        if (!saved.length) { line('还没存过通道。跑 npx feiyu mouth detect'); return; }
        const st = await C.statusOf(brain.dataDir());
        for (const x of st) line(`  ${x.alive ? '✔' : '✘'} ${String(x.implName).padEnd(16)} ${x.baseUrl}  ${x.uin ?? ''} ${x.nickname ?? ''}`);
        return;
      }
      const m = await C.resolveMouth({ dataDir: brain.dataDir() });
      if (!m) { line('✘ 没有可用的嘴。跑 npx feiyu mouth detect'); return; }
      line(`✔ 能用的嘴：${m.implName} ${m.baseUrl}  ${m.uin ?? ''} ${m.nickname ?? ''}（${m.source}）`);
      return;
    }

    case 'say': {
      const flag = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
      const via = flag('--via') || 'window';
      const target = flag('--target') || flag('--to') || '';
      const skip = new Set(['--via', '--target', '--to', '--kind', '--base', '--token']);
      const words = [];
      for (let i = 0; i < args.length; i += 1) {
        if (skip.has(args[i])) { i += 1; continue; }
        if (String(args[i]).startsWith('--')) continue;
        words.push(args[i]);
      }
      const text = words.join(' ') || '';
      if (!text) {
        line('用法：');
        line('  npx feiyu say --via onebot --target <群号> "要说的话"');
        line('  npx feiyu say --via window --target QQ "要说的话"');
        return;
      }
      const S = await import('./lib/say.mjs');
      const r = await S.say({
        text, via, target, title: target,
        kind: flag('--kind') || 'group',
        baseUrl: flag('--base') || '',
        token: flag('--token') || '',
      });
      if (!r.ok) {
        line(`✘ ${r.code}: ${r.text}`);
        return;
      }
      line(`✔ 发出去了 ${r.evidence || ''}`);
      return;
    }

    case 'body': {
      const kind = args[0];
      const s = brain.snapshot(ID);
      if (!kind) {
        line(`当前身体：${s.body ? `${s.body.label}（${s.body.screen}，${s.body.posture}）` : '无'}`);
        line(`可用：${BODY_KINDS.map((k) => `${k}（${BODY_PROFILES[k].label}）`).join(' / ')}`);
        if (s.body) {
          line('');
          line('装了什么：');
          for (const app of s.body.apps) line(`  · ${app}`);
        }
        return;
      }
      const b = brain.setBody(ID, kind, { ownership: args[1] });
      line(`换好了：${bodyLine(b)}`);
      return;
    }

    case 'rebirth': {
      const relation = args[0] || 'parent';
      const address = args[1] || '';
      const dir = path.join(brainsDir(), ID);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      const b = brain.birth({ id: ID, relation, address });
      line(`重开了一条鱼：${b.roleCard}，${b.persona.units.length} 条命题，主导 ${b.self.styleName}`);
      line(b.persona.brief);
      return;
    }

    default:
      line('用法：npx feiyu [status|brief|observe|settle|audit|spread|body|rebirth|snapshot|restore|snapshots|lint|import|migrate|verify|diary|doctor|serve|vocab|say|mouth]');
  }
}

try {
  await run();
} catch (e) {
  if (isNoCard(e)) {
    firstRunGuide();
    process.exit(0); // 这不是错误，是还没开始
  }
  console.error(`出错了：${e?.message ?? e}`);
  process.exit(1);
}
