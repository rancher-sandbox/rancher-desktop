/**
 * This script is run as part of the "Build Upgrade Testing" GitHub workflow
 * (.github/workflows/upgrade-test.yaml) to generate upgrade data for testing
 * Rancher Desktop upgrades.
 *
 * This will push changes to the "gh-pages" branch (for the upgrade manifest
 * JSON file), as well as publish releases (or update existing ones) for the
 * upgrade target.
 *
 * Note that this script intentionally blacklists the upstream repository (as
 * defined in package.json) because it changes releases.
 *
 * Inputs are all in environment variables:
 *   GITHUB_TOKEN:      GitHub access token.
 *   GITHUB_REPOSITORY: The GitHub owner/repository (from GitHub Actions).
 *   GITHUB_SHA:        Commit hash (if creating a new release).
 *   GITHUB_ACTOR:      User that triggered this, github.actor
 *   RD_SETUP_MSI:      The installer (msi file) to upload.
 *   RD_MACX86_ZIP:     The macOS (x86_64) zip archive to upload.
 *   RD_MACARM_ZIP:     The macOS (aarch64) zip archive to upload.
 *   RD_BUILD_INFO:     Build information ("latest.yml" from electron-builder)
 *   RD_OUTPUT_DIR:     Checkout of `gh-pages`, to be updated.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { Octokit } from 'octokit';
import yaml from 'yaml';

import { simpleSpawn } from './simple_process';

import { defined } from '@pkg/utils/typeUtils';

/** Read input from the environment; throws an error if unset. */
function getInput(name: string) {
  const result = process.env[name];

  if (!result) {
    throw new Error(`Could not read input; \$${ name } is not set correctly.`);
  }

  return result;
}

/** Given an input variable that expects a single file, return it. */
async function getInputFile(name: string) {
  const inputPath = getInput(name);
  const stat = await fs.promises.stat(inputPath);

  if (!stat.isDirectory()) {
    return inputPath;
  }

  for (const dirent of await fs.promises.readdir(inputPath, { withFileTypes: true })) {
    if (dirent.isFile()) {
      return path.join(inputPath, dirent.name);
    }
  }

  throw new Error(`Could not find input file for ${ name }`);
}

/**
 * assetInfo describes information we need about one asset.
 */
interface assetInfo {
  /** filepath is the (full) path to the asset file. */
  filepath:     string;
  /** filename is the base name of the asset. */
  filename:     string;
  /** length of the file */
  length:       number;
  /** checksum is the checksum file contents of the file. */
  checksum:     string;
  /** checksumName is the base name of the checksum. */
  checksumName: string;
}

/**
 * Given environment name, write checksum contents for the file.
 * @param name Name of the environment variable that holds the file path.
 * @returns File name and checksum data.
 */
async function getChecksum(name: string, filenameOverride?: string): Promise<assetInfo> {
  const filepath = await getInputFile(name);
  const outputName = filenameOverride || path.basename(filepath);
  const stat = await fs.promises.stat(filepath);
  const input = fs.createReadStream(filepath);
  const hasher = crypto.createHash('sha512');
  const promise = new Promise<void>((resolve) => {
    input.on('end', resolve);
  });

  input.pipe(hasher).setEncoding('hex');
  await promise;
  await new Promise<void>((resolve) => {
    hasher.end(() => {
      resolve();
    });
  });

  return {
    filepath,
    filename:     outputName,
    length:       stat.size,
    checksum:     `${ hasher.read() }  ${ outputName }`,
    checksumName: `${ outputName }.sha512sum`,
  };
}

async function getOctokit(): Promise<Octokit> {
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

  try {
    await octokit.rest.meta.getZen();
  } catch (ex) {
    console.error(`Invalid credentials: please check GITHUB_TOKEN is set. ${ ex }`);
    process.exit(1);
  }

  return octokit;
}

