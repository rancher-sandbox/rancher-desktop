const LineSplitter = /\r?\n/;
// eslint-disable-next-line no-control-regex -- Need to catch ANSI control
const logFormat = /^[-\d]+T[-:.\d]+Z?\s+\x1B\[\d+m([A-Z]+)\x1B\[\d+m\s+(.*)$/;

const CVEKeys = ['Package', 'VulnerabilityID', 'Severity', 'Title', 'InstalledVersion', 'FixedVersion', 'Description', 'PrimaryURL'];
const severityRatings: Record<string, number> = {
  LOW:      1,
  MEDIUM:   2,
  HIGH:     3,
  CRITICAL: 4,
  UNKNOWN:  5,
};
const MaxSeverityRating = Math.max(...Object.values(severityRatings));

type finalVulType = Record<string, string>;

export default class TrivyScanImageOutputCuller {
  prelimLines: string[];
  JSONLines:   string[];
  inJSON = false;

  constructor() {
    this.prelimLines = [];
    this.JSONLines = [];
  }

  getRating(key: string) {
    return key in severityRatings ? severityRatings[key] : MaxSeverityRating;
  }

  fixLines(lines: string[]) {
    // "key": "value with an escaped \' single quote isn't valid json"
    return lines.map(line => line.replace(/\\'/g, "'"));
  }

  addData(data: string): void {
    if (this.inJSON) {
      this.JSONLines.push(data.replace(/\\'/g, "'"));

      return;
    }
    const lines = data.split(LineSplitter);
    const jsonStartIndex = lines.indexOf('[');

    if (jsonStartIndex >= 0) {
      this.prelimLines = this.prelimLines.concat(lines.slice(0, jsonStartIndex));
      this.inJSON = true;
      this.JSONLines = this.fixLines(lines.slice(jsonStartIndex));
    } else {
      this.prelimLines = this.prelimLines.concat(lines);
    }
  }

  getProcessedData() {
    const prelimLines = this.prelimLines.map(line => line.replace(logFormat, '$1 $2'));

    if (!this.inJSON) {
      // No JSON, just so return the lines we have
      return prelimLines.join('\n');
    }
    let core;

    try {
      core = JSON.parse(this.JSONLines.join(''));
    } catch (e) {
      console.log(`Error json parsing ${ this.JSONLines.join('') }`);

      return prelimLines.join('\n');
    }
    const detailLines: string[] = [];

    core.forEach((targetWithVuls: Record<string, any>) => {
      const target = targetWithVuls['Target'];
      const sourceVulnerabilities = targetWithVuls['Vulnerabilities'];

      if (!sourceVulnerabilities.length) {
        return;
      }
      detailLines.push(`Target: ${ target }`, '');

      const processedVulnerabilities: finalVulType[] = sourceVulnerabilities.map((v: any) => {
        const record: finalVulType = {};

        CVEKeys.forEach((key) => {
          if (v[key]) {
            record[key] = v[key];
          }
        });

        return record;
      });

      processedVulnerabilities.sort();
      processedVulnerabilities.sort((a, b) => {
        return this.getRating(b['Severity']) - this.getRating(a['Severity']);
      });

      processedVulnerabilities.forEach((vul) => {
        CVEKeys.forEach((key) => {
          if (key in vul) {
            detailLines.push(`${ key }: ${ vul[key] }`);
          }
        });
        detailLines.push('');
      });
    });

    return prelimLines.concat(detailLines).join('\n');
  }
}
