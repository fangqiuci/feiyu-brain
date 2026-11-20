// 集成冒烟：完全按 bridge.js 的调用方式跑一遍。
//   node smoke.mjs
// 验证：插件能被桥接 import、wakeLine 能生成、不抛异常、长度可控。

import * as brain from './index.js';

const ID = 'smoke';

// 第一次（会现场出生，等同桥接首启）
const first = brain.wakeLine(ID, { who: '扶摇', words: ['嘴硬', '推荐'] });
console.log('── 第一次唤醒注入 ──');
console.log(first);
console.log(`\n长度：${first.length} 字符`);

// 模拟桥接连续几条消息
for (const [who, text] of [
  ['扶摇', '你真是又嘴硬又爱怼人'],
  ['访秋辞', '给我推荐点东西呗'],
  ['许璐', '这鱼今天怎么这么收敛'],
]) {
  brain.observe(ID, { text, who, what: text, via: 'chat' });
}

const snap = brain.snapshot(ID);
console.log('\n── 快照 ──');
console.log(JSON.stringify({
  styleName: snap.styleName,
  style: snap.style,
  briefChars: snap.briefChars,
  flow: snap.flow,
  weights: { count: snap.weights.count, identity: snap.weights.identity },
  memory: snap.memory,
  observations: snap.observations,
  invariants: snap.invariants,
}, null, 2));

if (snap.invariants.length) {
  console.error('\n✘ 不变量违规');
  process.exit(1);
}
console.log('\n✔ 冒烟通过');
