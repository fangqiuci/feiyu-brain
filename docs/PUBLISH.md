# 发布清单

> 目标：把这个包放到网上，别人能一条命令装上。
> 本页是操作手册，不是愿望清单——每一步都有对应的命令或检查。

---

## 一、先确认东西是干净可用的

```bash
cd plugins/feiyu-brain

node verify-package.mjs     # 包里有什么、有没有夹带（22 文件）
node selftest.mjs           # 内核断言 37 项
node test-adapters.mjs      # 适配器契约 12 项
node scripts/release.mjs    # 打出 .tgz
node scripts/verify-tarball.mjs   # 解开 .tgz 当第三方包 import 一遍
```

最后一步最关键：**目录能跑不代表包能跑**。`files` 漏了一项、路径写死了，都在这步暴露。

---

## 二、发 npm

### 方式 A：本机有 npm

```bash
npm pack --dry-run        # 再看一眼清单
npm publish --access public
```

### 方式 B：本机没有 npm（这台机器就是）

直接用 registry 协议发，脚本已经写好了：

```bash
set NPM_TOKEN=npm_xxxxxxxx
node scripts/publish-npm.mjs
```

token 去 <https://www.npmjs.com/settings/你的用户名/tokens> 建，
权限选 **Automation**（CI 用）或 **Bypass 2FA + Read and write**。

先干跑一次确认文档没问题：

```bash
node scripts/publish-npm.mjs --dry
```

### 名字被占用怎么办

`feiyu-brain` 大概率已经被注册。改 scope：

```json
"name": "@你的名字/feiyu-brain"
```

然后 import 路径变 `@你的名字/feiyu-brain`，`npm publish --access public`。
脚本会自动处理 scope 的 URL 编码。

---

## 三、发 GitHub（可选但推荐）

包发出去之后，仓库是别人看代码的地方。

```bash
git init
git add .
git commit -m "feiyu-brain 1.0.0"
git branch -M main
git remote add origin https://github.com/fangqiuci/feiyu-brain.git
git push -u origin main
```

**没有 git 也可以发**：GitHub 网页版「Create new repository」→「uploading an existing file」，
把 `plugins/feiyu-brain/` 里除 `dist/`、`state/`、`data/` 之外的文件拖进去。

⚠️ 上传前确认：**没有 `state/brains/`、没有 `.env`、没有 token**。
`.gitignore` 已经写好了，但网页上传不认 `.gitignore`——要手动别选。

---

## 四、进 DSH 插件市场

市场条目模板在 [`market/fangqiuci_feiyu-brain.yml`](../market/fangqiuci_feiyu-brain.yml)。

1. 复制到市场仓库的 `data/plugins/` 下，改名成 `<你的GitHub用户名>_feiyu-brain.yml`
2. `tarball` 填发布后的直链：
   - npm：`https://registry.npmjs.org/feiyu-brain/-/feiyu-brain-1.0.0.tgz`
   - 或 GitHub Release 的 `.../releases/download/v1.0.0/feiyu-brain-1.0.0.tgz`
3. `category` 按市场要求填（隔壁 doubao 是 `workflow`，填错 CI 会红）
4. 提 PR

首次贡献一般要人工放行，等一两天正常。

---

## 五、发完做三件验证

```bash
# 1. 全新目录里装一遍（不要用本地路径）
mkdir C:\tmp\t && cd C:\tmp\t && npm init -y && npm i feiyu-brain

# 2. 三个平台各 import 一次
node -e "import('feiyu-brain').then(m=>console.log(Object.keys(m).length,'exports'))"
node -e "import('feiyu-brain/adapters/qq-bridge').then(m=>console.log('bridge ok'))"
node -e "import('feiyu-brain/adapters/tencent-official').then(m=>console.log('tencent ok'))"

# 3. CLI 能用
npx feiyu status
```

三条都过，才算真的发出去了。

---

## 六、常见翻车

| 现象 | 原因 | 处理 |
|---|---|---|
| `Cannot find module 'feiyu-brain/adapters/xxx'` | `exports` 里没写 | 检查 package.json `exports` |
| `npx feiyu` 报找不到 | `bin` 指向的文件不在 `files` 里 | `files` 要含 `cli.mjs` |
| 装上去一跑就说找不到角色卡 | 用户没配 `roleDir` | 文档已写；错误信息也直说了 |
| 发布 403 | token 权限不够 / 包名被占 | 换 token 或改 scope |
| 发布 409 | 同版本号已存在 | 改 `version` 再发 |

---

## 七、这一版发了什么

| 项 | 值 |
|---|---|
| 版本 | 1.0.0 |
| 文件 | 22 → 见 `dist/manifest.json` |
| 大小 | ~33 KB |
| 依赖 | **0** |
| Node | ≥ 20 |
| 许可 | MIT |
