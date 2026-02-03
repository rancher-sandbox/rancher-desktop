const LineSplitter = /\r?\n/;
const ShaLineMatcher = /^[-\w]+-sha256:(\w+):\s*\w+\s*\|.*?\|/;
// this line appears only in nerdctl output for pull commands:
const SummaryLine1Matcher = /:\s*resolv(?:ing|ed)\s*\|/;
// this line appears in both containerd/buildkit and nerdctl pull output
const SummaryLine2Matcher = /^elapsed:.*total:/;

export default class ImageNonBuildOutputCuller {
  buffering:    boolean;
  lines:        string[];
  summaryLine1: string;
  summaryLine2: string;

  constructor() {
    this.buffering = true;
    this.lines = [];
    this.summaryLine1 = '';
    this.summaryLine2 = '';
  }

  addData(data: string) {
    // TODO (possibly): Deal with partial final lines - I haven't seen this happen yet
    const lines = data.split(LineSplitter);

    for (const rawLine of lines) {
      /* eslint-disable-next-line no-control-regex */
      const line = rawLine.replace(/\x1B\[[\d;,.]*[a-zA-Z]\r?/g, '');

      if (!this.buffering) {
        this.lines.push(line);
      } else if (SummaryLine1Matcher.test(line)) {
        this.summaryLine1 = line;
      } else if (SummaryLine2Matcher.test(line)) {
        this.summaryLine2 = line;
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
          if (this.summaryLine1) {
            this.lines.push(this.summaryLine1);
            this.summaryLine1 = '';
          }
          if (this.summaryLine2) {
            this.lines.push(this.summaryLine2);
            this.summaryLine2 = '';
          }
          this.lines.push(line);
        }
      }
    }
  }

  getProcessedData() {
    const lines = ([] as string[]).concat(this.lines);

    if (this.summaryLine1) {
      lines.push(this.summaryLine1);
    }
    if (this.summaryLine2) {
      lines.push(this.summaryLine2);
    }

    return lines.join('\n');
  }
}
