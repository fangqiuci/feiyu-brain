// 适配器契约测试：两种接入方式都必须成立。
//   node test-adapters.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { createBridgeAdapter } from './adapters/qq-bridge.js';
import { createUniversalHost } from './adapters/universal.js';
import { TencentOfficialAdapter } from './adapters/tencent-official.js';
import { normalizeEvent } from './core/event.js';

let pass = 0;
const fails = [];
function t(name, fn) {
  try { fn(); pass += 1; console.log(`  ✔ ${name}`); }
  catch (e) { fails.push({ name, msg: e.message }); console.log(`  ✘ ${name}\n      ${e.message}`); }
}

console.log('\n── 通用事件协议 ──');
t('任何平台的字段都能归一化成同一种事件', () => {
  const a = normalizeEvent({ sender: 'A', text: 'hi', chatId: 'group:1' }, 'x');
  const b = normalizeEvent({ userName: 'A', content: 'hi', channelId: 'group:1' }, 'y');
  assert.equal(a.sender, b.sender);
  assert.equal(a.text, b.text);
  assert.equal(a.chatId, b.chatId);
});

t('自己的消息不算经历', () => {
  const ev = normalizeEvent({ sender: '我', text: 'x', isSelf: true });
  assert.equal(ev.isSelf, true);
});

console.log('\n── 老用户：桥接适配器 ──');
const fakeBrainApi = {
  observe: (id, ev) => ({ ok: true, id, who: ev.sender }),
  wakeLine: (id, ev) => `【此刻的她】测试鱼（who=${ev?.sender ?? '-'}）`,
};

t('桥接状态 → 注入段', () => {
  const ad = createBridgeAdapter({ log: () => {}, id: 'default' });
  const st = { unread: [{ seq: 3, sender: '扶摇', plain: '你嘴真硬' }], recentMessages: [] };
  const line = ad.buildBrainLine('group:1', st, fakeBrainApi);
  assert.match(line, /【此刻的她】/);
  assert.ok(line.endsWith('\n\n'));
});

t('同一条消息不重复"经历"', () => {
  let count = 0;
  const api = { observe: () => { count += 1; }, wakeLine: () => 'x' };
  const ad = createBridgeAdapter({ log: () => {} });
  const st = { unread: [{ seq: 7, sender: 'A', plain: 'a' }], recentMessages: [] };
  ad.buildBrainLine('k', st, api);
  ad.buildBrainLine('k', st, api);
  assert.equal(count, 1, `观察了 ${count} 次`);
});

t('桥接崩溃不会连带崩溃', () => {
  const broken = { observe: () => { throw new Error('boom'); }, wakeLine: () => { throw new Error('boom'); } };
  const ad = createBridgeAdapter({ log: () => {} });
  const st = { unread: [{ seq: 9, sender: 'A', plain: 'a' }], recentMessages: [] };
  assert.equal(ad.buildBrainLine('k2', st, broken), '');
});

console.log('\n── 新用户：腾讯官方适配器 ──');
t('缺 appId/secret 立刻报错（不静默失败）', () => {
  assert.throws(() => new TencentOfficialAdapter({}), /appId/);
});

t('群 @ 消息映射正确', () => {
  const bot = new TencentOfficialAdapter({ appId: '1', clientSecret: 's', log: () => {} });
  const ev = bot.toBrainEvent('GROUP_AT_MESSAGE_CREATE', {
    id: 'msg1', content: ' 你好 ', group_openid: 'G1', author: { member_openid: 'M1' }, timestamp: 1700000000000,
  });
  assert.equal(ev.chatKind, 'group');
  assert.equal(ev.chatId, 'group:G1');
  assert.equal(ev.text, '你好');
  assert.equal(ev.isAtMe, true);
});

t('私聊消息映射正确', () => {
  const bot = new TencentOfficialAdapter({ appId: '1', clientSecret: 's', log: () => {} });
  const ev = bot.toBrainEvent('C2C_MESSAGE_CREATE', {
    id: 'msg2', content: '在吗', author: { user_openid: 'U1' },
  });
  assert.equal(ev.chatKind, 'private');
  assert.equal(ev.chatId, 'private:U1');
  assert.equal(ev.text, '在吗');
});

t('未支持的事件返回 null（不瞎猜）', () => {
  const bot = new TencentOfficialAdapter({ appId: '1', clientSecret: 's', log: () => {} });
  assert.equal(bot.toBrainEvent('AT_MESSAGE_CREATE', {}), null);
});

console.log('\n── 任意平台：通用宿主 ──');
t('handle 返回注入段 + 事件', () => {
  const calls = [];
  const brain = {
    wake: (ev) => { calls.push(ev); return { text: `【此刻的她】x` }; },
  };
  const host = createUniversalHost({ brain, buildSystemPrompt: (seg) => `SYS\n${seg}` });
  const r = host.handle({ sender: 'A', text: 'hi', chatId: 'group:1' });
  assert.match(r.system, /^SYS/);
  assert.equal(calls.length, 1);
});

console.log('\n── 打包边界 ──');
t('package.json 可发布（不私藏依赖、声明 exports）', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
  assert.ok(pkg.name);
  assert.equal(pkg.private, undefined);
  assert.ok(pkg.exports['.']);
  assert.ok(pkg.files.includes('adapters/'));
});

t('adapters 目录里有三种接法', () => {
  const dir = new URL('./adapters/', import.meta.url);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
  for (const need of ['index.js', 'qq-bridge.js', 'tencent-official.js', 'universal.js']) {
    assert.ok(files.includes(need), `缺 ${need}`);
  }
});

console.log(`\n${'─'.repeat(40)}`);
console.log(`通过 ${pass} 项，失败 ${fails.length} 项`);
if (fails.length) {
  for (const f of fails) console.log(`  ✘ ${f.name}: ${f.msg}`);
  process.exit(1);
}
console.log('全部通过 ✔');
