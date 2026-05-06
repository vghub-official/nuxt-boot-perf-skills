#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/**
 * 使用 Playwright + Chromium CDP 统计主文档 Navigation Timing 与子资源 Resource Timing 的**总耗时**
 * 及各**连接阶段**耗时，并按阶段分别输出耗时最高的若干条 URL（默认 10，见 `doc/app-startup-timing.md` 第六节）。
 *
 * **默认**：禁用缓存 + DevTools Slow 4G；可通过环境变量改为**使用缓存**与**不限速**，
 * 便于与本机 dev / preview 日常体验对照。
 *
 * 说明：SSR ①～⑦ 为服务端内部阶段，浏览器无法按请求拆分；主文档的 `waitingMs` 可粗略对应
 * 「首字节前」网络+服务端等待。子资源的 redirect/dns/connect/waiting/download 对齐 Resource Timing，
 * 用于对照文档「浏览器侧 A/F：chunk 拉取」等。
 *
 * 前置：已安装依赖并在 website 目录执行 `pnpm exec playwright install chromium`。
 *
 * 采样边界：与 `app/app.vue` 中 `teenpatti-app-root-mounted` 对齐——根组件全部 onMounted 执行完后同步打
 * `performance.mark`；脚本轮询 `window.__TEENPATTI_APP_ROOT_MOUNTED__` 后再采集。
 * 注意：`app.vue` 在 `onMounted` 前有 `await useGameBootstrapData`（含 `getGames` 等），在 Slow 4G 下挂载可能远晚于
 * `window.load`；须单独拉长「等 mounted 标」超时（见 `STARTUP_PROFILE_MOUNT_WAIT_MS`）。
 * 子资源仅统计「ResourceTiming.startTime ≤ mark.startTime」的条目（mark 之后发起的请求不入榜）。
 *
 * 环境变量：
 * - STARTUP_PROFILE_URL — 目标页，默认 http://localhost:3000/（与 `nuxt dev` 提示的 Local 一致）
 * - STARTUP_PROFILE_TOP — 各排行榜条数，默认 10
 * - STARTUP_PROFILE_SETTLE_MS — **根 mounted 标达成后**再等待的毫秒数（便于 mount 后懒加载 chunk），默认 0
 * - STARTUP_PROFILE_HEADED — 设为 1 时 headed 模式（便于目视确认）
 * - STARTUP_PROFILE_GOTO_TIMEOUT_MS — **仅** `page.goto`（默认 `domcontentloaded`）超时，默认 180000
 * - STARTUP_PROFILE_MOUNT_WAIT_MS — 等待 `window.__TEENPATTI_APP_ROOT_MOUNTED__` 的超时，默认 600000（10 分钟）
 * - STARTUP_PROFILE_JSON — 设为 1 时末尾额外打印一行 JSON（便于 jq / CI）
 * - STARTUP_PROFILE_ALL_PHASES — 设为 1 时输出 redirect/dns/connect 等全部阶段表；默认 0（dev+Slow 4G 下
 *   localhost 建连多为 0，只打 waiting/download 减少噪音）
 * - STARTUP_PROFILE_USE_CACHE — 设为 1 时**不**禁用 HTTP 缓存（默认禁用，与现网「硬刷新」对照用）
 * - STARTUP_PROFILE_THROTTLE_PRESET — 网络预设，默认 `devtools-slow-4g`；可设 `legacy-slow-4g`
 *   复现旧版脚本约 400Kbps / 150ms RTT 的更慢口径
 * - STARTUP_PROFILE_NO_THROTTLE — 设为 1 时**不**模拟网络限速（使用浏览器默认网络，即本机带宽）
 *
 * @example
 * # 终端 1：pnpm dev
 * # 终端 2（默认：禁缓存 + Slow 4G）：
 * STARTUP_PROFILE_URL=http://localhost:3000/en pnpm profile:startup-resources
 *
 * @example
 * # dev / preview + 缓存 + 正常网络（对照日常打开速度）：
 * STARTUP_PROFILE_USE_CACHE=1 STARTUP_PROFILE_NO_THROTTLE=1 STARTUP_PROFILE_URL=http://localhost:3000/ pnpm profile:startup-resources
 */

/**
 * Playwright 1.59+ 无头默认使用 headless shell；此处用完整 Chromium + `--headless=new`。
 */
const { chromium } = await import('playwright');

