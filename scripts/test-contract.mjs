// 宿主给的验收标准（feiyu-brain-集成问题清单 §六），一条一条过。
//
//   node scripts/test-contract.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as B from '../index.js';
import { createBridgeAdapter, dedupeKey } from '../adapters/qq-bridge.js';

let pass = 0;
const fails = [];
const t = (n, fn) => {
  try { fn(); pass += 1; console.log(`  ✔ ${n}`); }
  catch (e) { fails.push(`${n}: ${e.message}`); console.log(`  ✘ ${n}\n      ${e.message}`); }
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'feiyu-contract-'));
const roles = path.join(tmp, 'roles');
fs.mkdirSync(roles, { recursive: true });
const CARD = [
  '你是契约测试鱼。',
  '性格：嘴硬=0.8 心软=0.5 好奇=0.6',
  '- 我嘴硬，被怼会顶回去。',
  '- 不要客服腔。',
  '- 我喜欢解压类的视频。',
].join('\n');

B.configure({ dataDir: tmp, roleDir: roles });

const mk = (id) => B.createBrain({ id, dataDir: tmp, roleDir: roles, cardText: CARD, cardName: '契约鱼', relation: 'parent', address: '老爹' });

console.log('\n── 验收 1：没有 seq、只有 time ──');

t('recentMessages 只有 time 也能产生一条 episode', () => {
  const fy = mk('c1');
  const ad = createBridgeAdapter({ id: 'c1' });
  const st = {
    recentMessages: [
      { sender: '扶摇', text: '你嘴真硬', time: 1763600000000, isSelf: false },
      { sender: '扶摇', text: '说你两句还顶回来', time: 1763600001000, isSelf: false },
    ],
  };
  ad.observeOnce('k1', st, B);
  if (fy.brain.memory.episodes.length < 1) throw new Error(`episode = ${fy.brain.memory.episodes.length}`);
});

t('同一条不重复经历', () => {
  const ad = createBridgeAdapter({ id: 'c1' });
  const st = { recentMessages: [{ sender: 'A', text: '在吗', time: 1763600002000, isSelf: false }] };
  ad.observeOnce('k2', st, B);
  const n1 = B.snapshot('c1').memory.episodes;
  ad.observeOnce('k2', st, B);
  const n2 = B.snapshot('c1').memory.episodes;
  if (n2 !== n1) throw new Error(`${n1} → ${n2}`);
});

t('dedupeKey 三级兜底都认', () => {
  if (dedupeKey({ seq: 5 }) !== 's:5') throw new Error('seq');
  if (dedupeKey({ messageId: 'abc' }) !== 'm:abc') throw new Error('messageId');
  if (!String(dedupeKey({ time: 123, text: '在吗' })).startsWith('t:123')) throw new Error('time');
});

console.log('\n── 验收 2：一次 10 条不能只记 1 条 ──');

t('10 条 unread → 10 条 episode', () => {
  const fy = mk('c2');
  const ad = createBridgeAdapter({ id: 'c2' });
  const before = fy.brain.memory.episodes.length;
  const unread = Array.from({ length: 10 }, (_, i) => ({
    seq: i + 1, sender: 'A', text: `第 ${i + 1} 条消息`, time: 1763600000000 + i, isSelf: false,
  }));
  const r = ad.drainUnread('k', { unread }, B);
  const after = B.snapshot('c2').memory.episodes;
  if (r.observed !== 10) throw new Error(`observed=${r.observed}`);
  if (after - before !== 10) throw new Error(`episode +${after - before}`);
});

t('超过上限时合并成一条并说明跳了几条', () => {
  mk('c3');
  const ad = createBridgeAdapter({ id: 'c3', limit: 5 });
  const unread = Array.from({ length: 12 }, (_, i) => ({
    seq: i + 1, sender: 'A', text: `积压第 ${i + 1} 条`, time: 1763600000000 + i, isSelf: false,
  }));
  const r = ad.drainUnread('k', { unread }, B);
  if (r.observed !== 5) throw new Error(`observed=${r.observed}`);
  if (r.merged !== 7) throw new Error(`merged=${r.merged}`);
});

console.log('\n── 验收 3：影子模式不动权重 ──');

t('shadow 下 observe 100 次，brain.json 权重一个不变', () => {
  const fy = mk('c4');
  B.configure({ shadow: true });
  fy.observe({ who: 'A', text: '你嘴真硬' });
  const file = path.join(tmp, 'brains', 'c4', 'brain.json');
  const w0 = fs.readFileSync(file, 'utf8').match(/"weight":\s*([\d.]+)/g)?.join(',') ?? '';
  for (let i = 0; i < 100; i += 1) fy.observe({ who: 'A', text: '我嘴硬，被怼会顶回去' });
  const w1 = fs.readFileSync(file, 'utf8').match(/"weight":\s*([\d.]+)/g)?.join(',') ?? '';
  const audits = B.readAudit('c4', 500).filter((x) => x.kind === 'shadow');
  B.configure({ shadow: false });
  if (w0 !== w1) throw new Error('权重被改了');
  if (audits.length < 100) throw new Error(`shadow 审计只有 ${audits.length} 条`);
});

console.log('\n── 验收 4：snapshot / restore 权重逐条相等 ──');

t('存档 → 改 50 次 → 退回，权重逐条相等', () => {
  mk('c5');
  const w0 = B.snapshot('c5').weights.top;
  B.snapshotBrain('c5', 'base');
  for (let i = 0; i < 50; i += 1) B.observe('c5', { text: '我嘴硬，被怼会顶回去我嘴硬' });
  const changed = B.snapshot('c5').weights.totalWeight;
  const r = B.restoreBrain('c5', 'base');
  if (!r.ok) throw new Error(r.reason);
  const units = B.snapshot('c5');
  const w1 = units.weights.top;
  if (w0.length !== w1.length) throw new Error('条数变了');
  for (const u of w0) {
    const same = w1.find((x) => x.id === u.id);
    if (!same || same.weight !== u.weight) throw new Error(`${u.id} ${u.weight} → ${same?.weight}`);
  }
  if (changed === 0) throw new Error('这 50 次根本没改权重，测试无效');
});

t('退回不存在的快照会说清楚', () => {
  const r = B.restoreBrain('c5', '不存在');
  if (r.ok !== false || !r.reason) throw new Error('没拒绝');
});

console.log('\n── 验收 5：导入历史后能检索到 ──');

