import path from 'path';

import { AlpineLimaISOVersion, Dependency, DownloadContext } from 'scripts/lib/dependencies';
import { simpleSpawn } from 'scripts/simple_process';

/**
 * GoDependency represents a golang binary that is built from the local source
 * code.
 */
export class GoDependency implements Dependency {
  constructor(path: string | string[], dir: 'bin' | 'internal' | 'host' | 'staging' = 'bin') {
    this.name = Array.isArray(path) ? path[path.length - 1] : path;
    this.path = Array.isArray(path) ? path : [path];
    this.dir = dir;
  }

  name: string;
  path: string[];
  dir: 'bin' | 'internal' | 'host' | 'staging';

  async download(context: DownloadContext): Promise<void> {
    // Rather than actually downloading anything, this builds the source code.
    const sourceDir = path.join(process.cwd(), 'src', 'go', ...this.path);
    const outFile = this.outFile(context);

    console.log(`Building go utility \x1B[1;33;40m${ this.name }\x1B[0m from ${ sourceDir } to ${ outFile }...`);
    await simpleSpawn('go', ['build', '-ldflags', '-s -w', '-o', outFile, '.'], {
      cwd: sourceDir,
      env: this.environment(context),
    });
  }

  environment(context: DownloadContext): NodeJS.ProcessEnv {
    return {
      ...process.env,
      GOOS:   context.goPlatform,
      GOARCH: context.isM1 ? 'arm64' : 'amd64',
    };
  }

  outFile(context: DownloadContext): string {
    const target = context.platform === 'win32' ? `${ this.name }.exe` : this.name;

    if (this.dir === 'host') {
      return path.join(context.resourcesDir, this.dir, target);
    }

    return path.join(context.resourcesDir, context.platform, this.dir, target);
  }

  getAvailableVersions(includePrerelease?: boolean | undefined): Promise<string[]> {
    throw new Error('Go dependencies do not have available versions.');
  }

  rcompareVersions(version1: string | AlpineLimaISOVersion, version2: string): 0 | 1 | -1 {
    throw new Error('Go dependencies do not have available versions.');
  }
}

export class RDCtl extends GoDependency {
  constructor() {
    super('rdctl');
  }

  dependencies(context: DownloadContext): string[] {
    if (context.dependencyPlatform === 'wsl') {
      // For the WSL copy depend on the Windows one to generate code
      return ['rdctl:win32'];
    }

    return [];
  }

  override async download(context: DownloadContext): Promise<void> {
    // For WSL, don't re-generate the code; the win32 copy did it.
    if (context.dependencyPlatform !== 'wsl') {
      await simpleSpawn('node', ['scripts/ts-wrapper.js',
        'scripts/generateCliCode.ts',
        'pkg/rancher-desktop/assets/specs/command-api.yaml',
        'src/go/rdctl/pkg/options/generated/options.go']);
    }
    await super.download(context);
  }
}

export class ExtensionProxy extends GoDependency {
  constructor() {
    super('extension-proxy', 'staging');
  }

  override environment(context: DownloadContext): NodeJS.ProcessEnv {
    return {
      ...super.environment(context),
      CGO_ENABLED: '0',
    };
  }
}

export class WSLHelper extends GoDependency {
  constructor() {
    super('wsl-helper', 'internal');
  }

  dependencies(context: DownloadContext): string[] {
    return ['mobyOpenAPISpec:win32'];
  }

  override environment(context: DownloadContext) {
    return {
      ...super.environment(context),
      CGO_ENABLED: '0',
    };
  }
}

export class NerdctlStub extends GoDependency {
  constructor() {
    super('nerdctl-stub');
  }

  override outFile(context: DownloadContext) {
    // nerdctl-stub is the actual nerdctl binary to be run on linux;
    // there is also a `nerdctl` wrapper in the same directory to make it
    // easier to handle permissions for Linux-in-WSL.
    const leafName = context.platform === 'win32' ? 'nerdctl.exe' : 'nerdctl-stub';

    return path.join(context.resourcesDir, context.platform, this.dir, leafName);
  }
}
