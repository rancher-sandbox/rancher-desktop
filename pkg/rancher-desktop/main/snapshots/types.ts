export type SnapshotEvent = {
  type?: 'restore' | 'delete' | 'create',
  result?: 'success' | 'cancel' | 'error',
  error?: string,
  snapshotName?: string,
};

export type SpawnResult = {
  stdout: string,
  stderr: string,
  error?: any,
};

export interface SnapshotDialog {
  header: string,
  snapshot?: Snapshot,
  message?: string,
  detail?: string,
  info?: string | null,
  showProgressBar?: boolean,
  type?: string,
}

export interface Snapshot {
  name: string,
  created: string,
  description?: string,
}
