# 1.5.0 更新说明

> 上一个线上版本：**1.4.2**
> 这一版回答三件事：**怎么不打架、怎么接别人的系统、怎么把过去搬进来。**

---

## 一、不打架（四种装法）

以前只有「全开」和「全关」，装上去就得整个接管人设和记忆。

现在能只取一部分：

| 姿势 | 怎么配 | 适合谁 |
|---|---|---|
| **整脑** | 全套 | 从零开始 / 决定整套换 |
| **只当记忆库** | `observe(..., { evolve:false })` | 人设已有，只缺记忆 |
| **只当情绪机** | `wakeLine(..., { sections:['mood'] })` | 只想让语气有起伏 |
| **只当身体** | `tools:['app']` | 只想让它会开 App |

实测：全量唤醒 100 字 → 只点 `mood` **22 字**，叠加时 token 不会翻倍。

---

## 二、接别人的系统

### ① HTTP 边车（任何语言）

```bash
npx feiyu serve --port 7788
```

```python
requests.post('http://127.0.0.1:7788/wake',
              json={'id':'default','sender':who,'text':msg})
```

12 个接口，默认只绑 `127.0.0.1`，设了 `--token` 就要带 `x-feiyu-token` 头。
**Python / Java / Go 不用再 spawn node 进程。**

### ② 适配器契约写清楚了

`recentMessages` 没有 `seq` 时，旧版会**静默地**不再长大，而 `status` 一切正常——
这个坑不该踩第二次。

- 去重键三级兜底：`seq` → `messageId` → `time`
- `drainUnread()` 批量经历：10 条记 10 条，不再只记最新那条
- 拿不到键时记 `contractWarnings`，不静默

### ③ 情绪双源仲裁

宿主已有 `emotion.json` 的，两套都能改情绪会打架。现在定优先级：

```yaml
moodPolicy: brain    # brain（脑说了算）| host（宿主说了算，feel 只算不写）| blend（各一半）
```

---

## 三、把过去搬进来

```bash
# 老鱼：整个记忆目录一次并进来
npx feiyu migrate D:\cici\qq-bridge\memory --all --delete-source

# 自检
npx feiyu verify
```

- 自动认格式：`.jsonl` / `.md`（日记式）/ `.json`
- 认不出的行**跳过并报行号**，不猜
- 搬两次自动去重
- `--delete-source` 把原文件改名 `.migrated`（**不是删除**，删不删你决定）
- 超过 5000 条自动压卡片 + 归档，脑子不会膨胀

### 日记是她的心房

宿主的日记记"发生过什么"，她记"我怎么想"。

```bash
npx feiyu diary                    # 今天的素材 + 第一人称骨架
npx feiyu diary write ./note.md    # 存回去
npx feiyu diary list
```

存 `brains/<id>/days/2026-11-21.md`，**跟宿主日记分开**。
写完自动记一条经历，以后能想起"我写过什么"。

**日记带心情**：正文没写就补一行；她自己写了就不动；那天没记过就写"那天没记"，不编。

---

## 四、装不上能自救了

```bash
npx feiyu doctor          # 只查
npx feiyu doctor --fix    # 能修的替你修
```

查四件事并给具体修法：pnpm、插件登记（bundles）、工具白名单、数据目录。
`--fix` 会改 profile 的 `package.json` 和 `tool-allow.json`，改完要**完全退出 DSH 再启动**。

---

## 五、安全与可控

| 能力 | 干什么 |
|---|---|
| `shadow` 影子模式 | 只写 audit，权重一个不动——先试跑一百轮看会长成什么样 |
| `snapshot` / `restore` | 存档回滚，权重逐条还原 |
| `ttlPolicy` | `hard` / `summarize` / `archive`（忘细节但原文进归档）/ `off` |
| `body.owner: host` | 宿主管设备时，脑不抢（`E_HOST_OWNS`） |
| `identityCheck()` | 查记忆 / 自我叙事 / 关系三项，判断"换过去还是不是她" |
| `exportPack()` / `importPack()` | 连同记忆一起搬走 |

---

## 六、数字

| | 1.4.2 | 1.5.0 |
|---|---|---|
| 公开导出 | 105 | 131 |
| DSH 工具 | 6 | 9 |
| 测试 | 118 | 167 |
| 文档 | 8 | 12 |
| 包大小 | 86.8 KB | ~122 KB |

新增文档：`MEMORY.md`（记忆怎么处理）、`ADAPTER-CONTRACT.md`（接线必看）、`TROUBLESHOOT.md`（装不上）。

---

## 七、没做的

- **HTTP 边车的鉴权只有共享 token** —— 没有用户体系，够本地用，不够多租户
- **多设备并发** —— 一次只有一具身体在动
- **迁移不做语义理解** —— 日记里认不出的行直接跳过，不猜
