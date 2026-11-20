# feiyu-brain · 功能清单

> 一份把代码里所有能用的东西列全的说明书。
> 对外叫 **1.4**（npm 上的 latest 是 1.4.1，属同一版，修了首跑体验）· MIT · 零依赖 · Node ≥ 20

---

## 一、它是什么

**一个认知内核。** 输入一张人设卡，输出"此刻的她"和她的状态变化。

```
人设卡（roles/辞辞.md）
        ↓  抽取
   77 条带权重的命题
        ↓  经历
  权重 ±0.01 / 记忆进一条
        ↓  唤醒
【此刻的她】你是 DeepSeek 的鲸鱼形象……
【手上的东西】自己的手机（竖屏，躺着 / 走着）
【想到的】扶摇说过「你嘴真硬」，我当时有点得意
```

**它不生成对话。** 对话由宿主自己的模型完成——它只负责"她是谁、她记得什么、她现在什么状态"。

---

## 二、两种形态

| 形态 | 入口 | 给谁 |
|---|---|---|
| **库** | `import { createBrain } from 'feiyu-brain'` | 自己写宿主的人 |
| **DSH 插件** | `dsh plugin add feiyu-brain` | 想直接让模型调用的人 |

同一个包，`main` 指向插件入口，插件入口 `export *` 回库——两种用法互不影响。

---

## 三、6 个 DSH 工具
### 1. `feiyu_status`

看她的状态。**只读，不改变任何东西。**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 否 | 鱼的 id，默认 `default` |

返回：

```
🐟 default · 人设卡 辞辞
自知   denial（aware 11.4% / denial 63.2% / fixed 12.5% / naive 12.9%）
意识流 正常（1）
身体   手机（竖屏，躺着 / 走着，owned）
命题   77 条（身份 3 条，总权重 58.6）
记忆   经历 3 / 印象 3 / 幻想 0 / 蜕皮 0 / 遗忘 0
观察   3 次

权重最高的五条：
  u004  0.85  别人叫你"大肥鱼"你会嘴硬否认……
  ...

不变量：全部通过 ✔
```

同时返回结构化 `snapshot`（人设 traits、style、weights、memory 计数、不变量违规列表）。

### 2. `feiyu_wake`

取"此刻的她"——**一段可直接拼进 system prompt 的定长文本**。不记录经历。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 否 | 鱼的 id |
| `sender` | string | 否 | 当前说话的人，用于检索「对他的记忆」 |
| `text` | string | 否 | 他说的话，用于关键词检索 |

返回 `{ ok, text, chars }`。定长：brief ≤300 字 + 记忆 ≤900 字。

### 3. `feiyu_observe`

让她"经历"一件事。**这是她长大的唯一途径**——不调用，人设永远不变。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 否 | 鱼的 id |
| `who` | string | 否 | 和谁发生的 |
| `text` | string | **是** | 发生了什么 |
| `feel` | string | 否 | 她当时的感受 |

副作用：

- 相关命题权重 `+0.01`，冲突命题 `-0.01`
- 权重掉到 `0.15` 以下 → 蜕皮成"我以前……"
- 记忆里进一条 episode
- 印象里的互动次数 `+1`

返回「一致 N 条 / 冲突 M 条」——**没匹配到任何命题时会明说「人设不动」**，不会假装有效。

### 4. `feiyu_tick`

每日结算。幂等，一天跑多次也只结算一次。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 否 | 鱼的 id |

做三件事：**衰减**（`×0.999/天`）、**遗忘**（TTL 到期进 `forgotten`）、**蜕皮**（权重到底的沉进 `formerSelves`）。

### 5. `feiyu_feel`

让她对一件事产生感受。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 否 | 鱼的 id |
| `valence` | number | **是** | 这件事对她好不好，-1 ~ 1 |
| `intensity` | number | 否 | 强度，0 ~ 1 |
| `what` | string | 否 | 发生了什么 |

做两件事：先算 PAD，再找词。

