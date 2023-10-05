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

  constructor(stderr: string) {
    this.message = parseLines(stderr)[0];
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
    const response = await this.rdctl(['snapshot', 'create', snapshot.name]);

    if (response.error) {
      console.debug(response.stderr);
      throw new SnapshotsError(response.stderr);
    }
  }

  async restore(id: string) : Promise<void> {
    const response = await this.rdctl(['snapshot', 'restore', id]);

    if (response.error) {
      console.debug(response.stderr);
      throw new SnapshotsError(response.stderr);
    }
  }

  async delete(id: string) : Promise<void> {
    const response = await this.rdctl(['snapshot', 'delete', id]);

    if (response.error) {
      console.debug(response.stderr);
      throw new SnapshotsError(response.stderr);
    }
  }
}

export const Snapshots = new SnapshotsImpl();
