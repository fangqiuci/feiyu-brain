# 装不上 / 装上了不工作 —— 排障表

> **先跑这条**：
> ```bash
> npx feiyu doctor          # 只查
> npx feiyu doctor --fix    # 能修的替你修（bundles + 工具白名单）
> ```
> 它查 pnpm、插件登记、工具白名单、数据目录，逐项给出修法。下面的手工步骤是它修不了时的兜底。

> 来自一次真机（Windows 11 + DSH 0.2.2-rc.1 + 全新设备）的实测，五处会卡。

---

## 一、装不进去

### ① `'pnpm' 不是内部或外部命令`

`dsh plugin add` 底层调 pnpm。**这不是插件的问题，是机器上没有 pnpm。**

```powershell
npm i -g pnpm
pnpm -v          # 确认
```

或者用 corepack：

```powershell
corepack enable pnpm
```

### ② DSH CLI 直接 `node bin.js` 报 `MODULE_NOT_FOUND`

DSH 桌面版把 CLI 打包在 `app.asar` 里，普通 node 读不了。用 Electron 跑：

```powershell
$env:ELECTRON_RUN_AS_NODE="1"
& "D:\你的安装目录\DeepSeek Harness.exe" `
  "D:\你的安装目录\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh\lib\bin.js" `
  plugin --profile desktop add feiyu-brain
```

---

## 二、装上了但没生效

### ③ `pnpm add` 成功，但 DSH 启动时没装配它

检查 `~/.dsh/profiles/<profile>/package.json` 两处都要有：

```jsonc
{
  "dependencies": { "feiyu-brain": "^1.6.0" },
  "dsh": {
    "profile": {
      "bundles": [ "...", "feiyu-brain" ]   // ← 这一行最容易漏
    }
  }
}
```

漏了就直接打开 DSH 也不会加载——**等于没装**。

### ④ 六个/八个 `feiyu_*` 工具被闸门拒

`~/.dsh/state/tool-allow.json` 的 `exact` 里加上：

```jsonc
{
  "exact": [
    "feiyu_status", "feiyu_wake", "feiyu_observe", "feiyu_tick",
    "feiyu_feel", "feiyu_app", "feiyu_lint", "feiyu_snapshot"
  ]
}
```

不想一个个加就加前缀 `feiyu_`。

### ⑤ 数据写到包目录里，升级就丢

1.5 之前，`dataDir` 留空会落到包同级。装进 `node_modules` 之后那是**只读目录**，
`brain.json` 写不进去，或者升级就被覆盖。

**1.6 起自动判断**：

| 情况 | 数据落在哪 |
|---|---|
| 显式配了 `dataDir` | 你配的地方 |
| 环境变量 `FEIYU_DATA_DIR` | 那儿 |
| 仓库内开发 | `<仓库>/state` |
| **装进 node_modules** | **`~/.feiyu-brain/state`** |

自己查一下：

```bash
npx feiyu status     # 或者看 /status 工具返回的 runtime.dataDir
```

`runtime.dataDirInsidePackage` 为 `true` 就说明还在包里，需要显式配。

---

## 三、装上了、但"她没长大"

**先跑这三步，别急着怀疑装错。**

```bash
npx feiyu status                 # 命题数、记忆数
npx feiyu observe 某人 "他说的话"  # 手动记一条
npx feiyu status                 # 权重变了吗？记忆 +1 了吗？
```

如果手动 `observe` 有效，但接上桥接后不动——**那是适配器契约问题**，
看 [ADAPTER-CONTRACT.md](ADAPTER-CONTRACT.md)，八成是 `recentMessages` 没有 `seq`。

---

## 四、想先试跑、不想改线上人格

```js
createBrain({ id: 'fy-test', dataDir, roleDir, cardText, shadow: true })
```

- 用独立 `brainId`（比如 `fy-test`），跟线上那条鱼完全隔离
- 影子模式下 `observe` 只写审计，**权重一个都不动**
- 跑一百轮，看 `wouldChange` 合不合预期，再关掉 shadow 正式接

---

## 五、一次性自检

```bash
npx feiyu status   # 数据目录 / 影子模式 / TTL 策略都会打出来
npx feiyu lint     # 卡写得对不对、哪几行会被忽略
```

两条都正常，才算真的装好了。
