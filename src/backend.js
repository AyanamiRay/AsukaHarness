import { spawn, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';

import { parseDshUrl } from './lib/dsh-url.js';
import { findFreePort, isPortFree } from './lib/port.js';

const IS_WINDOWS = process.platform === 'win32';
const START_TIMEOUT_MS = 180_000;
const MAX_TAIL_LINES = 60;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const quoteWin = (value) => {
  const text = String(value);
  return /[\s"]/.test(text) ? `"${text.replace(/"/g, '\\"')}"` : text;
};

/**
 * `dsh` on Windows is usually a `.cmd` shim, which cannot be spawned directly.
 * Route those through `cmd.exe` and keep the argument list intact.
 */
export function resolveSpawn(command, args) {
  if (IS_WINDOWS && /\.(cmd|bat)$/i.test(command)) {
    const line = [command, ...args].map(quoteWin).join(' ');
    return { file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`] };
  }
  return { file: command, args };
}

function killTree(child, signal = 'SIGTERM') {
  if (!child?.pid) return;
  if (IS_WINDOWS) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      /* already gone */
    }
  }
}

/**
 * Owns one `dsh web` child process.
 *
 * The shell does not reimplement any DSH feature: it starts the official web
 * server on loopback, captures the tokenised URL from stdout and points a
 * Chromium window at it. Everything else — models, tools, sessions, plugins —
 * is the real DSH web UI.
 */
export class DshBackend extends EventEmitter {
  #options;
  #child = null;
  #url = null;
  #port = null;
  #ready = false;
  #stopping = false;
  #pending = '';
  #tail = [];

  constructor(options) {
    super();
    this.#options = options;
  }

  get url() {
    return this.#url;
  }

  get port() {
    return this.#port;
  }

  get running() {
    return this.#child !== null;
  }

  /**
   * Start the server and resolve once its URL banner appears.
   * @returns {Promise<{url: string, port: number}>}
   */
  async start() {
    if (this.#child) throw new Error('dsh web is already running');
    if (!this.#options.command) throw new Error('dsh executable not found');

    this.#stopping = false;
    this.#ready = false;
    this.#pending = '';
    this.#tail = [];
    this.#url = null;

    const host = this.#options.host || '127.0.0.1';
    let port = this.#options.port ?? null;
    if (port && !(await isPortFree(port, host))) {
      this.emit('log', { stream: 'shell', text: `port ${port} is busy, picking a free one` });
      port = null;
    }
    if (!port) port = await findFreePort(host);
    this.#port = port;

    const args = [
      'web',
      '--no-open',
      '--host',
      host,
      '--port',
      String(port),
      ...(this.#options.extraArgs ?? []),
    ];

    const { file, args: spawnArgs } = resolveSpawn(this.#options.command, args);
    this.emit('log', { stream: 'shell', text: `$ ${this.#options.command} ${args.join(' ')}` });

    const child = spawn(file, spawnArgs, {
      cwd: this.#options.workspace || process.cwd(),
      env: this.#options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: !IS_WINDOWS,
      windowsHide: true,
    });
    this.#child = child;

    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        killTree(child, 'SIGKILL');
        reject(new Error(`dsh web did not report a URL within ${START_TIMEOUT_MS / 1000}s`));
      }, START_TIMEOUT_MS);
      timer.unref?.();

      const cleanup = () => {
        clearTimeout(timer);
        child.off('error', onError);
        child.off('exit', onExit);
      };

      const onError = (error) => {
        cleanup();
        reject(new Error(`cannot start dsh: ${error.message}`));
      };

      const onExit = (code, signal) => {
        cleanup();
        reject(
          new Error(
            `dsh web exited before it was ready (code=${code ?? 'null'} signal=${signal ?? 'none'})\n${this.#tail.join('\n')}`,
          ),
        );
      };

      child.once('error', onError);
      child.once('exit', onExit);

      const settle = (url) => {
        if (this.#ready) return;
        this.#ready = true;
        this.#url = url;
        cleanup();
        this.emit('ready', { url, port });
        resolve({ url, port });
      };

      const onData = (stream) => (chunk) => {
        const text = String(chunk);
        this.emit('log', { stream, text });
        this.#pending += text;

        const lines = this.#pending.split(/\r?\n/);
        this.#pending = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          this.#tail.push(line.trim());
          if (this.#tail.length > MAX_TAIL_LINES) this.#tail.shift();
          const url = parseDshUrl(line);
          if (url) {
            settle(url);
            return;
          }
        }

        // Some launchers print the banner without a trailing newline. Accept it
        // only when a token is present, which means the URL is complete.
        if (/dsh web:\s+https?:\/\/\S+\?token=[\w.-]{8,}\s*$/.test(this.#pending)) {
          const url = parseDshUrl(this.#pending);
          if (url) settle(url);
        }
      };

      child.stdout.on('data', onData('stdout'));
      child.stderr.on('data', onData('stderr'));
    });

    // After readiness, an exit is a crash: surface it, but never reject `start`.
    child.once('exit', (code, signal) => {
      const wasReady = this.#ready;
      this.#child = null;
      this.#ready = false;
      const stopping = this.#stopping;
      this.#stopping = false;
      // Startup failures are reported by the ready promise; only a server that
      // was serving and then died counts as a crash worth restarting.
      if (wasReady && !stopping) this.emit('crash', { code, signal });
    });

    return ready;
  }

  /** Last-resort synchronous kill for `process.on('exit')`; never throws. */
  killSync() {
    const child = this.#child;
    if (!child) return;
    if (IS_WINDOWS) {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      return;
    }
    killTree(child, 'SIGKILL');
  }

  /** Terminate the whole process tree, giving it a chance to exit cleanly. */
  async stop({ timeout = 4_000 } = {}) {
    const child = this.#child;
    if (!child) return;
    this.#stopping = true;

    const exited = new Promise((resolve) => child.once('exit', resolve));
    killTree(child, 'SIGTERM');

    const timer = setTimeout(() => killTree(child, 'SIGKILL'), timeout);
    timer.unref?.();
    await Promise.race([exited, delay(timeout + 500)]);
    clearTimeout(timer);
    this.#child = null;
    this.#ready = false;
    this.#url = null;
  }
}