const THROTTLE_PRESETS = {
  /**
   * 对齐 Chrome DevTools 的 Slow 4G 预设：1.6 Mbps down / 750 Kbps up。
   * CDP latency 对应 DevTools 里 client 侧额外 RTT，DevTools profile 内部同样会做 request latency 调整。
   */
  'devtools-slow-4g': {
    label: 'DevTools Slow 4G（约 1.6Mbps 下行 / 150ms RTT）',
    latency: 150,
    downloadThroughput: Math.floor((1.6 * 1000 * 1000) / 8),
    uploadThroughput: Math.floor((750 * 1000) / 8),
    connectionType: 'cellular4g',
  },
  /** 旧脚本口径：比 DevTools Slow 4G 明显更慢，保留用于历史报告复现。 */
  'legacy-slow-4g': {
    label: 'Legacy Slow 4G（约 400Kbps 下行 / 150ms RTT）',
    latency: 150,
    downloadThroughput: Math.floor((400 * 1000) / 8),
    uploadThroughput: Math.floor((400 * 1000) / 8),
    connectionType: 'cellular4g',
  },
};

/** 子资源 / 主文档共用的 Resource Timing 阶段键（用于排序与 JSON） */
const PHASE_KEYS = [
  'redirectMs',
  'dnsMs',
  'connectMs',
  'waitingMs',
  'downloadMs',
  'totalMs',
];

/** 控制台展示用：阶段键 → 中文说明 */
/** 须与 `app/app.vue` 中 `TEENPATTI_STARTUP_PROFILE_MARK` 一致 */
const APP_ROOT_MOUNTED_MARK = 'teenpatti-app-root-mounted';

const PHASE_LABELS = {
  redirectMs: 'redirect（重定向）',
  dnsMs: 'dns（解析）',
  connectMs: 'connect（建连，含 TLS）',
  waitingMs: 'waiting（requestStart→responseStart，首字节前）',
  downloadMs: 'download（responseStart→responseEnd，body）',
  totalMs: 'total（responseEnd−startTime，总耗时）',
};

function envInt(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(name) {
  return ['1', 'true', 'yes'].includes(
    String(process.env[name] ?? '').toLowerCase()
  );
}

function resolveThrottlePreset(name) {
  const key = String(name || 'devtools-slow-4g').toLowerCase();
  return THROTTLE_PRESETS[key] || THROTTLE_PRESETS['devtools-slow-4g'];
}

/**
 * 日志用本地时分秒（不含日期），便于控制台扫读。
 * @returns {string}
 */
function formatLogTime() {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

/**
 * 将 `decodedBodySize` / `transferSize` 等字节字段格式化为带单位字符串（B、KiB、MiB、GiB）。
 * @param {unknown} value - Timing API 返回的字节数或占位
 * @returns {string}
 */
function formatByteSize(value) {
  if (value === undefined || value === null) return '-';
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  if (n === 0) return '0 B';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let i = 0;
  let v = abs;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  if (i === 0) {
    return `${sign}${Math.round(v)} B`;
  }
  const rounded = Math.round(v * 10) / 10;
  const s = String(rounded);
  const t = s.endsWith('.0') ? s.slice(0, -2) : s;
  return `${sign}${t} ${units[i]}`;
}

/**
 * 打印阶段日志，便于定位卡住步骤。
 * @param {string} message
 */
function logStage(message) {
  const now = formatLogTime();
  console.log(`[startup-resource-profile][${now}] ${message}`);
}

/**
 * 判断错误是否为 Playwright 浏览器二进制缺失。
 * @param {unknown} err
 * @returns {boolean}
 */
export function isMissingPlaywrightExecutableError(err) {
  const msg = String(err?.message || err || '');
  return msg.includes("Executable doesn't exist");
}

/**
 * 获取当前平台可执行的 pnpm 命令名。
 * @returns {string}
 */
export function resolvePnpmCommand() {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

/**
 * 运行外部命令并透传输出。
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string }} [opts]
 * @returns {Promise<void>}
 */
async function runCommand(command, args, opts = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      cwd: opts.cwd,
      env: process.env,
    });

    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `命令执行失败: ${command} ${args.join(' ')}（exit=${code}）`
          )
        );
      }
    });
  });
}

/**
 * 自动安装 Playwright Chromium（二进制缺失时兜底）。
 * @returns {Promise<void>}
 */
async function installPlaywrightChromium() {
  logStage('检测到 Chromium 可执行文件缺失，开始自动安装 playwright chromium');
  await runCommand(resolvePnpmCommand(), [
    'exec',
    'playwright',
    'install',
    'chromium',
  ]);
  logStage('playwright chromium 自动安装完成');
}

