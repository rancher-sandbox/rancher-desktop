/**
 * Windows Installer generation.
 *
 * While Electron-Builder has built-in MSI support, it's not quite as flexible
 * as we desired.  This runs WiX manually instead.
 */

/** @jsx Element.new */

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { spawnFile } from '@/utils/childProcess';

/**
 * Element is a class for interpreting JSX; we only need the bare basics to
 * generate a valid XML as input to the WiX toolchain.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Can't detect @jsx usage.
class Element {
  constructor(tag: string, attribs: Record<string, string>, ...children: (Element | string)[]) {
    this.tag = tag;
    this.attribs = attribs;
    this.children = children;
  }

  /**
   * Create a new element; this is used by the TypeScript JSX support.
   */
  static new(tag: string, attribs: Record<string, string> | null, ...children: (Element | Element[] | string)[]) {
    return new Element(tag, attribs ?? {}, ...children.flat());
  }

  tag: string;
  attribs: Record<string, string>;
  // eslint-disable-next-line no-use-before-define -- ESLint gets confused by recursive references
  children: (Element | string)[];

  /** Convert the Element to serialized XML. */
  toXML(indent = 0) {
    const indentString = (new Array(indent + 1)).join(' ');
    let result = `${ indentString }<${ this.tag }`;

    for (const [key, value] of Object.entries(this.attribs)) {
      result += ` ${ key }="${ value }"`;
    }
    if (this.children.length < 1) {
      result += '/>\n';
    } else {
      result += '>';
      if (this.children.some(c => c instanceof Element)) {
        result += '\n';
      }
      for (const child of this.children) {
        if (typeof child === 'string') {
          // For text content of elements, always use CDATA.
          result += `<![CDATA[${ child }]]>`;
        } else if (child instanceof Element) {
          result += child.toXML(indent + 2);
        } else {
          throw new TypeError(`Don't know how to serialize ${ child } (type ${ typeof child })`);
        }
      }
      if (this.children.some(c => c instanceof Element)) {
        result += indentString;
      }
      result += `</${ this.tag }>${ '\n' }`;
    }

    return result;
  }
}

// When rendering, the JSX tag name is supposed to be the name of a component
// that's passed to the first argument of React.createElement; so we need plain
// constants for every element we use.
const Component = 'Component';
const ComponentGroup = 'ComponentGroup';
const ComponentGroupRef = 'ComponentGroupRef';
const Condition = 'Condition';
const Directory = 'Directory';
const Feature = 'Feature';
const File = 'File';
const Icon = 'Icon';
const MajorUpgrade = 'MajorUpgrade';
const MediaTemplate = 'MediaTemplate';
const Package = 'Package';
const Product = 'Product';
const Property = 'Property';
const Shortcut = 'Shortcut';
const ShortcutProperty = 'ShortcutProperty';
const Wix = 'Wix';

/**
 * A structure representing the files (but not subdirectories) within a
 * directory.
 */
type directory = {
  /** The identifier for this directory. */
  id: string;
  /** The name of this directory, as the path relative to appDir. */
  name: string;
  /** Child directories. */
  directories: directory[];
  /** The regular files within this direcotry */
  files: { name: string, id: string }[];
};

/** Walk the given directory, determining what files exist. */
function walk(root: string): Promise<directory> {
  async function walkDirectory(dir: string): Promise<directory> {
    const relPath = path.relative(root, dir);
    const files: { name: string, id: string }[] = [];
    const result: directory = {
      id:          '', // Will be updated later
      name:        relPath,
      directories: [],
      files:       [],
    };
    const hasher = crypto.createHash('sha256');
    const children = await fs.promises.readdir(dir, { withFileTypes: true });

    hasher.update(relPath);
    await Promise.all(children.sort((a, b) => a.name.localeCompare(b.name)).map(async(child) => {
      if (child.isDirectory()) {
        result.directories.push(await walkDirectory(path.join(dir, child.name)));
      } else if (child.isFile()) {
        const info = await fs.promises.stat(path.join(dir, child.name));
        const input = `${ child.name }::${ info.size }@${ info.mtimeMs }`;
        const id = `f${ hasher.copy().update(input).digest('base64url').replaceAll('-', '.') }`;

        files.push({ name: child.name, id });
      } else {
        throw new Error(`Could not handle non-regular file ${ path.join(dir, child.name) }`);
      }
    }));

    result.directories.sort((a, b) => a.name.localeCompare(b.name));

    files.sort((a, b) => a.name.localeCompare(b.name));
    result.files = files;

    files.forEach(f => hasher.update(f.id));
    result.id = `d_${ hasher.digest('base64url').replaceAll('-', '.') }`;

    return result;
  }

  return walkDirectory(root);
}

