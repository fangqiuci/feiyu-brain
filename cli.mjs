#!/usr/bin/env node
// 大肥鱼大脑 · 运维命令行
//
//   node cli.mjs status              看她现在什么状态
//   node cli.mjs brief               打印"此刻的她"（唤醒时注入的那段）
//   node cli.mjs observe 扶摇 "你嘴真硬"   手动记一次经历
//   node cli.mjs settle              跑一次每日结算（衰减 + TTL + 蜕皮）
//   node cli.mjs audit 20            最近 20 条审计
//   node cli.mjs spread              派生检验：100 条鱼是不是 100 种样子
//   node cli.mjs rebirth parent 妈   重开一条鱼（会清空记忆，慎用）

import fs from 'node:fs';
import path from 'node:path';

import * as brain from './index.js';
import { ROOT } from './store.js';
import { wakeReply, styleVector, flowName, flowLevel } from './core/derive.js';
import { syntheticTraits } from './core/invariants.js';
import { BODY_KINDS, BODY_PROFILES, bodyLine } from './core/body.js';

const [, , cmd = 'status', ...args] = process.argv;
const ID = process.env.FEIYU_ID || 'default';

const line = (s = '') => console.log(s);

function printStatus() {
  const s = brain.snapshot(ID);
  line(`鱼：${s.id}   人设卡：${s.roleCard}   出生：${new Date(s.born).toLocaleString('zh-CN')}`);
  line(`自知：${s.styleName}  (aware ${s.style.aware} / denial ${s.style.denial} / fixed ${s.style.fixed} / naive ${s.style.naive})`);
  line(`意识流：${s.flow.name}（${s.flow.level}）`);
  line(`命题：${s.weights.count} 条，身份 ${s.weights.identity} 条，总权重 ${s.weights.totalWeight}`);
  line(`记忆：经历 ${s.memory.episodes} / 印象 ${s.memory.impressions} / 幻想 ${s.memory.imagination} / 蜕皮 ${s.memory.formerSelves} / 遗忘 ${s.memory.forgotten}`);
  line(`观察次数：${s.observations}`);
  line(`关系：${s.relation.type}（称呼「${s.relation.address || '—'}」，可解除 ${s.relation.ctr.dissolvable ? '是' : '否'}）`);
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

switch (cmd) {
  case 'status':
    printStatus();
    break;

  case 'brief': {
    const text = brain.getBrief(ID);
    line(text);
    line();
    line(`—— ${text.length} 字`);
    break;
  }

  case 'observe': {
    const who = args[0] || '';
    const text = args.slice(1).join(' ') || '';
    if (!text) {
      line('用法：node cli.mjs observe <谁> "<他说了什么>"');
      process.exit(1);
    }
    const r = brain.observe(ID, { text, who, what: text, via: 'cli' });
    line(`记下了：${who}「${text}」`);
    line(`一致：${r.consistent.length} 条  冲突：${r.conflicting.length} 条${r.label ? `  归因：${r.label}` : ''}`);
    break;
  }

  case 'settle': {
    brain.settleBrain(ID);
    line('结算完成。');
    printStatus();
    break;
  }

  case 'audit': {
    const n = Number(args[0] || 20);
    const rows = brain.readAudit(ID, n);
    if (!rows.length) line('（还没有审计记录）');
    for (const r of rows) line(JSON.stringify(r));
    break;
  }

  case 'spread': {
    const list = syntheticTraits(7, 100);
    const replies = list.map((t) => wakeReply(t, 0.8));
    const styles = list.map((t) => JSON.stringify(styleVector(t)));
    const uniqR = new Set(replies).size;
    const uniqS = new Set(styles).size;
    line(`100 条不同人设，同一情境（被吵醒，能量 0.8）：`);
    line(`  反应种类：${uniqR} / 100`);
    line(`  自知配方：${uniqS} / 100`);
    line(`  样本：${[...new Set(replies)].slice(0, 8).map((x) => `「${x}」`).join(' ')}`);
    line();
    line(uniqR >= 20 ? '✔ 不是查找表' : '✘ 散度太低，退化成查找表了');
    break;
  }

  case 'rebirth': {
    const relation = args[0] || 'parent';
    const address = args[1] || '';
    const dir = path.join(ROOT, 'state', 'brains', ID);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    const b = brain.birth({ id: ID, relation, address });
    line(`重开了一条鱼：${b.roleCard}，${b.persona.units.length} 条命题，主导 ${b.self.styleName}`);
    line(b.persona.brief);
    break;
  }

  case 'body': {
    const kind = args[0];
    const s = brain.snapshot(ID);
    if (!kind) {
      line(`当前身体：${s.body ? `${s.body.label}（${s.body.screen}，${s.body.posture}，${s.body.ownership === 'owned' ? '自己的' : s.body.ownership === 'borrowed' ? '借的' : '模拟的'}）` : '无'}`);
      line(`可用：${BODY_KINDS.map((k) => `${k}（${BODY_PROFILES[k].label}）`).join(' / ')}`);
      if (s.body) {
        line('');
        line('装了什么：');
        for (const app of s.body.apps) line(`  · ${app}`);
      }
      break;
    }
    const b = brain.setBody(ID, kind, { ownership: args[1] });
    line(`换好了：${bodyLine(b)}`);
    break;
  }

  default:
    line('用法：node cli.mjs [status|brief|observe|settle|audit|spread|body|rebirth]');
    process.exit(1);
}
