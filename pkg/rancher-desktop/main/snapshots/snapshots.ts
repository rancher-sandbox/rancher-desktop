import { spawnFile } from '@pkg/utils/childProcess';
import Logging from '@pkg/utils/logging';
import { getRdctlPath } from '@pkg/utils/paths';

import { Snapshot, SpawnResult } from './types';

const console = Logging.snapshots;

function parseFields(line: string): string[] {
  return line?.split(/\s{2,}/) || [];
}

function parseLines(line: string): string[] {
  return line?.split(/\r?\n/) || [];
}

function parseRows(response: SpawnResult) {
  const data = parseLines(response.stdout).filter(line => line);
  const [header, ...lines] = data;

  const fields = parseFields(header);

  return lines.map(line => fields.reduce((acc, f, index) => ({
    ...acc,
    [f.toLowerCase()]: parseFields(line)[index],
  }), {} as Snapshot));
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
    const response = await this.rdctl(['snapshot', 'list']);

    if (response.stderr) {
      return [];
    }

    return parseRows(response);
  }

  async create(snapshot: Snapshot) : Promise<void> {
    const response = await this.rdctl(['snapshot', 'create', snapshot.name]);

    if (response.stderr) {
      console.debug(response.stderr);
      throw new SnapshotsError(response.stderr);
    }
  }

  async restore(id: string) : Promise<void> {
    const response = await this.rdctl(['snapshot', 'restore', id]);

    if (response.stderr) {
      console.debug(response.stderr);
      throw new SnapshotsError(response.stderr);
    }
  }

  async delete(id: string) : Promise<void> {
    const response = await this.rdctl(['snapshot', 'delete', id]);

    if (response.stderr) {
      console.debug(response.stderr);
      throw new SnapshotsError(response.stderr);
    }
  }
}

export const Snapshots = new SnapshotsImpl();
