// This file creates the summary table at the end of the run.
//
// Inputs:
//   */version.txt   -- The version of Rancher Desktop tested
//   */name.txt      -- The test suite that was ran
//   */os.txt        -- The OS the test was run on
//   */engine.txt    -- The container engine used
//   */log-name.txt  -- The name of the logs artifact
//   */report.tap    -- The results
// Environment:
//   GITHUB_API_URL, GITHUB_RUN_ID, GITHUB_REPOSITORY, GITHUB_SERVER_URL
//     See https://docs.github.com/en/actions/learn-github-actions/variables#default-environment-variables
//   GITHUB_TOKEN
//     GitHub authorization token.

// @ts-check
import fs from 'fs';
import path from 'path';

/**
 * Define interface for emitting one line of output.
 * @typedef {(line: string) => unknown} OutputMethod
 */

class Run {
  /** Contents of version.txt. */
  versionData = '';
  /** Contents of name.txt. */
  name = '';
  /** Contents of os.txt. */
  os = '';
  /** Contents of engine.txt. */
  engine = '';
  /** Contents of log-name.txt. */
  logName = '';
  /** Total number of tests. */
  total = 0;
  /** Number of tests passed (not skipped). */
  passed = 0;
  /** Number of tests skipped. */
  skipped = 0;
  /** Number of tests failed. */
  failed = 0;
  /** Job ID; this may not be set. */
  id = 0;
  /** ID for the logs artifact; might be missing. */
  logId = 0;
  /** Number of tests passed or skipped. */
  get ok() { return this.passed + this.skipped };
  /** Whether this run succeeded. */
  get succeeded() { return this.ok == this.total };
  /** Version string for this run. */
  get version() {
    let v = this.versionData;
    for (const prefix of ['Rancher Desktop-', 'rancher-desktop-', 'Rancher.Desktop.Setup.']) {
      if (v.startsWith(prefix)) {
        v = v.substring(prefix.length);
      }
    }
    const suffixes = ['.msi'];
    for (const platform of ['linux', 'arm64-mac', 'mac', 'win']) {
      suffixes.push(`-${ platform }.zip`);
    }
    for (const suffix of suffixes) {
      if (v.endsWith(suffix)) {
        v = v.substring(0, v.length - suffix.length);
      }
    }
    return v;
  }
  /** The column for this run. */
  get column() { return `${ this.os } ${ this.engine }` }
}

/**
 * Read the runs in the current directory.
 * @returns {Promise<Run[]>}
 */