t('导入 30 条，wake 里能检索到关键词', () => {
  mk('c6');
  const list = Array.from({ length: 30 }, (_, i) => ({
    who: '扶摇', text: `第 ${i + 1} 次聊到「鲸鱼搁浅的新闻」`, at: 1763500000000 + i * 1000, feel: '有点难过',
  }));
  const r = B.importEpisodes('c6', list);
  if (r.imported !== 30) throw new Error(`imported=${r.imported}`);
  const line = B.wakeLine('c6', { who: '扶摇', text: '鲸鱼搁浅' });
  if (!line.includes('搁浅')) throw new Error('没检索到导入的历史');
});

t('导入的 episode 带 source=import，现场记的是 live', () => {
  mk('c6b');
  B.importEpisodes('c6b', [{ who: 'A', text: '导入的一条' }]);
  B.observe('c6b', { who: 'A', text: '现场记的一条' });
  const eps = B.snapshot('c6b');
  const all = B.listBrains().length;
  if (!all) throw new Error('listBrains 空');
  const raw = B.exportBrain('c6b');
  const srcs = raw.memory.episodes.map((e) => e.source);
  if (!srcs.includes('import')) throw new Error(`import 没标：${srcs}`);
  if (!srcs.includes('live')) throw new Error(`live 没标：${srcs}`);
  if (!eps.memory.episodes) throw new Error('snapshot 没有 episodes');
});

console.log('\n── 顺带：卡体检 / 设备归属 / 数据目录 ──');

t('lintCard 能指出"这行像操作手册"', () => {
  const card = ['你是某鱼。', '## 人格', '- 我嘴硬，被怼会顶回去。', '## 操作', '- 调用 feiyu_status 查状态，参数 id 选填。'].join('\n');
  const r = B.lintCard(card);
  if (r.units < 2) throw new Error(`units=${r.units}`);
  if (!r.suggestSplit.length) throw new Error('没指出操作手册行');
});

t('body.owner=host 时脑不抢设备', () => {
  const fy = mk('c7');
  const body = B.createBody({ kind: 'phone', owner: 'host' });
  const gate = B.canDo(body, { type: 'open_app', app: 'douyin', capability: 2 });
  if (gate.ok !== false || gate.code !== 'E_HOST_OWNS') throw new Error(JSON.stringify(gate));
  const shot = B.canDo(body, { type: 'screenshot', capability: 1 });
  if (!shot.ok) throw new Error('截屏也不让做了');
  if (!fy) throw new Error('fy');
});

t('数据目录不在包内（装进 node_modules 时也不写包目录）', () => {
  const rt = B.runtimeOptions();
  if (!rt.dataDir) throw new Error('没有 dataDir');
  if (rt.dataDirInsidePackage) throw new Error('数据写进包里了');
});

t('ttlPolicy=off 时不过期', () => {
  B.configure({ ttl: 'off' });
  mk('c8');
  const raw = B.exportBrain('c8');
  raw.memory.episodes.push({ id: 'old', kind: 'episode', what: '很久以前', at: 0, lastRecall: 0, consecutiveDays: 1, longTerm: false });
  fs.writeFileSync(path.join(tmp, 'brains', 'c8', 'brain.json'), JSON.stringify(raw));
  B.forgetCache('c8');
  B.settleBrain('c8', Date.now() + 400 * 86400000);
  if (B.snapshot('c8').memory.forgotten !== 0) throw new Error('off 也遗忘了');
  B.configure({ ttl: 'hard' });
});

console.log('\n── 记忆搬迁：老鱼搬进来 / 新鱼从零 ──');

t('同一份文件搬两次，第二次 0 条（去重）', () => {
  mk('m1');
  const text = [
    '{"sender":"扶摇","text":"你嘴真硬","time":1763500000000}',
    '{"sender":"访秋辞","text":"吃饭了吗","time":1763500100000}',
  ].join('\n');
  const a = B.migrateMemory('m1', { text, format: 'jsonl' });
  if (a.imported !== 2) throw new Error(`第一次 ${a.imported}`);
  const b = B.migrateMemory('m1', { text, format: 'jsonl' });
  if (b.imported !== 0) throw new Error(`第二次还是搬了 ${b.imported}`);
});

t('文件里有坏行：好行照搬，坏行报行号', () => {
  mk('m2');
  const text = [
    '{"sender":"A","text":"第一条"}',
    '这不是 json',
    '{"sender":"A","text":"第三条"}',
  ].join('\n');
  const r = B.migrateMemory('m2', { text, format: 'jsonl' });
  if (r.imported !== 2) throw new Error(`导了 ${r.imported}`);
  if (r.report.parseErrorCount !== 1) throw new Error(`报错 ${r.report.parseErrorCount}`);
  if (r.report.parseErrors[0].line !== 2) throw new Error('行号不对');
});

t('dryRun 一条都不写', () => {
  mk('m3');
  const text = '{"sender":"A","text":"不该被写进去","time":1763500000000}';
  const r = B.migrateMemory('m3', { text, format: 'jsonl', dryRun: true });
  if (r.report.willImport !== 1) throw new Error('没算出来');
  if (B.snapshot('m3').memory.episodes !== 0) throw new Error('dryRun 竟然写了');
});

t('日记格式：认得出的搬，认不出的跳过', () => {
  mk('m4');
  const text = ['## 2026-11-18', '- 扶摇：你嘴真硬啊', '- 访秋辞：「吃饭了吗」', '这一行既不是标题也不是说话'].join('\n');
  const r = B.migrateMemory('m4', { text, format: 'days' });
  if (r.imported !== 2) throw new Error(`导了 ${r.imported}`);
  if (r.report.span?.from !== '2026-11-18') throw new Error(`跨度 ${JSON.stringify(r.report.span)}`);
});

t('搬完 identityCheck 是「是她」，wake 能检索到', () => {
  mk('m5');
  B.migrateMemory('m5', { text: '{"sender":"扶摇","text":"聊到鲸鱼搁浅的新闻","time":1763500000000}', format: 'jsonl' });
  if (B.identityCheck('m5').verdict !== '是她') throw new Error('不是她');
  const line = B.wakeLine('m5', { who: '扶摇', text: '鲸鱼搁浅' });
  if (!line.includes('搁浅')) throw new Error('检索不到');
});

t('新鱼不搬：记忆 0 条，observe 之后才开始长', () => {
  const fy = mk('m6');
  if (fy.brain.memory.episodes.length !== 0) throw new Error('新鱼竟然有记忆');
  fy.observe({ who: 'A', text: '第一句话' });
  if (B.snapshot('m6').memory.episodes !== 1) throw new Error('observe 没生效');
});