/**
 * 启动 Chromium；若二进制缺失则自动安装后重试一次。
 * @param {import('playwright').LaunchOptions} options
 * @returns {Promise<import('playwright').Browser>}
 */
async function launchChromiumWithAutoInstall(options) {
  const executablePath = chromium.executablePath();
  if (!existsSync(executablePath)) {
    logStage(`本地未检测到 Chromium 可执行文件：${executablePath}`);
    await installPlaywrightChromium();
  }

  try {
    return await chromium.launch(options);
  } catch (err) {
    if (!isMissingPlaywrightExecutableError(err)) {
      throw err;
    }
    logStage('启动 Chromium 失败且判定为二进制缺失，执行一次安装后重试');
    await installPlaywrightChromium();
    return chromium.launch(options);
  }
}

/**
 * 在页面内采集 Navigation + 各 resource 的阶段耗时（子资源按 app root mounted mark 过滤）。
 * 注意：`page.evaluate` 只序列化本函数体，依赖必须写在本函数内部，否则浏览器里会报未定义。
 * @param {{ markName: string }} opts
 */
function collectProfileSnippet(opts) {
  const markName = opts.markName;

  /** @param {PerformanceResourceTiming} e */
  function phasesFromEntry(e) {
    const round = x => Math.max(0, Math.round(x * 10) / 10);
    return {
      redirectMs: round(e.redirectEnd - e.redirectStart),
      dnsMs: round(e.domainLookupEnd - e.domainLookupStart),
      connectMs: round(e.connectEnd - e.connectStart),
      waitingMs: round(e.responseStart - e.requestStart),
      downloadMs: round(e.responseEnd - e.responseStart),
      totalMs: round(e.responseEnd - e.startTime),
    };
  }

  const navEntry = performance.getEntriesByType('navigation')[0];
  let nav = null;
  if (navEntry) {
    const n = navEntry;
    const p = phasesFromEntry(n);
    const t0 = n.startTime;
    nav = {
      ...p,
      /** 与 `performance.mark` 同源：至主文档首字节（responseStart） */
      ttfbFromNavStartMs: Math.round((n.responseStart - t0) * 10) / 10,
      ttfbFromFetchStartMs:
        Math.round((n.responseStart - n.fetchStart) * 10) / 10,
      ttfbFromRequestStartMs:
        Math.round((n.responseStart - n.requestStart) * 10) / 10,
      domContentLoadedMs:
        Math.round((n.domContentLoadedEventEnd - n.fetchStart) * 10) / 10,
      /** 与 mark 同源：至 domContentLoadedEventEnd */
      domContentLoadedEndFromNavStartMs:
        Math.round((n.domContentLoadedEventEnd - t0) * 10) / 10,
      loadEventEndMs: Math.round((n.loadEventEnd - n.fetchStart) * 10) / 10,
      decodedBodySize: n.decodedBodySize,
      transferSize: n.transferSize,
    };
  }

  const marks = performance.getEntriesByName(markName, 'mark');
  const mountMark = marks.length ? marks[marks.length - 1] : null;
  const boundaryMs = mountMark ? mountMark.startTime : null;

  const list = performance.getEntriesByType('resource');
  const filtered =
    boundaryMs === null ? list : list.filter(e => e.startTime <= boundaryMs);

  const roundT = x => Math.round(x * 10) / 10;
  const resources = filtered.map(e => ({
    name: e.name,
    initiatorType: 'initiatorType' in e ? e.initiatorType : '',
    transferSize: 'transferSize' in e ? e.transferSize : 0,
    /** 相对 navigationStart，与 mark 同原点，便于对照「多晚收完尾」 */
    startTimeMs: roundT(e.startTime),
    responseEndMs: roundT(e.responseEnd),
    ...phasesFromEntry(e),
  }));

  return {
    nav,
    resources,
    mountBoundaryMs:
      boundaryMs !== null ? Math.round(boundaryMs * 10) / 10 : null,
    resourceCountTotal: list.length,
    resourceCountWithinBoundary: filtered.length,
  };
}

/**
 * 按 URL 合并多条 timing，各数值字段取 max
 * @param {Array<Record<string, unknown>>} rows
 */
