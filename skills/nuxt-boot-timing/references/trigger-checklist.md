# 触发本技能后：运行项目命令前的检查清单

在指导用户执行 **profile / Playwright** 或等价脚本前，按顺序完成以下检查（与计划第十一节一致）。

## 1. 包管理器与工作目录

- 定位含 `nuxt` 依赖的 `package.json` 所在目录（单仓多为仓库根；monorepo 则为**某个子包根**，子目录名因项目而异，勿写死示例路径）。
- 若用户打开的根目录或终端 cwd 下的 `package.json` **没有** `nuxt`：提示先 `cd` 到声明了 `nuxt` 的包根，再跑 profile / `verify-env` / dev。
- 确认使用 `pnpm` / `npm` / `yarn` 与文档一致。

## 2. 脚本入口

- `scripts/profile-cloudflare-startup.mjs`、`scripts/startup-resource-profile.mjs` 必须使用 `.cursor/skills/nuxt-boot-timing/scripts/` 下同名脚本直接复制（允许覆盖），不要临时生成或手写实现。
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

- **强制**：在**目标子包根目录**（`cwd` 为该目录）执行 `node …/verify-env.mjs`；脚本只从 cwd 向上的 `package.json` 链解析 Playwright，集合仓根不会代装依赖；未声明或未安装会直接失败。
- 检查 `playwright` 或 `@playwright/test` 是否在 `dependencies` / `devDependencies`。
- 阅读脚本 `import`，确认是否还有其它运行时包。

## 4. 是否需要安装

- 未安装依赖 → 先执行 `pnpm install`（或等价）。
- 使用 Playwright 且首次拉仓 → 通常需要 `npx playwright install`（或项目文档指定的浏览器，如 `chromium`）。
- 若存在 `engines.node` 或 `.nvmrc` → 版本不满足时先切换 Node。
- 若使用 `better-sqlite3` 等原生模块，Node 版本切换后必须在目标版本下重装依赖，否则会出现 `NODE_MODULE_VERSION` 不匹配。

## 5. 运行 dev / preview 与目标 URL

- **dev**：`pnpm dev` — 开发模式，Vite 与包体积常使首屏体感重于线上。
- **preview**：`pnpm build && pnpm preview` — 更接近生产；**应用层**对比结论以 preview 侧为主更稳妥。
- 脚本依赖本地 dev/preview 时，确认服务已启动，且环境变量中的 URL / 端口一致（如 `STARTUP_PROFILE_URL`）。

## 常见失败

| 现象 | 处理 |
|------|------|
| `browserType.launch: Executable doesn't exist` | 执行 `npx playwright install chromium`（以项目为准） |
| `Cannot find module 'playwright'` | 在正确子包目录安装依赖 |
| profile 立即退出且无 JSON | 检查 URL 是否可达、是否需先 `pnpm dev` / `pnpm preview` |
