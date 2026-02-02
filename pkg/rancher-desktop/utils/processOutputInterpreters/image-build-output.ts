const LineSplitter = /\r?\n/;

export default class ImageBuildOutputCuller {
  lines: string[];

  constructor() {
    this.lines = [];
  }

  addData(data: string): void {
    // TODO (possibly): Deal with partial final lines - I haven't seen this happen yet
    const lines = data.split(LineSplitter);

    this.lines.push(...lines);
  }

  getProcessedData(): string {
    return this.lines.join('\n');
  }
}
