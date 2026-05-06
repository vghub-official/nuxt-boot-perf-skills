#!/usr/bin/env node
/**
 * 校验 Node >= 18，并从三个维度汇报 Playwright 状态：
 * 1) 当前项目（cwd 向上的 package.json 链）
 * 2) 当前用户（用户目录下缓存与全局包）
 * 3) 本机可执行能力（PATH 中 playwright 命令）
 * 严格 Nuxt 校验：仅当命中声明 `nuxt` 的包根时，才继续 Playwright 校验。
 */
import process from "node:process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const major = Number(process.versions.node.split(".")[0] ?? "0");
if (!Number.isFinite(major) || major < 18) {
  console.error("[verify-env] 需要 Node >= 18，当前:", process.version);
  process.exit(1);
}
console.log("[verify-env] Node OK:", process.version);

/**
 * 从给定 package.json 路径创建 require 并尝试解析 Playwright 相关包。
 * @param packageJsonPath - package.json 的绝对路径
 * @returns 命中的包名与 resolve 入口；均未命中则返回 null
 */
function resolvePlaywrightFromPackageJson(packageJsonPath) {
  const req = createRequire(pathToFileURL(packageJsonPath).href);
  for (const name of ["playwright", "@playwright/test"]) {
    try {
      return { name, entry: req.resolve(name) };
    } catch {
      // 尝试下一包名
    }
  }
  return null;
}

/**
 * 判断该 package.json 是否在 dependencies / devDependencies / optionalDependencies 中声明了 Playwright 相关包。
 * @param packageJsonPath - package.json 绝对路径
 */
function packageDeclaresPlaywright(packageJsonPath) {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  } catch {
    return false;
  }
  const blocks = [
    pkg.dependencies,
    pkg.devDependencies,
    pkg.optionalDependencies,
  ];
  for (const block of blocks) {
    if (!block || typeof block !== "object") {
      continue;
    }
    if (
      Object.hasOwn(block, "playwright") ||
      Object.hasOwn(block, "@playwright/test")
    ) {
      return true;
    }
  }
  return false;
}

/**
 * 判断该 package.json 是否声明了 Nuxt。
 * @param packageJsonPath - package.json 绝对路径
 */
function packageDeclaresNuxt(packageJsonPath) {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  } catch {
    return false;
  }
  const blocks = [
    pkg.dependencies,
    pkg.devDependencies,
    pkg.optionalDependencies,
  ];
  for (const block of blocks) {
    if (!block || typeof block !== "object") {
      continue;
    }
    if (Object.hasOwn(block, "nuxt")) {
      return true;
    }
  }
  return false;
}

function hasNuxtConfig(dir) {
  return [
    "nuxt.config.ts",
    "nuxt.config.js",
    "nuxt.config.mjs",
    "nuxt.config.cjs",
  ].some((name) => existsSync(join(dir, name)));
}

/**
 * 自 startDir 起向父级查找 Nuxt 包根（package.json 声明 nuxt）。
 * @param startDir - 起始目录（通常为 process.cwd()）
 */
function resolveNuxtProjectWalkingAncestors(startDir) {
  let dir = startDir;
  for (let i = 0; i < 12; i++) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath) && packageDeclaresNuxt(pkgPath)) {
      return { via: pkgPath, dir, hasConfig: hasNuxtConfig(dir) };
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return null;
}

/**
 * 通过包管理器查询全局安装的 Playwright 相关包。
 * @param {"npm" | "pnpm"} manager
 */
function detectGlobalPlaywright(manager) {
  const args =
    manager === "npm"
      ? ["ls", "-g", "--depth=0", "--json"]
      : ["ls", "-g", "--depth=-1", "--json"];
  const probe = spawnSync(manager, args, { encoding: "utf8" });
  if (probe.error || probe.status !== 0 || !probe.stdout?.trim()) {
    return { manager, ok: false, found: [] };
  }
  try {
    const parsed = JSON.parse(probe.stdout);
    const deps = parsed?.dependencies && typeof parsed.dependencies === "object"
      ? parsed.dependencies
      : {};
    const found = ["playwright", "@playwright/test"].filter((pkg) =>
      Object.hasOwn(deps, pkg),
    );
    return { manager, ok: true, found };
  } catch {
    return { manager, ok: false, found: [] };
  }
}