/**
 * Given an unpacked application directory, return the application version.
 */
async function getAppVersion(appDir: string): Promise<string> {
  const exePath = path.join(appDir, 'Rancher Desktop.exe');
  const args = [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    `(Get-ChildItem "${ exePath }").VersionInfo.ProductVersion`,
  ];
  const { stdout } = await spawnFile('powershell.exe', args, { stdio: ['ignore', 'pipe', 'inherit'] });

  return stdout.trim();
}

/**
 * Given an unpacked build, produce a MSI installer.
 * @param workDir Working directory; the application is extracted in the
 *        subdirectory "appDir" within this directory.
 */
export default async function buildInstaller(workDir: string, development = false) {
  /** Given a directory, return all its descendants as a list. */
  function getDescendantDirs(d: directory): directory[] {
    function getDescendantsIncludingSelf(d: directory): directory[] {
      return d.directories.map(getDescendantsIncludingSelf).flat().concat(d);
    }

    return getDescendantsIncludingSelf(d).slice(0, -1);
  }

  const appDir = path.join(workDir, 'appDir');
  const rootDir = await walk(appDir);
  const descendantDirs = getDescendantDirs(rootDir);
  const appVersion = await getAppVersion(appDir);

  const root = <Wix xmlns="http://schemas.microsoft.com/wix/2006/wi">
    <Product
      Id="*"
      Name="Rancher Desktop"
      UpgradeCode="{1F717D5A-A55B-5FE2-9103-C0D74F7FBDE3}"
      Version={appVersion}
      Language="1033"
      Codepage="65001"
      Manufacturer="SUSE">
      <Package Compressed="yes" InstallerVersion="500" />
      {/* As of Windows 10/11, msiexec.exe is manifested for Windows 8.1 */}
      <Condition Message="Windows 10 and above is required">
        {'Installed OR VersionNT >= 603'}
      </Condition>
      <MajorUpgrade
        AllowSameVersionUpgrades="yes"
        DowngradeErrorMessage='A newer version of Rancher Desktop is already installed.' />
      <MediaTemplate CompressionLevel={development ? 'none' : 'high'} EmbedCab="yes" />

      <Property Id="ApplicationFolderName" Value="Rancher Desktop" />
      <Property Id="WixAppFolder" Value="WixPerUserFolder" />
      <Icon
        Id="RancherDesktopIcon.exe"
        SourceFile="$(var.appDir)\Rancher Desktop.exe" />
      <Property Id="ARPPRODUCTICON" Value="RancherDesktopIcon.exe" />
      {/* Installer is per-user/per-machine capable, but default to per-machine */}
      <Property Id="ALLUSERS" Secure="yes" Value="2" />
      <Directory Id="TARGETDIR" Name="SourceDir">
        <Directory Id="ProgramFiles64Folder">
          <Directory Id="APPLICATIONFOLDER" Name="Rancher Desktop">
            {(() => {
              function emit(d: directory) {
                return d.directories.map(subdir => <Directory Id={subdir.id} Name={path.basename(subdir.name)}>
                  {emit(subdir)}
                </Directory>);
              }

              return emit(rootDir);
            })()}
          </Directory>
        </Directory>
        {/* Desktop link */}
        <Directory Id="DesktopFolder" Name="Desktop" />
        {/* Start menu link */}
        <Directory Id="ProgramMenuFolder" />
      </Directory>

      <Feature Id="ProductFeature" Absent="disallow">
        <ComponentGroupRef Id="ProductComponents" />
      </Feature>

      <ComponentGroup Id="ProductComponents" Directory="APPLICATIONFOLDER">
        {rootDir.files.map((f) => {
          if (f.name === 'Rancher Desktop.exe') {
            // Special case the main executable
            return <Component>
              <File
                Name={f.name}
                Source={path.join('$(var.appDir)', f.name)}
                ReadOnly="yes"
                KeyPath="yes"
                Id="mainExecutable">
                <Shortcut
                  Id="desktopShortcut"
                  Directory="DesktopFolder"
                  Name="Rancher Desktop"
                  WorkingDirectory="APPLICATIONFOLDER"
                  Advertise="yes"
                  Icon="RancherDesktopIcon.exe" />
                <Shortcut
                  Id="startMenuShortcut"
                  Directory="ProgramMenuFolder"
                  Name="Rancher Desktop"
                  WorkingDirectory="APPLICATIONFOLDER"
                  Advertise="yes"
                  Icon="RancherDesktopIcon.exe">
                  <ShortcutProperty
                    Key="System.AppUserModel.ID"
                    Value="io.rancherdesktop.app" />
                </Shortcut>
              </File>
            </Component>;
          }

          return <Component>
            <File
              Name={f.name}
              Source={path.join('$(var.appDir)', f.name)}
              ReadOnly="yes"
              KeyPath="yes"
              Id={f.id}
            />
          </Component>;
        })}
        {descendantDirs.map(d => <ComponentGroupRef Id={d.id} />)}
      </ComponentGroup>
      {descendantDirs.map(d => <ComponentGroup Id={d.id} Directory={d.id}>
        {d.files.map(f => <Component>
          <File
            Name={f.name}
            Source={path.join('$(var.appDir)', d.name, f.name)}
            ReadOnly="yes"
            KeyPath="yes"
            Id={f.id}
          />
        </Component>,
        )}
      </ComponentGroup>,
      )}
    </Product>
  </Wix >;
  const wixDir = path.join(process.cwd(), 'resources', 'host', 'wix');

  console.log('Writing out WiX definition...');
  await fs.promises.writeFile(path.join(workDir, 'project.wxs'), root.toXML());
  await fs.promises.writeFile(path.join(process.cwd(), 'dist', 'project.wxs'), root.toXML());
  console.log('Compiling WiX...');
  await spawnFile(path.join(wixDir, 'candle.exe'), [
    '-arch', 'x64',
    `-dappDir=${ path.join(workDir, 'appDir') }`,
    '-nologo',
    '-out', path.join(workDir, 'project.wixobj'),
    '-pedantic',
    '-wx',
    path.join(workDir, 'project.wxs'),
  ], { stdio: 'inherit' });
  console.log('Linking WiX...');
  await spawnFile(path.join(wixDir, 'light.exe'), [
    // Skip ICE 60, which checks for files with versions but no language (since
    // Windows Installer will always need to reinstall the file on a repair, in
    // case it's the wrong language).  This trips up our icon fonts, which we
    // do not install system-wide.
    // https://learn.microsoft.com/en-us/windows/win32/msi/ice60
    '-sice:ICE60',
    // Skip ICE 61, which is incompatible AllowSameVersionUpgrades and with emits:
    // error LGHT1076 : ICE61: This product should remove only older versions of itself.
    // https://learn.microsoft.com/en-us/windows/win32/msi/ice61
    '-sice:ICE61',
    `-dappDir=${ path.join(workDir, 'appDir') }`,
    '-nologo',
    '-out', path.join(process.cwd(), 'dist', `Rancher Desktop Setup ${ appVersion }.msi`),
    '-pedantic',
    '-wx',
    path.join(workDir, 'project.wixobj'),
  ], { stdio: 'inherit' });
}

async function main() {
  const distDir = path.join(process.cwd(), 'dist');
  const zipName = (await fs.promises.readdir(distDir, 'utf-8')).find(f => f.endsWith('-win.zip'));

  if (!zipName) {
    throw new Error('Could not find zip file');
  }
  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rd-wix-'), 'utf-8');
  const appDir = path.join(workDir, 'appDir');

  await fs.promises.mkdir(appDir);

  try {
    await spawnFile('unzip', ['-d', appDir, path.join(distDir, zipName)], { stdio: 'inherit' });
    await buildInstaller(workDir, true);
  } finally {
    await fs.promises.rm(workDir, { recursive: true });
  }
}

// hack
main().catch((e) => {
  console.error(e); process.exit(1);
});
