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
2. 在 `scripts` 中确认 profile 命令与 **Node 脚本路径** 存在；不存在则勿虚构命令。
3. 检查 `playwright` 等运行时依赖是否已声明。
4. 判断是否需要 `pnpm install` / `npx playwright install` / 切换 Node 版本。
5. 确认本地 dev/preview **URL 可达** 与环境变量端口一致。

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

## 机读 JSON（v1）

从终端提取 **可 `JSON.parse` 的对象** 后，**先校验必填键**再下结论。字段约定见 [references/output-schema-v1.md](./references/output-schema-v1.md)。与业务侧 profile 脚本合并时，以该脚本**实际 JSON 输出**为准更新 `references` 与本集合仓内契约测试。

## 本集合仓维护

- 开发与测试命令见仓库根 [README.md](../../README.md)；工程文件索引见 [docs/artifacts-to-extract.md](../../docs/artifacts-to-extract.md)。
- 贡献约定见 [CONTRIBUTING.md](../../CONTRIBUTING.md)。
