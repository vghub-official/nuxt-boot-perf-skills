# Nuxt Boot Perf Skills

面向 **Nuxt 3/4** 的 Cursor Agent Skills 集合，聚焦冷启动（boot）、SSR/CSR 边界、首屏资源链路与 `onMounted` 延迟排障。

## 可用技能

| 技能                                                | 说明                                                             | 适用场景                                                      |
| --------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------- |
| [nuxt-boot-timing](./skills/nuxt-boot-timing/SKILL.md) | 冷启动阶段模型、触发检查清单、脚本接入约定、profile 结论输出格式 | Nuxt 首屏慢、根组件 mounted 很晚、dev 与 preview 体感差异较大 |

## 快速安装（Cursor）

将技能目录复制到 `~/.cursor/skills`：

```bash
mkdir -p ~/.cursor/skills
cp -R /path/to/nuxt-boot-perf-skills/skills/nuxt-boot-timing ~/.cursor/skills/nuxt-boot-timing
```

更新技能时重复覆盖即可：

```bash
cp -R /path/to/nuxt-boot-perf-skills/skills/nuxt-boot-timing ~/.cursor/skills/nuxt-boot-timing
```

### 使用 Skills CLI 安装（类似 `npx skills add`）

若仓库已发布到 GitHub，可直接安装：

```bash
npx skills add <owner>/nuxt-boot-perf-skills --skill nuxt-boot-timing -g -y
```

说明：

- 推荐显式传 `--skill nuxt-boot-timing`，避免多技能仓时装错目标。
- `-g` 为全局安装到用户级技能目录；不加则按当前项目上下文安装。
- 不建议使用 `<owner>/<repo>@nuxt-boot-timing` 这种写法，`@...` 常被当作 Git ref（分支或 tag）。

## 配套脚本（供业务仓库复制）

`nuxt-boot-timing` 依赖下列脚本（来源于技能目录）：

- `scripts/verify-env.mjs`
- `scripts/startup-resource-profile.mjs`
- `scripts/profile-cloudflare-startup.mjs`

推荐流程：

1. 在业务项目的 Nuxt 包根执行 `verify-env.mjs`（该目录 `package.json` 应声明 `nuxt`）。
2. 将上面三个脚本复制到业务项目 `scripts/` 目录（可覆盖同名文件）。
3. 在业务项目 `package.json` 中补齐 profile 命令（详见 [SKILL.md](./skills/nuxt-boot-timing/SKILL.md)）。

示例（在 Nuxt 应用根目录执行）：

```bash
node /path/to/nuxt-boot-perf-skills/skills/nuxt-boot-timing/scripts/verify-env.mjs
```

## 目录结构

```text
nuxt-boot-perf-skills/
├── .gitignore
├── AGENTS.md
├── CHANGELOG.md
├── CLAUDE.md
├── CONTRIBUTING.md
├── LICENSE.md
├── README.md
└── skills/
    └── nuxt-boot-timing/
        ├── SKILL.md
        ├── references/
        │   ├── boot-phases.md
        │   └── trigger-checklist.md
        └── scripts/
            ├── profile-cloudflare-startup.mjs
            ├── startup-resource-profile.mjs
            └── verify-env.mjs
```

## 与业务仓库的关系

- 本仓库提供可复用的技能文本和脚本基线。
- 业务仓库维护自身专名、页面路径、口径阈值与实测报告。
- 建议业务仓库按需覆盖同步脚本，保持与 `SKILL.md` 的触发清单一致。

## 许可

MIT，见 [LICENSE.md](./LICENSE.md)。
