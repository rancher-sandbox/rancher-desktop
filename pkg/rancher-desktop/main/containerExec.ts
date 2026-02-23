/**
 * This module handles interactive container exec sessions for the Shell tab.
 * It manages bidirectional IPC between the renderer (xterm.js) and docker exec.
 */

import Electron from 'electron';

import type { ContainerEngineClient } from '@pkg/backend/containerClient';
import type { WritableReadableProcess } from '@pkg/backend/containerClient/types';
import { getIpcMainProxy } from '@pkg/main/ipcMain';
import Logging from '@pkg/utils/logging';

const console = Logging.containerExec;
const ipcMainProxy = getIpcMainProxy(console);

interface ExecSession {
  process: WritableReadableProcess;
  frame:   Electron.WebFrameMain | null;
}

export class ContainerExecHandler {
  protected sessions = new Map<string, ExecSession>();

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
  }

  protected initHandlers() {
    ipcMainProxy.on('container-exec/start', (event, execId, containerId, namespace) => {
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
        const session: ExecSession = { process: proc, frame: event.senderFrame ?? null };

        this.sessions.set(execId, session);

        const sendToFrame = (channel: string, ...args: any[]) => {
          try {
            session.frame?.send?.(channel, ...args);
          } catch (ex) {
            console.debug(`Failed to send ${ channel } to frame:`, ex);
          }
        };

        proc.stdout.on('data', (data: Buffer) => {
          sendToFrame('container-exec/output', execId, data.toString('utf-8'));
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
            sendToFrame('container-exec/output', execId, filtered);
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
            sendToFrame('container-exec/pty', execId, hasPty);
            // Strip the sentinel, then process any remaining content.
            const remaining = stderrBuf
              .replace(SENTINEL_PTY, '')
              .replace(SENTINEL_NPTY, '');

            stderrBuf = '';
            processStderr(remaining);
          }
        });

        proc.on('exit', (code) => {
          sendToFrame('container-exec/exit', execId, code ?? -1);
          this.sessions.delete(execId);
        });

        proc.on('error', (err) => {
          console.error(`Exec session ${ execId } error:`, err);
          sendToFrame('container-exec/output', execId, `\r\nError: ${ err.message }\r\n`);
          sendToFrame('container-exec/exit', execId, -1);
          this.sessions.delete(execId);
        });
      } catch (ex) {
        console.error(`Failed to start exec session ${ execId }:`, ex);
        try {
          event.senderFrame?.send?.('container-exec/exit', execId, -1);
        } catch {}
      }
    });

    ipcMainProxy.on('container-exec/input', (_, execId, data) => {
      const session = this.sessions.get(execId);

      if (session) {
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
      }
    });
  }
}
