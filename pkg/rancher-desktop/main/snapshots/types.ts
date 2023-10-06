export type SnapshotEvent = {
  type: 'restore' | 'delete' | 'create',
  result?: 'success' | 'cancel',
  error?: string | null,
  snapshot?: Snapshot,
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
  showLogo?: boolean,
}

export interface Snapshot {
  id: string,
  name: string,
  created: string,
}
