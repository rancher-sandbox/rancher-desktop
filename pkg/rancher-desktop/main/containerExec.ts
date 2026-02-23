/**
 * This module handles interactive container exec sessions for the Shell tab.
 * It manages bidirectional IPC between the renderer (xterm.js) and docker exec.
 *
 * Sessions survive frontend navigation: on "detach" the process keeps running
 * and stdout is buffered (ring buffer, 50 KB).  On reconnect the buffer is
 * replayed so the user sees the full terminal history.
 */

import Electron from 'electron';
import crypto from 'crypto';

import type { ContainerEngineClient } from '@pkg/backend/containerClient';
import type { WritableReadableProcess } from '@pkg/backend/containerClient/types';
import { getIpcMainProxy } from '@pkg/main/ipcMain';
import Logging from '@pkg/utils/logging';

const console = Logging.containerExec;
const ipcMainProxy = getIpcMainProxy(console);

const MAX_OUTPUT_BUF = 50 * 1024; // 50 KB ring buffer

function generateExecId(): string {
  return crypto.randomBytes(12).toString('hex');
}

interface ExecSession {
  process:     WritableReadableProcess;
  frame:       Electron.WebFrameMain | null;
  containerId: string;
  hasPty:      boolean | null;  // null until sentinel found
  outputBuf:   string;          // ring buffer of recent stdout
  detached:    boolean;
}

export class ContainerExecHandler {
  protected sessions            = new Map<string, ExecSession>(); // execId → session
  protected sessionsByContainer = new Map<string, string>();      // containerId → execId

  constructor(protected client: ContainerEngineClient) {
    this.initHandlers();
  }

  updateClient(client: ContainerEngineClient) {
    this.client = client;
    this.killAll();
  }

  killAll() {
    for (const [, session] of this.sessions) {
      try {
        session.process.kill('SIGTERM');
      } catch (ex) {
        console.debug('Error killing exec session:', ex);
      }
    }
    this.sessions.clear();
    this.sessionsByContainer.clear();
  }

