/**
 * This module handles periodic container stats polling for the Stats tab.
 * It runs `docker stats --no-stream` and `docker top` in the main process
 * (as child processes) and pushes results to the renderer via IPC events,
 * keeping the renderer event loop completely unblocked.
 */

import Electron from 'electron';

import type { ContainerEngineClient } from '@pkg/backend/containerClient';
import { getIpcMainProxy } from '@pkg/main/ipcMain';
import type { IpcRendererEvents } from '@pkg/typings/electron-ipc';
import Logging from '@pkg/utils/logging';

const console = Logging.containerStats;
const ipcMainProxy = getIpcMainProxy(console);

/** Timeout (ms) for a single `docker stats --no-stream` or `docker top` call. */
const FETCH_TIMEOUT_MS = 8_000;

interface StatsSession {
  timer:     ReturnType<typeof setInterval>;
  sender:    Electron.WebContents;
  namespace: string | undefined;
}

export class ContainerStatsHandler {
  protected sessions = new Map<string, StatsSession>();

  constructor(protected client: ContainerEngineClient) {
    this.initHandlers();
  }

  updateClient(client: ContainerEngineClient) {
    this.client = client;
    this.stopAll();
  }

  stopAll() {
    for (const session of this.sessions.values()) {
      clearInterval(session.timer);
    }
    this.sessions.clear();
  }

  /**
   * Run a container CLI command with a timeout.  Returns stdout on success or
   * null on error / timeout.
   */
  private async runWithTimeout(args: string[], namespace: string | undefined): Promise<string | null> {
    const timeout = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), FETCH_TIMEOUT_MS);
    });

    const run = (async() => {
      try {
        const result = await this.client.runClient(args, 'pipe', { namespace });

        return result.stdout;
      } catch {
        return null;
      }
    })();

    return Promise.race([run, timeout]);
  }

  protected initHandlers() {
    ipcMainProxy.on('container-stats/start', (event, containerId, intervalSeconds, namespace) => {
      // Stop any existing session for this container.
      const existing = this.sessions.get(containerId);

      if (existing) {
        clearInterval(existing.timer);
      }

      const sendToFrame = <ch extends keyof IpcRendererEvents>(channel: ch, ...args: Parameters<IpcRendererEvents[ch]>) => {
        try {
          event.sender.send(channel, ...args);
        } catch (ex) {
          console.debug(`Failed to send ${ channel } to frame:`, ex);
        }
      };

      const poll = async() => {
        const [statsRaw, topRaw] = await Promise.all([
          this.runWithTimeout(
            ['stats', '--no-stream', '--format', '{{json .}}', containerId],
            namespace,
          ),
          this.runWithTimeout(['top', containerId], namespace),
        ]);

        if (statsRaw?.trim()) {
          sendToFrame('container-stats/data', containerId, statsRaw.trim());
        }
        if (topRaw?.trim()) {
          sendToFrame('container-stats/processes', containerId, topRaw.trim());
        }
      };

      const session: StatsSession = {
        timer:  setInterval(() => { poll().catch(console.error) }, intervalSeconds * 1_000),
        sender: event.sender,
        namespace,
      };

      this.sessions.set(containerId, session);

      // Fetch immediately so the first data point appears without waiting for the interval.
      poll().catch(console.error);
    });

    ipcMainProxy.on('container-stats/stop', (_, containerId) => {
      const session = this.sessions.get(containerId);

      if (session) {
        clearInterval(session.timer);
        this.sessions.delete(containerId);
      }
    });
  }
}