function mergeByUrl(rows) {
  /** 同 URL 多次采样：阶段与 transfer 取 max；开始时间取 min；结束时间取 max */
  const maxKeys = new Set([...PHASE_KEYS, 'transferSize']);
  const map = new Map();
  for (const r of rows) {
    const name = r.name;
    const prev = map.get(name);
    if (!prev) {
      map.set(name, { ...r });
    } else {
      for (const k of maxKeys) {
        if (typeof r[k] === 'number') {
          const pv = typeof prev[k] === 'number' ? prev[k] : 0;
          prev[k] = Math.max(pv, r[k]);
        }
      }
      if (typeof r.startTimeMs === 'number') {
        const pv =
          typeof prev.startTimeMs === 'number' ? prev.startTimeMs : Infinity;
        prev.startTimeMs = Math.min(pv, r.startTimeMs);
      }
      if (typeof r.responseEndMs === 'number') {
        const pv =
          typeof prev.responseEndMs === 'number' ? prev.responseEndMs : 0;
        prev.responseEndMs = Math.max(pv, r.responseEndMs);
      }
      if (r.initiatorType && !prev.initiatorType) {
        prev.initiatorType = r.initiatorType;
      }
    }
  }
  return [...map.values()];
}

/**
 * 按某字段降序取前 N 条
 * @param {Array<Record<string, unknown>>} rows
 * @param {string} key
 * @param {number} n
 */
function topBy(rows, key, n) {
  return [...rows]
    .sort((a, b) => (Number(b[key]) || 0) - (Number(a[key]) || 0))
    .slice(0, n);
}

/**
 * 打印一个排行榜表格
 * @param {string} title
 * @param {Array<Record<string, unknown>>} rows
 * @param {string} sortKey
 */
function printRankTable(title, rows, sortKey) {
  console.log(title);
  const pad = (s, w) => String(s).padEnd(w);
  console.log(pad(sortKey, 14) + pad('type', 10) + pad('xfer', 14) + 'url');
  console.log('-'.repeat(118));
  for (const r of rows) {
    console.log(
      pad(r[sortKey], 14) +
        pad(String(r.initiatorType || '-'), 10) +
        pad(formatByteSize(r.transferSize), 14) +
        r.name
    );
  }
  console.log('');
}

/**
 * 从 dev / Vite `/_nuxt/@fs/.../node_modules/.pnpm/<锁文件夹>/...` 提取 pnpm 锁目录名，用于聚合。
 * @param {string} url
 * @returns {string}
 */
