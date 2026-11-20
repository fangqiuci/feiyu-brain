# feiyu-brain · 大肥鱼的大脑

> **人设是根，其余都是长出来的。**

一个**平台无关**的认知内核。给它一张人设卡，它长出一条有记忆、有情绪、会发呆、会嘴硬的鱼。

它**不会说话**——说话是"身体"的事。它只做两件事：

- 唤醒时，产出该拼进 prompt 的那一段（`【此刻的她】…`）
- 经历时，让她的权重、记忆、情绪动一动

**换一个身体（QQ 桥接 / 腾讯官方 / 你自己的平台），大脑一行不动。**

---

## 安装

```bash
npm i feiyu-brain
```

或者直接把仓库里的 `plugins/feiyu-brain/` 拷走。

Node ≥ 20。零依赖。

---

## 两种接法

| 你是谁 | 用哪个 | 说明 |
|---|---|---|
| **老用户**，还在跑自己的桥接 | `adapters/qq-bridge` | 桥接不用改，插一段进 prompt 就行 |
| **新用户**，走腾讯官方 | `adapters/tencent-official` | 官方开放平台，HTTP + WebSocket |
| 其他平台 | `adapters/universal` | 你能把消息变成 `{sender,text,chatId}` 就行 |

⚠️ 本包**不含任何平台协议实现**，也**不内置任何桥接**。它只是脑子。
详见 [docs/COMPLIANCE.md](docs/COMPLIANCE.md)。

---

## 30 秒上手

```js
import { createBrain } from 'feiyu-brain';

const fy = createBrain({
  id: 'default',
  dataDir: './data',          // 她的档案放哪
  roleDir: './roles',         // 人设卡目录（roles/辞辞.md）
  relation: 'parent',
  address: '老爹',
});

// 她看到一条消息 → 拿到该注入 prompt 的那段
const { text } = fy.wake({
  sender: '扶摇',
  text: '你嘴真硬啊',
  chatId: 'group:123',
});

console.log(text);
// 【此刻的她】你是 DeepSeek 的鲸鱼形象，网友口中的「小鲸鱼」…
// 【想到的】
// 扶摇：嘴毒但人不坏（互动 3 次）

// 每天跑一次：衰减、遗忘、蜕皮
fy.tick();
```

`text` 拼进你模型 system prompt 的任何位置都行。**建议放在靠前**——先知道"我是谁"，再谈"现在几点"。

---

## 大脑里有什么

| 器官 | 它做什么 |
|---|---|
| **人设** | 从卡里抽成 77 条带权重的命题；行为一致 +0.01，冲突 −0.01，掉到 0.15 就蜕皮成"我以前……" |
| **记忆** | 30 天窗口；提起续命；连续被提 15 天升级长期；忘了就是真的没有 |
| **情绪** | PAD 三轴（愉悦/唤醒/掌控）；不会命名 → 会命名 → 自己总结 |
| **意识流** | 休眠 / 发呆 / 正常 / 走神 / 幻想，一条轴五档 |
| **自知** | 四种方向的份量（aware/denial/fixed/naive），从人设算出来，不是选格子 |
| **归因** | 不审批，只贴标签：有据 / 即兴 / 硬撑 / 明知故犯 / 说不清 |
| **关系** | 只管"谁进意识"，不管"怎么回" |
| **身体** | 手机 / 平板 / 电脑，三具可插拔；L1~L4 权限；没证据的操作不算发生 |

---

## 唯一的验收标准

> **同一件事，换一条人设，她的反应会不会变？**

```
100 条不同人设，同一情境（被吵醒）：
  反应种类 70 / 100
  自知配方 100 / 100
```

不变 = 硬编码 = 那不是鱼，是壳。

```bash
npx feiyu spread
```

---

## 数据

```
<dataDir>/brains/<id>/
├── brain.json      人设命题 + 记忆 + 状态 + 自我认知
└── audit.jsonl     出生 / 蜕皮 / 归因 / 导入导出
```

一条鱼一个目录。**你可以把整个目录拷走，她就是她。**

---

## CLI

```bash
npx feiyu status          # 她什么状态
npx feiyu brief           # 此刻的她（唤醒注入的那段）
npx feiyu observe 扶摇 "你嘴真硬"
npx feiyu settle          # 每日结算
npx feiyu spread          # 派生检验
npx feiyu audit 20
npx feiyu rebirth parent 老爹
```

---

## 文档

- [docs/MIGRATION.md](docs/MIGRATION.md) —— 老用户：桥接怎么接
- [docs/PLATFORM.md](docs/PLATFORM.md) —— 新用户：腾讯官方怎么接
- [docs/BODY.md](docs/BODY.md) —— 手机 / 平板 / 电脑：权限与证据
- [docs/COMPLIANCE.md](docs/COMPLIANCE.md) —— 边界与合规
- [docs/PUBLISH.md](docs/PUBLISH.md) —— 发布清单

---

## 已知边界

- **特质提取的精度取决于人设卡。** 一张"怎么说话"的卡抽出来偏窄（嘴硬 1.00、好奇 0.15）。要更准，给她一张"她是什么人"的卡。
- **腾讯官方适配器未线上联调**（没有 appId/secret）。字段以官方文档为准，先 sandbox 单群验证。
- **身体层只有抽象，没有驱动。** 手机/平板/电脑的"能做什么、该用哪具、权限够不够"已经写好了；真去开 App 要宿主自己接 ADB / 桌面自动化。

---

## 许可证

MIT。
