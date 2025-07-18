export interface SnapshotEvent {
  type?:         'restore' | 'delete' | 'create' | 'confirm' | 'backend-lock',
  result?:       'success' | 'cancel' | 'error',
  error?:        string,
  snapshotName?: string,
  eventTime?:    string,
}

export interface SpawnResult {
  stdout: string,
  stderr: string,
  error?: any,
}

export interface SnapshotDialog {
  header:             string,
  snapshot?:          Snapshot,
  message?:           string,
  detail?:            string,
  info?:              string | null,
  showProgressBar?:   boolean,
  type?:              string,
  snapshotEventType?: SnapshotEvent['type'],
}

export interface Snapshot {
  name:         string,
  created:      string,
  description?: string,
}
