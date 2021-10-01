const LineSplitter = /\r?\n/;

export default class ImageBuildOutputCuller {
  constructor() {
    this.lines = [];
  }

  addData(data) {
    // TODO (possibly): Deal with partial final lines - I haven't seen this happen yet
    const lines = data.split(LineSplitter);

    this.lines.push(...lines);
  }

  getProcessedData() {
    return this.lines.join('\n');
  }
}
