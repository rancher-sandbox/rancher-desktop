const LineSplitter = /\r?\n/;
const ShaLineMatcher = /^[-\w]+-sha256:(\w+):\s*\w+\s*\|.*?\|/;
const SummaryLineMatcher = /^elapsed:.*total:/;

export default class ImageNonBuildOutputCuller {
  constructor() {
    this.buffering = true;
    this.lines = [];
    this.summaryLine = '';
  }

  addData(data) {
    // TODO (possibly): Deal with partial final lines - I haven't seen this happen yet
    const lines = data.split(LineSplitter);

    for (const rawLine of lines) {
      /* eslint-disable-next-line no-control-regex */
      const line = rawLine.replace(/\x1B\[[\d;,.]*[a-zA-Z]\r?/g, '');

      if (!this.buffering) {
        this.lines.push(line);
      } else if (SummaryLineMatcher.test(line)) {
        this.summaryLine = line;
      } else if (/^\s*$/.test(line)) {
        // do nothing
      } else {
        const m = ShaLineMatcher.exec(line);

        if (m) {
          const idx = this.lines.findIndex(elt => elt.includes(m[1]));
          const strippedLine = line.replace(/\[\d+m/g, '');

          if (idx === -1) {
            this.lines.push(strippedLine);
          } else {
            // Replace an updated line in place
            this.lines[idx] = strippedLine;
          }
        } else {
          this.buffering = false;
          if (this.summaryLine) {
            this.lines.push(this.summaryLine);
            this.summaryLine = '';
          }
          this.lines.push(line);
        }
      }
    }
  }

  getProcessedData() {
    let data = this.lines.join('\n');

    if (this.summaryLine) {
      data += `\n ${ this.summaryLine }`;
    }

    return data;
  }
}
