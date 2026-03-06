/** @jest-environment node */

import { EventEmitter } from 'events';

import { jest } from '@jest/globals';

import mockModules from '@pkg/utils/testUtils/mockModules';

// Fake IPC proxy backed by a plain EventEmitter.
// ContainerExecHandler registers handlers via ipcMainProxy.on(); tests trigger
// them by emitting on fakeProxy directly.
const fakeProxy = new EventEmitter();

mockModules({
  electron:             undefined,
  '@pkg/utils/logging': undefined,
  '@pkg/main/ipcMain':  { getIpcMainProxy: jest.fn(() => fakeProxy) },
});

let ContainerExecHandler: Awaited<typeof import('@pkg/main/containerExec')>['ContainerExecHandler'];

beforeAll(async() => {
  ({ ContainerExecHandler } = await import('@pkg/main/containerExec'));
});

// ── test helpers ───────────────────────────────────────────────────────────────

/** Fake WritableReadableProcess with a spied stdin.write and kill. */
function makeProcess() {
  const proc = new EventEmitter() as any;

  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { write: jest.fn() };
  proc.kill = jest.fn();

  return proc;
}

/**
 * Fake return value for the pre-check runClient call.
 * Resolves on exit code 0, rejects with the exit code otherwise.
 */
function makeCheckProcess(exitCode = 0) {
  if (exitCode === 0) {
    return Promise.resolve({});
  }
  const err: any = new Error(`Exited with exit code ${ exitCode }`);

  err.code = exitCode;

  return Promise.reject(err);
}

/** Fake Electron WebFrameMain. */
function makeFrame() {
  return { send: jest.fn() } as any;
}

/** Fake IPC event (the first arg passed to ipcMain.on handlers). */
function makeEvent(frame = makeFrame()) {
  return { sender: frame } as any;
}

/**
 * Start a session where the `script` pre-check succeeds.
 * Returns the session proc and frame for further setup.
 */
async function startSession(handler: any, containerId: string) {
  const checkProc = makeCheckProcess(0);
  const shellProc = makeProcess();
  const frame = makeFrame();

  // runClient is called twice: first for the pre-check (exits 0), then for the real shell session.
  handler._mockClient.runClient
    .mockReturnValueOnce(checkProc)
    .mockReturnValueOnce(shellProc);

  fakeProxy.emit('container-exec/start', makeEvent(frame), containerId, undefined);

  // Let the async handler (pre-check await) run.
  await new Promise(setImmediate);

  const session = handler.sessions.get(containerId)!;

  return {
    shellProc, frame, session, containerId,
  };
}

// ── tests ──────────────────────────────────────────────────────────────────────

