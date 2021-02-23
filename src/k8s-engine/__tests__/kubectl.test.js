const { spawn } = require('child_process');
const events = require('events');
const resources = require('../../resources');
const kubectl = require('../kubectl');

jest.mock('child_process');
jest.mock('../../resources');

class MockChildProcess extends events.EventEmitter {
  stdout = new events.EventEmitter();
  stderr = new events.EventEmitter();

  constructor(...args) {
    super();
    this.args = args;
  }

  succeed(message) {
    this.stdout.emit('data', message);
    this.emit('exit', 0);
  }

  fail(message) {
    this.stderr.emit('data', message);
    this.emit('exit', 1);
  }
}

describe('kubectl.js', () => {
  /** @type {MockChildProcess} */
  let child = null;
  let args;

  const consoleMethods = [console.log, console.error];
  const emptyFunc = () => {
  };

  beforeEach(() => {
    [console.log, console.error] = [emptyFunc, emptyFunc];
    resources.executable.mockReturnValue('/bin/true');
    args = ['config', 'use-context', 'morris'];
    spawn.mockImplementation((...args) => {
      child = new MockChildProcess(...args);

      return child;
    });
  });
  afterEach(() => {
    resources.executable.mockReset();
    spawn.mockReset();

    [console.log, console.error] = consoleMethods;
  });

  describe('runCommand', () => {
    it('should parse arguments correctly', async() => {
      const promise = kubectl.runCommand(args);

      child.emit('exit', 0);
      await promise;
      expect(child.args.slice(0, 2))
        .toEqual(['/bin/true', args]);
    });

    it('should return the expected value', () => {
      const promise = kubectl.runCommand(args);

      child.stdout.emit('data', 'some data');
      child.stderr.emit('data', 'ignored');
      child.emit('exit', 0);
      expect(promise)
        .resolves
        .toBe('some data');
    });

    it('should reject on non-zero exit', () => {
      const promise = kubectl.runCommand(args);

      child.stdout.emit('data', 'ignored');
      child.stderr.emit('data', 'error info');
      child.emit('exit', 1);
      promise.catch((e) => {
        expect(e.message)
          .toMatch('error info');
      });
    });
  });

  describe('waitForPods', () => {
    it('should process the lines', () => {
      const promise = kubectl.waitForPods('shazbat!');

      child.stdout.emit('data', `Every 2.0s: k get pods -n cert-manager  chirico.local: Fri Feb 19 15:39:43 2021

NAME                                       READY   STATUS    RESTARTS   AGE
cert-manager-74ddbfdfb7-qzhft              1/1     Running   0          17m
cert-manager-cainjector-86c65bdfdd-d6pld   1/1     Running   0          17m
cert-manager-webhook-65d6fb84df-x568p      1/1     Running   0          17m
`);
      child.emit('exit', 0);
      expect(promise).resolves.toBeTruthy();
    });

    fit('should wait for all the pods', () => {
      const promise1 = kubectl.waitForPods("doesn't matter");

      child.stdout.emit('data', `Every 2.0s: k get pods -n cert-manager chirico.local: Fri Feb 19 15:39:43 2021

NAME                                       READY   STATUS    RESTARTS   AGE
cert-manager-74ddbfdfb7-qzhft              1/1     Starting  0          17m
cert-manager-cainjector-86c65bdfdd-d6pld   1/1     Running   0          17m
cert-manager-webhook-65d6fb84df-x568p      1/1     CreatingContainer   0          17m
`);
      child.emit('exit', 0);
      expect(promise1).rejects.toThrowError();

      const promise2 = kubectl.waitForPods("doesn't matter");

      child.stdout.emit('data', `Every 2.0s: k get pods -n cert-manager chirico.local: Fri Feb 19 15:39:43 2021

NAME                                       READY   STATUS    RESTARTS   AGE
cert-manager-74ddbfdfb7-qzhft              1/1     Starting  0          17m
cert-manager-cainjector-86c65bdfdd-d6pld   1/1     Running   0          17m
cert-manager-webhook-65d6fb84df-x568p      1/1     CreatingContainer   0          17m
`);
      child.emit('exit', 0);
      expect(promise2).rejects.toThrowError();

      const promise3 = kubectl.waitForPods("doesn't matter");

      child.stdout.emit('data', `Every 2.0s: k get pods -n cert-manager chirico.local: Fri Feb 19 15:39:43 2021

NAME                                       READY   STATUS    RESTARTS   AGE
cert-manager-74ddbfdfb7-qzhft              1/1     Running   0          17m
cert-manager-cainjector-86c65bdfdd-d6pld   1/1     Running   0          17m
cert-manager-webhook-65d6fb84df-x568p      1/1     Running   0          17m
`);
      child.emit('exit', 0);
      expect(promise3).resolves.toBeTruthy();

      // Now let's verify that
    });
  });
});
