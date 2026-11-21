# 1.6.0 —— 长了嘴，也长了手

发布时间：2026-11-21

从这一版起，它不再只是"会想"的东西。

---

## 一、嘴：能说话了

### 为什么以前不行

1.5.x 只有 `wake`/`observe`，`wake` 吐出来的是一段状态文本，**要宿主自己接模型、自己发出去**。

结果就是别人装完之后说：**"只会思考，不会说话，也不会动手。"** 这话是对的。

### 现在怎么做

```js
import { say } from 'feiyu-brain/lib/say.mjs'

await say({ target: '1098191551', text: '在吗' })
// { ok: true, messageId: -452310030, via: 'onebot' }
```

**没写端口、没写 token、没写实现名**——它自己扫出来的。

### 三种嘴

| via | 走哪 | 需要 |
|---|---|---|
| `auto`（默认） | 自动发现可用的 OneBot | 无 |
| `onebot` | 指定 OneBot 11 | baseUrl + token |
| `http` | 宿主自己的发送接口 | 一个 URL |
| `window` | 最后兜底：往窗口打字 | 窗口在前台 |

### 认这些网关

| 实现 | 默认端口 | 配置位置 |
|---|---|---|
| SnowLuma | 3000 | `~/SnowLuma/config/onebot_*.json` |
| NapCat | 3000 / 6099 | `~/AppData/Roaming/napcat/config` |
| Lagrange | 8080 / 3000 | `~/.config/Lagrange` |
| go-cqhttp | 5700 | `~/go-cqhttp/config.yml` |
| 通用 OneBot | 都试 | — |

**token 从配置文件里自动挖，用户不用手抄。**

### 三条命令

```bash
npx feiyu mouth detect      # 扫一遍，找到就记住
npx feiyu mouth             # 现在能不能说话
npx feiyu say --target 群号 "话"
```

---

## 二、手：能动手了

| 动作 | 说明 |
|---|---|
| `open_app` | 打开程序 |
| `open_url` | 打开网页（只认 http(s)） |
| `focus` | 聚焦窗口 |
| `click x y` | 点一下 |
| `type` | 打一段字（走剪贴板，中文不乱码） |
| `key` | 按键（ENTER/TAB/ESC…） |
| `scroll` | 滚动 |
| `screenshot` | 截屏取证 |
| `shell` | 执行命令（**必须当场授权**） |

**没授权一律拒**（`E_NEED_APPROVAL`），`dryRun` 可以先看要跑什么。

---

## 三、审查报告六条，全修

| # | 问题 | 修法 |
|---|---|---|
| 1 | `test-adapters.mjs`/`smoke.mjs` 没进包 | 补进 `files` |
| 2 | `selftest` 在干净机器第一条就崩 | 内联测试卡 + 临时目录 |
| 3 | 本地服务不校验 Origin，CORS `*` | 加 `originAllowed()`，通配符改成 `http://127.0.0.1` |
| 4 | `feiyu_` 不在 qq-bridge 白名单 | 加进唯一权威那份 |
| 5 | `audit.jsonl` 无限增长 | 2 MB 轮转 |
| 6 | 自测写进包目录 | 改到 `os.tmpdir()` |

### Origin 闸的实测

```
恶意 Origin : 403 E_ORIGIN
无 Origin   : 200        ← curl / Python 照常能用
本机 Origin : 200        ← 本机页面照常能用
恶意预检    : 403        ← OPTIONS 也拦
```

---

## 四、顺手修的两个真 bug

**① 老存档读不出来**

1.2.0 时代的 `brain.json` 没有 `vocab` 字段，新版 `snapshot` 直接崩。
崩在宿主里 = 注入段拿不到 = **她一夜之间变冷淡**。

现在 `normalizeBrain()` 全部兜住。

**② 人格卡里混进"说话规矩"**

一张卡 57% 是「默认 1~10 字」「允许已读乱回」「不要解释」——
拼进 brief 之后模型读到的全是禁令，执行出来就是**短、冷、不接话**。

现在「规章制度」类的行最多占 1/4。

---

## 五、话多话少，由人设算

不是写死"默认 1~10 字"：

```js
verbosity = 0.15 + 0.50×活泼 + 0.40×社交 + 0.15×好奇
          - 0.45×懒 - 0.25×敏感 - 0.20×嘴硬
```

**brief 的长度跟着这个值变。** 话少的鱼，连介绍自己都懒得说全。

而且它随 traits 漂移——一条活泼的鱼跑几年变懒了，brief 自己就缩了。

---

## 六、升级须知

- **数据兼容**：老 `brain.json` 自动补齐，不用迁移
- **新增可选依赖**：无（还是零依赖）
- **新增环境变量**：`FEISHU_ONEBOT` / `FEISHU_ONEBOT_TOKEN`（可选）
- **新增配置文件**：`~/.feiyu-brain/channels.json`（`mouth detect` 自动写）

---

## 七、测试

```
内核断言   47/47
适配器     12/12
新能力     51/51
宿主验收   78/78
DSH 插件   17/17
解包验证    5/5
————————————————
合计      210 项，0 失败
```

**这一版的自测，在任何干净机器上都能跑通**——审查报告里那句"它自己的质量门是坏的"，从 1.6.0 起不成立了。
