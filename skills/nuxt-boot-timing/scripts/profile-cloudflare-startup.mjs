#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { URL } from 'node:url';

function envBool(name) {
  return ['1', 'true', 'yes'].includes(
    String(process.env[name] ?? '').toLowerCase()
  );
}

function envInt(name, fallback) {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function log(message) {
  console.log(`[profile-cloudflare-startup] ${message}`);
}

function quoteShellArg(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function resolveCommand(binName) {
  const localBin = join(process.cwd(), 'node_modules', '.bin', binName);
  if (existsSync(localBin)) {
    return localBin;
  }
  return binName;
}

async function runCommand(command, args, opts = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd ?? process.cwd(),
      env: opts.env ?? process.env,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(`命令执行失败: ${command} ${args.join(' ')}（exit=${code}）`)
      );
    });
  });
}

async function waitForHttpReady(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(3000),
      });
      if (response.status < 500) {
        return;
      }
    } catch {}

    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  throw new Error(`等待服务就绪超时: ${url}（timeout=${timeoutMs}ms）`);
}

async function isHttpReady(url) {
  try {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(3000),
    });
    return response.status < 500;
  } catch {
    return false;
  }
}

function startPersistentCommand(command, args, opts = {}) {
  const fileDescriptorLimit = opts.fileDescriptorLimit;
  const shouldRaiseFileDescriptorLimit =
    Number.isFinite(fileDescriptorLimit) &&
    Number(fileDescriptorLimit) > 0 &&
    process.platform !== 'win32';
  const spawnCommand = shouldRaiseFileDescriptorLimit ? 'sh' : command;
  const spawnArgs = shouldRaiseFileDescriptorLimit
    ? [
        '-lc',
        `ulimit -n ${Number(fileDescriptorLimit)} >/dev/null 2>&1 || true; exec ${[command, ...args].map(quoteShellArg).join(' ')}`,
      ]
    : args;

  const child = spawn(spawnCommand, spawnArgs, {
    cwd: opts.cwd ?? process.cwd(),
    env: opts.env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.on('data', chunk => {
    process.stdout.write(chunk);
  });
  child.stderr?.on('data', chunk => {
    if (child.suppressShutdownStderr) return;
    process.stderr.write(chunk);
  });

  return child;
}

async function terminateChild(child, name) {
  if (!child || child.killed || child.exitCode !== null) return;

  await new Promise(resolve => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, 5000);

    child.once('close', () => {
      clearTimeout(timer);
      resolve();
    });

    log(`停止 ${name}`);
    /**
     * `wrangler pages dev` 退出时偶发 esbuild Go runtime deadlock dump；此时 profile 已完成，
     * 属于预期关闭阶段的工具链噪音，避免污染性能报告。
     */
    child.suppressShutdownStderr = true;
    child.kill('SIGTERM');
  });
}

function isLocalHostname(hostname) {
  return ['127.0.0.1', 'localhost', '0.0.0.0', '::1'].includes(hostname);
}

