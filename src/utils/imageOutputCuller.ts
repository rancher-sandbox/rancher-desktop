const LineSplitter = /\r\n?|\n/;
const LineParser = /^([-\w]+-sha256:)(\w+):(\s*)(\w+)(\s*)(\|.*?\|)/;
const SummaryLine = /^elapsed:.*total:/;

export default class ImageOutputCuller {
  private buffering: boolean;
  readonly lines: string[];
  private summaryLine: string;
  constructor() {
    this.buffering = true;
    this.lines = [];
    this.summaryLine = '';
  }

  addData(data: string): void {
    //TODO: Deal with partial final lines
    const lines = data.split(LineSplitter);
    lines.forEach((line) => {
      if (!this.buffering) {
        this.lines.push(line);
      } else if (SummaryLine.test(line)) {
        this.summaryLine = line;
      } else if (/^\s*$/.test(line)) {
        // do nothing
      } else {
        const m = LineParser.exec(line);
        if (m) {
          const LineParser = /^([-\w]+-sha256):(\w+):(\s*)(\w+)(\s*)(\|.*?\|)/;
          const idx = this.lines.findIndex((elt: string) => elt.includes(m[2]));

          if (idx === -1) {
            this.lines.push(line);
          } else {
            // Replace an updated line in place
            this.lines[idx] = line;
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
    });
  }

  getProcessedData(): string {
    let data = this.lines.join("\n");
    if (this.summaryLine) {
      data += "\n" + this.summaryLine;
    }

    return data;
  }
}