async function readRuns() {
  /** @type Run[] */
  const runs = [];

  for (const entry of await fs.promises.readdir('.', { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    try {
      /**
       * Return the contents of a file relative to the entry directory.
       * @param {string} relPath The name of the file to read.
       * @returns {Promise<string>} Trimmed contents of the file.
       */
      async function readFile(relPath) {
        const fullPath = path.join(entry.name, relPath);
        return (await fs.promises.readFile(fullPath, { encoding: 'utf-8' })).trimEnd();
      }
      const run = new Run();

      run.versionData = await readFile('version.txt');
      run.name = await readFile('name.txt');
      run.os = await readFile('os.txt');
      run.engine = await readFile('engine.txt');
      run.logName = await readFile('log-name.txt');

      const report = await fs.promises.open(path.join(entry.name, 'report.tap'));

      for await (const line of report.readLines()) {
        if (line.startsWith('1..')) {
          run.total = parseInt(line.substring(3), 10);
        } else if (line.toLowerCase().includes(' # skip')) {
          run.skipped++;
        } else if (line.startsWith('ok ')) {
          run.passed++;
        } else if (line.startsWith('no ok ')) {
          run.failed++;
        }
      }
      runs.push(run);
    } catch (ex) {
      // We might be reading `.git`, `.github`, etc; don't abort if we failed to
      // read anything, but record the error for debugging purposes.
      console.error(`Failed to read ${ entry.name }:`, ex);
    }
  }

  // We don't have job ID and artifact ID from the recorded data (because those
  // are not available to the jobs as they are run); try to fetch them.
  await updateRunInfo(runs);

  return runs;
}

/**
 * Print the version string table.
 * @param {Run[]} runs The runs collected.
 * @param {OutputMethod} output Function to output a line.
 */
async function printVersions(runs, output) {
  /** @type Set<string> */
  const versions = new Set();
  for (const run of runs) {
    versions.add(run.version);
  }
  output('Versions\n---');
  for (const version of Array.from(versions).sort()) {
    output('`' + version + '`');
  }
  output('');
}

/**
 * Minimal structure of a /jobs API return.
 * @typedef {Object} GitHubWorkflowJobList
 * @property {GitHubWorkflowRunJob[]} jobs
 */
/**
 * @typedef {Object} GitHubWorkflowRunJob
 * @property {number} id
 * @property {string} name
 */
/**
 * Minimal structure of a /artifacts API return.
 * @typedef {Object} GitHubWorkflowArtifactsList
 * @property {GitHubWorkflowArtifact[]} artifacts
 */
/**
 * @typedef {Object} GitHubWorkflowArtifact
 * @property {number} id
 * @property {string} name
 */

/**
 * Fetch GitHub metadata about the current run.
 * @param {'jobs' | 'artifacts'} infoType The information to get.
 * @returns {Promise<any | undefined>} The data from API, or undefined.
 */
async function getRunMetadata(infoType) {
  const { env } = process;
  const variables = [
    'GITHUB_API_URL', 'GITHUB_RUN_ID', 'GITHUB_REPOSITORY',
  ];
  for (const variable of variables) {
    if (!(variable in env)) {
      console.error(`${ variable } not set, skipping GitHub API calls`);
      return;
    }
  }
  const url = `${ env.GITHUB_API_URL }/repos/${ env.GITHUB_REPOSITORY }/actions/runs/${ env.GITHUB_RUN_ID }/${ infoType }?per_page=100`;
  /** @type Record<string, string> */
  const headers = {};

  if ('GITHUB_TOKEN' in env) {
    headers.Authorization = `Bearer ${ env.GITHUB_TOKEN }`;
  }
  const response = await fetch(url, { headers })

  if (!response.ok) {
    throw new Error(`Failed to get GitHub ${ infoType } info:` + await response.text());
  }
  return await response.json();
}

/**
 * Update runs in place with metadata from GitHub.
 * @param {Run[]} runs The runs to modify.
 */
async function updateRunInfo(runs) {
  /** @type GitHubWorkflowJobList | undefined */
  const jobInfo = await getRunMetadata('jobs');
  if (jobInfo) {
    // Parse the info to get a list of job matrix values to job ID.
    // Because there may be more values than the ones we're looking for, we can't
    // just make it a Map.
    const jobMap = jobInfo.jobs.map(job => {
      const name = (/\((.*)\)/.exec(job.name) ?? [])[1];
      const vals = new Set((name?.split(',') ?? []).map(n => n.trim()));
      return /** @type {const} */([vals, job.id]);
    });

    for (const run of runs) {
      const [, id]= jobMap.find(([vals]) => {
        return vals.has(run.name) && vals.has(run.os) && vals.has(run.engine);
      }) ?? [];
      if (id) {
        run.id = id;
      }
    }
  }

  /** @type GitHubWorkflowArtifactsList | undefined */
  const artifactInfo = await getRunMetadata('artifacts');
  if (artifactInfo) {
    const artifactMap = Object.fromEntries(artifactInfo.artifacts.map(a => [a.name, a.id]));
    for (const run of runs) {
      if (run.logName in artifactMap) {
        run.logId = artifactMap[run.logName];
      }
    }
  }
}

/**
 * Print the result table
 * @param {Run[]} runs The runs collected
 * @param {OutputMethod} output Function to output a line
 */
async function printResults(runs, output) {
  if (!process.env.EXPECTED_TESTS) {
    throw new Error('EXPECTED_TESTS was not set');
  }
  /** @type {{name: string, host: string, engine: string}[]} */
  const expectedTests = JSON.parse(process.env.EXPECTED_TESTS);
  const expectedNames = Array.from(new Set(expectedTests.map(t => t.name))).sort();
  const expectedHosts = Array.from(new Set(expectedTests.map(t => t.host))).sort();
  const expectedColumns = expectedHosts.map(host => {
    const engines = new Set(expectedTests.filter(t => t.host === host).map(t => t.engine));
    return Array.from(engines).sort().map(engine => [host, engine]);
  }).flat(1);

  output(['Name', ...expectedColumns.map(parts => parts.join(' '))].join(' | '));
  output(['', ...expectedColumns].map(() => '---').join(' | '));

  for (const name of expectedNames) {
    const row = [name];
    for (const [host, engine] of expectedColumns) {
      const run = runs.find(r => r.name === name && r.os === host && r.engine === engine);
      const expected = expectedTests.find(t => t.name === name && t.host === host && t.engine === engine);

      if (run) {
        const emoji = run.succeeded ? ':white_check_mark:' : ':x:';
        const count  = run.succeeded ? '' : `${ run.ok }/${ run.total }`;
        let tooltip = '';
        tooltip += run.passed ? `${ run.passed } passed ` : '';
        tooltip += run.failed ? `${ run.failed } failed ` : '';
        tooltip += run.skipped ? `${ run.skipped } skipped ` : '';
        tooltip += `out of ${ run.total }`;
        const { env } = process;
        let result = '';
        if (run.logId) {
          const url = `${ env.GITHUB_SERVER_URL }/${ env.GITHUB_REPOSITORY }/actions/runs/${ env.GITHUB_RUN_ID}/artifacts/${ run.logId }`;
          result += `<a href="${ url }" title="Download logs">:file_folder:</a> `;
        }
        result += `<a title="${ tooltip }"`;
        if (run.id) {
          const url = `${ env.GITHUB_SERVER_URL }/${ env.GITHUB_REPOSITORY }/actions/runs/${ env.GITHUB_RUN_ID }/job/${ run.id }`;
          result += ` href="${ url }"`;
        }
        result += `>${ emoji } ${ count }</a>`;
        row.push(result);
      } else if (expected) {
        // The test result is missing for this run.
        row.push('<a title="run results missing">:x: ??</a>');
      } else {
        // This combination is not run.
        row.push('');
      }
    }
    output(row.join(' | '));
  }
}

(async() => {
  const runs = await readRuns();

  for (const run of runs) {
    console.log(run);
  }
  /** @type {OutputMethod} */
  let output = console.log;
  if (process.env.GITHUB_STEP_SUMMARY) {
    const file = await fs.promises.open(process.env.GITHUB_STEP_SUMMARY, 'a');
    output = (line) => file.write(line + '\n');
  }
  await printVersions(runs, output);
  await printResults(runs, output);
})().catch(ex => {
  console.error(ex);
  process.exit(1);
});