function commandExists(command) {
  const probe = spawnSync("bash", ["-lc", `command -v ${command}`], {
    encoding: "utf8",
  });
  return probe.status === 0 && Boolean(probe.stdout?.trim());
}

function detectUserBrowserCache(homeDir) {
  const candidates = [
    join(homeDir, "Library", "Caches", "ms-playwright"), // macOS
    join(homeDir, ".cache", "ms-playwright"), // Linux / 部分 CI
    join(homeDir, "AppData", "Local", "ms-playwright"), // Windows
  ];
  return candidates.find((dir) => existsSync(dir)) ?? null;
}

const nuxtProject = resolveNuxtProjectWalkingAncestors(process.cwd());
const userName = os.userInfo().username;
const homeDir = os.homedir();
const globalNpm = detectGlobalPlaywright("npm");
const globalPnpm = detectGlobalPlaywright("pnpm");
const playwrightCliInPath = commandExists("playwright");
const browserCacheDir = detectUserBrowserCache(homeDir);
const resolved =
  nuxtProject && packageDeclaresPlaywright(nuxtProject.via)
    ? resolvePlaywrightFromPackageJson(nuxtProject.via)
    : null;

console.log("[verify-env] 维度报告:");
console.log(
  "  - Nuxt 项目:",
  nuxtProject
    ? [
        `已命中 Nuxt 包根（${nuxtProject.via}）`,
        nuxtProject.hasConfig ? "检测到 nuxt.config.*" : "未检测到 nuxt.config.*",
      ].join(" | ")
    : "未命中声明 nuxt 的 package.json（严格模式）",
);
console.log(
  "  - 当前项目:",
  resolved && nuxtProject
    ? `已解析 ${resolved.name}（来源 ${nuxtProject.via}）`
    : "未解析到 playwright / @playwright/test（以 Nuxt 包根为准）",
);
console.log(
  `  - 当前用户(${userName}):`,
  [
    globalNpm.ok
      ? `npm -g: ${globalNpm.found.length ? globalNpm.found.join(", ") : "未发现"}`
      : "npm -g: 无法读取",
    globalPnpm.ok
      ? `pnpm -g: ${globalPnpm.found.length ? globalPnpm.found.join(", ") : "未发现"}`
      : "pnpm -g: 无法读取",
    browserCacheDir ? `浏览器缓存: ${browserCacheDir}` : "浏览器缓存: 未发现",
  ].join(" | "),
);
console.log(
  "  - 本机可执行能力:",
  playwrightCliInPath ? "PATH 中可找到 playwright 命令" : "PATH 中未找到 playwright 命令",
);

if (!resolved) {
  if (!nuxtProject) {
    console.error(
      "[verify-env] 严格 Nuxt 校验失败：自 cwd 向上的 package.json 链未发现声明 `nuxt` 的包根。",
    );
    console.error("  请先 cd 到 Nuxt 应用根目录（含 nuxt 依赖的 package.json）再执行。");
    process.exit(1);
  }
  console.error(
    "[verify-env] 在 Nuxt 包根中未解析到 playwright 或 @playwright/test。",
  );
  console.error(
    "  请在该 Nuxt 子包根目录声明并安装 Playwright，再执行 verify-env / profile。",
  );
  console.error(
    "  示例: cd <nuxt-app-root> && pnpm add -D playwright && npx playwright install chromium",
  );
  console.error("  提示: 如仅全局安装或仅系统 PATH 可执行，也不能替代项目内依赖声明。");
  process.exit(1);
}

console.log("[verify-env] Playwright OK:", resolved.name, "←", nuxtProject.via);
process.exit(0);