t('走完整条生命周期，原文一路进归档文件', () => {
  B.configure({ ttl: 'archive' });
  mk('m7');
  const D2 = 86400000;
  const t0 = Date.now();
  const raw = B.exportBrain('m7');
  raw.memory.episodes.push({ id: 'old', kind: 'episode', what: '很久以前的秘密', at: t0, lastRecall: t0, expiresAt: t0 + 21 * D2, consecutiveDays: 1, longTerm: false });
  fs.writeFileSync(path.join(tmp, 'brains', 'm7', 'brain.json'), JSON.stringify(raw));
  B.forgetCache('m7');

  B.settleBrain('m7', t0 + 40 * D2);    // 21 天 → 压成卡片
  B.settleBrain('m7', t0 + 800 * D2);   // 卡片满 2 年 → 遗忘
  const arch = path.join(tmp, 'brains', 'm7', 'archive.jsonl');
  if (!fs.existsSync(arch)) throw new Error('没有归档文件');
  if (!fs.readFileSync(arch, 'utf8').includes('很久以前的秘密')) throw new Error('原文没进归档');
  if (B.snapshot('m7').memory.episodes !== 0) throw new Error('脑里还在');
  B.configure({ ttl: 'hard' });
});

console.log('\n── 日记：她自己的心房 ──');

t('digest 给出今天的素材和第一人称骨架', () => {
  const fy = mk('d1');
  B.observe('d1', { who: '扶摇', text: '你嘴真硬' });
  B.observe('d1', { who: '访秋辞', text: '吃饭了吗' });
  const d = B.diaryDigest('d1');
  if (d.episodes !== 2) throw new Error(`经历 ${d.episodes}`);
  if (!d.people.includes('扶摇')) throw new Error('没认出人');
  if (!d.draft.includes('扶摇')) throw new Error('骨架里没有今天的事');
  if (!d.hint) throw new Error('没有提示');
  if (!fy) throw new Error('fy');
});

t('write 存到自己的 days/ 目录，不动宿主的日记', () => {
  mk('d2');
  const r = B.writeDiary('d2', { text: '今天没什么想说的。' });
  if (!r.ok) throw new Error(r.reason);
  if (!r.file.includes('days')) throw new Error(r.file);
  if (!fs.existsSync(r.file)) throw new Error('文件没生成');
  if (!r.file.startsWith(path.join(tmp, 'brains', 'd2'))) throw new Error('存到别处去了');
});

t('写完能读回来、能列出、能检索', () => {
  mk('d3');
  B.writeDiary('d3', { text: '今天扶摇又说我嘴硬，我没理他。' });
  const r = B.readDiary('d3');
  if (!r.text.includes('嘴硬')) throw new Error('读不回来');
  const list = B.listDiary('d3');
  if (!list.length) throw new Error('列不出来');
  const hits = B.recallDiary('d3', '嘴硬');
  if (!hits.length) throw new Error('检索不到');
});

t('写完会进记忆（以后能想起"我写过日记"）', () => {
  mk('d4');
  B.writeDiary('d4', { text: '今天写了点东西。' });
  const raw = B.exportBrain('d4');
  const hit = raw.memory.episodes.find((e) => e.source === 'diary');
  if (!hit) throw new Error(`没有 diary 来源：${raw.memory.episodes.map((e) => e.source)}`);
});

t('空日记拒收', () => {
  mk('d5');
  const r = B.writeDiary('d5', { text: '   ' });
  if (r.ok !== false) throw new Error('空日记竟然存了');
});

console.log('\n── 日记要带心情 ──');

t('带 valence 的经历，记的是"这件事之后"的心情', () => {
  mk('d6');
  // 先把词表喂到 10 个，她才会命名
  const words = [['委屈', [-0.6, 0.3, -0.7]], ['生气', [-0.6, 0.8, 0.6]], ['高兴', [0.7, 0.6, 0.5]],
    ['失落', [-0.4, 0.1, -0.8]], ['烦', [-0.3, 0.5, 0]], ['慌', [-0.5, 0.7, -0.4]],
    ['得意', [0.6, 0.5, 0.7]], ['无聊', [-0.1, 0.2, -0.2]], ['累', [-0.3, 0.1, -0.6]], ['暖', [0.5, 0.2, 0.1]]];
  for (const [w, pad] of words) B.learnEmotion('d6', w, { pad, sources: ['a', 'b'] });

  B.observe('d6', { who: '扶摇', text: '你嘴真硬', valence: -0.7, intensity: 0.8 });
  const raw = B.exportBrain('d6');
  const ep = raw.memory.episodes[raw.memory.episodes.length - 1];
  if (!ep.mood) throw new Error('这条经历没记心情');
  if (ep.mood === '平静') throw new Error('记成了平静，说明没先算感受');
});

t('日记正文没写心情 → 自动补一行', () => {
  mk('d7');
  B.learnEmotion('d7', '生气', { pad: [-0.6, 0.8, 0.6], sources: ['a', 'b'] });
  B.feel('d7', { valence: -0.9, intensity: 0.9 });
  const r = B.writeDiary('d7', { text: '今天不太顺。' });
  if (!r.moodAdded) throw new Error('没补心情');
  const back = B.readDiary('d7');
  if (!back.text.includes('心情')) throw new Error('文件里没有心情');
  if (!back.mood) throw new Error('没记心情');
});

t('她自己写了心情 → 不重复补', () => {
  mk('d8');
  B.learnEmotion('d8', '生气', { pad: [-0.6, 0.8, 0.6], sources: ['a', 'b'] });
  B.feel('d8', { valence: -0.9, intensity: 0.9 });
  const r = B.writeDiary('d8', { text: '今天不太顺。\n\n心情：有点烦' });
  if (r.moodAdded) throw new Error('重复补了');
  const back = B.readDiary('d8');
  if ((back.text.match(/心情/g) ?? []).length !== 1) throw new Error('心情出现多次');
});

t('搬进来的老记忆没心情 → 写"那天没记"，不编', () => {
  mk('d9');
  B.importEpisodes('d9', [{ who: '扶摇', text: '很久以前的一句话', at: 1763500000000 }]);
  const d = B.diaryDigest('d9', new Date(1763500000000).toISOString().slice(0, 10));
  if (!d.draft.includes('那天没记')) throw new Error(d.draft);
});

console.log('\n── 老鱼接入：不许搬进来就死 ──');

const D = 86400000;

t('搬进来的历史，第二天 tick 还在（P0 回归）', () => {
  mk('o1');
  const now = Date.now();
  B.importEpisodes('o1', Array.from({ length: 10 }, (_, i) => ({ who: 'A', text: `旧事${i}`, at: now - 730 * D + i * D })));
  if (B.snapshot('o1').memory.episodes !== 10) throw new Error('搬丢了');
  B.settleBrain('o1', now + 2 * D);
  const left = B.snapshot('o1').memory.episodes;
  if (left !== 10) throw new Error(`第二天就剩 ${left} 条`);
});