describe('ContainerExecHandler', () => {
  let mockClient: { runClient: jest.Mock };
  let handler: any; // access protected fields via `any`

  beforeEach(() => {
    fakeProxy.removeAllListeners();
    mockClient = { runClient: jest.fn() };
    handler = new ContainerExecHandler(mockClient as any);
    handler._mockClient = mockClient; // stored for startSession helper
  });

  // ── new session ─────────────────────────────────────────────────────────────

  describe('container-exec/start — new session', () => {
    it('runs a pre-check for script availability before starting the session', async() => {
      const checkProc = makeCheckProcess(0);
      const shellProc = makeProcess();

      mockClient.runClient
        .mockReturnValueOnce(checkProc)
        .mockReturnValueOnce(shellProc);

      fakeProxy.emit('container-exec/start', makeEvent(), 'ctr1', undefined);
      await new Promise(setImmediate);

      expect(mockClient.runClient).toHaveBeenCalledTimes(2);
      // First call: pre-check (uses 'ignore' so all stdio goes to /dev/null)
      expect(mockClient.runClient).toHaveBeenNthCalledWith(
        1,
        expect.arrayContaining(['exec', 'ctr1', 'sh', '-c', 'command -v script']),
        'ignore',
        expect.any(Object),
      );
      // Second call: real session with `script`
      expect(mockClient.runClient).toHaveBeenNthCalledWith(
        2,
        expect.arrayContaining(['exec', '-i', 'ctr1', 'script']),
        'interactive',
        expect.any(Object),
      );
    });

    it('sends container-exec/unsupported when script is not available', async() => {
      const checkProc = makeCheckProcess(127);
      const frame = makeFrame();

      mockClient.runClient.mockReturnValueOnce(checkProc);

      fakeProxy.emit('container-exec/start', makeEvent(frame), 'ctr1', undefined);
      await new Promise(setImmediate);

      expect(frame.send).toHaveBeenCalledWith('container-exec/unsupported');
      expect(mockClient.runClient).toHaveBeenCalledTimes(1);
      expect(handler.sessions.size).toBe(0);
    });

    it('passes namespace through to runClient', async() => {
      const checkProc = makeCheckProcess(0);
      const shellProc = makeProcess();

      mockClient.runClient
        .mockReturnValueOnce(checkProc)
        .mockReturnValueOnce(shellProc);

      fakeProxy.emit('container-exec/start', makeEvent(), 'ctr1', 'my-ns');
      await new Promise(setImmediate);

      expect(mockClient.runClient).toHaveBeenCalledWith(
        expect.any(Array),
        'interactive',
        expect.objectContaining({ namespace: 'my-ns' }),
      );
    });

    it('sends container-exec/ready immediately after the session is spawned', async() => {
      const { frame, containerId } = await startSession(handler, 'ctr1');

      expect(frame.send).toHaveBeenCalledWith('container-exec/ready', containerId, '');
    });

    it('forwards stdout chunks to renderer as container-exec/output', async() => {
      const { shellProc, frame, containerId } = await startSession(handler, 'ctr1');

      shellProc.stdout.emit('data', Buffer.from('hello\n'));

      expect(frame.send).toHaveBeenCalledWith('container-exec/output', containerId, 'hello\n');
    });

    it('sends container-exec/exit with the process exit code', async() => {
      const { shellProc, frame, containerId } = await startSession(handler, 'ctr1');

      shellProc.emit('exit', 42);

      expect(frame.send).toHaveBeenCalledWith('container-exec/exit', containerId, 42);
    });

    it('cleans up both session maps on process exit', async() => {
      const { shellProc } = await startSession(handler, 'ctr1');

      shellProc.emit('exit', 0);

      expect(handler.sessions.size).toBe(0);
    });
  });

  // ── output ring buffer ───────────────────────────────────────────────────────

  describe('output ring buffer', () => {
    it('accumulates stdout in outputBuf', async() => {
      const { shellProc, session } = await startSession(handler, 'ctr1');

      shellProc.stdout.emit('data', Buffer.from('line1\n'));
      shellProc.stdout.emit('data', Buffer.from('line2\n'));

      expect(session.outputBuf).toContain('line1\n');
      expect(session.outputBuf).toContain('line2\n');
    });

    it('caps outputBuf at 50 KB', async() => {
      const { shellProc, session } = await startSession(handler, 'ctr1');

      const MAX = 50 * 1024;
      const big = Buffer.alloc(MAX + 4096, 'x');

      shellProc.stdout.emit('data', big);

      expect(session.outputBuf.length).toBeLessThanOrEqual(MAX);
    });
  });

  // ── input ────────────────────────────────────────────────────────────────────

  describe('container-exec/input', () => {
    it('writes data to stdin', async() => {
      const { shellProc, containerId } = await startSession(handler, 'ctr1');

      fakeProxy.emit('container-exec/input', {}, containerId, 'ls\n');

      expect(shellProc.stdin.write).toHaveBeenCalledWith('ls\n');
    });
  });

  // ── detach ────────────────────────────────────────────────────────────────────

  describe('container-exec/detach', () => {
    it('nulls the frame and marks the session as detached', async() => {
      const { session, containerId } = await startSession(handler, 'ctr1');

      fakeProxy.emit('container-exec/detach', {}, containerId);

      expect(session.sender).toBeNull();
      expect(session.detached).toBe(true);
    });

    it('keeps the process alive after detach', async() => {
      const { shellProc, containerId } = await startSession(handler, 'ctr1');

      fakeProxy.emit('container-exec/detach', {}, containerId);

      expect(shellProc.kill).not.toHaveBeenCalled();
      expect(handler.sessions.size).toBe(1);
    });
  });

  // ── reconnect ─────────────────────────────────────────────────────────────────

  describe('container-exec/start — reconnect', () => {
    it('reattaches the frame and replays buffered history without spawning a new process', async() => {
      const { shellProc, containerId } = await startSession(handler, 'ctr1');

      shellProc.stdout.emit('data', Buffer.from('hello\n'));
      fakeProxy.emit('container-exec/detach', {}, containerId);

      const frame2 = makeFrame();

      fakeProxy.emit('container-exec/start', makeEvent(frame2), 'ctr1', undefined);
      await new Promise(setImmediate);

      // runClient was called twice for the initial session (check + shell);
      // no additional calls for the reconnect.
      expect(mockClient.runClient).toHaveBeenCalledTimes(2);
      expect(frame2.send).toHaveBeenCalledWith(
        'container-exec/ready',
        containerId,
        expect.stringContaining('hello'),
      );
    });

    it('spawns a fresh process when the previous session was killed', async() => {
      const { containerId } = await startSession(handler, 'ctr1');

      fakeProxy.emit('container-exec/kill', {}, containerId);

      // Two more runClient calls for the new session (check + shell).
      const checkProc2 = makeCheckProcess(0);
      const shellProc2 = makeProcess();

      mockClient.runClient
        .mockReturnValueOnce(checkProc2)
        .mockReturnValueOnce(shellProc2);

      fakeProxy.emit('container-exec/start', makeEvent(), 'ctr1', undefined);
      await new Promise(setImmediate);

      expect(mockClient.runClient).toHaveBeenCalledTimes(4); // 2 initial + 2 new
    });
  });

  // ── kill ──────────────────────────────────────────────────────────────────────

  describe('container-exec/kill', () => {
    it('terminates the process and removes both session entries', async() => {
      const { shellProc, containerId } = await startSession(handler, 'ctr1');

      fakeProxy.emit('container-exec/kill', {}, containerId);

      expect(shellProc.kill).toHaveBeenCalledWith('SIGTERM');
      expect(handler.sessions.size).toBe(0);
    });
  });

  // ── killAll ───────────────────────────────────────────────────────────────────

  describe('killAll', () => {
    it('kills all sessions and clears both maps', async() => {
      const { shellProc: proc1 } = await startSession(handler, 'ctr1');
      const { shellProc: proc2 } = await startSession(handler, 'ctr2');

      handler.killAll();

      expect(proc1.kill).toHaveBeenCalledWith('SIGTERM');
      expect(proc2.kill).toHaveBeenCalledWith('SIGTERM');
      expect(handler.sessions.size).toBe(0);
    });
  });
});