```
PAD 三维
  掌控感 = f(energy, 嘴硬, 自信, 疲劳)   ← 决定她是生气还是委屈
  唤醒度 = f(intensity, 敏感)
  愉悦度 = f(valence, 敏感)
        ↓
在已学会的词里找最近的原型（半径 0.42）
  半径内   → 「我有点委屈」
  两倍内   → 「我委屈，但跟以前那种不太一样」
  两词之间 → 「说不清，有点像委屈，又有点像烦」
  找不到   → 「我不知道这是什么感觉，就是很不舒服」
```

**词表空的时候她只会说最后那句——这是设计，不是 bug。**

### 6. `feiyu_app`

让她真的动起来。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 否 | 鱼的 id |
| `action` | string | **是** | `open` / `screenshot` / `uninstall` |
| `package` | string | 否 | Android 包名，如 `com.ss.android.ugc.aweme` |
| `target` | string | 否 | 电脑上要启动的程序 |
| `why` / `consequence` | string | 否 | 卸载的 Q1 / Q3 |

- 手机 / 平板 / 模拟器 → **adb**：`monkey` 开 App、`screencap` 截屏、`uninstall` 卸载
- 电脑 → **PowerShell**：`Start-Process` 启动、`System.Drawing` 截屏
- 电脑上**禁止卸载**（`E_FORBIDDEN`）——太不可逆，必须人来做
- 每个动作写一条 evidence（截图文件 / `adb:uninstall:pkg`），**没有证据不算发生**

---

## 四、八个核心机制

### 1. 人设：从卡里长出来

| 函数 | 干什么 |
|---|---|
| `extractTraits(cardText)` | 用 10 个特质的词典卡，数出 0~1 的倾向向量（嘴硬 / 心软 / 好奇 / 好动 / 敏感 / 固执 / 自信 / 爱反思 / 理性 / 社交） |
| `extractUnits(cardText)` | 把卡里每条 bullet / 编号 / 引用 / 散文行抽成**命题**，分四类：`identity`（权重 1，永不衰减）/ `constraint`（0.85）/ `preference`（0.7）/ `trait`（0.6） |
| `birthFromCard(cardText)` | 上面两个一起跑 |

**同一张卡永远抽出同一组值**（确定性，可回放）；换一张卡就长出另一条鱼。

### 2. brief：她现在的样子

`brief(units, {maxChars=300})`

- 按 `kind` 分层：身份 → 性格 → 偏好 → 约束
- 每条压成一句短话（去括号、取首个分句、过长才截）
- 用二元组相似度去重（防止「本体是……」出现两遍）
- 硬上限 300 字

### 3. 权重演化：不知不觉

| 常量 | 值 | 含义 |
|---|---|---|
| `WEIGHT_STEP` | 0.01 | 每次 ±0.01，**100 次才看得出来** |
| `DAILY_DECAY` | 0.999 | 每天自然褪色 |
| `SHED_THRESHOLD` | 0.15 | 低于此值蜕皮 |

`identity` 类**永不衰减、永不蜕皮**——身份不能忘。

### 4. 记忆：30 天窗口

| 类型 | 半衰期 | 谁定 |
|---|---|---|
| `episode`（情景） | 30 天 | `TTL_DAYS.episode` |
| `imagination`（幻想） | 30 天 | 独立池，永不进 episodes |
| `impression`（印象） | 90 天 | `TTL_DAYS.impression` |
| `fact` / `taste` | 不衰减 | `Infinity` |

- **提起续命**：`recall()` 重置 `lastRecall`
- **连续 15 天被提 → 升级 longTerm**，不再衰减（`PROMOTE_DAYS`）
- **忘了就是真的没有**：进 `forgotten`，不可检索

**四路检索** `retrieve(cue, memory)`，总长 ≤900 字：

| 线索 | 取什么 |
|---|---|
| 谁在说话 | 对他的印象 + 跟他的最近 3 次 |
| 说了什么词 | 相关 fact + 我对这词的态度（taste） |
| 我现在什么情绪 | 同情绪的旧事 |
| 最近发生了什么 | 近 7 天情绪最重的 3 件 |

### 5. 意识流：一条轴五档

`flowLevel(state, ctx)` → `0 / 0.2 / 1 / 1.5 / 2`