function findListeningPids(port) {
  try {
    const output = execFileSync(
      'lsof',
      ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }
    );
    return output
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function terminatePid(pid, label) {
  await new Promise(resolve => {
    const child = spawn('kill', ['-TERM', pid], { stdio: 'ignore' });

    child.once('close', () => {
      const timer = setTimeout(() => {
        spawn('kill', ['-KILL', pid], { stdio: 'ignore' }).once(
          'close',
          resolve
        );
      }, 5000);

      const poll = setInterval(() => {
        try {
          process.kill(Number(pid), 0);
        } catch {
          clearInterval(poll);
          clearTimeout(timer);
          resolve();
        }
      }, 250);
    });
  });

  log(`已停止 ${label}（pid=${pid}）`);
}

async function stopExistingLocalServerIfNeeded(serverUrl) {
  const { hostname, port } = new URL(serverUrl);
  if (!isLocalHostname(hostname)) {
    return;
  }

  if (!(await isHttpReady(serverUrl))) {
    return;
  }

  const pids = findListeningPids(port || '80');
  if (pids.length === 0) {
    log(
      `检测到 ${serverUrl} 可访问，但未解析到本地监听进程，继续尝试启动新服务`
    );
    return;
  }

  log(`检测到 ${serverUrl} 已有本地服务，先停止旧进程: ${pids.join(', ')}`);
  for (const pid of pids) {
    await terminatePid(pid, `占用 ${serverUrl} 的本地服务`);
  }
}

const shouldRunBuild = !envBool('STARTUP_PROFILE_SKIP_ANALYZE');
const serverMode = String(
  process.env.STARTUP_PROFILE_SERVER_MODE || 'cloudflare'
).toLowerCase();
if (!['cloudflare', 'dev'].includes(serverMode)) {
  throw new Error(
    `不支持的 STARTUP_PROFILE_SERVER_MODE=${serverMode}（仅支持 cloudflare 或 dev）`
  );
}
const defaultServerUrl =
  serverMode === 'dev' ? 'http://localhost:3000/' : 'http://localhost:8788/';
const serverUrl = process.env.STARTUP_PROFILE_URL || defaultServerUrl;
const serverReadyTimeoutMs = envInt('STARTUP_PROFILE_SERVER_WAIT_MS', 120000);
const useRemote = envBool('STARTUP_PROFILE_CF_REMOTE');
const wranglerCommand = resolveCommand('wrangler');
const pnpmCommand = resolveCommand('pnpm');
const nodeCommand = process.execPath;
const parsedServerUrl = new URL(serverUrl);
const wranglerPort = parsedServerUrl.port || '8788';
const wranglerArgs = ['--cwd', 'dist', 'pages', 'dev', '--port', wranglerPort];
const devArgsRaw = String(process.env.STARTUP_PROFILE_DEV_ARGS || '').trim();
const devArgs = devArgsRaw ? devArgsRaw.split(/\s+/).filter(Boolean) : ['dev'];
const devUlimitNoFile = envInt('STARTUP_PROFILE_DEV_ULIMIT_NOFILE', 65536);
const devUsePolling = !envBool('STARTUP_PROFILE_DEV_DISABLE_POLLING');
const devPollIntervalMs = envInt('STARTUP_PROFILE_DEV_POLL_INTERVAL_MS', 1000);
const devPort = parsedServerUrl.port || '3000';
const resolvedDevArgs =
  devArgs.length === 1 && devArgs[0] === 'dev'
    ? ['dev', '--port', devPort]
    : devArgs;

if (useRemote) {
  wranglerArgs.push('--remote');
} else {
  wranglerArgs.push('--local');
}

let serverChild;

const cleanup = async () => {
  const serverName =
    serverMode === 'dev'
      ? `pnpm ${resolvedDevArgs.join(' ')}`
      : 'wrangler pages dev';
  await terminateChild(serverChild, serverName);
};

process.on('SIGINT', async () => {
  await cleanup();
  process.exit(130);
});

process.on('SIGTERM', async () => {
  await cleanup();
  process.exit(143);
});

try {
  if (serverMode === 'cloudflare' && shouldRunBuild) {
    log('运行 build');
    await runCommand(pnpmCommand, ['build']);
  } else if (serverMode === 'cloudflare') {
    log('跳过 build（STARTUP_PROFILE_SKIP_ANALYZE=1）');
  } else if (shouldRunBuild) {
    log('dev 模式下忽略 build（仅 cloudflare 模式会构建）');
  } else {
    log('dev 模式：跳过 build');
  }

  await stopExistingLocalServerIfNeeded(serverUrl);

  if (serverMode === 'cloudflare') {
    log(
      `启动 Cloudflare Pages 本地服务: ${wranglerCommand} ${wranglerArgs.join(' ')}`
    );
    serverChild = startPersistentCommand(wranglerCommand, wranglerArgs);
    serverChild.on('error', error => {
      console.error('[profile-cloudflare-startup] wrangler 启动失败:', error);
    });
  } else {
    log(`启动 Nuxt dev 服务: ${pnpmCommand} ${resolvedDevArgs.join(' ')}`);
    if (process.platform !== 'win32') {
      log(`提升文件句柄上限（ulimit -n）到: ${devUlimitNoFile}`);
    }
    if (devUsePolling) {
      log(
        `启用 polling 文件监听以规避 EMFILE（interval=${devPollIntervalMs}ms）`
      );
    }
    const devEnv = {
      ...process.env,
      ...(devUsePolling
        ? {
            CHOKIDAR_USEPOLLING: '1',
            CHOKIDAR_INTERVAL: String(devPollIntervalMs),
            WATCHPACK_POLLING: 'true',
          }
        : {}),
    };
    serverChild = startPersistentCommand(pnpmCommand, resolvedDevArgs, {
      fileDescriptorLimit: devUlimitNoFile,
      env: devEnv,
    });
    serverChild.on('error', error => {
      console.error('[profile-cloudflare-startup] dev 服务启动失败:', error);
    });
  }

  log(`等待服务就绪: ${serverUrl}`);
  await waitForHttpReady(serverUrl, serverReadyTimeoutMs);

  log('执行 startup resource profile');
  await runCommand(nodeCommand, ['scripts/startup-resource-profile.mjs'], {
    env: {
      ...process.env,
      STARTUP_PROFILE_URL: serverUrl,
    },
  });
} finally {
  await cleanup();
}
