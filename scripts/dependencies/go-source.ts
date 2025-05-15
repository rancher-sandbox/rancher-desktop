import path from 'path';

import { Dependency, DownloadContext } from 'scripts/lib/dependencies';
import { simpleSpawn } from 'scripts/simple_process';

type GoDependencyOptions = {
  /**
   * The output file name, relative to the platform-specific resources directory.
   * If this does not contain any directory separators ('/'), it is assumed to
   * be a directory name (defaults to `bin`) and the leaf name of the source
   * path is appended as the executable name.
   */
  outputPath: string;
  /**
   * Additional environment for the go compiler; e.g. for GOARCH overrides.
   */
  env?: NodeJS.ProcessEnv;

  /**
   * The version string to be stamped into the binary at build time.
   * This is typically used with `-ldflags="-X ..."` to embed version information.
   * Example: `1.18.1`.
   */
  version?: string;

  /**
   * The Go module path, typically as defined in `go.mod`. This should match the
   * import path of the module (e.g., `github.com/rancher-sandbox/rancher-desktop/src/go/wsl-helper`).
   */
  modulePath?: string;
};

/**
 * GoDependency represents a golang binary that is built from the local source
 * code.
 */
export class GoDependency implements Dependency {
  /**
   * Construct a new GoDependency.
   * @param sourcePath The path to be compiled, relative to .../src/go
   * @param options Additional configuration option; if a string is given, this
   * is the outputPath option, defaulting to `bin`.
   */
  constructor(sourcePath: string, options: string | GoDependencyOptions = 'bin') {
    this.sourcePath = sourcePath;
    this.options = typeof options === 'string' ? { outputPath: options } : options;
  }

  get name(): string {
    if (this.options.outputPath.includes('/')) {
      return path.basename(this.options.outputPath);
    }

    return path.basename(this.sourcePath);
  }

  sourcePath: string;
  options: GoDependencyOptions;

  async download(context: DownloadContext): Promise<void> {
    // Rather than actually downloading anything, this builds the source code.
    const sourceDir = path.join(process.cwd(), 'src', 'go', this.sourcePath);
    const outFile = this.outFile(context);

    const ldFlags: string[] = ['-s', '-w'];

    if (this.options.version && this.options.modulePath) {
      ldFlags.push(`-X ${ this.options.modulePath }/pkg/version.Version=${ this.options.version }`);
    }

    const buildArgs: string[] = ['build', '-ldflags', ldFlags.join(' '), '-o', outFile, '.'];

    const env = this.environment(context);

    console.log(`Building go utility \x1B[1;33;40m${ this.name }\x1B[0m [${ env.GOOS }/${ env.GOARCH }] from ${ sourceDir } to ${ outFile }...`);
    await simpleSpawn('go', buildArgs, {
      cwd: sourceDir,
      env,
    });
  }

  environment(context: DownloadContext): NodeJS.ProcessEnv {
    return {
      ...process.env,
      GOOS:   context.goPlatform,
      GOARCH: context.isM1 ? 'arm64' : 'amd64',
      ...this.options.env ?? {},
    };
  }

  outFile(context: DownloadContext): string {
    const suffix = context.platform === 'win32' ? '.exe' : '';
    let outputPath = `${ this.options.outputPath }${ suffix }`;

    if (!this.options.outputPath.includes('/')) {
      outputPath = `${ this.options.outputPath }/${ this.name }${ suffix }`;
    }

    return path.join(context.resourcesDir, context.platform, outputPath);
  }
}

export class RDCtl extends GoDependency {
  constructor(version: string) {
    super('rdctl', {
      outputPath: 'bin',
      modulePath: 'github.com/rancher-sandbox/rancher-desktop/src/go/rdctl',
      version,
    });
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

export class WSLHelper extends GoDependency {
  constructor(version: string) {
    super('wsl-helper', {
      outputPath: 'internal',
      env:        { CGO_ENABLED: '0' },
      modulePath: 'github.com/rancher-sandbox/rancher-desktop/src/go/wsl-helper',
      version,
    });
  }

  dependencies(context: DownloadContext): string[] {
    return ['mobyOpenAPISpec:win32'];
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

    return path.join(context.resourcesDir, context.platform, 'bin', leafName);
  }
}

export class SpinStub extends GoDependency {
  constructor() {
    super('spin-stub');
  }

  override outFile(context: DownloadContext) {
    // spin-stub is only used on Windows
    return path.join(context.resourcesDir, context.platform, 'bin', 'spin.exe');
  }
}
