// 适配器总入口
//
// 一个大脑，两种接法：
//   老用户 → qq-bridge        （继续用你现在的桥接）
//   新用户 → tencent-official （腾讯官方机器人开放平台）
//   其他   → universal        （自带传输）
//
// 大脑本身不含任何平台代码——它只产出文本、只记录经历。

export { createBridgeAdapter } from './qq-bridge.js';
export { TencentOfficialAdapter, INTENTS } from './tencent-official.js';
export { createUniversalHost, normalizeEvent } from './universal.js';

export const ADAPTERS = {
  'qq-bridge': '老用户：SnowLuma / OneBot 桥接（宿主提供传输）',
  'tencent-official': '新用户：腾讯官方机器人开放平台（HTTP + WebSocket）',
  universal: '任意平台：自带传输，把消息变成 { sender, text, chatId } 即可',
};
