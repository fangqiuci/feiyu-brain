# 新用户：腾讯官方机器人开放平台

> 适用：从零开始，不碰第三方桥接，直接走官方接口。
> ⚠️ 本适配器**未线上联调**（没有 appId/secret），字段以官方文档为准。
> 第一次接入请用 sandbox + 单个测试群验证。

---

## 为什么走官方

| | 第三方桥接 | 官方开放平台 |
|---|---|---|
| 协议来源 | 逆向/模拟客户端 | 官方公开 HTTP + WebSocket |
| 稳定性 | 平台一改就挂 | 有版本和公告 |
| 合规 | 风险自负 | 按平台条款走 |
| 消息类型 | 全 | 受审核和额度限制 |

**代价是自由度**：官方机器人只能收到被 @ 的消息、有主动消息额度、要过审核。这些是规则，不是 bug。

---

## 一、拿凭证

1. 去 QQ 开放平台注册开发者、创建机器人应用
2. 拿到 `appId` 和 `clientSecret`
3. 在后台开启你需要的 intents（群消息 / 私聊消息）
4. 把机器人拉进测试群

---

## 二、接上大脑

```js
import { createBrain } from 'feiyu-brain';
import { TencentOfficialAdapter, INTENTS } from 'feiyu-brain/adapters/tencent-official';

const brain = createBrain({
  id: 'default',
  dataDir: './data',
  roleDir: './roles',
  relation: 'parent',
  address: '老爹',
});

const bot = new TencentOfficialAdapter({
  appId: process.env.QQ_APP_ID,
  clientSecret: process.env.QQ_CLIENT_SECRET,
  intents: INTENTS.GROUP_AND_C2C,
  log: console.log,
});

bot.onMessage(async (event) => {
  // 1. 拿"此刻的她"（内部会顺手让她经历这条消息）
  const { text: personaBlock } = brain.wake(event);

  // 2. 交给你的模型——这段就是注入点
  const reply = await callYourLLM([
    personaBlock,
    '你是群里的一个普通群友。回复要短，1~10 字，不要客服腔。',
    `群友「${event.sender}」说：${event.text}`,
  ].join('\n\n'));

  // 3. 被动回复（带 msg_id，官方要求）
  await bot.reply(event, reply);
});

await bot.start();
```

`callYourLLM` 换成你自己的（DeepSeek / 通义 / 本地模型都行）。**本包不绑定任何模型。**

---

## 三、三条必须知道的规则

### 1. 被动回复有窗口

官方要求：收到消息后在一段时间内、带着 `msg_id` 回复。
超时就只能走**主动消息**，而主动消息有额度和审核。

`bot.reply(event, text)` 已经自动带上 `event.sourceMsgId`。

### 2. 群聊里只能收到 @ 她的消息

所以 `GROUP_AT_MESSAGE_CREATE` 映射出来的事件 `isAtMe = true`。
这意味着**她"潜水看群"这件事在官方接口下是不成立的**——收不到没 @ 她的消息。

大脑里"注意闸门"那套在这儿会退化。这是平台限制，不是设计问题。
如果以后官方开放了全量群消息，改一行映射就行。

### 3. 一条回复可以分多条

官方建议一条 `msg_id` 下用不同的 `msg_seq` 发多条（对应"她一句话一条消息"的习惯）：

```js
for (const [i, line] of ['先说这句', '再补一句'].entries()) {
  await bot.reply(event, line, i + 1);
}
```

别刷屏。

---

## 四、部署

```bash
# 最简：一个常驻进程
node examples/tencent-bot.mjs
```

用 systemd / pm2 / Windows 服务托管。**断开会自动 5 秒重连**（适配器里写好了）。

---

## 五、检查清单

- [ ] `appId` / `clientSecret` 从环境变量读，不进代码仓库
- [ ] 先在一个测试群验证 @ 回复
- [ ] 确认 `msg_id` 回复在窗口内
- [ ] 主动消息额度够不够（她"主动开口"会消耗额度）
- [ ] 人设卡放好：`roles/<名字>.md`
- [ ] `npx feiyu status` 能看到她

---

## 六、和"老用户"的差别

| | 老用户（桥接） | 新用户（官方） |
|---|---|---|
| 大脑 | **完全一样** | **完全一样** |
| 数据 | `brain.json` 可以直接拷过来 | 同左 |
| 差别 | 传输层 | 传输层 |

**她换了身体，还是她。** 这就是把大脑和传输分开的意义。
