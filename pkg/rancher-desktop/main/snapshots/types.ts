export type SpawnResult = {
  stdout: string,
  stderr: string,
  error?: any
};

export interface Snapshot {
  id?: string,
  name: string,
  created?: Date,
}