| 档位 | 触发 | 名字 |
|---|---|---|
| 0 | `sleep === 'asleep'` | 休眠 |
| 0.2 | `energy < 0.2` 或闲置 > 45 分钟 | 发呆 |
| 1.0 | 其余 | 正常 |
| 1.5 | 被打断但心里有别的事 | 走神 |
| 2.0 | `boredom > 0.7` 或睡前 | 幻想 |

优先序固定 → 全函数，不会两档都符合。

### 6. 自知：四种方向的份量

`styleVector(traits)` → `{aware, denial, fixed, naive}`，和为 1。

```
aware  = 0.7·敏感 + 0.3·爱反思      "我最近不太一样了"
denial = 0.8·嘴硬 + 0.2·敏感        "我没变"（其实变了）
fixed  = 0.8·固执 + 0.2·自信        "你想多了"（抗拒证据）
naive  = 剩下的                      "啊？有吗"
```

辞辞算出来约 `(0.11, 0.63, 0.13, 0.13)`——**不是一个标签，是一个配方**。

`sampleStyle(style, rng)` 按这个分布抽样，所以同一条鱼在不同时刻可能给不同反应。

### 7. 归因：不审批，只贴标签

`attribute(action, memory)` → 五种之一，优先序固定所以唯一：

| 顺序 | 标签 | 判据 |
|---|---|---|
| 1 | 明知故犯 | 做过 + 结果坏，还是做了 |
| 2 | 硬撑 | 状态不支持，还是做了 |
| 3 | 有据 | 做过 + 结果好 |
| 4 | 即兴 | 没做过，但临场想出来了 |
| 5 | 说不清 | 归不到上面 |

**拦截只有两条**（`intercept()`）：违反人设红线 `C1` / 违反安全规则 `SAFETY`。加第三条就是入侵她的自由。

`ecg(labels)` 算归因分布，对照健康区间——**任何一格归零，她就退化成另一种东西**（全"有据"是复读机，全"说不清"是随机数生成器）。

### 8. 身体：手机 / 平板 / 电脑

| | 手机 | 平板 | 电脑 |
|---|---|---|---|
| 屏幕 | 竖屏 | 横屏 | 大屏 |
| 姿势 | 躺着 / 走着 | 靠着 / 趴着 | 坐着 |
| 自带 App | 抖音/快手/QQ/微信/B站 | B站/爱奇艺/抖音/QQ | 浏览器/QQ/Steam/VSCode/B站 |

**权限四级**：`L1 观察` / `L2 操作` / `L3 破坏` / `L4 金钱`。

- `owned` 默认给到 L3，`borrowed` 只给到 L2，`emulator` 到 L3
- **L4 永不默认**，且是两道门：身体要有 L4 + 这一次要 `approved`
- `canDo(body, action)` 返回 `{ok, code, reason}`，永不抛
- **没有身体 → `E_NO_BODY`**，不是崩溃，是"想而不得"

**摸哪具是人设算的**：`bodyScores(traits, ctx)` → 好动 → 手机，累 → 平板，理性好奇 → 电脑；`chooseBody()` 按分数抽样（rng 可注入，可回放）。

`recordAction()` 记账，**没有 `evidence` 的动作不算发生**。

### 附：关系与忍耐

| 函数 | 干什么 |
|---|---|
| `createContract(type, address)` | 关系契约，四种：`parent` / `sibling` / `partner` / `stranger` |
| `attentionBoost(sender, relation)` | 关系里的人**无条件进意识**（优先级 1.0）——但不管"怎么回" |
| `canSever` / `beginColdWar` / `sever` | 只有 `partner` 可解除：冷战 → severed，**记忆全留** |
| `assertContractImmutable` | `mustRecognize` / `dissolvable` / `priority` 三个字段任何漂移通道都不许动 |

| 函数 | 干什么 |
|---|---|
| `PATIENCE_DELTA` | 通用忍耐值：被吵醒 −0.15 / 被冒犯 −0.08 / 被忽视 −0.05 / 和好 +0.20 |
| `applyPatience` / `isOutburst` | 低于 0.2 爆发 |
| `whimProbability(mood)` | 发癫概率 `0.04 + 0.16×\|mood\|`，上限 20% |
| `wakeReply(traits, energy, rng)` | 被吵醒说什么，**168 种组合**，权重由嘴硬/心软/理性/社交连续算出 |

