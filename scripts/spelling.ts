/**
 * This script runs github.com/check-spelling/check-spelling locally.  It
 * requires a working sh interpreter, perl, and possibly other things.
 * This is meant to be used as a local check before pushing to make PRs; this is
 * a no-op in CI as we still rely on the CI workflow there instead.
 */

import fs from 'fs/promises';
import path from 'path';

import yaml from 'yaml';

import { simpleSpawn } from './simple_process';

if (process.env.CI) {
  console.log(`Skipping spell checking in CI, please see separate workflow.`);
  process.exit();
}

if (process.platform === 'win32') {
  console.log(`Skipping spell checking, Windows is not supported.`);
  process.exit();
}

if (process.platform === 'darwin') {
  // On macOS, the spell checker fails to skip expected long words.
  // Disable spell checking there for now.
  // https://github.com/check-spelling/check-spelling/issues/84
  console.log(`Skipping spell checking, macOS has false positives.`);
  process.exit();
}

/**
 * Clone the check-spelling repository if needed, and return the script.
 * @param step GitHub Actions check spelling step configuration.
 * @returns Path to unknown-words.sh
 */
async function findScript(step: any): Promise<string> {
  // Put the check-spelling files in `$PWD/resources/host/check-spelling
  const checkout = path.join(process.cwd(), 'resources', 'host', 'check-spelling');
  const script = path.join(checkout, 'unknown-words.sh');
  const [repo, hash] = step.uses?.split('@') ?? [];

  if (!repo) {
    throw new Error('Failed to find check-spelling repository from GitHub Actions workflow');
  }
  if (!hash) {
    throw new Error('Failed to find commit/branch to use for check-spelling');
  }

  try {
    await fs.stat(script);
    // Update the checkout.
    await simpleSpawn('git', ['-C', checkout, 'fetch']);
  } catch (ex) {
    // Assume file not found.
    await simpleSpawn('git', ['clone', '--no-checkout', `https://github.com/${ repo }.git`, checkout]);
  }
  await simpleSpawn('git', ['-C', checkout, 'checkout', hash]);

  return script;
}

(async function() {
  // Locate the GitHub Actions workflow and locate the check spelling step.
  const configPath = path.join(process.cwd(), '.github', 'workflows', 'spelling.yml');
  const config = yaml.parse(await fs.readFile(configPath, { encoding: 'utf-8' }));
  const step = config.jobs?.spelling?.steps?.find((step: any) => step?.id === 'spelling');
  const stepConfig = step?.with;

  if (!stepConfig) {
    throw new Error('Failed to locate check-spelling CI configuration');
  }
  // Remove configuration that does not make sense outside of CI.
  delete stepConfig.experimental_apply_changes_via_bot;
  delete stepConfig.use_sarif;

  // Set up configuration for the script.
  process.env.INPUTS = JSON.stringify(stepConfig);

  // Find the check spelling script and run it.
  const script = await findScript(step);

  await simpleSpawn(script);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