async function updateRelease(octokit: Octokit, owner: string, repo: string, tag: string) {
  const files = {
    msi:    await getChecksum('RD_SETUP_MSI', `Rancher.Desktop.Setup.${ tag }.msi`),
    macx86: await getChecksum('RD_MACX86_ZIP', `Rancher.Desktop-${ tag }-mac.x86_64.zip`),
    macarm: await getChecksum('RD_MACARM_ZIP', `Rancher.Desktop-${ tag }-mac.aarch64.zip`),
  };

  console.log(`Updating release with files:\n${ yaml.stringify(files) }`);

  let release: Awaited<ReturnType<Octokit['rest']['repos']['createRelease']>>['data'] | undefined;

  try {
    ({ data: release } = await octokit.rest.repos.getReleaseByTag({
      owner, repo, tag,
    }));
  } catch (ex) {
    console.log(`Creating new release for ${ tag }: ${ ex }`);
    ({ data: release } = await octokit.rest.repos.createRelease({
      owner,
      repo,
      name:             tag,
      tag_name:         tag,
      target_commitish: getInput('GITHUB_SHA'),
      draft:            true,
    }));
  }
  if (!release) {
    throw new Error(`Could not get or create release for ${ tag }`);
  }
  console.log(`Got release info for ${ release.name }`);

  await Promise.all(Object.values(files).map(async(info) => {
    if (!release) {
      throw new Error(`Could not get or create release for ${ tag }`);
    }
    const checksumAsset = release.assets.find(asset => asset.name === info.checksumName);

    if (checksumAsset && release.assets.find(asset => asset.name === info.filename)) {
      const existingChecksum = (await octokit.rest.repos.getReleaseAsset({
        owner,
        repo,
        asset_id: checksumAsset.id,
        headers:  { accept: 'application/octet-stream' },
      })) as unknown as string;

      if (existingChecksum.trim() === info.checksum.trim()) {
        console.log(`Skipping ${ info.filename }, checksum matches`);

        return;
      }
    }

    await Promise.all([info.checksumName, info.filename]
      .map(name => release?.assets.find(asset => asset.name === name))
      .filter(defined)
      .map((asset) => {
        console.log(`Deleting obsolete asset ${ asset.name }`);

        return octokit.rest.repos.deleteReleaseAsset({
          owner, repo, asset_id: asset.id,
        });
      },
      ));

    await Promise.all([
      octokit.rest.repos.uploadReleaseAsset({
        owner,
        repo,
        release_id: release.id,
        name:       info.checksumName,
        data:       info.checksum,
      }),
      // We need a custom request for the  main file, as we need to stream it
      // from a file strem.
      octokit.request({
        method:  'POST',
        url:     release.upload_url,
        headers: {
          'Content-Length': info.length,
          'Content-Type':   'application/octet-stream',
        },
        data: fs.createReadStream(info.filepath),
        name: info.filename,
      }),
    ]);
  }));
  console.log(`Release ${ release.name } updated.`);

  return release.html_url;
}

async function updatePages(tag: string) {
  const response = {
    versions: [{
      Name:        tag,
      ReleaseDate: (new Date()).toISOString(),
      Tags:        ['latest'],
    }],
    requestIntervalInMinutes: 1,
  };

  console.log('Updating gh-pages...');
  await fs.promises.writeFile(path.join(getInput('RD_OUTPUT_DIR'), 'response.json'),
    JSON.stringify(response),
    'utf-8');
  await simpleSpawn('git',
    [
      '-c', `user.name=${ getInput('GITHUB_ACTOR') }`,
      '-c', `user.email=${ getInput('GITHUB_ACTOR') }@users.noreply.github.com`,
      'commit', `--message=Automated update to ${ tag }`, 'response.json',
    ], {
      stdio: ['ignore', 'inherit', 'inherit'],
      cwd:   getInput('RD_OUTPUT_DIR'),
    });
  await simpleSpawn('git',
    ['push'], {
      stdio: ['ignore', 'inherit', 'inherit'],
      cwd:   getInput('RD_OUTPUT_DIR'),
    });
  console.log('gh-pages updated.');
}

async function main() {
  console.log('Reading configuration information...');
  const buildInfoPath = await getInputFile('RD_BUILD_INFO');
  const [owner, repo] = getInput('GITHUB_REPOSITORY').split('/');
  const packageURL = new URL(JSON.parse(await fs.promises.readFile('package.json', 'utf-8')).repository.url);
  const [packageOwner, packageRepo] = packageURL.pathname.replace(/\.git$/, '').split('/').filter(x => x);
  const buildInfo = yaml.parse(await fs.promises.readFile(buildInfoPath, 'utf-8'));
  const tag: string = buildInfo.extraMetadata.version.replace(/^v?/, 'v');

  console.log(`Publishing ${ tag } from ${ owner }/${ repo } (upstream is ${ packageOwner }/${ packageRepo })...`);
  if (packageOwner === owner && packageRepo === repo) {
    console.error(`Cowardly refusing to touch ${ packageURL }`);
    process.exit(1);
  }

  const octokit = await getOctokit();
  const releaseURL = await updateRelease(octokit, owner, repo, tag);
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;

  await updatePages(tag);
  if (summaryPath) {
    await fs.promises.writeFile(
      summaryPath,
      `# Usage instructions
      1. Publish the release at ${ releaseURL }
      2. Configure \`resources\\app-update.yml\` to contain:
      \`\`\`yaml
      upgradeServer: https://${ owner }.github.io/${ repo }/response.json
      owner: ${ owner }
      repo: ${ repo }
      \`\`\`
      `.split(/\r?\n/).map(s => s.trim()).filter(s => s).join('\n'),
      { encoding: 'utf-8' });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