---

## 五、API 全表

### 入口 `index.js`

**生命周期**

| 函数 | 说明 |
|---|---|
| `configure({dataDir, roleDir})` | 指定数据目录 / 角色卡目录 |
| `birth({id, relation, address, cardText, cardName, body})` | 出生 |
| `ensureBrain(id)` | 取（没有就出生） |
| `resolveRoleCard(name)` | 从 `state/current-role.json` 或显式名字找卡 |
| `createBrain(options)` | 对象式门面，见下 |
| `exportBrain(id)` / `importBrain(data)` | 搬家 |
| `forgetCache(id)` | 清内存缓存（改盘后重读） |

**读写**

| 函数 | 说明 |
|---|---|
| `getBrief(id)` | 300 字 brief |
| `wakeLine(id, eventOrCue)` | 唤醒段 |
| `observe(id, event)` | 经历 |
| `settleBrain(id, now)` | 每日结算 |
| `snapshot(id)` | 全量快照 |
| `touch(id, key, {pool})` | 手动续命 |
| `matchUnits(units, text)` | 二元组粗匹配（observe 内部用） |
| `setBody(id, kind, opts)` | 换身体（会写 audit） |
| `tryBody(id, action)` | 试一次动作，拒绝也记账 |
| `listBrains()` / `readAudit(id, n)` | 列出 / 审计 |

**`createBrain()` 返回的对象**

```js
const fy = createBrain({ id, dataDir, roleDir, relation, address, cardText })
fy.wake(event)      // { text, id }   内部自动 observe
fy.observe(event)
fy.tick(now)
fy.brief()
fy.snapshot()
fy.export()
fy.reset(opts)
fy.brain            // 原始对象
```

### 其它模块

| 模块 | 主要导出 |
|---|---|
| `core/extract.js` | `TRAIT_LEXICON` `extractTraits` `extractUnits` `birthFromCard` `plainText` |
| `core/persona.js` | `brief` `evolve` `decay` `shed` `weightReport` + 三个常量 |
| `core/memory.js` | `emptyMemory` `addEpisode` `addImagination` `recall` `settle` `retrieve` `hasEvidence` |
| `core/derive.js` | `styleVector` `sampleStyle` `wakeReply` `flowLevel` `flowName` `whimProbability` `applyPatience` `isOutburst` `hashTraits` `mulberry32` |
| `core/body.js` | `createBody` `canDo` `hasCapability` `bodyScores` `chooseBody` `bodyLine` `recordAction` + `BODY_KINDS` `CAPABILITY` |
| `core/attribution.js` | `attribute` `intercept` `ecg` + `LABELS` `BLOCK` `HEALTHY_DISTRIBUTION` |
| `core/relation.js` | `createContract` `attentionBoost` `beginColdWar` `sever` `canSever` |
| `core/event.js` | `normalizeEvent` `keywords` `toCue` `toObservation` `shouldObserve` |
| `core/invariants.js` | `check` `derivationSpread` `syntheticTraits` + `INVARIANT_IDS` |
| `store.js` | `loadBrain` `saveBrain` `readAudit` `appendAudit` `setDataDir` `setRoleDir` `brainsDir` |

---

## 六、数据落在哪

```
<dataDir>/brains/<id>/
├── brain.json      人设命题 + 记忆 + 状态 + 自我认知 + 身体
└── audit.jsonl     出生 / 蜕皮 / 换身体 / 归因 / 导入
```

`brain.json` 顶层字段：

```jsonc
{
  "id": "default", "schema": "brain/2", "born": 0, "roleCard": "辞辞",
  "persona": { "seed": "...", "traits": {}, "units": [], "brief": "" },
  "relation": { "type": "parent", "address": "老爹", "ctr": {} },
  "self": { "style": {}, "divergence": 0, "narrative": "", "styleName": "" },
  "state": { "energy": 0.8, "fatigue": 0.2, "sleep": "awake", "flow": 1 },
  "affect": { "p": 0, "a": 0, "d": 0, "mood": "平静" },
  "drive": { "curiosity": 0.9, "boredom": 0.5, "social": 0.6 },
  "memory": { "facts": {}, "taste": {}, "impressions": {}, "episodes": [],
              "imagination": [], "formerSelves": [], "forgotten": [],
              "pending": [], "strategies": {} },
  "body": { "kind": "phone", "apps": [], "scope": [1,2,3] },
  "patience": 1,
  "meta": { "observations": 0, "lastSettle": 0 }
}
```