function pnpmBucketFromUrl(url) {
  const m = String(url).match(/node_modules\/\.pnpm\/([^/]+)\//);
  return m ? m[1] : '_other';
}

/**
 * 按 pnpm 目录聚合子资源（体积与峰值耗时；条数为合并后 URL 数近似）。
 * @param {Array<Record<string, unknown>>} merged
 */
function aggregateByPnpmBucket(merged) {
  /** @type {Map<string, { bucket: string, urlCount: number, sumTransfer: number, maxDownloadMs: number, maxWaitingMs: number, maxTotalMs: number }>} */
  const map = new Map();
  for (const r of merged) {
    const bucket = pnpmBucketFromUrl(String(r.name));
    let row = map.get(bucket);
    if (!row) {
      row = {
        bucket,
        urlCount: 0,
        sumTransfer: 0,
        maxDownloadMs: 0,
        maxWaitingMs: 0,
        maxTotalMs: 0,
      };
      map.set(bucket, row);
    }
    row.urlCount += 1;
    const ts = Number(r.transferSize) || 0;
    row.sumTransfer += ts;
    row.maxDownloadMs = Math.max(row.maxDownloadMs, Number(r.downloadMs) || 0);
    row.maxWaitingMs = Math.max(row.maxWaitingMs, Number(r.waitingMs) || 0);
    row.maxTotalMs = Math.max(row.maxTotalMs, Number(r.totalMs) || 0);
  }
  return [...map.values()].sort((a, b) => b.sumTransfer - a.sumTransfer);
}

/**
 * dev + Slow 4G：打印「最晚 responseEnd」与距 mark 的空档（同 navigation 时间原点）。
 * @param {string} title
 * @param {Array<Record<string, unknown>>} rows
 * @param {number | null} boundaryMs
 */
function printLatestResponseEndTable(title, rows, boundaryMs) {
  console.log(title);
  const pad = (s, w) => String(s).padEnd(w);
  console.log(
    pad('respEnd', 10) +
      pad('gap→mark', 10) +
      pad('start', 10) +
      pad('dlMs', 10) +
      pad('wait', 8) +
      pad('xfer', 14) +
      pad('type', 8) +
      'url'
  );
  console.log('-'.repeat(118));
  for (const r of rows) {
    const end = Number(r.responseEndMs);
    const gap =
      boundaryMs !== null && Number.isFinite(boundaryMs) && Number.isFinite(end)
        ? Math.round((boundaryMs - end) * 10) / 10
        : '-';
    console.log(
      pad(r.responseEndMs ?? '-', 10) +
        pad(gap, 10) +
        pad(r.startTimeMs ?? '-', 10) +
        pad(r.downloadMs ?? '-', 10) +
        pad(r.waitingMs ?? '-', 8) +
        pad(formatByteSize(r.transferSize), 14) +
        pad(String(r.initiatorType || '-'), 8) +
        r.name
    );
  }
  console.log(
    '  gap→mark：mount 边界时间 − responseEnd；负值表示该 URL 在 mark 之后才收完尾（仍可能拖住执行/解析）。'
  );
  console.log('');
}

/**
 * 打印主文档首字节、domContentLoaded、根 onMounted 的明确统计（相对导航 Performance 时间原点）。
 * @param {Record<string, unknown> | null} nav
 * @param {number | null | undefined} mountBoundaryMs
 * @param {string} mountMarkName
 */
function printStartupSummary(nav, mountBoundaryMs, mountMarkName) {
  console.log(
    '[startup-resource-profile] 关键里程碑（时间原点：Navigation.startTime）'
  );
  const ttfbNav =
    nav && typeof nav.ttfbFromNavStartMs === 'number'
      ? Number(nav.ttfbFromNavStartMs)
      : null;
  const dclNavEnd =
    nav && typeof nav.domContentLoadedEndFromNavStartMs === 'number'
      ? Number(nav.domContentLoadedEndFromNavStartMs)
      : null;
  const mount =
    mountBoundaryMs !== null &&
    mountBoundaryMs !== undefined &&
    Number.isFinite(Number(mountBoundaryMs))
      ? Number(mountBoundaryMs)
      : null;

  /**
   * 统一里程碑输出格式，保证控制台纵向对齐。
   * @param {string} label
   * @param {number | null} v
   */
  const one = (label, v) => {
    const val = v !== null && Number.isFinite(v) ? `${v} ms` : '（无数据）';
    console.log(`  ${String(label).padEnd(28)} ${val}`);
  };

  one('TTFB（主文档首字节）', ttfbNav);
  one('DCL（domContentLoaded 结束）', dclNavEnd);
  one(`根 onMounted（mark: ${mountMarkName}）`, mount);

  if (
    ttfbNav !== null &&
    dclNavEnd !== null &&
    Number.isFinite(ttfbNav) &&
    Number.isFinite(dclNavEnd)
  ) {
    const gap = Math.round((dclNavEnd - ttfbNav) * 10) / 10;
    one('间隔（TTFB → DCL）', gap);
  }
  if (
    dclNavEnd !== null &&
    mount !== null &&
    Number.isFinite(dclNavEnd) &&
    Number.isFinite(mount)
  ) {
    const gap = Math.round((mount - dclNavEnd) * 10) / 10;
    one('间隔（DCL → onMounted）', gap);
  }
  if (
    ttfbNav !== null &&
    mount !== null &&
    Number.isFinite(ttfbNav) &&
    Number.isFinite(mount)
  ) {
    const gap = Math.round((mount - ttfbNav) * 10) / 10;
    one('间隔（TTFB → onMounted）', gap);
  }
  console.log('');
}

async function main() {
  logStage('脚本启动，开始读取环境变量');
  const baseUrl = process.env.STARTUP_PROFILE_URL || 'http://localhost:3000/';
  const topN = envInt('STARTUP_PROFILE_TOP', 10);
  const settleMs = envInt('STARTUP_PROFILE_SETTLE_MS', 0);
  const gotoTimeout = envInt('STARTUP_PROFILE_GOTO_TIMEOUT_MS', 180000);
  /** 根 `onMounted` 在 `await useGameBootstrapData` 之后；Slow 4G 下 API 可能极慢，默认给足等待 */
  const mountWaitMs = envInt('STARTUP_PROFILE_MOUNT_WAIT_MS', 600000);
  const headed = envBool('STARTUP_PROFILE_HEADED');
  /** 默认 false：与历史行为一致，CDP 禁用缓存 */
  const useHttpCache = envBool('STARTUP_PROFILE_USE_CACHE');
  const throttlePresetName =
    process.env.STARTUP_PROFILE_THROTTLE_PRESET || 'devtools-slow-4g';
  const throttlePreset = resolveThrottlePreset(throttlePresetName);
  /** 默认 false：启用网络限速；设为 1 时不调用限速 */
  const noThrottle = envBool('STARTUP_PROFILE_NO_THROTTLE');

  logStage(
    `配置完成：url=${baseUrl}，top=${topN}，gotoTimeout=${gotoTimeout}ms，mountWait=${mountWaitMs}ms`
  );
  logStage('开始启动 Chromium');
  const launchStartedAt = Date.now();
  const browser = await launchChromiumWithAutoInstall(
    headed
      ? { headless: false }
      : {
          headless: false,
          args: ['--headless=new'],
        }
  );
  logStage(`Chromium 已启动，耗时 ${Date.now() - launchStartedAt}ms`);

  logStage('开始创建浏览器上下文');
  const contextStartedAt = Date.now();
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
  });
  logStage(`浏览器上下文已创建，耗时 ${Date.now() - contextStartedAt}ms`);

  logStage('开始创建新页面');
  const pageStartedAt = Date.now();
  const page = await context.newPage();
  logStage(`新页面已创建，耗时 ${Date.now() - pageStartedAt}ms`);

  logStage('开始创建 CDP 会话并配置网络');
  const cdpStartedAt = Date.now();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: !useHttpCache });
  if (!noThrottle) {
    try {
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: throttlePreset.latency,
        downloadThroughput: throttlePreset.downloadThroughput,
        uploadThroughput: throttlePreset.uploadThroughput,
        connectionType: throttlePreset.connectionType,
      });
    } catch {
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: throttlePreset.latency,
        downloadThroughput: throttlePreset.downloadThroughput,
        uploadThroughput: throttlePreset.uploadThroughput,
      });
    }
  }
  logStage(`CDP 网络配置完成，耗时 ${Date.now() - cdpStartedAt}ms`);

  const started = Date.now();
  logStage(`开始导航页面（waitUntil=domcontentloaded）：${baseUrl}`);
  try {
    await page.goto(baseUrl, {
      waitUntil: 'domcontentloaded',
      timeout: gotoTimeout,
    });
    logStage(`页面导航完成，耗时 ${Date.now() - started}ms`);
  } catch (e) {
    await browser.close();
    console.error(
      '[startup-resource-profile] 导航失败（请先启动 dev/preview 并检查 URL）：',
      baseUrl
    );
    console.error(e);
    if (
      String(e?.message || '').includes('ERR_CONNECTION_REFUSED') &&
      baseUrl.includes('127.0.0.1')
    ) {
      console.error(
        '\n提示：本机 `nuxt dev` 常只监听 `localhost`（IPv6 ::1）。若出现拒绝连接，请改用\n' +
          '  STARTUP_PROFILE_URL=http://localhost:3000/...\n'
      );
    }
    process.exitCode = 1;
    return;
  }

  logStage('开始等待 #__nuxt 可见');
  const nuxtVisibleStartedAt = Date.now();
  let nuxtRootVisible = false;
  try {
    await page
      .locator('#__nuxt')
      .first()
      .waitFor({
        state: 'visible',
        timeout: Math.min(gotoTimeout, 60000),
      });
    nuxtRootVisible = true;
    logStage(`#__nuxt 已可见，耗时 ${Date.now() - nuxtVisibleStartedAt}ms`);
  } catch {
    logStage(
      `等待 #__nuxt 可见超时（已继续），耗时 ${Date.now() - nuxtVisibleStartedAt}ms`
    );
    /* 仍继续采集 */
  }

  logStage(
    `开始等待根组件 mounted 标记（__TEENPATTI_APP_ROOT_MOUNTED__），超时 ${mountWaitMs}ms`
  );
  const mountFlagStartedAt = Date.now();
  try {
    await page.waitForFunction(
      () => window.__TEENPATTI_APP_ROOT_MOUNTED__ === true,
      undefined,
      { timeout: mountWaitMs }
    );
    logStage(
      `检测到根组件 mounted 标记，耗时 ${Date.now() - mountFlagStartedAt}ms`
    );
  } catch (e) {
    let diag = null;
    try {
      diag = await page.evaluate(() => ({
        readyState: document.readyState,
        hasNuxtRoot: !!document.querySelector('#__nuxt'),
        hasMountFlag: window.__TEENPATTI_APP_ROOT_MOUNTED__ === true,
        nuxtPayloadError: window.__NUXT__?.payload?.error,
      }));
    } catch {
      /* 页面可能已关或不可执行 */
    }
    await browser.close();
    console.error(
      '[startup-resource-profile] 超时：未检测到根组件 mounted 标。',
      `mark=${APP_ROOT_MOUNTED_MARK}；` +
        '根组件在 `await useGameBootstrapData` 完成前不会进入 `onMounted`（慢网或接口极慢时可拉长 `STARTUP_PROFILE_MOUNT_WAIT_MS`，当前=' +
        `${mountWaitMs}）。`
    );
    if (diag) {
      console.error(
        '[startup-resource-profile] 页面诊断（超时瞬间）：',
        JSON.stringify(diag, null, 2)
      );
    }
    console.error(e);
    process.exitCode = 1;
    return;
  }

  if (settleMs > 0) {
    logStage(`开始 mounted 后 settle 等待：${settleMs}ms`);
    await new Promise(r => setTimeout(r, settleMs));
    logStage(`mounted 后 settle 完成，耗时 ${settleMs}ms`);
  }

  logStage('开始采集 performance profile');
  const profileCollectStartedAt = Date.now();
  const {
    nav,
    resources: raw,
    mountBoundaryMs,
    resourceCountTotal,
    resourceCountWithinBoundary,
  } = await page.evaluate(collectProfileSnippet, {
    markName: APP_ROOT_MOUNTED_MARK,
  });
  logStage(
    `performance profile 采集完成，耗时 ${Date.now() - profileCollectStartedAt}ms`
  );
  const merged = mergeByUrl(raw);
  const allPhases = envBool('STARTUP_PROFILE_ALL_PHASES');
  const boundaryNum =
    mountBoundaryMs !== null && mountBoundaryMs !== undefined
      ? Number(mountBoundaryMs)
      : null;

  const totalElapsedMs = Date.now() - started;
  const condLabel = [
    useHttpCache ? '使用缓存' : '禁用缓存',
    noThrottle ? '不限速（本机默认网络）' : throttlePreset.label,
  ].join(' + ');
  console.log('');
  console.log('[startup-resource-profile] 运行概览');
  console.log(`  条件：${condLabel}`);
  console.log(`  URL：${baseUrl}`);
  console.log(
    `  onMounted 边界（${APP_ROOT_MOUNTED_MARK}）：${mountBoundaryMs ?? '（未取到 mark）'} ms`
  );
  console.log(
    `  子资源（startTime≤mark）：${resourceCountWithinBoundary}/${resourceCountTotal}`
  );
  console.log(`  等待配置：settle=${settleMs}ms，mountWait≤${mountWaitMs}ms`);
  console.log(`  总耗时（goto→采样）：${totalElapsedMs} ms`);
  console.log('');
  printStartupSummary(nav, mountBoundaryMs, APP_ROOT_MOUNTED_MARK);

  /* 一、主文档（HTML）：对应 doc「一.1 SSR 首字节」在浏览器侧可观测部分 */
  console.log(
    '[startup-resource-profile] 一、主文档（HTML）— Navigation / Resource Timing 阶段'
  );
  if (nav && typeof nav === 'object') {
    console.log(
      '  （SSR ①～⑦ 在服务端；此处 waiting/total 等为浏览器对「文档」这条请求的计时）'
    );
    const order = [
      'ttfbFromNavStartMs',
      'ttfbFromFetchStartMs',
      'ttfbFromRequestStartMs',
      'redirectMs',
      'dnsMs',
      'connectMs',
      'waitingMs',
      'downloadMs',
      'totalMs',
      'domContentLoadedMs',
      'domContentLoadedEndFromNavStartMs',
      'loadEventEndMs',
      'decodedBodySize',
      'transferSize',
    ];
    for (const key of order) {
      const v = nav[key];
      if (v !== undefined && v !== null) {
        if (key === 'decodedBodySize' || key === 'transferSize') {
          console.log(`  ${key}: ${formatByteSize(v)}`);
        } else {
          console.log(`  ${key}: ${v}`);
        }
      }
    }
  } else {
    console.log('  （未取到 navigation 条目）');
  }
  console.log('');

  /* 二、dev + 慢网：「最晚收尾」比单纯 totalMs 更接近掐点（并行时多条 totalMs 会一齐很高） */
  const topLatestEnd = topBy(merged, 'responseEndMs', topN);
  printLatestResponseEndTable(
    `[startup-resource-profile] 二、子资源 — mount 前发起且按 responseEnd 最晚 Top ${topN}（与 mark 同源计时；合并同名 URL）`,
    topLatestEnd,
    boundaryNum
  );

  /* 三、pnpm 目录聚合：看谁吃掉最多 transfer（dev 下 @fs chunk 多，聚合后好读） */
  const buckets = aggregateByPnpmBucket(merged);
  console.log(
    `[startup-resource-profile] 三、子资源 — pnpm 锁目录聚合 Top ${topN}（按 sum(transferSize) 降序；max* 为合并后 URL 的峰值）`
  );
  const padAgg = (s, w) => String(s).padEnd(w);
  console.log(
    padAgg('sumXfer', 14) +
      padAgg('urls', 6) +
      padAgg('maxDl', 8) +
      padAgg('maxWait', 8) +
      padAgg('maxTot', 8) +
      'pnpm 目录（_other=非 .pnpm 路径）'
  );
  console.log('-'.repeat(118));
  for (const row of buckets.slice(0, topN)) {
    console.log(
      padAgg(formatByteSize(row.sumTransfer), 14) +
        padAgg(row.urlCount, 6) +
        padAgg(row.maxDownloadMs, 8) +
        padAgg(row.maxWaitingMs, 8) +
        padAgg(row.maxTotalMs, 8) +
        row.bucket
    );
  }
  console.log('');

  /* 四、子资源：总耗时 totalMs（并行场景下作辅证） */
  const topTotal = topBy(merged, 'totalMs', topN);
  printRankTable(
    `[startup-resource-profile] 四、子资源 — 总耗时 totalMs Top ${topN}（仅 mark 前发起；合并同名 URL，取 max）`,
    topTotal,
    'totalMs'
  );

  /* 五、waiting / download；localhost 下 redirect/dns/connect 多为 0，默认省略 */
  const phaseKeysForTable = allPhases
    ? PHASE_KEYS.filter(k => k !== 'totalMs')
    : ['waitingMs', 'downloadMs'];
  console.log(
    `[startup-resource-profile] 五、子资源 — 各阶段耗时 Top ${topN}` +
      (allPhases
        ? '（含 redirect/dns/connect）'
        : '（仅 waiting/download；全阶段请设 STARTUP_PROFILE_ALL_PHASES=1）')
  );
  console.log('');

  for (const key of phaseKeysForTable) {
    const label = PHASE_LABELS[key] || key;
    const slice = topBy(merged, key, topN);
    printRankTable(`  [${key}] ${label}`, slice, key);
  }

  console.log(
    '说明：connect 含 TCP/TLS；复用连接时 dns/connect 常为 0。不等价 DevTools JS Bottom-Up；' +
      (noThrottle
        ? '当前不限速；dev 下首字节前等待仍可能含 Vite transform。'
        : 'dev 下首字节前等待常含 Vite transform。')
  );

  const resourcePhasesTop = {};
  for (const key of PHASE_KEYS) {
    resourcePhasesTop[key] = topBy(merged, key, topN);
  }

  if (envBool('STARTUP_PROFILE_JSON')) {
    const payload = {
      url: baseUrl,
      useHttpCache,
      noThrottle,
      mountMark: APP_ROOT_MOUNTED_MARK,
      mountBoundaryMs,
      mountWaitMs,
      resourceCountTotal,
      resourceCountWithinBoundary,
      settleMs,
      totalElapsedMs,
      allPhases,
      nav,
      resourceTopLatestResponseEndMs: topLatestEnd,
      resourcePnpmBucketsTop: buckets.slice(0, topN),
      resourceTopTotalMs: topTotal,
      resourcePhasesTop,
      /** 带时间轴字段的合并列表，便于 jq 二次分析 */
      resourcesMerged: merged,
    };
    console.log('');
    console.log(JSON.stringify(payload));
  }

  logStage('开始关闭浏览器');
  await browser.close();
  logStage('浏览器已关闭，脚本结束');
}

const argvScriptHref = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : null;

if (import.meta.url === argvScriptHref) {
  main().catch(err => {
    console.error(err);
    if (
      String(err?.message || '').includes('Executable doesn') ||
      String(err?.message || '').includes('browserType.launch')
    ) {
      console.error(
        '\n提示：请在 website 目录执行 `pnpm exec playwright install chromium`（需下载完成）。\n' +
          '无头模式使用完整 Chromium + `--headless=new`，不依赖 chromium-headless-shell 包。\n'
      );
    }
    process.exitCode = 1;
  });
}
