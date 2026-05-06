# Nuxt Boot Perf Skills

面向 **Nuxt 3/4** 的 Cursor Agent Skills 集合：应用冷启动、SSR/CSR 阶段与首屏（含 `onMounted` 边界）性能排障；可与 Playwright + Navigation / Resource Timing 的 profile 脚本配合使用。

常见 **Agent Skills 集合仓**布局：根目录说明文档 + `skills/<skill-name>/SKILL.md` + 许可证文件。

## 可用技能

| 技能 | 说明 | 适用场景 |
|------|------|----------|
| [nuxt-boot-timing](./skills/nuxt-boot-timing/SKILL.md) | 冷启动阶段模型、依赖检查清单、profile JSON 解读与报告模板 | Nuxt 首屏慢、`onMounted` 很晚、弱网 / 禁缓存下 dev 与 preview 对比 |

## 快速安装（Cursor）

### 手动安装（推荐）

将**单个技能目录**复制到 Cursor 技能目录（名称与技能内 `name` 字段一致可减少困惑）：

```bash
mkdir -p ~/.cursor/skills
cp -R /path/to/nuxt-boot-perf-skills/skills/nuxt-boot-timing ~/.cursor/skills/nuxt-boot-timing
```

若本集合仓位于某 Git 仓库的工作区内（路径任意）：

```bash
mkdir -p ~/.cursor/skills
cp -R "$(git rev-parse --show-toplevel)/nuxt-boot-perf-skills/skills/nuxt-boot-timing" ~/.cursor/skills/nuxt-boot-timing
```

更新技能：再次执行 `cp -R` 覆盖，或改为在该目录上 `git pull`（若你将技能单独拆到公开 Git 仓库后克隆到 `~/.cursor/skills/`）。

### 其他工具链

部分环境支持 `npx add-skill <org/repo>` 从 Git 安装技能，以你使用的 CLI 文档为准；本 README 以 Cursor 手动路径为主。

## 本集合仓开发与测试

```bash
cd nuxt-boot-perf-skills
npm test
```

`verify-env` 只检查**当前工作目录对应的目标项目**（自 cwd 向上的 `package.json` 链能否 `resolve` 到 `playwright` / `@playwright/test`）。集合仓根 **不** 安装 Playwright；请在业务仓库的 **Nuxt 应用根目录**（`package.json` 声明 `nuxt`；monorepo 则为对应子包根）执行：

```bash
cd /path/to/your-nuxt-app
node /path/to/nuxt-boot-perf-skills/skills/nuxt-boot-timing/scripts/verify-env.mjs
```

校验本仓库内脚本行为时使用 fixture（在 fixture 目录安装依赖并跑同一脚本）：

```bash
npm run verify-env:fixture
```

工程文件索引见 [docs/artifacts-to-extract.md](./docs/artifacts-to-extract.md)。

## 目录结构

```text
nuxt-boot-perf-skills/
├── package.json
├── LICENSE
├── LICENSE.md
├── .gitignore
├── README.md
├── AGENTS.md
├── CONTRIBUTING.md
├── CHANGELOG.md
├── docs/
│   └── artifacts-to-extract.md   # 工程路径索引（非待复制代码块）
├── test/
│   ├── fixtures/profile-sample.json
│   └── profile-output-parse.test.mjs
├── .github/workflows/ci.yml
└── skills/
    └── nuxt-boot-timing/
        ├── SKILL.md
        ├── references/
        │   ├── trigger-checklist.md
        │   ├── boot-phases.md
        │   └── output-schema-v1.md
        └── scripts/
            └── verify-env.mjs
```

## 与业务仓库的关系

- 各业务仓库可自行维护**专题文档**（启动耗时、专名、实测区间）与 **profile 自动化脚本**；本集合仓提供可复用的 **SKILL** 叙事与 **JSON 输出契约** 测试骨架。
- 若单独发布为公开 Git 仓库，可将 `nuxt-boot-perf-skills/` 目录内容作为仓库根推送。

## 许可

MIT，见根目录 [LICENSE](./LICENSE) 与 [LICENSE.md](./LICENSE.md)（正文一致；公开仓以无扩展名 `LICENSE` 为准）。
