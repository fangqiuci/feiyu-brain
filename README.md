# feiyu-brain · 大肥鱼的大脑

> **人设是根，其余都是长出来的。**

> ⚠️ **人格卡必须由用户自己写。**
> 这个包**不生成卡、不代写卡、不猜你想让她是什么样**——它只负责把卡装进来、按卡运行、让卡随经历慢慢变。
> 卡是起点，也是她能变成什么样的边界。

一个**平台无关**的认知内核。给它一张人设卡，它长出一条有记忆、有情绪、会发呆、会嘴硬的鱼。

它**不会说话**——说话是"身体"的事。它只做两件事：

- 唤醒时，产出该拼进 prompt 的那一段（`【此刻的她】…`）
- 经历时，让她的权重、记忆、情绪动一动

**换一个身体（QQ 桥接 / 腾讯官方 / 你自己的平台），大脑一行不动。**

---

## 闭环：人设 → 刷什么 → 改人设 → 又改刷什么

```
用户写的卡（起点，唯一入口）
      ↓ 决定她先看什么
  刷视频 / 经历
      ↓ 产生反应
  人设被改（特质 +0.004，权重 ±0.01）
      ↓ 人也变了
  口味跟着变（先验重新算）
      ↓
  下次刷的不一样 ──→ 回到第二行
```

**人设不是常量，是被经历改写的变量；而这个变量又是"选什么"的依据。**

新鱼的性子是用户写的；刷得多了，她会慢慢变成另一条鱼——但她始终从那张卡出发。

---

## 安装

```bash
npm i feiyu-brain
```

或者直接把仓库里的 `plugins/feiyu-brain/` 拷走。

Node ≥ 20。零依赖。

---

## 两种用法

| | 怎么用 | 给谁 |
|---|---|---|
| **库** | `import { createBrain } from 'feiyu-brain'` | 自己写宿主的人 |
| **DSH 插件** | `dsh plugin add feiyu-brain` | 想直接让模型读写这条鱼的人 |

> 第一步卡住了？先看 [docs/TROUBLESHOOT.md](docs/TROUBLESHOOT.md)。
> 要接线？**先看 [docs/ADAPTER-CONTRACT.md](docs/ADAPTER-CONTRACT.md)**——宿主少给一个字段，她就不会长大，而且不报错。

插件形态注册 **8 个**工具（可以只注册你要的，见下文「四种姿势」）：

| 工具 | 干什么 |
|---|---|
| `feiyu_status` | 她现在什么状态（人设 / 自知 / 意识流 / 身体 / 记忆 / 运行配置） |
| `feiyu_wake` | 取"此刻的她"，拼进 system prompt（可点菜：`sections` / `budget`） |
| `feiyu_observe` | 记一次经历（`evolve:false` 时只记不改人设） |
| `feiyu_tick` | 每日结算（衰减 / 遗忘 / 蜕皮） |
| `feiyu_feel` | 对一件事产生感受（PAD → 找词，有情绪余温） |
| `feiyu_app` | 真开 App / 截屏 / 卸载（adb 或 PowerShell，留证据） |
| `feiyu_lint` | 卡体检：哪几行会变成"她是谁"，哪几行像操作手册该拆出去 |
| `feiyu_snapshot` | 存档 / 回滚 / 列快照 |
| `feiyu_diary` | 她自己的日记：取素材 / 写回去 / 翻旧账 |

对话仍然由宿主自己的模型完成——插件只负责**她是谁**。

---

## 装不上？先跑 doctor

```bash
npx feiyu doctor          # 只检查
npx feiyu doctor --fix    # 能修的替你修
```

它会查四件事并给出具体修法：

```
✘ pnpm          没装 —— dsh plugin add 底层要用它
    → npm i -g pnpm
✘ 插件登记       dependencies 缺 / bundles 缺（缺 bundles 等于装了不加载）
    → 加 --fix 自动补
! 工具白名单     少了 N 个 feiyu_*（会进不了闸门）
    → 加 --fix 自动补 9 个
```

**`--fix` 会改 `~/.dsh/profiles/<profile>/package.json` 和 `~/.dsh/state/tool-allow.json`。**
改完要**完全退出 DSH 再启动**。

pnpm 和角色卡它不修——一个装在你系统上，一个**必须你自己写**。

---

## 别的语言也能用（HTTP 边车）

AstrBot 是 Python，脑是 Node。以前只能每条消息 spawn 一个 node（100~300ms 冷启动）。

