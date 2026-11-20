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

function run() {
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
      line('用法：npx feiyu [status|brief|observe|settle|audit|spread|body|rebirth]');
  }
}

try {
  run();
} catch (e) {
  if (isNoCard(e)) {
    firstRunGuide();
    process.exit(0); // 这不是错误，是还没开始
  }
  console.error(`出错了：${e?.message ?? e}`);
  process.exit(1);
}
