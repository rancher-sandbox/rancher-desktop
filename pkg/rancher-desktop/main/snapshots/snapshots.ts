import { Snapshot, SpawnResult } from '@pkg/main/snapshots/types';
import { spawnFile } from '@pkg/utils/childProcess';
import Logging from '@pkg/utils/logging';
import { getRdctlPath } from '@pkg/utils/paths';

const console = Logging.snapshots;

function parseLines(line: string): string[] {
  return line?.split(/\r?\n/) || [];
}

class SnapshotsError {
  readonly isSnapshotError = true;
  message: string;

  constructor(response: SpawnResult) {
    console.debug(response.stdout);

    try {
      const value = JSON.parse(response.stdout);

      this.message = value?.error;
    } catch (error) {
      this.message = 'Cannot parse error message from `rdctl snapshot` command';
    }
  }
}

class SnapshotsImpl {
  private async rdctl(commandArgs: string[]): Promise<SpawnResult> {
    try {
      const rdctlPath = getRdctlPath();

      return await spawnFile(rdctlPath || '', commandArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err: any) {
      return {
        stdout: err?.stdout ?? '', stderr: err?.stderr ?? '', error: err,
      };
    }
  }

  async list(): Promise<Snapshot[]> {
    const response = await this.rdctl(['snapshot', 'list', '--json']);

    if (response.error) {
      return [];
    }

    const data = parseLines(response.stdout).filter(line => line);

    return data.map(line => JSON.parse(line));
  }

  async create(snapshot: Snapshot) : Promise<void> {
    const command = [
      'snapshot',
      'create',
      snapshot.name,
      '--json',
    ];

    if (snapshot.description) {
      command.push(`--description "${ snapshot.description }"`);
    }

    const response = await this.rdctl(command);

    if (response.error) {
      throw new SnapshotsError(response);
    }
  }

  async restore(name: string) : Promise<void> {
    const response = await this.rdctl(['snapshot', 'restore', name, '--json']);

    if (response.error) {
      throw new SnapshotsError(response);
    }
  }

  async delete(name: string) : Promise<void> {
    const response = await this.rdctl(['snapshot', 'delete', name, '--json']);

    if (response.error) {
      throw new SnapshotsError(response);
    }
  }
}

export const Snapshots = new SnapshotsImpl();