现在起一个常驻进程：

```bash
npx feiyu serve --port 7788
# 要鉴权就加 --token xxx
```

Python 侧三行：

```python
import requests
r = requests.post('http://127.0.0.1:7788/wake',
                  json={'id': 'default', 'sender': who, 'text': msg}).json()
print(r['text'])
```

| 方法 | 路径 |
|---|---|
| GET | `/health` `/status` `/version` `/identity` `/verify` |
| POST | `/wake` `/observe` `/feel` `/diary` `/migrate` `/snapshot` |

**默认只绑 `127.0.0.1`**；设了 `--token` 就必须带 `x-feiyu-token` 头。
**只要心情不要人设**？请求里带 `sections: ['mood']`，22 字。

---

一个角色要跑起来，需要四件东西。**feiyu-brain 只占第一件。**

| 四件 | 谁提供 |
|---|---|
| **脑**：她是谁、记得什么、什么情绪 | **feiyu-brain** |
| **嘴**：把想法变成那句话 | 你的模型 |
| **通道**：QQ / 手机 / 网页 | 你的桥接 |
| **身体**：真的去开 App | adb / PowerShell |

> ⚠️ **如果你已经有一套"脑"了（有人设、有记忆、有情绪），不要整个装。**
> 两套都往 prompt 里塞，会各说各话，token 还翻倍。

按你缺哪一件，选一种姿势：

### ① 整脑（替换）

适合从零开始，或者决定整套换掉。

```js
const pack = exportPack('old');      // 旧的那颗脑，先打包
importPack(pack, { id: 'new' });     // 装到新环境——记忆、关系、词表都跟着走
```

### ② 只当记忆库（并挂）

人设仍由你原来的系统管，feiyu-brain 只负责"记住发生过什么"。

```js
observe('default', { who, text }, { evolve: false });
```

`evolve:false` 时**一个权重都不动**，也不蜕皮、不改特质——它不会偷偷跟你的旧脑抢人设。

### ③ 只当情绪机

只要"她此刻什么心情"，不要人设段、不要记忆段。

```js
wakeLine('default', cue, { sections: ['mood'] })   // 约 20~40 字
feiyu_feel({ valence: -0.8, intensity: 0.7 })      // 有情绪余温，不会每轮归零
```

### ④ 只当身体

只要"她真的会开 App"，其余全不要。

```yaml
# cordis.patch.yml
config:
  tools: [app]        # 只注册 feiyu_app
```

`tools` 也可以写 `[status, wake, observe, tick]` —— **不写 `app`，就没有那只手**。

---

## 换脑之前先做一次体检

```js
identityCheck('default')
// → { memory:{episodes:12,people:3}, narrative:true, relation:{type:'parent',address:'老爹'}, verdict:'是她' }
```

判据只有三样：**记忆 / 自我叙事 / 关系**。

- 三个都在 → 是她
- 缺一个 → 像她，但不是她
- 全没有 → 只是同名

**换脑就是换人，除非你把记忆搬过去。** `exportPack()` 带的就是这三样。

---

## 唤醒段可以点菜

| sections | 出什么 | 大概字数 |
|---|---|---|
| 不填 | 全给 | 1200~1500 |
| `['mood']` | 只要心情 | 20~40 |
| `['mood','memory']` | 心情 + 想到的 | 900 左右 |
| `['persona']` | 只要人设 | ≤300 |

还可以加 `budget: 300` 卡死总字数，超了从低优先级砍（人设保底不砍）。

> ⚠️ `feiyu_app` 要真设备：手机/平板走 **adb**，电脑走 **PowerShell**。没有 adb 就返回 `E_NO_DEVICE`，不会假装做了。
> 它跑的通道跟你的网络/隧道**没有关系**——装了它，手机不会连得更顺，只是多了一只"能动手的手"。

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
| **记忆** | 两层老化：没人提 30 天压扁成"大概"，90 天才遗忘；一直被提就一直清楚；原文进归档 |
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

- [docs/MEMORY.md](docs/MEMORY.md) —— **记忆怎么处理**：双记忆共存、老鱼搬迁、新鱼从零、TTL 四档
- [docs/ADAPTER-CONTRACT.md](docs/ADAPTER-CONTRACT.md) —— **接线必看**：宿主得给哪些字段，缺了会怎样
- [docs/TROUBLESHOOT.md](docs/TROUBLESHOOT.md) —— 装不上 / 装上了没反应
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
