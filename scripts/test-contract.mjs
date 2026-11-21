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
  const raw = JSON.parse(fs.readFileSync(path.join(tmp, 'brains', 'c6b', 'brain.json'), 'utf8'));
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
  const raw = JSON.parse(fs.readFileSync(path.join(tmp, 'brains', 'c8', 'brain.json'), 'utf8'));
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

t('archive 策略：过期后进归档文件，脑里不再检索到', () => {
  B.configure({ ttl: 'archive' });
  mk('m7');
  const raw = JSON.parse(fs.readFileSync(path.join(tmp, 'brains', 'm7', 'brain.json'), 'utf8'));
  raw.memory.episodes.push({ id: 'old', kind: 'episode', what: '很久以前的秘密', at: 0, lastRecall: 0, consecutiveDays: 1, longTerm: false });
  fs.writeFileSync(path.join(tmp, 'brains', 'm7', 'brain.json'), JSON.stringify(raw));
  B.forgetCache('m7');
  B.settleBrain('m7', Date.now() + 400 * 86400000);
  const arch = path.join(tmp, 'brains', 'm7', 'archive.jsonl');
  if (!fs.existsSync(arch)) throw new Error('没有归档文件');
  if (!fs.readFileSync(arch, 'utf8').includes('很久以前的秘密')) throw new Error('归档里没有');
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
  const raw = JSON.parse(fs.readFileSync(path.join(tmp, 'brains', 'd4', 'brain.json'), 'utf8'));
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
  const raw = JSON.parse(fs.readFileSync(path.join(tmp, 'brains', 'd6', 'brain.json'), 'utf8'));
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

console.log('\n── 情绪双源仲裁 ──');

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
