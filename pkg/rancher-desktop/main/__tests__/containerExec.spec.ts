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

const { ContainerExecHandler } = await import('@pkg/main/containerExec');

// ── test helpers ───────────────────────────────────────────────────────────────

/** Fake WritableReadableProcess with a spied stdin.write and kill. */
function makeProcess() {
  const proc = new EventEmitter() as any;

  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin  = { write: jest.fn() };
  proc.kill   = jest.fn();

  return proc;
}

/** Fake Electron WebFrameMain. */
function makeFrame() {
  return { send: jest.fn() } as any;
}

/** Fake IPC event (the first arg passed to ipcMain.on handlers). */
function makeEvent(frame = makeFrame()) {
  return { senderFrame: frame } as any;
}

/** Start a session and trigger the PTY/non-PTY sentinel, returning context. */
function startSession(handler: any, containerId: string, pty: boolean) {
  const proc  = makeProcess();
  const frame = makeFrame();

  handler._mockClient.runClient.mockReturnValue(proc);
  fakeProxy.emit('container-exec/start', makeEvent(frame), containerId, undefined);
  proc.stderr.emit('data', Buffer.from(pty ? 'RDSHELL:pty\r\n' : 'RDSHELL:npty\r\n'));

  const sessions: Map<string, any> = handler.sessions;
  const execId  = [...sessions.keys()].at(-1)!;
  const session = sessions.get(execId)!;

  return {
    proc, frame, session, execId,
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
    it('calls runClient with docker exec -i and the container id', () => {
      mockClient.runClient.mockReturnValue(makeProcess());
      fakeProxy.emit('container-exec/start', makeEvent(), 'ctr1', undefined);

      expect(mockClient.runClient).toHaveBeenCalledWith(
        expect.arrayContaining(['exec', '-i', 'ctr1']),
        'interactive',
        expect.any(Object),
      );
    });

    it('passes namespace through to runClient', () => {
      mockClient.runClient.mockReturnValue(makeProcess());
      fakeProxy.emit('container-exec/start', makeEvent(), 'ctr1', 'my-ns');

      expect(mockClient.runClient).toHaveBeenCalledWith(
        expect.any(Array),
        'interactive',
        expect.objectContaining({ namespace: 'my-ns' }),
      );
    });

    it('detects PTY mode from RDSHELL:pty sentinel', () => {
      const { frame } = startSession(handler, 'ctr1', true);

      expect(frame.send).toHaveBeenCalledWith('container-exec/ready', expect.any(String), '', true);
      expect(frame.send).toHaveBeenCalledWith('container-exec/pty',   expect.any(String), true);
    });

    it('detects non-PTY mode from RDSHELL:npty sentinel', () => {
      const { frame } = startSession(handler, 'ctr1', false);

      expect(frame.send).toHaveBeenCalledWith('container-exec/ready', expect.any(String), '', false);
      expect(frame.send).toHaveBeenCalledWith('container-exec/pty',   expect.any(String), false);
    });

    it('forwards stdout chunks to renderer as container-exec/output', () => {
      const { proc, frame, execId } = startSession(handler, 'ctr1', true);

      proc.stdout.emit('data', Buffer.from('hello\n'));

      expect(frame.send).toHaveBeenCalledWith('container-exec/output', execId, 'hello\n');
    });

    it('sends container-exec/exit with the process exit code', () => {
      const { proc, frame, execId } = startSession(handler, 'ctr1', true);

      proc.emit('exit', 42);

      expect(frame.send).toHaveBeenCalledWith('container-exec/exit', execId, 42);
    });

    it('cleans up both session maps on process exit', () => {
      const { proc } = startSession(handler, 'ctr1', true);

      proc.emit('exit', 0);

      expect(handler.sessions.size).toBe(0);
      expect(handler.sessionsByContainer.size).toBe(0);
    });
  });

  // ── output ring buffer ───────────────────────────────────────────────────────

  describe('output ring buffer', () => {
    it('accumulates stdout in outputBuf', () => {
      const { proc, session } = startSession(handler, 'ctr1', true);

      proc.stdout.emit('data', Buffer.from('line1\n'));
      proc.stdout.emit('data', Buffer.from('line2\n'));

      expect(session.outputBuf).toContain('line1\n');
      expect(session.outputBuf).toContain('line2\n');
    });

    it('caps outputBuf at 50 KB', () => {
      const { proc, session } = startSession(handler, 'ctr1', true);

      const MAX  = 50 * 1024;
      const big  = Buffer.alloc(MAX + 4096, 'x');

      proc.stdout.emit('data', big);

      expect(session.outputBuf.length).toBeLessThanOrEqual(MAX);
    });
  });

  // ── non-PTY input echo buffering ─────────────────────────────────────────────

  describe('container-exec/input — non-PTY echo buffering', () => {
    it('echoes printable characters into outputBuf', () => {
      const { session, execId } = startSession(handler, 'ctr1', false);

      fakeProxy.emit('container-exec/input', {}, execId, 'ls /');

      expect(session.outputBuf).toContain('ls /');
    });

    it('converts \\n (Enter) to \\r\\n in outputBuf', () => {
      const { session, execId } = startSession(handler, 'ctr1', false);

      fakeProxy.emit('container-exec/input', {}, execId, '\n');

      expect(session.outputBuf).toContain('\r\n');
    });

    it('converts \\x7f (backspace) to \\b \\b in outputBuf', () => {
      const { session, execId } = startSession(handler, 'ctr1', false);

      fakeProxy.emit('container-exec/input', {}, execId, '\x7f');

      expect(session.outputBuf).toContain('\b \b');
    });

    it('does NOT echo into outputBuf for PTY sessions', () => {
      const { session, execId } = startSession(handler, 'ctr1', true);
      const bufBefore = session.outputBuf;

      fakeProxy.emit('container-exec/input', {}, execId, 'ls\n');

      // PTY handles its own echo — buffer must not change due to input
      expect(session.outputBuf).toBe(bufBefore);
    });

    it('always writes data to stdin regardless of PTY mode', () => {
      const { proc, execId } = startSession(handler, 'ctr1', false);

      fakeProxy.emit('container-exec/input', {}, execId, 'ls\n');

      expect(proc.stdin.write).toHaveBeenCalledWith('ls\n');
    });
  });

  // ── detach ────────────────────────────────────────────────────────────────────

  describe('container-exec/detach', () => {
    it('nulls the frame and marks the session as detached', () => {
      const { session, execId } = startSession(handler, 'ctr1', true);

      fakeProxy.emit('container-exec/detach', {}, execId);

      expect(session.frame).toBeNull();
      expect(session.detached).toBe(true);
    });

    it('keeps the process alive after detach', () => {
      const { proc, execId } = startSession(handler, 'ctr1', true);

      fakeProxy.emit('container-exec/detach', {}, execId);

      expect(proc.kill).not.toHaveBeenCalled();
      expect(handler.sessions.size).toBe(1);
    });
  });

  // ── reconnect ─────────────────────────────────────────────────────────────────

  describe('container-exec/start — reconnect', () => {
    it('reattaches the frame and replays buffered history without spawning a new process', () => {
      const { proc, execId } = startSession(handler, 'ctr1', false);

      proc.stdout.emit('data', Buffer.from('hello\n'));
      fakeProxy.emit('container-exec/detach', {}, execId);

      const frame2 = makeFrame();

      fakeProxy.emit('container-exec/start', makeEvent(frame2), 'ctr1', undefined);

      expect(mockClient.runClient).toHaveBeenCalledTimes(1);
      expect(frame2.send).toHaveBeenCalledWith(
        'container-exec/ready',
        execId,
        expect.stringContaining('hello'),
        false,
      );
    });

    it('spawns a fresh process when the previous session was killed', () => {
      const proc2 = makeProcess();

      const { execId } = startSession(handler, 'ctr1', true);

      fakeProxy.emit('container-exec/kill', {}, execId);

      mockClient.runClient.mockReturnValue(proc2);
      fakeProxy.emit('container-exec/start', makeEvent(), 'ctr1', undefined);

      expect(mockClient.runClient).toHaveBeenCalledTimes(2);
    });
  });

  // ── kill ──────────────────────────────────────────────────────────────────────

  describe('container-exec/kill', () => {
    it('terminates the process and removes both session entries', () => {
      const { proc, execId } = startSession(handler, 'ctr1', true);

      fakeProxy.emit('container-exec/kill', {}, execId);

      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
      expect(handler.sessions.size).toBe(0);
      expect(handler.sessionsByContainer.size).toBe(0);
    });
  });

  // ── killAll ───────────────────────────────────────────────────────────────────

  describe('killAll', () => {
    it('kills all sessions and clears both maps', () => {
      const { proc: proc1 } = startSession(handler, 'ctr1', true);
      const { proc: proc2 } = startSession(handler, 'ctr2', true);

      handler.killAll();

      expect(proc1.kill).toHaveBeenCalledWith('SIGTERM');
      expect(proc2.kill).toHaveBeenCalledWith('SIGTERM');
      expect(handler.sessions.size).toBe(0);
      expect(handler.sessionsByContainer.size).toBe(0);
    });
  });
});
