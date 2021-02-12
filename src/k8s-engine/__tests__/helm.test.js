const { spawn } = require('child_process');
const events = require('events');
const resources = require('../../resources');
const helm = require('../helm');

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

describe('helm.js', () => {
  /** @type {MockChildProcess} */
  let child = null;
  beforeEach(() => {
    resources.executable.mockReturnValue('/bin/true');
    spawn.mockImplementation((...args) => {
      child = new MockChildProcess(...args);
      return child;
    });
  });
  afterEach(() => {
    resources.executable.mockReset();
    spawn.mockReset();
  });
  describe('exec', () => {
    it('should parse arguments correctly', async () => {
      const promise = helm.exec({ key: 'value', dangling: undefined });
      child.emit('exit', 0);
      await promise;
      expect(child.args).toEqual(['/bin/true', ['--key=value', '--dangling']]);
    });

    it('should return the expected value', async () => {
      const promise = helm.exec({});
      child.stdout.emit('data', 'some data');
      child.stderr.emit('data', 'ignored');
      child.emit('exit', 0);
      expect(await promise).toEqual('some data');
    });

    it('should parse json data', async () => {
      const promise = helm.exec({ output: 'json' });
      child.stdout.emit('data', JSON.stringify({ hello: 'world' }));
      child.stderr.emit('data', 'ignored');
      child.emit('exit', 0);
      expect(await promise).toEqual({ hello: 'world' });
    });

    it('should reject on non-zero exit', async () => {
      const promise = helm.exec({});
      child.stdout.emit('data', 'ignored');
      child.stderr.emit('data', 'error info');
      child.emit('exit', 1);
      await expect(promise).rejects.toThrow(new Error('error info'));
    });
  });

  describe('list', () => {
    const args = ['ls', '--output=json', '--kube-context=rancher-desktop'];
    it('should run helm ls', async () => {
      const promise = helm.list();
      child.succeed('[{"hello":"world"}]');
      expect(await promise).toEqual([{ hello: 'world' }]);
      expect(child.args).toEqual(['/bin/true', args]);
    });

    it('should report error when failing to list', async () => {
      const promise = helm.list();
      child.fail('pikachu');
      await expect(promise).rejects
        .toThrow(new Error('Failed to list releases: pikachu'));
      expect(child.args).toEqual(['/bin/true', args]);
    });

    it('should report error with namespace when failing to list', async () => {
      const promise = helm.list('ns');
      child.fail('pikachu');
      await expect(promise).rejects
        .toThrow(new Error('Failed to list releases in namespace ns: pikachu'));
      expect(child.args).toEqual(['/bin/true', args.concat('--namespace=ns')]);
    });
  });

  describe('status', () => {
    const args = ['status', 'relname', '--output=json', '--kube-context=rancher-desktop'];
    it('should run helm status', async () => {
      const promise = helm.status('relname');
      child.succeed(JSON.stringify({ hello: 1 }));
      expect(await promise).toEqual({ hello: 1 });
      expect(child.args).toEqual(['/bin/true', args]);
    });

    it('should report error on failure', async () => {
      const promise = helm.status('relname');
      child.fail('snorlax');
      await expect(promise).rejects
        .toThrow(new Error('Failed to get status of release relname: snorlax'));
      expect(child.args).toEqual(['/bin/true', args]);
    });

    it('should report error with namespace on error', async () => {
      const promise = helm.status('relname', 'ns');
      child.fail('snorlax');
      await expect(promise).rejects
        .toThrow(new Error('Failed to get status of release ns:relname: snorlax'));
      expect(child.args).toEqual(['/bin/true', args.concat('--namespace=ns')]);
    });
  });

  describe('install', () => {
    const args = ['install', 'relname', 'chart',
      '--output=json', '--kube-context=rancher-desktop', '--wait'];
    it('should run helm install', async () => {
      const promise = helm.install('relname', 'chart');
      child.succeed(JSON.stringify({ result: 1 }));
      expect(await promise).toEqual({ result: 1 });
      expect(child.args).toEqual(['/bin/true', args]);
    });

    it('should report error on failure', async () => {
      const promise = helm.install('relname', 'chart');
      child.fail('charmander');
      await expect(promise).rejects
        .toThrow(new Error('Failed to install chart relname: charmander'));
      expect(child.args).toEqual(['/bin/true', args]);
    });

    it('should report error with namespace on failure', async () => {
      const promise = helm.install('relname', 'chart', 'ns', true);
      child.fail('charmander');
      await expect(promise).rejects
        .toThrow(new Error('Failed to install chart ns:relname: charmander'));
      expect(child.args).toEqual(['/bin/true',
        args.concat('--namespace=ns', '--create-namespace')]);
    });
  });

  describe('uninstall', () => {
    const args = ['uninstall', 'relname', '--kube-context=rancher-desktop'];
    it('should run helm uninstall', async () => {
      const promise = helm.uninstall('relname');
      child.succeed('');
      expect(await promise).toBeUndefined();
      expect(child.args).toEqual(['/bin/true', args]);
    });

    it('should report error on failure', async () => {
      const promise = helm.uninstall('relname');
      child.fail('squirtle');
      await expect(promise).rejects
        .toThrow(new Error('Failed to uninstall chart relname: squirtle'));
      expect(child.args).toEqual(['/bin/true', args]);
    });

    it('should report error with namespace on failure', async () => {
      const promise = helm.uninstall('relname', 'ns');
      child.fail('squirtle');
      await expect(promise).rejects
        .toThrow(new Error('Failed to uninstall chart ns:relname: squirtle'));
      expect(child.args).toEqual(['/bin/true', args.concat('--namespace=ns')]);
    });

    it('should not report error on release not loaded', async () => {
      const promise = helm.uninstall('relname');
      child.fail('Error: uninstall: Release not loaded: relname');
      expect(await promise).toBeUndefined();
      expect(child.args).toEqual(['/bin/true', args]);
    });

    it('should not report error on release not fonud', async () => {
      const promise = helm.uninstall('relname');
      child.fail('Failed to purge the release: release: not found');
      expect(await promise).toBeUndefined();
      expect(child.args).toEqual(['/bin/true', args]);
    });
  });
});
