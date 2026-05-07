---
name: nuxt-boot-timing
description: >-
  指导 Nuxt 3/4 应用冷启动（boot）与首屏耗时排障：区分 SSR 与 CSR/Hydration 阶段、对照 Navigation 与 Resource Timing、
  在运行 profile 或 Playwright 脚本前检查 package.json 与依赖安装。适用于首屏慢、根 onMounted 很晚、
  useAsyncData/Suspense、弱网禁缓存下 dev 与 preview 对比、profile JSON 解读等场景。
---

# Nuxt 冷启动与首屏耗时

## 适用范围

- **目标栈**：Nuxt 3/4 + Vue 3 + Vite；可选 Nitro SSR、`@nuxt/content`、Nuxt DevTools。
- **非目标**：纯 CSR SPA 无 Nuxt、Next/Remix 等（勿套用本技能阶段表）。

## 触发本技能后：运行任何 profile 命令前（必做）

按顺序完成，详见 [references/trigger-checklist.md](./references/trigger-checklist.md)。

1. 定位含 Nuxt 的 `package.json` 与**实际工作目录**（仓库根或 monorepo 子包根均可；勿假设固定子目录名）。若当前路径对应的 `package.json` **未**声明 `nuxt`，应明确提示用户切换到声明了 `nuxt` 的包根再执行命令，并说明 monorepo 时可能在子目录。
2. **Profile 脚本（须复制）**：将 `scripts/profile-cloudflare-startup.mjs`、`scripts/startup-resource-profile.mjs` **直接从** `.cursor/skills/nuxt-boot-timing/scripts/` **复制到项目 `scripts/`（可覆盖）**，**禁止现场生成/手写脚本内容**。**环境校验脚本 `verify-env.mjs` 不必复制**：在 Nuxt 包根作为 `cwd`，用技能目录下脚本的绝对路径执行即可（见触发清单第三节）。
3. 在 Nuxt 根组件（通常是 `app/app.vue`）中补齐 mounted 标记：最后注册一个 `onMounted`，同步执行 `window.__TEENPATTI_APP_ROOT_MOUNTED__ = true` 与 `performance.mark('teenpatti-app-root-mounted')`；若使用 TS，请同步声明 `Window` 字段类型。
4. 在 `package.json` 的 `scripts` 中确认 profile 命令存在；若缺失，补齐：
   - `profile:startup-resources`: `node scripts/startup-resource-profile.mjs`
   - `profile:startup-resources:cf`: `node scripts/profile-cloudflare-startup.mjs`
   - `profile:startup-resources:dev`: `n exec 22.19.0 env STARTUP_PROFILE_SERVER_MODE=dev node scripts/profile-cloudflare-startup.mjs`
   - `profile:startup-resources:normal`: `STARTUP_PROFILE_USE_CACHE=1 STARTUP_PROFILE_NO_THROTTLE=1 node scripts/startup-resource-profile.mjs`
5. 检查 `playwright` 等运行时依赖是否已声明。
6. 判断是否需要 `pnpm install` / 切换 Node 版本；若缺 Playwright 浏览器二进制，**仅提示**用户在包根自行执行 `npx playwright install chromium`（或等价），**不要默认代替用户自动执行**（用户明确要求代跑时除外）。
7. 确认本地 dev/preview **URL 可达** 与环境变量端口一致。
8. 若已进入 profile / Playwright 测试路径，向用户输出**测试命令**与 **`STARTUP_PROFILE_*` 可配置参数**，格式见 [references/trigger-checklist.md](./references/trigger-checklist.md) 第六节。

### Node 与 ABI 约束（必看）

- 若项目声明 `engines.node`（例如 `22.x`）或存在 `.nvmrc/.node-version`，profile 与 dev 应强制用该版本运行。
- 建议把 `dev` 也固定到项目 Node（示例：`n exec 22.19.0 nuxt dev`），避免 `better-sqlite3` 等原生模块出现 ABI 不匹配。
- 若出现 `NODE_MODULE_VERSION` 报错（如 127 vs 137），先用目标 Node 重新安装依赖，再重试：
  - `n exec 22.19.0 pnpm install`

## 阶段模型（摘要）

阅读 [references/boot-phases.md](./references/boot-phases.md)。完整表格、项目专名与实测区间请在**业务仓库自维护文档**中补充，并与本技能 `references` 互链（可选）。

## 分析结果输出格式（对用户）

呈现 profile 或手工整理的结论时，使用以下 **Markdown 小节标题**（便于粘贴对比）：

1. **环境与前提**（建议写全下列要点，并视情况补充 URL、是否禁缓存、是否限速、包管理器与 Node）：
   - **应用位置**：约定以 **Nuxt 应用根目录**（该目录的 `package.json` 声明 `nuxt`）为命令与 `verify-env` 的 cwd；若用户 workspace 或终端 cwd 不在此目录，先说明应切换到哪一层（monorepo 时指出「含 `nuxt` 的子包根」，路径以仓库实际为准）。
   - **运行方式**：`pnpm dev`（开发模式；Vite 与包体积会放大首屏体感，适合迭代）；`pnpm build && pnpm preview`（更接近线上；**应用层**耗时对比以 **preview** 为准）。
   - **约束与待办**：若目标 `package.json` 尚无 `profile:boot-resources` 等现成 profile 脚本、也未声明 Playwright，应在排障**待办**中列出为用户补齐脚本/依赖的步骤；**测试结束后**询问用户是否需协助**撤销**这些临时改动（移除脚本与依赖声明等）。
2. **阶段判定**：对照 SSR/CSR 摘要，用一两句话指出瓶颈落在哪一段。
3. **证据摘要**：表格列出 Top N 资源或最大 gap（来自 JSON 或 DevTools）。
4. **建议下一步**：最多三条可执行项（如 preview 复测、关闭 DevTools、懒挂载大弹窗）。

## 本集合仓维护

- 开发与测试命令见仓库根 [README.md](../../README.md)；工程文件索引见 [docs/artifacts-to-extract.md](../../docs/artifacts-to-extract.md)。
- 贡献约定见 [CONTRIBUTING.md](../../CONTRIBUTING.md)。
