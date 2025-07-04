import events from 'events';

import { jest } from '@jest/globals';
import Electron from 'electron';

import { getIpcMainProxy } from '@pkg/main/ipcMain';
import { Log } from '@pkg/utils/logging';

type Handler = (event: Electron.IpcMainInvokeEvent, ...args: any) => Promise<unknown>;

describe('IpcMainProxy', () => {
  let log: Log;
  let emitter: E;
  let subject: ReturnType<typeof getIpcMainProxy>;

  class E extends events.EventEmitter implements Electron.IpcMain {
    protected handlers: Record<string, {once: boolean, handler: Handler}> = {};

    handle(channel: string, handler: Handler) {
      this.handleInternal(channel, handler, false);
    }

    handleOnce(channel: string, handler: Handler) {
      this.handleInternal(channel, handler, true);
    }

    protected handleInternal(channel: string, handler: Handler, once: boolean) {
      if (this.handlers[channel]) {
        throw new Error(`Already have handler for ${ channel }`);
      }
      this.handlers[channel] = { handler, once };
    }

    removeHandler(channel: string) {
      delete this.handlers[channel];
    }

    invoke(channel: string, ...args: any) {
      const data = this.handlers[channel];

      if (!data) {
        return Promise.reject(new Error(`No handler for ${ channel }`));
      }
      const { handler, once } = data;

      if (once) {
        delete this.handlers[channel];
      }

      return new Promise((resolve, reject) => {
        try {
          handler(null as any, ...args).then(resolve).catch(reject);
        } catch (ex) {
          reject(ex);
        }
      });
    }

    clear() {
      for (const ch of this.eventNames()) {
        this.removeAllListeners(ch);
      }
      for (const ch of Object.keys(this.handlers)) {
        this.removeHandler(ch);
      }
    }
  }

  beforeAll(() => {
    emitter = new E();
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeAll(() => {
    log = new Log('ipc-main-test');
    for (const meth of ['log', 'error', 'info', 'warn', 'debug', 'debugE'] as const) {
      jest.spyOn(log, meth);
    }
    subject = getIpcMainProxy(log, emitter);
  });

  afterEach(() => {
    jest.clearAllMocks();
    emitter.clear();
  });

  it('should allow adding event listeners', () => {
    const topic = 'get-app-version' as const;
    const cb = jest.fn();

    subject.on(topic, cb);
    emitter.emit(topic);
    expect(cb).toHaveBeenCalled();
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining(topic));
  });

  it('should allow removing event listeners', () => {
    const topic = 'get-app-version' as const;
    const cb = jest.fn();

    subject.on(topic, cb);
    subject.removeListener(topic, cb);
    emitter.emit(topic);
    expect(cb).not.toHaveBeenCalled();
    expect(log.debug).not.toHaveBeenCalled();
  });

  it('should allow single-use listeners', () => {
    const topic = 'get-app-version' as const;
    const cb = jest.fn();

    subject.once(topic, cb);
    emitter.emit(topic);
    emitter.emit(topic);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(log.debug).toHaveBeenCalledTimes(1);
  });

  it('should allow removing all listeners of a topic', () => {
    const topic = 'get-app-version' as const;
    const cb = jest.fn();

    subject.on(topic, cb);
    subject.removeAllListeners(topic);
    emitter.emit(topic);
    expect(cb).not.toHaveBeenCalled();
    expect(log.debug).not.toHaveBeenCalled();
  });

  it('should reject missing handlers', async() => {
    const topic = 'api-get-credentials' as const;

    await expect(emitter.invoke(topic)).rejects.toThrow(topic);
  });

  it('should allow adding event handlers', async() => {
    const topic = 'api-get-credentials' as const;

    type cbType = Parameters<typeof subject.handle<typeof topic>>[1];
    const cb = jest.fn().mockImplementation(() => Promise.resolve(1)) as cbType;

    subject.handle(topic, cb);
    await expect(emitter.invoke(topic)).resolves.not.toThrow();
    expect(cb).toHaveBeenCalled();
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining(topic));
  });

  it('should allow removing event handlers', async() => {
    const topic = 'api-get-credentials' as const;

    type cbType = Parameters<typeof subject.handle<typeof topic>>[1];
    const cb = jest.fn().mockImplementation(() => Promise.resolve(1)) as cbType;

    subject.handle(topic, cb);
    subject.removeHandler(topic);
    await expect(emitter.invoke(topic)).rejects.toThrow(topic);
    expect(cb).not.toHaveBeenCalled();
    expect(log.debug).not.toHaveBeenCalled();
  });

  it('should allow single-use event handlers', async() => {
    const topic = 'api-get-credentials' as const;

    type cbType = Parameters<typeof subject.handle<typeof topic>>[1];
    const cb = jest.fn().mockImplementation(() => Promise.resolve(1)) as cbType;

    subject.handleOnce(topic, cb);
    await expect(emitter.invoke(topic)).resolves.not.toThrow();
    await expect(emitter.invoke(topic)).rejects.toThrow(topic);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(log.debug).toHaveBeenCalledTimes(1);
  });
});