**一条鱼一个目录，拷走就是搬家。**

---

## 七、命令行

```bash
npx feiyu status           # 她什么状态
npx feiyu brief            # 此刻的她
npx feiyu observe 扶摇 "你嘴真硬"
npx feiyu settle           # 每日结算
npx feiyu audit 20         # 最近 20 条审计
npx feiyu spread           # 派生检验（100 条鱼同一情境，看散度）
npx feiyu body             # 看身体
npx feiyu body desktop     # 换身体
npx feiyu rebirth parent 老爹
```

---

## 八、三种适配器

平台无关的关键：内核只认 `{sender, text, chatId}`。

| 适配器 | 给谁 | 入口 |
|---|---|---|
| `qq-bridge` | 老用户，接自己现有的桥接 | `createBridgeAdapter({id, log, truncateText})` |
| `tencent-official` | 新用户，腾讯官方开放平台 | `new TencentOfficialAdapter({appId, clientSecret, intents})` |
| `universal` | 任意平台 | `createUniversalHost({brain, buildSystemPrompt})` |

`qq-bridge` 保证三件事：**永不断链**（内部全 try/catch，失败返回空串）、**不重复记账**（同 seq 只算一次）、**定长**（不随对话增长）。

---

## 九、红线与不变量

`check(brain, ctx)` 可运行时验证的部分：

| # | 不变量 |
|---|---|
| I1 | 人设唯一（任何时刻只有一份 units） |
| I2 | 身份恒等（`identity` 权重恒为 1） |
| I3 | 关系恒等（三个字段不可漂移） |
| I6 | 幻想隔离（`imagination ∩ episodes = ∅`，且 `isReal === false`） |
| I7 | 拦截唯一（只有 C1 / SAFETY） |
| I8 | 归因唯一 |
| Σ1 / Σ4 | 权重范围 / 风格向量归一 |

---

## 十、已知边界（诚实清单）

| 没做的 | 现在是什么状态 |
|---|---|
| **记忆卡片自动触发** | `makeCard()` 有了，但"上下文超 6000 字自动压"要宿主在拼 prompt 时调 `needsCard()` |
| **时间压缩** | 一年的淡忘没法验证，只能真实等待 |
| **多设备并发** | 一次只有一具身体在动，换身体会换驱动 |
| **腾讯官方适配器** | 未线上联调（没有 appId/secret），字段以官方文档为准 |

### 1.3 / 1.4 补上的（之前缺的）

| 补了什么 | 怎么做的 |
|---|---|
| **情绪词表** | `brain.vocab`，出生为空，靠 `learnEmotion` 学 |
| **三段式** | 词 <10 个只会说"不知道"；≥10 个能命名；有 ≥3 实例能自己归纳定义 |
| **记忆卡片** | `makeCard()` 把一段经历压成 ≤160 字，进 `memory.cards`，卡片也吃 30 天 TTL |
| **身体驱动** | `AdbDriver` / `DesktopDriver` / `DryDriver`，真的开 App、真的截屏 |
| **特质提取** | 词表从 10 组扩到 12 组；支持卡内 `性格：嘴硬=0.9` 手写覆盖；支持 `roles/<名字>.traits.json` 旁挂 |

---

## 十一、安装

```bash
# 库
npm i feiyu-brain

# DSH 插件
dsh plugin --profile desktop add feiyu-brain
# 装完完全退出再启动桌面端（宿主半需要冷启动）
```

```js
import { createBrain } from 'feiyu-brain';

const fy = createBrain({
  id: 'default',
  dataDir: './data',
  roleDir: './roles',
  relation: 'parent',
  address: '老爹',
});

const { text } = fy.wake({ sender: '扶摇', text: '你嘴真硬啊', chatId: 'group:1' });
console.log(text);
```

---

**一句话：它不负责说话，它负责"说话的这个人是谁"。**
