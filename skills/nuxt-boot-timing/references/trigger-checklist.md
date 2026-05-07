# 触发本技能后：运行项目命令前的检查清单

在指导用户执行 **profile / Playwright** 或等价脚本前，按顺序完成以下检查（与计划第十一节一致）。

## 1. 包管理器与工作目录

- 定位含 `nuxt` 依赖的 `package.json` 所在目录（单仓多为仓库根；monorepo 则为**某个子包根**，子目录名因项目而异，勿写死示例路径）。
- 若用户打开的根目录或终端 cwd 下的 `package.json` **没有** `nuxt`：提示先 `cd` 到声明了 `nuxt` 的包根，再跑 profile / `verify-env` / dev。
- 确认使用 `pnpm` / `npm` / `yarn` 与文档一致。

## 2. 脚本入口

- `scripts/profile-cloudflare-startup.mjs`、`scripts/startup-resource-profile.mjs` 必须使用 `.cursor/skills/nuxt-boot-timing/scripts/` 下同名脚本直接复制（允许覆盖），不要临时生成或手写实现。
- `scripts/verify-env.mjs` **不要求**复制到待测业务仓：始终在技能目录保留单一副本即可；校验时在 **Nuxt 包根** 设好 `cwd`，用绝对路径调用，例如 `node <技能目录>/scripts/verify-env.mjs`（脚本依据 `cwd` 解析 `package.json`，与脚本文件所在路径无关）。
- Nuxt 根组件（通常 `app/app.vue`）必须补齐 mounted 标记：最后注册 `onMounted`，同步执行 `window.__TEENPATTI_APP_ROOT_MOUNTED__ = true` 与 `performance.mark('teenpatti-app-root-mounted')`。
- TypeScript 项目需声明 `Window.__TEENPATTI_APP_ROOT_MOUNTED__` 类型，避免脚本接入后出现 TS 报错。
- 在 `package.json` 的 `scripts` 中确认是否存在 profile 相关命令（例如 `profile:boot-resources`）。
- `dev` 模式推荐使用：
  - `profile:startup-resources:dev`: `n exec 22.19.0 env STARTUP_PROFILE_SERVER_MODE=dev node scripts/profile-cloudflare-startup.mjs`
  - 不要写成 `pnpm dev && node ...`（`pnpm dev` 为常驻进程，后半段不会执行）。
- 确认实际调用的 **Node 脚本路径**（如 `node scripts/boot-resource-profile.mjs`）。
- **若不存在**：不得假定命令可用；应改为纯 CDP / DevTools 说明，或提示用户先接入脚本。
- **若需临时接入**：可将「新增 profile 脚本 / 安装 Playwright」写入用户**待办**；自动化验证完成后，**询问用户是否协助清除**这些临时脚本与依赖声明（避免长期污染业务仓）。

## 3. 运行时依赖

- **强制**：在**目标子包根目录**打开终端（`cwd` 为该目录），执行 `node <技能路径>/scripts/verify-env.mjs`（无需把 `verify-env.mjs` 拷入业务项目）；脚本只从 cwd 向上的 `package.json` 链解析 Playwright，集合仓根不会代装依赖；未声明或未安装会直接失败。
- 检查 `playwright` 或 `@playwright/test` 是否在 `dependencies` / `devDependencies`。
- 阅读脚本 `import`，确认是否还有其它运行时包。

## 4. 是否需要安装

- 未安装依赖 → 先执行 `pnpm install`（或等价）。
- **Playwright 浏览器二进制**：首次拉仓或尚未下载 Chromium 等时，**须明确提示**用户在 **Nuxt 包根**自行执行安装（例如 `npx playwright install chromium` 或 `pnpm exec playwright install chromium`，以项目文档为准）。**Agent 默认不得自动执行**上述 Playwright 安装命令；仅在用户**明确要求**「请你帮我执行安装」时方可代跑。
- 若存在 `engines.node` 或 `.nvmrc` → 版本不满足时先切换 Node。
- 若使用 `better-sqlite3` 等原生模块，Node 版本切换后必须在目标版本下重装依赖，否则会出现 `NODE_MODULE_VERSION` 不匹配。

## 5. 运行 dev / preview 与目标 URL

- **dev**：`pnpm dev` — 开发模式，Vite 与包体积常使首屏体感重于线上。
- **preview**：`pnpm build && pnpm preview` — 更接近生产；**应用层**对比结论以 preview 侧为主更稳妥。
- 脚本依赖本地 dev/preview 时，确认服务已启动，且环境变量中的 URL / 端口一致（如 `STARTUP_PROFILE_URL`）。

## 6. 匹配本技能测试 / profile 场景时的输出（Agent）

当对话已进入「跑 verify-env、profile、Playwright 采集」等测试路径时，除完成上文检查外，**须向用户列出**可复制的命令及可调环境变量（以下路径以业务仓库 `package.json` 为准；`verify-env` 仍可用技能目录绝对路径）。

