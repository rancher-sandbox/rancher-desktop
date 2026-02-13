/*
Copyright © 2025 SUSE LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/
// @ts-check
module.exports = {
  name: 'plugin-rancher-desktop-license-checker',
  /** @type (_: NodeJS.Require) => any */
  factory: require => {
    const { BaseCommand, WorkspaceRequiredError } = require('@yarnpkg/cli');
    const { Cache, Configuration, Project, ThrowReport, structUtils, Workspace } = require('@yarnpkg/core');
    const { Filename } = require('@yarnpkg/fslib');

    const UNKNOWN_LICENSE = '<unknown>';
    // https://github.com/cncf/foundation/blob/main/policies-guidance/allowed-third-party-license-policy.md#approved-licenses-for-allowlist
    const ALLOWED_LICENSES = new Set([
      '0BSD',
      'BSD-2-Clause',
      'BSD-2-Clause-FreeBSD',
      'BSD-3-Clause',
      'MIT',
      'MIT-0',
      'ISC',
      'OpenSSL',
      'OpenSSL-standalone',
      'PSF-2.0',
      'Python-2.0',
      'Python-2.0.1',
      'PostgreSQL',
      'SSLeay-standalone', // spellcheck-ignore-line
      'UPL-1.0', // spellcheck-ignore-line
      'X11',
      'Zlib',
      // The default CNCF license, not in the above list.
      'Apache-2.0',
      // Extra accepted licenses.
      'Unlicense',
    ]);

    /**
     * Hard-coded list of license overrides, for licenses that are not correctly
     * specified in package.json (verified by browsing the source code).
     * @type Record<string, string>
     */
    const overrides = {
      'esprima@npm:1.2.5': 'BSD-2-Clause', // https://github.com/jquery/esprima/pull/1181
    };

    /**
     * LicenseParser is used to determine if a license is acceptable for use.
     */
    class LicenseParser {
      /**
       * @param { string | string[] | { type: string } | { type: string }[]} input - The license text.
       */
      constructor(input) {
        /** @type Set<string> */
        this.licenses = new Set ((Array.isArray(input) ? input : [input]).flatMap(entry => {
          return LicenseParser.parseLicenseString(typeof entry === 'string' ? entry : entry.type);
        }));
      }

      /**
       * Parse an SPDX license identifier expression; currently only OR is allowed.
       * @param {string} input - The SPDX license identifier.
       * @returns {string[]} - The parsed result.
       */
      static parseLicenseString(input) {
          const parenMatch = /^\((.*)\)$/.exec(input);

          if (!parenMatch) {
            return [input];
          }
          return parenMatch[1].split(/\s+OR\s+/);
      }

      toString() {
        return Array.from(this.licenses).join(' OR ');
      }

      acceptable() {
        return this.licenses.intersection(ALLOWED_LICENSES).size > 0;
      }
    }

    class LicenseCheckCommand extends BaseCommand {
      static paths = [['license-check']];

      /** @override */
      async execute() {
        const { cwd, plugins } = this.context;
        const configuration = await Configuration.find(cwd, plugins);
        const { project, workspace } = await Project.find(configuration, cwd);
        const cache = await Cache.find(project.configuration);
        const report = new ThrowReport();

        if (!workspace) {
          throw new WorkspaceRequiredError(project.cwd, cwd);
        }

        /** @type { Iterable<import('@yarnpkg/core').Package> } */
        const dependencies = await this.getDependenciesForWorkspace(configuration, workspace);

        const fetcher = configuration.makeFetcher();
        /** @type {(locator: import('@yarnpkg/core').Locator) => Promise<import('@yarnpkg/core').FetchResult>} */
        const wrappedFetch = locator => {
          return fetcher.fetch(locator, {cache, project, fetcher, report, checksums: project.storedChecksums});
        }

        let hasErrors = false;
        for (const dependency of dependencies) {
          try {
            const licenses = await this.getLicensesForPackage(dependency, wrappedFetch);
            if (!licenses.acceptable()) {
              console.log(`${ structUtils.prettyLocator(configuration, dependency)} has disallowed license ${ licenses }`);
              hasErrors = true;
            }
          } catch (ex) {
            console.log(`Error fetching license for ${ structUtils.prettyLocator(configuration, dependency) }: ${ ex }`);
          }
        }

        if (hasErrors) {
          process.exit(1);
        }

        console.log('All NPM modules have acceptable licenses.');
      }

      /**
       * Find all packages required by the given workspace, excluding development
       * dependencies.
       * @note Some dependencies to node-gyp are explicitly ignored because they
       * were automatically added by Yarn and do not actually exist.
       * @param {Configuration} configuration - The project configuration
       * @param {Workspace} workspace - The workspace to examine
       * @returns {Promise<Iterable<import('@yarnpkg/core').Package>>}
       */
      async getDependenciesForWorkspace(configuration, workspace) {
        const blacklistedNodeGypDependencies = ['native-reg', 'node-addon-api'];
        const { project } = workspace;
        /** @type { Map<import('@yarnpkg/core').DescriptorHash, import('@yarnpkg/core').Package> } */
        const knownDependencies = new Map();

        await project.restoreInstallState();

        for (const workspace of project.workspaces) {
          workspace.manifest.devDependencies.clear();
        }

        const cache = await Cache.find(project.configuration);
        await project.resolveEverything({ report: new ThrowReport(), cache });

        const queue = project.workspaces.map(w => w.anchoredDescriptor);

        while (queue.length > 0) {
          const descriptor = queue.pop();

          if (!descriptor) {
            throw new Error('Popped empty item off queue');
          }
          if (knownDependencies.has(descriptor.descriptorHash)) {
            continue;
          }
          const locatorHash = project.storedResolutions.get(descriptor.descriptorHash);

          if (!locatorHash) {
            throw new Error(`Failed to find locator for ${ structUtils.prettyDescriptor(configuration, descriptor) }`);
          }

          const pkg = project.storedPackages.get(locatorHash);

          if (!pkg) {
            throw new Error(`Failed to find package for ${ structUtils.prettyDescriptor(configuration, descriptor) }`);
          }

          knownDependencies.set(descriptor.descriptorHash, pkg);
          for (const dep of pkg.dependencies.values()) {
            if (dep.name === 'node-gyp') {
              if (blacklistedNodeGypDependencies.includes(descriptor.name)) {
                // Yarn manually adds a dependency in this case, but it should be a devDependency instead.
                continue;
              }
              console.log(`Warning: Adding node-gyp dependency via ${ structUtils.prettyDescriptor(configuration, descriptor)}`);
            }
            queue.push(dep);
          }
        }

        // Remove the anchors, as that's not a "dependency".
        for (const workspace of project.workspaces) {
          knownDependencies.delete(workspace.anchoredDescriptor.descriptorHash);
        }

        return knownDependencies.values();
      }

      /**
       * Given a descriptor, return the licenses used by the package.
       * @param {import('@yarnpkg/core').Package} pkg - The descriptor for the package to fetch.
       * @param {(locator: import('@yarnpkg/core').Locator) => Promise<import('@yarnpkg/core').FetchResult>} fetcher - A function to fetch files from packages.
       * @returns {Promise<LicenseParser>} - The licenses in use.
       */
      async getLicensesForPackage(pkg, fetcher) {
        const { packageFs } = await fetcher(pkg);
        const { pathUtils } = packageFs;
        const packageNameAndVersion = structUtils.stringifyLocator(pkg);

        if (packageNameAndVersion in overrides) {
          return new LicenseParser(overrides[packageNameAndVersion]);
        }

        /** @type any */
        const packageName = structUtils.stringifyIdent(pkg);
        const manifestPath = pathUtils.join(Filename.nodeModules, packageName, Filename.manifest);
        const manifest = await packageFs.readJsonPromise(manifestPath);
        return new LicenseParser(manifest.license ?? manifest.licenses ?? UNKNOWN_LICENSE);
      }
    }

    return { commands: [ LicenseCheckCommand ] };
  },
};
