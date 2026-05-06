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
  const child = spawn(command, args, {
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
const serverUrl = process.env.STARTUP_PROFILE_URL || 'http://localhost:8788/';
const serverReadyTimeoutMs = envInt('STARTUP_PROFILE_SERVER_WAIT_MS', 120000);
const useRemote = envBool('STARTUP_PROFILE_CF_REMOTE');
const wranglerCommand = resolveCommand('wrangler');
const nodeCommand = process.execPath;
const parsedServerUrl = new URL(serverUrl);
const wranglerPort = parsedServerUrl.port || '8788';
const wranglerArgs = ['--cwd', 'dist', 'pages', 'dev', '--port', wranglerPort];

if (useRemote) {
  wranglerArgs.push('--remote');
} else {
  wranglerArgs.push('--local');
}

let wranglerChild;

const cleanup = async () => {
  await terminateChild(wranglerChild, 'wrangler pages dev');
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
  if (shouldRunBuild) {
    log('运行 build');
    await runCommand(resolveCommand('pnpm'), ['build']);
  } else {
    log('跳过 build（STARTUP_PROFILE_SKIP_ANALYZE=1）');
  }

  await stopExistingLocalServerIfNeeded(serverUrl);

  log(
    `启动 Cloudflare Pages 本地服务: ${wranglerCommand} ${wranglerArgs.join(' ')}`
  );
  wranglerChild = startPersistentCommand(wranglerCommand, wranglerArgs);

  wranglerChild.on('error', error => {
    console.error('[profile-cloudflare-startup] wrangler 启动失败:', error);
  });

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