### 6.1 建议给出的命令示例

- **环境校验**（`cwd` = Nuxt 包根）：
  - `node <技能目录>/scripts/verify-env.mjs`
- **仅跑资源 profile**（需本地 dev/preview 已就绪；命令名以项目为准）：
  - `pnpm profile:startup-resources`  
    或：`node scripts/startup-resource-profile.mjs`
- **Cloudflare / dev 一条龙**（脚本内启服务再跑 profile）：
  - `pnpm profile:startup-resources:cf` / `node scripts/profile-cloudflare-startup.mjs`
  - dev 模式示例：`STARTUP_PROFILE_SERVER_MODE=dev node scripts/profile-cloudflare-startup.mjs`（若项目用固定 Node，可按 SKILL 示例包裹 `n exec …`）

### 6.2 `startup-resource-profile.mjs` 可配置环境变量

| 变量 | 含义 | 默认 |
|------|------|------|
| `STARTUP_PROFILE_URL` | 目标页 URL | `http://localhost:3000/` |
| `STARTUP_PROFILE_TOP` | 各阶段排行榜条数 | `10` |
| `STARTUP_PROFILE_SETTLE_MS` | 根 mounted 标记后再等待的毫秒数 | `0` |
| `STARTUP_PROFILE_HEADED` | 设为 `1` 使用 headed，便于目视 | 关闭 |
| `STARTUP_PROFILE_GOTO_TIMEOUT_MS` | `page.goto`（`domcontentloaded`）超时 | `180000` |
| `STARTUP_PROFILE_MOUNT_WAIT_MS` | 等待 `window.__TEENPATTI_APP_ROOT_MOUNTED__` 超时 | `600000` |
| `STARTUP_PROFILE_JSON` | 设为 `1` 末尾额外输出一行 JSON | 关闭 |
| `STARTUP_PROFILE_ALL_PHASES` | 设为 `1` 输出全部 Resource Timing 阶段表 | 关闭 |
| `STARTUP_PROFILE_USE_CACHE` | 设为 `1` 不禁用 HTTP 缓存 | 默认禁缓存 |
| `STARTUP_PROFILE_THROTTLE_PRESET` | 限速预设：`devtools-slow-4g` / `legacy-slow-4g` | `devtools-slow-4g` |
| `STARTUP_PROFILE_NO_THROTTLE` | 设为 `1` 不限速（本机带宽） | 默认限速 |

示例：`STARTUP_PROFILE_USE_CACHE=1 STARTUP_PROFILE_NO_THROTTLE=1 STARTUP_PROFILE_URL=http://localhost:3000/ pnpm profile:startup-resources`

### 6.3 `profile-cloudflare-startup.mjs` 可配置环境变量

| 变量 | 含义 | 默认 |
|------|------|------|
| `STARTUP_PROFILE_SERVER_MODE` | `cloudflare`：build + wrangler；`dev`：`pnpm dev`（可加端口） | `cloudflare` |
| `STARTUP_PROFILE_URL` | 探活与传给子脚本的页面 URL | cloudflare：`http://localhost:8788/`；dev：`http://localhost:3000/` |
| `STARTUP_PROFILE_SERVER_WAIT_MS` | 等待本地 HTTP 就绪超时 | `120000` |
| `STARTUP_PROFILE_SKIP_ANALYZE` | 设为 `1` 跳过 `pnpm build`（cloudflare 模式） | 执行 build |
| `STARTUP_PROFILE_CF_REMOTE` | 设为 `1` 时 wrangler 加 `--remote` | 本地 |
| `STARTUP_PROFILE_DEV_ARGS` | dev 模式传给 `pnpm` 的参数（空格分隔）；空则用 `dev --port <端口>` | 默认 dev |
| `STARTUP_PROFILE_DEV_ULIMIT_NOFILE` | 非 Windows 下提升句柄上限 | `65536` |
| `STARTUP_PROFILE_DEV_DISABLE_POLLING` | 设为 `1` 关闭 chokidar/watchpack polling | 默认开启 polling |
| `STARTUP_PROFILE_DEV_POLL_INTERVAL_MS` | polling 间隔 | `1000` |

子进程调用 `startup-resource-profile.mjs` 时会继承当前环境；可与 §6.2 变量组合使用（脚本内会设置 `STARTUP_PROFILE_URL` 与传入的服务 URL 对齐）。

## 常见失败

| 现象 | 处理 |
|------|------|
| `browserType.launch: Executable doesn't exist` | **提示**用户在 Nuxt 包根执行 `npx playwright install chromium`（或 `pnpm exec playwright install chromium`，以项目为准）；**不要默认代替用户自动执行** |
| `Cannot find module 'playwright'` | 在正确子包目录安装依赖 |
| profile 立即退出且无 JSON | 检查 URL 是否可达、是否需先 `pnpm dev` / `pnpm preview` |
