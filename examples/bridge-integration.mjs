// 老用户示例：模拟一次"桥接唤醒"，看她会被注入什么。
//   node examples/bridge-integration.mjs
//
// 这个脚本不需要真桥接——它造一个和桥接同构的 st 对象。

import { createBridgeAdapter } from '../adapters/qq-bridge.js';
import * as brainApi from '../index.js';

const adapter = createBridgeAdapter({
  id: 'example', // 用独立 id，别污染线上那条鱼
  log: (m) => console.log(m),
  truncateText: (s, n) => String(s ?? '').slice(0, n),
});

// 桥接里会话状态的样子（只取适配器用得到的字段）
const st = {
  unread: [
    { seq: 101, sender: '扶摇', plain: '你嘴真硬啊，说你两句还顶回来', isSelf: false, time: Date.now() - 60000 },
    { seq: 102, sender: '访秋辞', plain: '别理她，她就这德行', isSelf: false, time: Date.now() - 30000 },
  ],
  recentMessages: [],
};

const line = adapter.buildBrainLine('group:1108462204', st, brainApi);
console.log('── 唤醒时插进 prompt 的那一段 ──');
console.log(line || '（空：适配器没产出，不影响桥接）');

console.log('\n── 她现在的状态 ──');
const snap = brainApi.snapshot('example');
console.log(JSON.stringify({
  styleName: snap.styleName,
  flow: snap.flow,
  memory: snap.memory,
  observations: snap.observations,
}, null, 2));
