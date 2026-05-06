#!/usr/bin/env node
/**
 * 校验 Node >= 18，并强制在「目标项目」中可解析 Playwright（`playwright` 或 `@playwright/test`）。
 * 仅从 process.cwd() 起沿父目录查找 package.json：须声明 playwright / @playwright/test 且可 resolve（避免仅靠残留 node_modules 误判）。
 */
import process from "node:process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
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
 * 自 startDir 起向父级查找 package.json：须**声明** playwright 或 @playwright/test，且能成功 resolve。
 * @param startDir - 起始目录（通常为 process.cwd()）
 */
function resolvePlaywrightWalkingAncestors(startDir) {
  let dir = startDir;
  for (let i = 0; i < 12; i++) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath) && packageDeclaresPlaywright(pkgPath)) {
      const hit = resolvePlaywrightFromPackageJson(pkgPath);
      if (hit) {
        return { ...hit, via: pkgPath };
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return null;
}

const resolved = resolvePlaywrightWalkingAncestors(process.cwd());

if (!resolved) {
  console.error(
    "[verify-env] 在目标项目（自 cwd 向上的 package.json 链）中未解析到 playwright 或 @playwright/test。",
  );
  console.error(
    "  请在含 Nuxt / profile 脚本的子包根目录执行，并确保该 package.json 已声明其一且已执行安装。",
  );
  console.error(
    "  示例: cd <nuxt-app-root> && npm i -D playwright && npx playwright install chromium",
  );
  console.error("  校验本仓库脚本时: npm run verify-env:fixture");
  process.exit(1);
}

console.log("[verify-env] Playwright OK:", resolved.name, "←", resolved.via);
process.exit(0);
