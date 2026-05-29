/**
 * This module handles periodic container stats polling for the Stats tab.
 * It runs `docker stats --no-stream` and `docker top` in the main process
 * (as child processes) and pushes results to the renderer via IPC events,
 * keeping the renderer event loop completely unblocked.
 */

import Electron from 'electron';

import type { ContainerEngineClient } from '@pkg/backend/containerClient';
import { getIpcMainProxy } from '@pkg/main/ipcMain';
import Logging from '@pkg/utils/logging';
import { makeSendToFrame } from '@pkg/window';

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
    for (const [containerId, session] of this.sessions) {
      clearInterval(session.timer);
      try {
        session.sender.send('container-stats/stopped', containerId);
      } catch {}
    }
    this.sessions.clear();
  }

  /**
   * Run a container CLI command, aborting via the provided signal.
   * Returns stdout on success or null on error / abort.
   */
  private async runWithTimeout(args: string[], namespace: string | undefined, signal: AbortSignal): Promise<string | null> {
    try {
      const result = await this.client.runClient(args, 'pipe', { namespace, signal });

      return result.stdout;
    } catch {
      return null;
    }
  }

  protected initHandlers() {
    ipcMainProxy.on('container-stats/start', (event, containerId, intervalSeconds, namespace) => {
      const sendToFrame = makeSendToFrame(event.sender, console);

      // Stop any existing session for this container.
      const existing = this.sessions.get(containerId);

      if (existing) {
        clearInterval(existing.timer);
      }

      let inFlight = false;

      const poll = async() => {
        if (inFlight) return;
        inFlight = true;
        const abort = new AbortController();
        const timeoutId = setTimeout(() => abort.abort(), FETCH_TIMEOUT_MS);

        try {
          // --no-stream exits after one sample so the process cleans up
          // naturally; streaming would require managing a long-lived process.
          await Promise.all([
            (async() => {
              const statsRaw = await this.runWithTimeout(
                ['stats', '--no-stream', '--format', '{{json .}}', containerId],
                namespace,
                abort.signal,
              );

              if (statsRaw?.trim()) {
                sendToFrame('container-stats/data', containerId, statsRaw.trim());
              }
            })(),
            (async() => {
              const topRaw = await this.runWithTimeout(['top', containerId], namespace, abort.signal);

              if (topRaw?.trim()) {
                sendToFrame('container-stats/processes', containerId, topRaw.trim());
              }
            })(),
          ]);
        } finally {
          clearTimeout(timeoutId);
          inFlight = false;
        }
      };

      const session: StatsSession = {
        timer:  setInterval(() => { poll().catch(console.error) }, intervalSeconds * 1_000),
        sender: event.sender,
        namespace,
      };

      this.sessions.set(containerId, session);

      // Clean up if the renderer is destroyed before it sends container-stats/stop.
      event.sender.once('destroyed', () => {
        const { sender, timer } = this.sessions.get(containerId) ?? {};

        if (sender !== event.sender) return;
        clearInterval(timer);
        this.sessions.delete(containerId);
      });

      // Fetch immediately so the first data point appears without waiting for the interval.
      poll().catch(console.error);
    });

    ipcMainProxy.on('container-stats/stop', (event, containerId) => {
      const { sender, timer } = this.sessions.get(containerId) ?? {};

      if (sender !== event.sender) return;
      clearInterval(timer);
      this.sessions.delete(containerId);
    });
  }
}
