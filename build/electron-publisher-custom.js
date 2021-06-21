const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const url = require('url');
const util = require('util');

const electronPublish = require('electron-publish');

class LonghornPublisher extends electronPublish.Publisher {
  providerName = 'longhorn';
  toString() {
    return '<Longhorn Publisher>';
  }

  upload() {
    // We're not doing any uploading here.
    return Promise.resolve();
  }

  /**
   * checkAndResolveOptions is used to resolve publisher configs, which is then
   * stored in the `app-update.yml` config file shipped with the application.
   */
  static async checkAndResolveOptions(options) {
    // Try to auto-fill the GitHub repository info.
    if (!options.owner || !options.repo) {
      // Try to get the repository info from package.json
      let repository;
      const packagePath = path.join(path.dirname(module.path), 'package.json');
      const packageData = JSON.parse(await fs.promises.readFile(packagePath, { encoding: 'utf8' }));

      if (packageData.repository.url) {
        repository = new url.URL(packageData.repository.url);
      } else {
        // Try to get the repository info from git config
        const execFile = util.promisify(childProcess.execFile);
        const { stdout } = await execFile('git', ['config', 'remote.origin.url']);

        repository = new url.URL(stdout.trim());
      }

      if (repository.hostname === 'github.com') {
        const [, owner, repo] = repository.pathname.replace(/\.git$/, '').split('/');

        options.owner ||= owner;
        options.repo ||= repo;
      }
    }
  }
}
module.exports = LonghornPublisher;
