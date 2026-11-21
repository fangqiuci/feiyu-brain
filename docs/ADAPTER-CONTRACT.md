# 适配器契约 · qq-bridge（SnowLuma / OneBot）

> 这份文档存在的原因：有人照着示例接线，因为 `recentMessages` 没有 `seq`，
> 大脑**静默地**不再长大，而 `feiyu_status` 一切正常。这个坑不该踩第二次。

---

## 一、宿主需要提供什么

`buildBrainLine(key, st, brain)` 和 `drainUnread(key, st, brain)` 都读同一个 `st`：

```js
st = {
  unread: [],           // 可选，强烈建议有
  recentMessages: [],   // 可选，通常有，但常常没有 seq
}
```

### 消息字段

| 字段 | 必填 | 说明 | 缺了会怎样 |
|---|---|---|---|
| `sender` / `nickname` | 建议 | 谁说的，用于"对这个人有没有印象" | 记为无名 |
| `text` / `plain` / `tail` | **是** | 说了什么 | 这条被跳过（`skipped`） |
| `seq` | 否 | 单调递增序号，最好的去重键 | 退到下一级 |
| `messageId` | 否 | 消息 id，第二优先 | 退到下一级 |
| `time` | **强烈建议** | 毫秒时间戳，第三优先 + 排序用 | 没有去重键 → 契约告警 |
| `isSelf` | 否 | 是不是她自己发的 | 默认 false，可能把自己的话记成经历 |

**去重键优先级**：`seq` → `messageId` → `time + 前16字`。

三级都拿不到时，这条**不会**被静默丢弃——会记一条 `contractWarning`：

```js
ad.warnings()      // → [{ at, code: 'E_NO_NEW_KEYS', detail }]
```

宿主可以把这个数组挂到自己的 `/status` 接口上。**"没长大"不该是玄学。**

---

## 二、两个入口

### `drainUnread(key, st, brain, { limit })`

把 `st.unread + st.recentMessages` 里**没经历过的**按时间升序逐条 `observe`。

```js
const r = ad.drainUnread('group:123', st, brain);
// → { observed: 7, skipped: 0, merged: 0, remaining: 0, ok: true }
```

- `observed` 真正进记忆的条数
- `skipped` 有键但没正文，跳过的条数
- `merged` 超过 `limit` 时被合并成一条「补看」的条数
- `remaining` 合并后还剩多少没处理

默认 `limit = 20`（构造适配器时 `createBridgeAdapter({ limit })` 可改）。

### `buildBrainLine(key, st, brain)`

唤醒时调一次：内部先 `drainUnread`，再产出要拼进 prompt 的那一段。永远不抛，失败返回空串。

---

## 三、验收标准（改完照这个测）

| # | 场景 | 期望 |
|---|---|---|
| 1 | `recentMessages` 只有 `time`，没有 `seq` | 必须产生一条 episode |
| 2 | 一次给 10 条 unread | 10 条（或 1 条合并 + 明确说明），不能只 1 条且无提示 |
| 3 | 同一条消息重复喂 | 不重复经历 |
| 4 | 拿不到去重键 | `warnings()` 里有记录，不静默 |
| 5 | 超过 limit | `merged > 0`，且合并的那条正文写明"补看 N 条" |

这五条在 `scripts/test-contract.mjs` 里都有对应用例，`npm test` 会跑。

---

## 四、常见误接

| 症状 | 原因 | 修法 |
|---|---|---|
| `feiyu_status` 正常，但权重永远不动 | 宿主没有传 `st`，或 `st` 里没有消息 | 确认 `buildBrainLine` 拿到了当前会话的 `st` |
| 只在第一次有反应，后面都像没听见 | 用了旧版 `observeOnce`（只取最新一条 + 只认 seq） | 升级到 1.6+，改用 `drainUnread` |
| 权重乱跳 | 同一个 `st` 被 `buildBrainLine` 和手动 `observeOnce` 各调一次 | 只留一个入口 |
| 记忆里出现她自己的话 | `isSelf` 没标 | 宿主侧补上 |

---

## 五、影子模式（试跑不伤人设）

```js
const brain = createBrain({ id: 'fy-test', dataDir, roleDir, cardText, shadow: true })
```

- `observe` 只写 `audit.jsonl`，**不动权重、不进记忆、不落盘**
- 返回 `{ shadow: true, wouldChange: [{ id, from, to }] }` —— 直接能看到"如果真接会长成什么样"
- `feiyu_status` 里 `runtime.shadow` 会显示 `true`

跑够一百轮，看 `wouldChange` 和自己的预期对不对，再关掉 shadow 正式接。
