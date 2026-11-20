# 身体：手机 / 平板 / 电脑

> 大脑决定"想干什么"，身体决定"够不够得着"。
> 同一颗脑子，换具身体就是另一种活法。

---

## 一、三具身体

| | 手机 | 平板 | 电脑 |
|---|---|---|---|
| 屏幕 | 竖屏 | 横屏 | 大屏 |
| 姿势 | 躺着 / 走着 | 靠着 / 趴着 | 坐着 |
| 擅长 | 刷短视频、聊天、随手拍、蹲人 | 看剧、长时间刷、躺着看 | 干活、打游戏、多开、查东西 |
| 不擅长 | 干重活、长时间看剧 | 打字、干活 | 躺着用、带出门 |
| 自带 App | 抖音 / 快手 / QQ / 微信 / B站 | B站 / 爱奇艺 / 抖音 / QQ | 浏览器 / QQ / Steam / VSCode / B站 |

**同一条"想刷视频"，摸出来的东西不一样。**

---

## 二、她摸哪具身体，是人设算出来的

```js
bodyScores(traits, context)
```

| 她是什么人 | 更容易摸到 |
|---|---|
| 好动、社交 | **手机**（随身、碎片） |
| 累、心软 | **平板**（能躺着） |
| 理性、好奇 | **电脑**（能干正事） |

再加活动偏好：想刷短视频 → 手机；想看剧 → 平板；想打游戏 / 干活 → 电脑。

**所以"她会开电脑"不是写死的功能，是她这个性格在那个状态下算出来的。**

```bash
npx feiyu status     # 看 snapshot.body
```

---

## 三、权限：四级，两道门

| 级别 | 例子 | 默认 |
|---|---|---|
| **L1 观察** | 截图、看屏幕 | 给 |
| **L2 操作** | 开 App、滑、搜、播 | 给 |
| **L3 破坏** | 删软件、清数据 | 自己的给，借的不给 |
| **L4 金钱** | 充值、买会员 | **永不默认** |

### 花钱是两道门

```
① 身体有没有 L4      ← 由用户授权这具身体能花钱
② 这一次有没有批准    ← 每次金额都要批
③ 支付密码           ← 每次由用户输入，不落地
```

**批准 ≠ 授权。** 你批了一次 6 块钱的会员，不等于她以后能随便花。

```js
canDo(body, { capability: 4 })                          // → E_NEED_APPROVAL
canDo(body, { capability: 4, approved: true })           // → E_NO_PERMISSION（身体没 L4）
canDo(bodyWithL4, { capability: 4, approved: true })     // → ok
```

---

## 四、证据链：没证据 = 没发生

```js
{ at, body, action, ok, code, evidence: 'shots/2026-11-20/140211.png', durMs }
```

**没有 `evidence` 的动作，视为没有发生。**

这条同时解决两件事：
- 她不能说"我刚刷了"却没刷（查截图）
- 你随时能看她到底在干嘛（查截图）

---

## 五、没有身体

```js
canDo(null, {})  // → { ok:false, code:'E_NO_BODY', reason:'没有身体，想而不得' }
```

**不抛异常，返回一个理由。**

这是设计的一部分——"想而不得"本身会产生情绪：

```
想刷抖音 → 没有身体 → 想做的事做不了 + 没掌控感
        → "就是很不爽"  /  "我委屈"
```

**先有内心，再有手。** 没有手的大脑还是大脑。

---

## 六、宿主怎么接驱动

内核不执行任何动作，只做三件事：算、判、记账。

```js
import { canDo, recordAction, CAPABILITY } from 'feiyu-brain';

// 她想开抖音
const action = { type: 'open_app', app: 'douyin', capability: CAPABILITY.OPERATE };
const gate = canDo(brain.body, action);
if (!gate.ok) return gate;   // E_NO_BODY / E_NO_PERMISSION / E_NO_APP

// 宿主自己执行（ADB / 桌面自动化 / 模拟器）
const shot = await myDriver.openApp('douyin');
recordAction(brain.body, action, { ok: true, durMs: 1200 }, shot.path);
```

驱动是宿主的事：ADB、scrcpy、Playwright、模拟器 API 都行。
**内核不挑工具，只认证据。**

---

## 七、边界

- 本包**不包含**任何设备控制代码，也不申请任何系统权限
- 借来的设备默认不给 L3（删东西会伤到主人）
- 删除要过"临界点 + 三问"，不是随手就能删
- 花钱永远要人在场

---

## 八、一句话

**大脑决定她想干什么，身体决定她够不够得着。**
**换具身体，还是同一条鱼。**
