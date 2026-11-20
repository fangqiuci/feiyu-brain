# 老用户：接你自己的桥接

> 适用：还在跑 SnowLuma / OneBot 那套桥接的人。
> 你做你的传输，大脑只负责"她是谁"。

---

## 它做什么

桥接每次唤醒 AI，都会拼一段 prompt。你只需要在这段 prompt 里**多插一行**：

```
【此刻的她】你是 DeepSeek 的鲸鱼形象…（≤300 字）
```

再加一个动作：她"看到"一条消息时，告诉大脑一声（权重会动）。

**桥接的其它部分一行都不用改。**

---

## 三步

### 1. 装

```bash
npm i feiyu-brain
```

### 2. 创建适配器

```js
import { createBridgeAdapter } from 'feiyu-brain/adapters/qq-bridge';

const adapter = createBridgeAdapter({
  id: 'default',
  log: (m) => console.log(m),
  truncateText: (s, n) => String(s).slice(0, n),
});
```

### 3. 在拼 prompt 的地方插一行

```js
// 原来：
const base = roleLine + identityLine + tokenLine + antiAiLine + ... + timeSenseLine;

// 现在：
const brainLine = adapter.buildBrainLine(key, st, brainApi);
const base = roleLine + identityLine + tokenLine + brainLine + antiAiLine + ... + timeSenseLine;
```

`st` 就是你桥接里那个会话状态对象（有 `unread` / `recentMessages` / `seq` / `sender` 的那个）。

**位置建议放前面**：先知道"我是谁"，再判断"现在几点了"。

---

## 它保证三件事

| 保证 | 怎么做的 |
|---|---|
| **永不断链** | `buildBrainLine` 内部全 try/catch，失败返回空串——没有内心也要能说话 |
| **不会重复记账** | 同一个 `seq` 只"经历"一次（内存里记水位） |
| **定长** | brief ≤300 字 + 记忆 ≤800 token，不随对话增长 |

---

## 数据放在哪

默认跟包同级的 `state/brains/`。想指定：

```js
import { configure } from 'feiyu-brain';
configure({ dataDir: 'D:/bots/feiyu-data', roleDir: 'D:/bots/roles' });
```

或环境变量：

```bash
FEIYU_DATA_DIR=D:/bots/feiyu-data
FEIYU_ROLE_DIR=D:/bots/roles
```

---

## 验证接对了

```bash
npx feiyu status
```

应该看到：

```
鱼：default   人设卡：辞辞   出生：...
自知：denial  (aware 0.11 / denial 0.63 / fixed 0.13 / naive 0.13)
命题：77 条，身份 3 条
```

然后往群里发一条消息，看她的 prompt 里有没有多出 `【此刻的她】`。

---

## 常见问题

**Q：桥接里没有 `st` 对象怎么办？**
用通用适配器，自己组事件：

```js
import { createUniversalHost } from 'feiyu-brain/adapters/universal';
const host = createUniversalHost({ brain: createBrain({...}) });
const { system } = host.handle({ sender, text, chatId });
```

**Q：会不会让她的回复变慢？**
不会。大脑是纯本地计算，单次 < 5ms，不调模型。

**Q：会不会把她的性格改坏？**
不会。人设卡是只读的种子；权重怎么变都改不到身份和关系。跑偏了用 `npx feiyu rebirth` 重开。

**Q：原来的桥接被平台起诉了，还能用吗？**
那是**传输层**的事，与本包无关。本包只是脑子，接入哪个身体由你决定，也由你承担对应责任的合规判断。
