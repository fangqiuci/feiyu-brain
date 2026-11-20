// 新用户示例：腾讯官方机器人 + 大脑
//   QQ_APP_ID=xxx QQ_CLIENT_SECRET=xxx node examples/tencent-bot.mjs
//
// 没配凭证时只打印用法，不会尝试连接。
// 真实使用时把 callYourLLM 换成你自己的模型调用。

import { createBrain } from '../index.js';
import { TencentOfficialAdapter, INTENTS } from '../adapters/tencent-official.js';

const appId = process.env.QQ_APP_ID;
const clientSecret = process.env.QQ_CLIENT_SECRET;

if (!appId || !clientSecret) {
  console.log(`用法：
  QQ_APP_ID=你的appId QQ_CLIENT_SECRET=你的secret node examples/tencent-bot.mjs

说明：
  1. 去 QQ 开放平台创建机器人，拿到 appId / clientSecret
  2. 开启群/C2C 消息 intents
  3. 把机器人拉进测试群，@ 它说话
  4. 本示例用 echo 当模型——真接入时把 callYourLLM 换掉`);
  process.exit(0);
}

const brain = createBrain({
  id: 'default',
  roleDir: './roles',
  relation: 'parent',
  address: '老爹',
});

async function callYourLLM(prompt) {
  // TODO: 换成你的模型。这里只做占位，证明注入点在哪。
  return `（模型未接：收到 ${prompt.length} 字上下文）`;
}

const bot = new TencentOfficialAdapter({
  appId,
  clientSecret,
  intents: INTENTS.GROUP_AND_C2C,
  log: (m) => console.log(m),
});

bot.onMessage(async (event) => {
  console.log(`[收到] ${event.sender}: ${event.text}`);

  // ① 拿"此刻的她"（内部会顺手让她经历这条消息）
  const { text: personaBlock } = brain.wake(event);

  // ② 拼 prompt —— 这一段就是接入点
  const prompt = [
    personaBlock,
    '你是群里的一个普通群友。回复要短，1~10 字，不要客服腔。',
    `群友「${event.sender}」说：${event.text}`,
  ].join('\n\n');

  // ③ 交给模型
  const reply = await callYourLLM(prompt);

  // ④ 被动回复（自动带 msg_id）
  await bot.reply(event, reply);
});

console.log('[tencent] 正在连接…');
await bot.start();