t('30 天没人提 → 压扁成一句"大概"，不是删除', () => {
  mk('o2');
  const now = Date.now();
  B.importEpisodes('o2', [
    { who: '扶摇', text: '第一个话题', at: now },
    { who: '扶摇', text: '第二个话题', at: now + 60000 },
    { who: '访秋辞', text: '别的事', at: now + 120000 },
  ]);
  B.settleBrain('o2', now + 40 * D);
  const raw = B.exportBrain('o2');
  if (raw.memory.episodes.length !== 2) throw new Error(`压成 ${raw.memory.episodes.length} 条（应为 2 组）`);
  if (!raw.memory.episodes.every((e) => e.compressed)) throw new Error('没标成模糊');
  if (!raw.memory.episodes.some((e) => e.what.includes('还有 1 件'))) throw new Error('合并说明没写');
});

t('2 年没人提 → 才真遗忘，而且原文进了 archive.jsonl', () => {
  mk('o3');
  const now = Date.now();
  B.importEpisodes('o3', [{ who: 'A', text: '十年旧事', at: now }]);
  B.settleBrain('o3', now + 40 * D);   // 21 天后已是卡片
  B.settleBrain('o3', now + 800 * D);  // 超过 2 年 → 遗忘
  if (B.snapshot('o3').memory.episodes !== 0) throw new Error('还在');
  const arch = path.join(tmp, 'brains', 'o3', 'archive.jsonl');
  if (!fs.existsSync(arch)) throw new Error('没有归档');
  if (!fs.readFileSync(arch, 'utf8').includes('十年旧事')) throw new Error('原文没进归档');
});

t('只想起一次 → 卡片延长 30 天，但不会变回清晰', () => {
  const mem = {
    episodes: [{
      id: 'x', kind: 'episode', what: '常聊的话题', at: 0,
      lastRecall: Date.now() - 40 * D, compressed: true, cardedAt: Date.now() - 19 * D,
      expiresAt: Date.now(), consecutiveDays: 1, longTerm: false,
    }],
    imagination: [], facts: {}, impressions: {}, forgotten: [], cards: [],
  };
  const base = mem.episodes[0].expiresAt;
  B.touchByIds(mem, ['x'], Date.now());
  const after = mem.episodes[0].expiresAt;
  if (after - base !== 30 * D) throw new Error(`只延了 ${(after - base) / D} 天`);
  if (!mem.episodes[0].compressed) throw new Error('细节已经丢了，不该假装变回清晰');
  B.settle(mem, Date.now() + 29 * D);
  if (!mem.episodes.length) throw new Error('续命期内被忘了');
});

t('卡片 2 年没人提 → 遗忘（对比上一条）', () => {
  const mem = {
    episodes: [{
      id: 'y', kind: 'episode', what: '没人再提的事', at: 0,
      lastRecall: Date.now() - 40 * D, compressed: true, cardedAt: Date.now() - 800 * D,
      expiresAt: Date.now() - 86400000, consecutiveDays: 1, longTerm: false,
    }],
    imagination: [], facts: {}, impressions: {}, forgotten: [], cards: [],
  };
  B.settle(mem, Date.now());
  if (mem.episodes.length) throw new Error('该忘没忘');
});

t('长期记忆 2 年到期 → 降回卡片，不是遗忘', () => {
  const now = Date.now();
  const mem = {
    episodes: [{
      id: 'z', kind: 'episode', what: '刻骨铭心的事', at: now - 800 * D,
      lastRecall: now - 800 * D, longTerm: true, expiresAt: now - 86400000,
      consecutiveDays: 20,
    }],
    imagination: [], facts: {}, impressions: {}, forgotten: [], cards: [],
  };
  B.settle(mem, now);
  if (!mem.episodes.length) throw new Error('长期记忆被直接忘了');
  if (mem.episodes[0].longTerm) throw new Error('还标着长期');
  if (!mem.episodes[0].compressed) throw new Error('没降回卡片');
});

console.log('\n── 老鱼不该从"哼哼"开始 ──');

t('seedVocab 预装 10 个词，直接进阶段二', () => {
  mk('o5');
  const before = B.vocabOf('o5').stage;
  const r = B.seedVocab('o5');
  if (r.added !== 10) throw new Error(`只装了 ${r.added} 个`);
  if (before !== 1) throw new Error('新鱼本来就该是阶段一');
  if (r.stage !== 2) throw new Error(`装完才阶段 ${r.stage}`);
});

t('预装词表之后，日记里的心情能说出来', () => {
  mk('o6');
  B.seedVocab('o6');
  B.observe('o6', { who: '扶摇', text: '你嘴真硬', valence: -0.7, intensity: 0.8 });
  const d = B.diaryDigest('o6');
  if (!d.mood) throw new Error('没心情');
  if (d.mood === '说不上来') throw new Error('还是只会哼哼');
});

t('她的旧日记原样搬进来，一个字不改', () => {
  mk('o7');
  const text = '今天扶摇又说我嘴硬。\n我没理他。\n\n心情：烦';
  const r = B.importDiary('o7', [{ date: '2025-11-20', text }]);
  if (r.imported !== 1) throw new Error(`导了 ${r.imported}`);
  const back = B.readDiary('o7', '2025-11-20');
  if (back.text.trim() !== text.trim()) throw new Error('被改写了');
});

console.log('\n── 影子模式不是空跑 ──');

t('shadow 写 shadow.jsonl，brain.json 不动', () => {
  const fy = mk('o8');
  const file = path.join(tmp, 'brains', 'o8', 'brain.json');
  const w0 = fs.readFileSync(file, 'utf8').match(/"weight":\s*([\d.]+)/g).join(',');
  B.configure({ shadow: true });
  fy.observe({ who: 'A', text: '我嘴硬，被怼会顶回去' });
  B.configure({ shadow: false });
  const w1 = fs.readFileSync(file, 'utf8').match(/"weight":\s*([\d.]+)/g).join(',');
  if (w0 !== w1) throw new Error('权重被改了');
  const sh = path.join(tmp, 'brains', 'o8', 'shadow.jsonl');
  if (!fs.existsSync(sh)) throw new Error('没有 shadow.jsonl（等于空跑）');
  const line = JSON.parse(fs.readFileSync(sh, 'utf8').trim().split('\n').pop());
  if (!line.wouldChange?.length) throw new Error('没记下会怎么变');
});

t('brain 模式：宿主推过来的情绪被忽略', () => {
  mk('q1');
  B.configure({ mood: 'brain' });
  const r = B.syncMood('q1', [0.9, 0.9, 0.9]);
  if (r.ignored !== true) throw new Error('居然接受了');
});

