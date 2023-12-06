import { VMBackend, VMExecutor } from '@pkg/backend/backend';
import * as imageProcessor from '@pkg/backend/containers/containerProcessor';
import * as K8s from '@pkg/backend/k8s';
import mainEvents from '@pkg/main/mainEvents';
import * as childProcess from '@pkg/utils/childProcess';
import { executable } from '@pkg/utils/resources';

export default class NerdctContainerProcessor extends imageProcessor.ContainerProcessor {
  protected currentNamespace = 'default';

  constructor(executor: VMExecutor) {
    super(executor);

    mainEvents.on('k8s-check-state', (mgr: VMBackend) => {
      if (!this.active) {
        return;
      }
      this.isK8sReady =
        mgr.state === K8s.State.STARTED || mgr.state === K8s.State.DISABLED;
      // this.updateWatchStatus();
    });
  }

  protected get processorName() {
    return 'nerdctl';
  }

  protected async runContainerCommand(
    args: string[],
    sendNotifications = true,
  ): Promise<imageProcessor.childResultType> {
    const namespacedArgs = ['--namespace', this.currentNamespace].concat(args);

    const { stdout, stderr } = await childProcess.spawnFile(
      executable('nerdctl'),
      [...namespacedArgs],
      { stdio: ['inherit', 'pipe', 'pipe'] },
    );

    const output = stdout.toString().trim();

    if (sendNotifications) {
      stderr ? this.emit('container-process-output', stderr) : this.emit('container-process-output', output);
    }

    return {
      stdout: output,
      stderr,
    };
  }

  async getNamespacedContainers(): Promise<Array<string>> {
    const { stdout, stderr } = await childProcess.spawnFile(
      executable('nerdctl'),
      [
        'container',
        'list',
        '--namespace',
        this.currentNamespace,
        '--format="{{json .}}"',
      ],
      { stdio: ['inherit', 'pipe', 'pipe'] },
    );

    if (stderr) {
      console.log(`Error getting namespaces: ${ stderr }`, stderr);
    }

    const containers = stdout
      .split('\n')
      .filter(line => line)
      .map(line => JSON.parse(line.slice(1, -1)));

    return containers;
  }

  async getNamespaces(): Promise<Array<string>> {
    const { stdout, stderr } = await childProcess.spawnFile(
      executable('nerdctl'),
      ['namespace', 'list', '--quiet'],
      { stdio: ['inherit', 'pipe', 'pipe'] },
    );

    if (stderr) {
      console.log(`Error getting namespaces: ${ stderr }`, stderr);
    }

    return stdout
      .trim()
      .split(/\r?\n/)
      .map(line => line.trim())
      .sort();
  }
}
