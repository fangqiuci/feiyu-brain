# 手把手发布

> 从零开始，一条命令一条命令抄。
> 全程大约 15 分钟，其中 10 分钟在注册。

---

## 第 0 步 · 先看看东西在不在

打开 PowerShell（开始菜单搜 `powershell`），粘贴：

```powershell
cd C:\Users\Admin\qq-bridge\plugins\feiyu-brain
$node = 'C:\Users\Admin\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
& $node selftest.mjs
```

看到 `通过 45 项，失败 0 项` 就对了。

> 为什么要写完整路径？因为这台机器没装 npm，`node` 也不在 PATH 里。
> 桥接就是用这个完整路径跑的。

---

## 第 1 步 · 注册 npm 账号

1. 打开 <https://www.npmjs.com/signup>
2. 填 **用户名 / 邮箱 / 密码**
   - ⚠️ 用户名会出现在包页面上，想好再填
   - ⚠️ 邮箱必须是真的，**要收验证邮件**
3. 去邮箱点验证链接
4. **没验证邮箱发不了包**，会报 `403 Forbidden`

已经有账号就跳过这步，直接 `npm login` 或网页登录。

---

## 第 2 步 · 开两步验证（2FA）

npm 强制要求。网页右上角头像 → **Account** → **Two-Factor Authentication** → 用手机上的验证器（Authenticator / 1Password / 微信小程序都行）扫二维码。

**这一步必须做**，否则第 4 步会被拒。

---

## 第 3 步 · 建 token

打开 <https://www.npmjs.com/settings/~/tokens>

页面有两个标签，**两个都能用**，选一个：

### 方案 A（最省事）：Classic Token

1. 点 **Classic Token** 标签
2. 类型选 **Automation**
   - 这个类型**自动跳过 2FA**，最不容易卡住
3. 点 **Generate Token**
4. **立刻复制**——`npm_` 开头那一长串，**关掉页面就再也看不到了**

### 方案 B：Granular Access Token

1. 点 **Granular Access Token**
2. Name 随便填，比如 `feiyu-publish`
3. Expiration 选 30 天
4. Permissions 选 **Read and write**
5. ✅ 勾上 **Bypass two-factor authentication**
6. Packages 选 **All packages**（或者只勾 `feiyu-brain`）
7. Generate → 复制

---

## 第 4 步 · 发布

### 方式一：双击（推荐）

进文件夹 `C:\Users\Admin\qq-bridge\plugins\feiyu-brain\`，**双击 `publish.bat`**。

它会：
1. 自动打包
2. 等你粘贴 token（右键粘贴，不会显示出来，正常）
3. 按回车，发出去

看到 `发布成功 ✔` 就成了。

### 方式二：敲命令

```powershell
cd C:\Users\Admin\qq-bridge\plugins\feiyu-brain
$node = 'C:\Users\Admin\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
$env:NPM_TOKEN = '把刚才复制的 token 粘这里'
& $node scripts\publish-npm.mjs
```

> PowerShell 里粘贴用**右键**，Ctrl+V 有时候不灵。

---

## 第 5 步 · 验证发出去了

**A. 看页面**

打开 <https://www.npmjs.com/package/feiyu-brain>
应该能看到 README 和 `npm i feiyu-brain` 的安装说明。

**B. 真的装一遍**（最硬的验证）

开一个新的 PowerShell：

```powershell
cd C:\Windows\Temp
mkdir feiyu-test -Force
cd feiyu-test
$node = 'C:\Users\Admin\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
& $node -e "import('feiyu-brain').then(m=>console.log('装上了，导出', Object.keys(m).length, '个'))"
```

打印出 `装上了，导出 xx 个` 就真成了。

---

## 第 6 步 · 出错了对照这张表

| 报错 | 意思 | 怎么办 |
|---|---|---|
| `401 Unauthorized` | token 不对或过期 | 重新建一个，注意不要带空格 |
| `403 Forbidden` | ① 邮箱没验证 ② token 权限不够 ③ 2FA 没开 | 按 1→2→3 顺序查 |
| `403 ... you do not have permission to publish` | 这个名字被别人占了 | 见下面「改名」 |
| `409 Conflict` | 这个版本号已经存在 | 改 `package.json` 的 `version`，比如 1.1.1 |
| `E409` / `cannot publish over` | 同上 | 同上 |
| `ENOTFOUND registry.npmjs.org` | 网络不通 | 挂梯子，或者换网络 |
| `EPERM` / 文件占用 | 打包时有文件被锁 | 关掉编辑器再试 |

### 如果名字被占了

改 `package.json` 里的 `name` 成带作用域的：

```json
"name": "@你的用户名/feiyu-brain"
```

然后发布要加参数：

```powershell
& $node scripts\publish-npm.mjs
```

脚本会自动处理作用域的 URL 编码。装的时候变成：

```bash
npm i @你的用户名/feiyu-brain
```

> 现在 `feiyu-brain` 这个名字还空着（我查过是 404），但要发就快点，别被人抢了。

---

## 第 7 步（可选）· 传到 GitHub

**没有 git 也能传**，用网页拖文件：

1. 打开 <https://github.com/new>
2. Repository name 填 `feiyu-brain`，选 **Public**，点 **Create repository**
3. 点 **uploading an existing file**
4. 打开 `C:\Users\Admin\qq-bridge\plugins\feiyu-brain\`，把这些拖进去：
   - `index.js`、`store.js`、`cli.mjs`、`package.json`、`README.md`、`LICENSE`
   - 整个 `core\`、`adapters\`、`docs\`、`examples\`、`market\` 文件夹
5. ❌ **千万别拖**：`dist\`、`state\`、`.env`
6. 点 **Commit changes**

---

## 第 8 步（可选）· 上 DSH 插件市场

模板已经写好了：`market\fangqiuci_feiyu-brain.yml`

1. 把 `fangqiuci_` 改成**你的 GitHub 用户名**
2. 把 `tarball` 那一行换成你的：
   ```
   https://registry.npmjs.org/feiyu-brain/-/feiyu-brain-1.1.0.tgz
   ```
3. 复制到市场仓库的 `data/plugins/` 下
4. 提 PR

`category` 一定要按市场要求填（隔壁 doubao 是 `workflow`，填错 CI 会红）。

---

## 一张图记住

```
注册 npm  →  开 2FA  →  建 token  →  双击 publish.bat  →  去页面看
   10 分钟      3 分钟      2 分钟         30 秒
```

---

## 卡住了怎么办

把报错**整段**贴给我，我按错误码给你下一步。

不要只说"发布失败"——`401 / 403 / 409` 三个的处理方式完全不一样。