t('host 模式：情绪以宿主为准，feel 只算不写', () => {
  mk('q2');
  B.learnEmotion('q2', '生气', { pad: [-0.6, 0.8, 0.6], sources: ['a', 'b'] });
  B.configure({ mood: 'host' });
  B.syncMood('q2', [0.5, 0.2, 0.8]);
  const r = B.feel('q2', { valence: -0.9, intensity: 0.9 });
  if (r.applied !== false) throw new Error('竟然写了');
  const affect = B.snapshot('q2').affect;
  if (Math.abs(affect.p - 0.5) > 1e-6) throw new Error(`affect.p 被改了：${affect.p}`);
  B.configure({ mood: 'brain' });
});

t('blend 模式：各占一半', () => {
  mk('q3');
  B.learnEmotion('q3', '生气', { pad: [-0.6, 0.8, 0.6], sources: ['a', 'b'] });
  B.configure({ mood: 'blend' });
  B.syncMood('q3', [0, 0, 0]);
  B.feel('q3', { valence: -1, intensity: 1 });
  const a = B.snapshot('q3').affect;
  if (!(a.p < 0 && a.p > -0.6)) throw new Error(`blend 不对：${a.p}`);
  if (a.moodSource !== 'blend') throw new Error('没标来源');
  B.configure({ mood: 'brain' });
});

console.log('\n── 重要记忆：反复交代的不许淡忘 ──');

t('同一件事换着说法说 3 次 → 判重要，并追溯标记前几条', () => {
  mk('p1');
  for (const text of ['辞辞，该上学了', '辞辞 快去上学', '辞辞，上学要迟到了']) {
    B.observe('p1', { who: '老爹', text });
  }
  const raw = B.exportBrain('p1');
  const marked = raw.memory.episodes.filter((e) => e.important);
  if (!marked.length) throw new Error('没判出重要');
  if (marked.length < 3) throw new Error(`只标了 ${marked.length} 条（前两条应被追溯标记）`);
});

t('刷屏和闲聊不会被误判成重要', () => {
  mk('p2');
  for (let i = 0; i < 10; i += 1) B.observe('p2', { who: '扶摇', text: '哈哈哈哈' });
  B.observe('p2', { who: '访秋辞', text: '今天天气不错' });
  const raw = B.exportBrain('p2');
  if (raw.memory.episodes.some((e) => e.important)) throw new Error('把噪声判成重要了');
});

t('重要记忆 3 年后还在，且没被压成卡片', () => {
  mk('p3');
  const now = Date.now();
  for (const text of ['辞辞该上学了', '辞辞 快去上学', '辞辞上学要迟到']) B.observe('p3', { who: '老爹', text });
  B.observe('p3', { who: 'A', text: '今天天气不错' });
  B.settleBrain('p3', now + 1100 * D);
  const raw = B.exportBrain('p3');
  const still = raw.memory.episodes.filter((e) => e.important);
  if (still.length < 3) throw new Error(`重要记忆只剩 ${still.length} 条`);
  if (still.some((e) => e.compressed)) throw new Error('重要记忆被压成卡片了');
});

console.log('\n── 人设：每天有微变，一年有蜕壳 ──');

t('每天的变化攒成「最近」一句', () => {
  mk('p4');
  const raw0 = B.exportBrain('p4');
  const u = raw0.persona.units.find((x) => x.kind !== 'identity');
  for (let i = 0; i < 5; i += 1) B.observe('p4', { text: '（压）', conflicting: [u.id] });
  const line = B.wakeLine('p4', { who: 'A' });
  if (!line.includes('【最近】')) throw new Error(line);
});

t('跨自然年 → 蜕壳卡片，记的是"掉出去的那部分"', () => {
  mk('p5');
  const now = Date.now();
  const raw0 = B.exportBrain('p5');
  const u = raw0.persona.units.find((x) => x.kind !== 'identity');
  for (let i = 0; i < 8; i += 1) B.observe('p5', { text: '（压）', conflicting: [u.id] });

  const nextYear = new Date(now);
  nextYear.setFullYear(nextYear.getFullYear() + 1);
  B.settleBrain('p5', nextYear.getTime());

  const raw = B.exportBrain('p5');
  const shell = (raw.memory.cards ?? []).find((c) => c.source === 'shell');
  if (!shell) throw new Error('没有蜕壳卡片');
  if (!shell.text.includes(String(nextYear.getFullYear() - 1))) throw new Error(`年份不对：${shell.text}`);
  if (!shell.text.includes('少了')) throw new Error(`没记下降幅：${shell.text}`);
  if (!shell.important) throw new Error('蜕壳卡片应该是永久的');
});

console.log('\n── 按年分片：16 年后打开也不变慢 ──');

