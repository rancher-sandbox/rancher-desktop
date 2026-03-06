/**
 * This module handles interactive container exec sessions for the Shell tab.
 * It manages bidirectional IPC between the renderer (xterm.js) and docker exec.
 *
 * Sessions survive frontend navigation: on "detach" the process keeps running
 * and stdout is buffered (ring buffer, 50 KB).  On reconnect the buffer is
 * replayed so the user sees the full terminal history.
 */

import Electron from 'electron';

import type { ContainerEngineClient } from '@pkg/backend/containerClient';
import type { WritableReadableProcess } from '@pkg/backend/containerClient/types';
import { getIpcMainProxy } from '@pkg/main/ipcMain';
import type { IpcRendererEvents } from '@pkg/typings/electron-ipc';
import Logging from '@pkg/utils/logging';

const console = Logging.containerExec;
const ipcMainProxy = getIpcMainProxy(console);

const MAX_OUTPUT_BUF = 50 * 1024; // 50 KB ring buffer

interface ExecSession {
  process:   WritableReadableProcess;
  sender:    Electron.WebContents | null;
  outputBuf: string;
  detached:  boolean;
}

export class ContainerExecHandler {
  protected sessions = new Map<string, ExecSession>(); // containerId → session

  constructor(protected client: ContainerEngineClient) {
    this.initHandlers();
  }

  updateClient(client: ContainerEngineClient) {
    this.client = client;
    this.killAll();
  }

  killAll() {
    for (const [containerId, session] of this.sessions) {
      try {
        session.process.kill('SIGTERM');
      } catch (ex) {
        console.debug(`Error killing exec session ${ containerId }:`, ex);
      }
    }
    this.sessions.clear();
  }

  protected async checkScriptAvailable(containerId: string, namespace: string | undefined): Promise<boolean> {
    try {
      // Use 'ignore' stdio so all streams go to /dev/null — no pipes to block
      // on, no stdin that keeps the Docker multiplexed connection open.
      // spawnFile resolves on exit code 0 and rejects otherwise.
      await this.client.runClient(
        ['exec', containerId, 'sh', '-c', 'command -v script'],
        'ignore',
        { namespace },
      );

      return true;
    } catch {
      return false;
    }
  }

  protected initHandlers() {
    ipcMainProxy.on('container-exec/start', async(event, containerId, namespace) => {
      const sendToFrame = <ch extends keyof IpcRendererEvents>(channel: ch, ...args: Parameters<IpcRendererEvents[ch]>) => {
        try {
          event.sender.send(channel, ...args);
        } catch (ex) {
          console.debug(`Failed to send ${ channel } to frame:`, ex);
        }
      };

      // Reconnect path: an existing session for this container is alive.
      const session = this.sessions.get(containerId);

      if (session) {
        console.debug(`[ContainerExec] reconnecting existing session for ${ containerId }`);
        session.sender = event.sender;
        session.detached = false;
        sendToFrame('container-exec/ready', containerId, session.outputBuf);

        return;
      }

      // New session path.
      try {
        // Pre-check: verify `script` is available in the container before
        // starting the session.  If it isn't, we cannot offer a good shell
        // experience (no PTY line discipline), so we surface a clear message
        // instead of falling back to a degraded mode.
        const scriptAvailable = await this.checkScriptAvailable(containerId, namespace);

        if (!scriptAvailable) {
          sendToFrame('container-exec/unsupported');

          return;
        }

        const proc = this.client.runClient(
          ['exec', '-i', containerId, 'script', '-q', '-c', 'sh', '/dev/null'],
          'interactive',
          { namespace },
        );

        const newSession: ExecSession = {
          process:   proc,
          sender:    event.sender,
          outputBuf: '',
          detached:  false,
        };

        this.sessions.set(containerId, newSession);

        const sendToSession = <ch extends keyof IpcRendererEvents>(channel: ch, ...args: Parameters<IpcRendererEvents[ch]>) => {
          try {
            newSession.sender?.send(channel, ...args);
          } catch (ex) {
            console.debug(`Failed to send ${ channel } to frame:`, ex);
          }
        };

        sendToSession('container-exec/ready', containerId, '');

        proc.stdout.on('data', (data: Buffer) => {
          const text = data.toString('utf-8');

          // Accumulate in ring buffer.
          newSession.outputBuf += text;
          if (newSession.outputBuf.length > MAX_OUTPUT_BUF) {
            newSession.outputBuf = newSession.outputBuf.slice(-MAX_OUTPUT_BUF);
          }

          sendToSession('container-exec/output', containerId, text);
        });

        proc.stderr.on('data', (data: Buffer) => {
          const text = data.toString('utf-8');

          sendToSession('container-exec/output', containerId, text);
          newSession.outputBuf += text;
          if (newSession.outputBuf.length > MAX_OUTPUT_BUF) {
            newSession.outputBuf = newSession.outputBuf.slice(-MAX_OUTPUT_BUF);
          }
        });

        proc.on('exit', (code: number | null) => {
          sendToSession('container-exec/exit', containerId, code ?? -1);
          this.sessions.delete(containerId);
        });

        proc.on('error', (err: Error) => {
          console.error(`Exec session for ${ containerId } error:`, err);
          sendToSession('container-exec/output', containerId, `\r\nError: ${ err.message }\r\n`);
          sendToSession('container-exec/exit', containerId, -1);
          this.sessions.delete(containerId);
        });
      } catch (ex) {
        console.error(`Failed to start exec session for ${ containerId }:`, ex);
        try {
          sendToFrame('container-exec/exit', '', -1);
        } catch {}
      }
    });

    ipcMainProxy.on('container-exec/input', (_, containerId, data) => {
      const session = this.sessions.get(containerId);

      try {
        session?.process.stdin?.write(data);
      } catch (ex) {
        console.debug(`Failed to write to exec session ${ containerId }:`, ex);
      }
    });

    ipcMainProxy.on('container-exec/kill', (_, containerId) => {
      const session = this.sessions.get(containerId);

      if (session) {
        try {
          session.process.kill('SIGTERM');
        } catch (ex) {
          console.debug(`Failed to kill exec session ${ containerId }:`, ex);
        }
        this.sessions.delete(containerId);
      }
    });

    ipcMainProxy.on('container-exec/detach', (_, containerId) => {
      const session = this.sessions.get(containerId);

      if (session) {
        session.sender = null;
        session.detached = true;
      }
    });
  }
}
