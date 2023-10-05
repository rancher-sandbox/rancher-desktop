export type SnapshotEvent = {
  type: 'restore' | 'delete' | 'create',
  result: 'success' | 'cancel',
  name: string
};

export type SpawnResult = {
  stdout: string,
  stderr: string,
  error?: any
};

export interface Snapshot {
  id: string,
  name: string,
  created: string,
}