  protected initHandlers() {
    ipcMainProxy.on('container-exec/start', (event, containerId, namespace) => {
      const sendToFrame = (channel: string, ...args: any[]) => {
        try {
          event.senderFrame?.send?.(channel, ...args);
        } catch (ex) {
          console.debug(`Failed to send ${ channel } to frame:`, ex);
        }
      };

      // Reconnect path: an existing session for this container is alive.
      const existingId = this.sessionsByContainer.get(containerId);

      if (existingId) {
        const session = this.sessions.get(existingId);

        if (session) {
          session.frame    = event.senderFrame ?? null;
          session.detached = false;
          sendToFrame('container-exec/ready', existingId, session.outputBuf, session.hasPty ?? false);

          return;
        }
        // Stale entry (process exited while detached); fall through to create new.
        this.sessionsByContainer.delete(containerId);
      }

      // New session path.
      try {
        // Try `script` inside the container for a proper PTY (echo + line-
        // buffered output).  Fall back to plain `sh -i` on images that don't
        // have `script` (e.g. Alpine/BusyBox without the applet).
        //
        // A short sentinel written to stderr tells us which branch ran so we
        // can forward `container-exec/pty` to the renderer; the renderer uses
        // this to enable local echo when no PTY is available.
        const SENTINEL_PTY  = 'RDSHELL:pty';
        const SENTINEL_NPTY = 'RDSHELL:npty';
        const shellCmd = [
          `if command -v script >/dev/null 2>&1;`,
          `then printf "${SENTINEL_PTY}\\r\\n" >&2; exec script -q -c sh /dev/null;`,
          `else printf "${SENTINEL_NPTY}\\r\\n" >&2; exec sh -i;`,
          `fi`,
        ].join(' ');

        const proc = this.client.runClient(
          ['exec', '-i', containerId, 'sh', '-c', shellCmd],
          'interactive',
          { namespace },
        );

        const execId = generateExecId();
        const session: ExecSession = {
          process:     proc,
          frame:       event.senderFrame ?? null,
          containerId,
          hasPty:      null,
          outputBuf:   '',
          detached:    false,
        };

        this.sessions.set(execId, session);
        this.sessionsByContainer.set(containerId, execId);

        const sendToSession = (channel: string, ...args: any[]) => {
          try {
            session.frame?.send?.(channel, ...args);
          } catch (ex) {
            console.debug(`Failed to send ${ channel } to frame:`, ex);
          }
        };

        proc.stdout.on('data', (data: Buffer) => {
          const text = data.toString('utf-8');

          // Accumulate in ring buffer.
          session.outputBuf += text;
          if (session.outputBuf.length > MAX_OUTPUT_BUF) {
            session.outputBuf = session.outputBuf.slice(-MAX_OUTPUT_BUF);
          }

          sendToSession('container-exec/output', execId, text);
        });

        // Buffer stderr until the sentinel arrives so we can detect PTY mode
        // before any other content reaches the renderer.
        let stderrBuf = '';
        let sentinelFound = false;

        const processStderr = (text: string) => {
          const filtered = text
            .split(/\r?\n/)
            .filter(line => !/input device is not a TTY|can't access tty|job control turned off|cannot set terminal process group|no job control in this shell/i.test(line))
            .join('\r\n');

          if (filtered.trim()) {
            sendToSession('container-exec/output', execId, filtered);
            // Also buffer stderr for history replay (e.g. shell prompts in
            // non-PTY mode arrive via stderr, not stdout).  The content
            // already uses \r\n so the replay conversion leaves it untouched.
            session.outputBuf += filtered;
            if (session.outputBuf.length > MAX_OUTPUT_BUF) {
              session.outputBuf = session.outputBuf.slice(-MAX_OUTPUT_BUF);
            }
          }
        };

        proc.stderr.on('data', (data: Buffer) => {
          const chunk = data.toString('utf-8');

          if (sentinelFound) {
            processStderr(chunk);

            return;
          }

          stderrBuf += chunk;

          const hasPty  = stderrBuf.includes(SENTINEL_PTY);
          const hasNpty = stderrBuf.includes(SENTINEL_NPTY);

          if (hasPty || hasNpty) {
            sentinelFound = true;
            session.hasPty = hasPty;
            // For new sessions: send ready (empty history) then pty event.
            sendToSession('container-exec/ready', execId, '', hasPty);
            sendToSession('container-exec/pty', execId, hasPty);
            // Strip the sentinel, then process any remaining content.
            const remaining = stderrBuf
              .replace(SENTINEL_PTY, '')
              .replace(SENTINEL_NPTY, '');

            stderrBuf = '';
            processStderr(remaining);
          }
        });

        proc.on('exit', (code) => {
          sendToSession('container-exec/exit', execId, code ?? -1);
          this.sessions.delete(execId);
          this.sessionsByContainer.delete(containerId);
        });

        proc.on('error', (err) => {
          console.error(`Exec session ${ execId } error:`, err);
          sendToSession('container-exec/output', execId, `\r\nError: ${ err.message }\r\n`);
          sendToSession('container-exec/exit', execId, -1);
          this.sessions.delete(execId);
          this.sessionsByContainer.delete(containerId);
        });
      } catch (ex) {
        console.error(`Failed to start exec session for ${ containerId }:`, ex);
        try {
          sendToFrame('container-exec/exit', '', -1);
        } catch {}
      }
    });

    ipcMainProxy.on('container-exec/input', (_, execId, data) => {
      const session = this.sessions.get(execId);

      if (session) {
        // In non-PTY mode the frontend echoes keystrokes locally (they never
        // appear in proc.stdout).  Mirror the echo into outputBuf so that
        // the replay on reconnect shows both input and output.
        // The frontend already converted \r→\n before sending, so \n means
        // "Enter was pressed".  Backspace (\x7f) is echoed as \b \b.
        if (session.hasPty === false) {
          let echoed = '';

          for (const ch of data) {
            if (ch === '\n') {
              echoed += '\r\n';
            } else if (ch === '\x7f') {
              echoed += '\b \b';
            } else if (ch >= ' ') {
              echoed += ch;
            }
          }
          if (echoed) {
            session.outputBuf += echoed;
            if (session.outputBuf.length > MAX_OUTPUT_BUF) {
              session.outputBuf = session.outputBuf.slice(-MAX_OUTPUT_BUF);
            }
          }
        }

        try {
          session.process.stdin?.write(data);
        } catch (ex) {
          console.debug(`Failed to write to exec session ${ execId }:`, ex);
        }
      }
    });

    ipcMainProxy.on('container-exec/kill', (_, execId) => {
      const session = this.sessions.get(execId);

      if (session) {
        try {
          session.process.kill('SIGTERM');
        } catch (ex) {
          console.debug(`Failed to kill exec session ${ execId }:`, ex);
        }
        this.sessions.delete(execId);
        this.sessionsByContainer.delete(session.containerId);
      }
    });

    ipcMainProxy.on('container-exec/detach', (_, execId) => {
      const session = this.sessions.get(execId);

      if (session) {
        session.frame    = null;
        session.detached = true;
      }
    });
  }
}