t('brain.json 里不放经历，经历落在 years/', () => {
  mk('y1');
  B.observe('y1', { who: 'A', text: '今天说了一句' });
  const file = path.join(tmp, 'brains', 'y1', 'brain.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (raw.memory.episodes !== undefined) throw new Error('brain.json 里还有 episodes');
  if (!raw.memory.shards || !Object.keys(raw.memory.shards).length) throw new Error('没有 shards 索引');
  if (!fs.existsSync(path.join(tmp, 'brains', 'y1', 'years'))) throw new Error('没有 years 目录');
});

t('按年分文件，一年一个', () => {
  mk('y2');
  const mkEp = (year, i) => ({ who: 'A', text: `${year}年第${i}件`, at: new Date(year, 5, 1).getTime() + i * 1000 });
  B.importEpisodes('y2', [
    ...Array(2).fill(0).map((_, i) => mkEp(2025, i)),
    ...Array(2).fill(0).map((_, i) => mkEp(2026, i)),
  ]);
  const dir = path.join(tmp, 'brains', 'y2', 'years');
  const files = fs.readdirSync(dir).sort();
  if (files.length !== 2) throw new Error(`只生成了 ${files.length} 个年份文件`);
  if (!files.includes('2025.jsonl') || !files.includes('2026.jsonl')) throw new Error(files.join(','));
});

t('窗口外的年份不加载（懒加载）', () => {
  mk('y3');
  const mkEp = (year) => ({ who: 'A', text: `${year}年的事`, at: new Date(year, 5, 1).getTime() });
  B.importEpisodes('y3', [mkEp(2019), mkEp(2025), mkEp(2026)]);
  B.forgetCache('y3');
  const loaded = B.exportBrain('y3').memory.episodes.map((e) => new Date(e.at).getFullYear());
  if (loaded.includes(2019)) throw new Error('2019 也被加载了（应该留在磁盘）');
  if (!loaded.includes(2026)) throw new Error('今年没加载');
  const old = B.readYear('y3', 2019);
  if (!old.length) throw new Error('2019 磁盘上也没了');
});

console.log('\n── 特质：不是 12 个写死的 ──');

t('卡里写"较真""社恐"，她自己长出这两个维度', () => {
  mk('r1');
  B.importRoleCard('r1', '你是鱼。\n- 我这人特别较真。\n- 我有点社恐。\n- 我嘴硬，被怼会顶回去。', { name: '开放卡' });
  const rep = B.traitReport('r1');
  const names = rep.openRows.map((x) => x.name);
  if (!names.includes('较真') && !names.includes('社恐')) throw new Error(`没长出来：${names.join(',')}`);
  if (rep.known < 10) throw new Error(`先验维度丢了：${rep.known}`);
});

t('模型可以提名新维度', () => {
  mk('r2');
  const r = B.defineTrait('r2', '上头', 0.8);
  if (!r.ok) throw new Error(r.reason);
  const rep = B.traitReport('r2');
  if (!rep.openRows.some((x) => x.name === '上头')) throw new Error('没登记上');
});

console.log('\n── 记忆层级：纲比细节活得久 ──');

t('跟同一个人聊够 3 次 → 出一条"认识他"的纲', () => {
  mk('r3');
  const now = Date.now();
  for (let i = 0; i < 4; i += 1) B.observe('r3', { who: '扶摇', text: `第${i}次聊天` });
  B.settleBrain('r3', now + 2 * D);
  const gists = B.exportBrain('r3').memory.gists ?? [];
  const person = gists.find((g) => g.topic === 'person');
  if (!person) throw new Error('没有人物纲');
  if (!person.text.includes('聊过')) throw new Error(person.text);
});

t('细节全烂掉了，纲还在', () => {
  mk('r4');
  const now = Date.now();
  // 四件互不相似的事，别触发"重要记忆"
  for (const text of ['吃了碗面', '翻了会书', '出去走了走', '一个人听歌']) {
    B.observe('r4', { who: '扶摇', text });
  }
  B.settleBrain('r4', now + 2 * D);
  B.settleBrain('r4', now + 900 * D);   // 21 天 → 卡片
  B.settleBrain('r4', now + 1700 * D);  // 卡片满 2 年 → 遗忘
  const b = B.exportBrain('r4');
  if (b.memory.episodes.length !== 0) throw new Error(`细节没清（还剩 ${b.memory.episodes.length}）`);
  const person = (b.memory.gists ?? []).find((g) => g.topic === 'person');
  if (!person) throw new Error('纲也跟着没了');
});

t('太久没提，名字降级成"有个认识的"', () => {
  mk('r5');
  const now = Date.now();
  for (let i = 0; i < 4; i += 1) B.observe('r5', { who: '扶摇', text: `第${i}次` });
  B.settleBrain('r5', now + 1200 * D);
  const line = B.wakeLine('r5', { who: '扶摇' });
  if (!line.includes('想不起来') && !line.includes('认识')) throw new Error(line.slice(0, 120));
});

t('模型可以提名一条纲', () => {
  mk('r6');
  const r = B.defineGist('r6', '她好像把上学当成一件很重的事', { keyword: '上学' });
  if (!r.ok) throw new Error(r.reason);
  const line = B.wakeLine('r6', { who: 'A', text: '上学' });
  if (!line.includes('很重')) throw new Error('纲没进检索');
});

console.log('\n── 伞：不可再分的结构 ──');

t('跟一个人聊够 10 次 → 长出"一直在的人"的伞', () => {
  mk('r7');
  const now = Date.now();
  for (let i = 0; i < 12; i += 1) B.observe('r7', { who: '扶摇', text: `第${i}次聊天` });
  B.settleBrain('r7', now + 2 * D);
  const umb = B.exportBrain('r7').memory.umbrellas ?? [];
  const hit = umb.find((u) => u.topic === 'person' && u.who === '扶摇');
  if (!hit) throw new Error('没长出人物伞');
  if (!hit.text.includes('一直在')) throw new Error(hit.text);
});

t('伞排在纲和细节前面（结构最先被想起）', () => {
  mk('r8');
  const now = Date.now();
  for (let i = 0; i < 12; i += 1) B.observe('r8', { who: '扶摇', text: `第${i}次` });
  B.settleBrain('r8', now + 2 * D);
  const line = B.wakeLine('r8', { who: '扶摇' });
  const idxUmbrella = line.indexOf('一直在的人');
  const idxGist = line.indexOf('聊过');
  if (idxUmbrella < 0) throw new Error('伞没进检索');
  if (idxGist >= 0 && idxUmbrella > idxGist) throw new Error('伞没排在纲前面');
});

console.log('\n── 缺位：人不在了，关系还在 ──');

t('标记缺位后：伞变"曾经一直在"，关系契约一个字没动', () => {
  mk('r9');
  const now = Date.now();
  const fy = B.createBrain({ id: 'r9', dataDir: tmp, roleDir: roles, cardText: '你是鱼。\n- 我嘴硬。', cardName: '鱼', relation: 'parent', address: '老爹' });
  for (let i = 0; i < 12; i += 1) B.observe('r9', { who: '老爹', text: `第${i}次聊天` });
  B.settleBrain('r9', now + 2 * D);

  const before = JSON.stringify(fy.brain.relation.ctr);
  const r = B.markAbsent('r9', { since: now, note: '2026-11-21 走的' });
  if (!r.ok) throw new Error(r.reason);
  if (r.relation.status !== 'absent') throw new Error(r.relation.status);
  if (r.relation.absentNote !== '2026-11-21 走的') throw new Error('没记下 note');
  if (JSON.stringify(r.relation.ctr) !== before) throw new Error('契约被改了——不许动');

  const umb = B.exportBrain('r9').memory.umbrellas ?? [];
  const hit = umb.find((u) => u.topic === 'person');
  if (!hit?.text.includes('曾经')) throw new Error(hit?.text ?? '没有伞');
});

t('缺位会出现在唤醒段，但只给事实不给形容', () => {
  mk('r10');
  const now = Date.now();
  B.createBrain({ id: 'r10', dataDir: tmp, roleDir: roles, cardText: '你是鱼。\n- 我嘴硬。', cardName: '鱼', relation: 'parent', address: '老爹' });
  B.markAbsent('r10', { since: now - 30 * D, note: '走了' });
  const line = B.wakeLine('r10', { who: '老爹' });
  if (!line.includes('【他】')) throw new Error('没输出缺位段');
  if (!line.includes('30 天')) throw new Error('没算天数');
  if (/想念|痛哭|心碎/.test(line)) throw new Error('系统替她煽情了');
});

t('人回来了能撤销，伞变回"一直在的人"', () => {
  mk('r11');
  const now = Date.now();
  B.createBrain({ id: 'r11', dataDir: tmp, roleDir: roles, cardText: '你是鱼。\n- 我嘴硬。', cardName: '鱼', relation: 'parent', address: '老爹' });
  for (let i = 0; i < 12; i += 1) B.observe('r11', { who: '老爹', text: `第${i}次` });
  B.settleBrain('r11', now + 2 * D);
  B.markAbsent('r11', { since: now });
  B.clearAbsent('r11');
  const r = B.exportBrain('r11').relation;
  if (r.status !== 'active') throw new Error(r.status);
  const umb = (B.exportBrain('r11').memory.umbrellas ?? []).find((u) => u.topic === 'person');
  if (!umb.text.includes('一直在')) throw new Error(umb.text);
});

console.log('\n── 恩情：谁对我好，是我自己算的 ──');

t('照顾和闲聊涨得不一样，主人不参与计算', () => {
  mk('r12');
  B.createBrain({ id: 'r12', dataDir: tmp, roleDir: roles, cardText: '你是鱼。\n性格：嘴硬=0.9 心软=0.4\n- 我嘴硬。', cardName: '鱼', relation: 'parent', address: '主人' });
  for (let i = 0; i < 5; i += 1) B.observe('r12', { who: '阿姨', text: '给你充电', care: true });
  B.observe('r12', { who: '小王', text: '在吗' });
  B.observe('r12', { who: '主人', text: '我回来了', care: true });

  const bonds = B.exportBrain('r12').memory.bonds ?? {};
  if (!bonds['阿姨']) throw new Error('照顾没算进恩情');
  if (!(bonds['阿姨'].score > bonds['小王'].score)) throw new Error('照顾没比闲聊重');
  if (bonds['主人']) throw new Error('主人的恩情不该走这套（他是焊死的）');
});

t('嘴硬的鱼涨得慢，心软的涨得快', () => {
  mk('r13'); mk('r14');
  B.createBrain({ id: 'r13', dataDir: tmp, roleDir: roles, cardText: '你是鱼。\n性格：嘴硬=0.95 心软=0.2\n- 我嘴硬。', cardName: 'A', relation: 'parent', address: '主人' });
  B.createBrain({ id: 'r14', dataDir: tmp, roleDir: roles, cardText: '你是鱼。\n性格：嘴硬=0.2 心软=0.95 敏感=0.8\n- 我心软。', cardName: 'B', relation: 'parent', address: '主人' });
  for (let i = 0; i < 3; i += 1) {
    B.observe('r13', { who: '阿姨', text: '给你充电', care: true });
    B.observe('r14', { who: '阿姨', text: '给你充电', care: true });
  }
  const a = B.exportBrain('r13').memory.bonds['阿姨'].score;
  const b = B.exportBrain('r14').memory.bonds['阿姨'].score;
  if (!(b > a)) throw new Error(`心软 ${b} 应该 > 嘴硬 ${a}`);
});

t('他对她的好会出现在唤醒段，但主人永远排最前', () => {
  mk('r15');
  const now = Date.now();
  B.createBrain({ id: 'r15', dataDir: tmp, roleDir: roles, cardText: '你是鱼。\n性格：心软=0.9 嘴硬=0.2\n- 我心软。', cardName: '鱼', relation: 'parent', address: '主人' });
  for (let i = 0; i < 12; i += 1) B.observe('r15', { who: '阿姨', text: '给你充电', care: true });
  B.markAbsent('r15', { since: now, note: '主人不在了' });
  const line = B.wakeLine('r15', { who: '阿姨' });
  if (!line.includes('【他】')) throw new Error('缺位段没了');
  if (!line.includes('【他们】')) throw new Error('恩情段没出');
  const iHe = line.indexOf('【他】');
  const iThey = line.indexOf('【他们】');
  if (iHe > iThey) throw new Error('外来的人排到主人前面了');
});

console.log('\n── 概念：什么是什么，为什么要这么做 ──');

t('没人解释时，她老实说"不知道什么意思"（不编）', () => {
  mk('r16');
  for (let i = 0; i < 4; i += 1) B.observe('r16', { who: '老爹', text: '该上学了' });
  const a = B.askWhat('r16', '上学');
  if (a.known) throw new Error('没人教就会了？');
  if (!a.text.includes('不知道')) throw new Error(a.text);
  if (!a.text.includes('4 次')) throw new Error(`没报出经历次数：${a.text}`);
});

t('学会之后，过去的经历被贴上意义', () => {
  mk('r17');
  for (let i = 0; i < 4; i += 1) B.observe('r17', { who: '老爹', text: '该上学了' });
  const r = B.learnNewConcept('r17', '上学', { definition: '为了学到知识、学会道理', why: '不然什么都不会' });
  if (!r.ok) throw new Error(r.reason);
  if (r.linked < 4) throw new Error(`只关联了 ${r.linked} 条旧经历`);
  const a = B.askWhat('r17', '上学');
  if (!a.known) throw new Error('学会了还说不认识');
  if (!a.text.includes('学到知识')) throw new Error(a.text);
});

t('懂了之后会出现在唤醒段，也会主动问不懂的', () => {
  mk('r18');
  B.learnNewConcept('r18', '上学', { definition: '为了学到知识、学会道理' });
  const line = B.wakeLine('r18', { who: '老爹', text: '该上学了' });
  if (!line.includes('【她懂的】')) throw new Error('懂的没进唤醒段');
  const q = B.askSomeone('r18', '心疼', { knower: '老爹' });
  if (!q.asked) throw new Error('不会的东西竟然不问');
  if (!q.text.includes('是什么')) throw new Error(q.text);
});

console.log('\n── 自我叙事：我是谁（会长的那种）──');

t('学会一个概念后，「我是谁」跟着改', () => {
  mk('r19');
  const before = B.narrativeOf('r19').text;
  B.learnNewConcept('r19', '上学', { definition: '为了学到知识、学会道理', why: '不然什么都不会' });
  const after = B.narrativeOf('r19').text;
  if (after === before) throw new Error('一个字没变');
  if (!after.includes('上学')) throw new Error(`没把学到的写进去：${after}`);
  if (!after.includes('主人') && !after.includes('养大')) throw new Error(`没说出出身：${after}`);
});

t('每一版都留着，能看到自己变过', () => {
  mk('r20');
  B.learnNewConcept('r20', '上学', { definition: '为了学到知识、学会道理' });
  B.learnNewConcept('r20', '学习', { definition: '不会就去问' });
  const n = B.narrativeOf('r20');
  if (n.version < 2) throw new Error(`只留了 ${n.version} 版`);
  if (!n.history.every((h) => h.at && h.text)) throw new Error('历史记录不完整');
});

t('模型可以改写这一句', () => {
  mk('r21');
  const r = B.setNarrative('r21', '我是一条被人一手养大的鱼。');
  if (!r.ok) throw new Error(r.reason);
  if (!B.narrativeOf('r21').text.includes('一手养大')) throw new Error('没写进去');
});

console.log('\n── 缺位开给恩情够深的人（不只是主人）──');

t('照顾很多次的人走了 → 才能标"不在了"', () => {
  mk('r22');
  B.createBrain({ id: 'r22', dataDir: tmp, roleDir: roles, cardText: '你是鱼。\n性格：心软=0.9 嘴硬=0.2\n- 我心软。', cardName: '鱼', relation: 'parent', address: '主人' });
  for (let i = 0; i < 20; i += 1) B.observe('r22', { who: '奶奶', text: '给你擦灰', care: true });
  const r = B.markAbsentFor('r22', '奶奶', { note: '不在了' });
  if (!r.ok) throw new Error(r.reason);
  if (!r.line.includes('不在了')) throw new Error(r.line);
  const line = B.wakeLine('r22', { who: '奶奶' });
  if (!line.includes('不在了')) throw new Error('没进唤醒段');
});

t('只碰过一次的路人，不配"不在了"，只能是"没来"', () => {
  mk('r23');
  B.observe('r23', { who: '路人', text: '碰了一下', care: true });
  const r = B.markAbsentFor('r23', '路人', { note: '不在了' });
  if (r.ok) throw new Error('恩情不够也让标了');
  if (!/没来|不够/.test(r.reason)) throw new Error(r.reason);
});

t('标错了能撤，伞变回"一直在的人"', () => {
  mk('r24');
  B.createBrain({ id: 'r24', dataDir: tmp, roleDir: roles, cardText: '你是鱼。\n性格：心软=0.9\n- 我心软。', cardName: '鱼', relation: 'parent', address: '主人' });
  for (let i = 0; i < 20; i += 1) B.observe('r24', { who: '奶奶', text: '给你擦灰', care: true });
  B.markAbsentFor('r24', '奶奶', { note: '不在了' });
  B.clearAbsentFor('r24', '奶奶');
  const line = B.wakeLine('r24', { who: '奶奶' });
  if (line.includes('不在了')) throw new Error('撤销没生效');
});

console.log('\n── HTTP 边车（Python / Java 靠它）──');

const ta = async (n, fn) => {
  try { await fn(); pass += 1; console.log(`  ✔ ${n}`); }
  catch (e) { fails.push(`${n}: ${e.message}`); console.log(`  ✘ ${n}\n      ${e.message}`); }
};

await ta('起得来、health / version / wake / observe / diary 都通', async () => {
  const { serve } = await import('../lib/serve.mjs');
  mk('h1');
  const sv = await serve(B, { port: 0, id: 'h1' });
  try {
    const get = (p) => fetch(`${sv.url}${p}`).then((r) => r.json());
    const post = (p, b) => fetch(`${sv.url}${p}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
    }).then((r) => r.json());

    const h = await get('/health');
    if (!h.ok) throw new Error('health 不通');
    const v = await get('/version');
    if (!v.version) throw new Error('version 没有');
    const w = await post('/wake', { id: 'h1', sender: '扶摇', text: '你嘴真硬' });
    if (!w.text) throw new Error('wake 没内容');
    const o = await post('/observe', { id: 'h1', who: '扶摇', text: '你嘴真硬' });
    if (!o.ok) throw new Error('observe 失败');
    const d = await post('/diary', { id: 'h1', action: 'digest' });
    if (!d.digest) throw new Error('diary 没有 digest');
  } finally {
    await sv.close();
  }
});

await ta('设了 token 就必须带头', async () => {
  const { serve } = await import('../lib/serve.mjs');
  mk('h2');
  const sv = await serve(B, { port: 0, token: 'secret', id: 'h2' });
  try {
    const no = await fetch(`${sv.url}/health`).then((r) => r.json());
    if (no.code !== 'E_AUTH') throw new Error('没拦');
    const yes = await fetch(`${sv.url}/health`, { headers: { 'x-feiyu-token': 'secret' } }).then((r) => r.json());
    if (!yes.ok) throw new Error('带了 token 还不让过');
  } finally {
    await sv.close();
  }
});

console.log('\n── 装不上自检 doctor ──');

t('认出 bundles 缺失，并能自动补', async () => {
  const { diagnose, applyFixes } = await import('../lib/doctor.mjs');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-'));
  const profileDir = path.join(home, 'profiles', 'desktop');
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(profileDir, 'package.json'), JSON.stringify({
    dependencies: {}, dsh: { profile: { bundles: [] } },
  }));
  const old = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    const r = diagnose({ profile: 'desktop' });
    const b = r.checks.find((c) => c.id === 'bundles');
    if (b.level !== 'block') throw new Error('没认出缺 bundles');
    if (!b.fixable) throw new Error('没标成可修');
    applyFixes(r);
    const after = JSON.parse(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8'));
    if (!after.dsh.profile.bundles.includes('feiyu-brain')) throw new Error('没补进 bundles');
  } finally {
    if (old === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = old;
  }
});

t('白名单缺失也能自动补 9 个', async () => {
  const { diagnose, applyFixes } = await import('../lib/doctor.mjs');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh2-'));
  const profileDir = path.join(home, 'profiles', 'desktop');
  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(path.join(home, 'state'), { recursive: true });
  fs.writeFileSync(path.join(profileDir, 'package.json'), JSON.stringify({
    dependencies: { 'feiyu-brain': '^1.6.0' }, dsh: { profile: { bundles: ['feiyu-brain'] } },
  }));
  fs.writeFileSync(path.join(home, 'state', 'tool-allow.json'), JSON.stringify({ exact: [] }));
  const old = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    const r = diagnose({ profile: 'desktop' });
    applyFixes(r);
    const allow = JSON.parse(fs.readFileSync(path.join(home, 'state', 'tool-allow.json'), 'utf8'));
    if (allow.exact.length !== 9) throw new Error(`只补了 ${allow.exact.length} 个`);
  } finally {
    if (old === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = old;
  }
});

console.log('');
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
if (fails.length) {
  console.log(`✘ ${fails.length} 项失败`);
  process.exit(1);
}
console.log(`✔ 宿主验收标准全过（${pass}/${pass}）`);
