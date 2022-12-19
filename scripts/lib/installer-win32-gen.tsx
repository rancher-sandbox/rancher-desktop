
/** @jsx Element.new */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * Element is a class for interpreting JSX; we only need the bare basics to
 * generate a valid XML as input to the WiX toolchain.
 */

export class Element {
  constructor(tag: string, attribs: Record<string, string>, ...children: (Element | string)[]) {
    this.tag = tag;
    this.attribs = attribs;
    this.children = children;
  }

  /**
   * Create a new element; this is used by the TypeScript JSX support.
   */
  static new(tag: string, attribs: Record<string, string> | null, ...children: (Element | Element[] | string)[]) {
    return new Element(tag, attribs ?? {}, ...children.flat().filter(x => x));
  }

  tag: string;
  attribs: Record<string, string>;

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
const File = 'File';
const Fragment = 'Fragment';
const PermissionEx = 'PermissionEx';
const RegistryKey = 'RegistryKey';
const RegistryValue = 'RegistryValue';
const ServiceControl = 'ServiceControl';
const ServiceInstall = 'ServiceInstall';
const Shortcut = 'Shortcut';
const ShortcutProperty = 'ShortcutProperty';

/**
 * A structure representing the files and subdirectories within a directory.
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
        const id = `f_${ hasher.copy().update(input).digest('base64url').replaceAll('-', '.') }`;

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

/** Given a directory, return all its descendants as a list. */
function getDescendantDirs(d: directory): directory[] {
  function getDescendantsIncludingSelf(d: directory): directory[] {
    return d.directories.map(getDescendantsIncludingSelf).flat().concat(d);
  }

  return getDescendantsIncludingSelf(d).slice(0, -1);
}

/**
 * Generate the file listings. The output will be a WiX <Fragment> with the
 * following key identifiers:
 * <Directory Id="TARGETDIR" />
 * <ComponentGroup Id="ProductComponents" />
 * @param rootPath Path of the unpacked application directory.
 */
export default async function generateFileList(rootPath: string): Promise<string> {
  const rootDir = await walk(rootPath);

  // Drop the "build/" directory, those are files to build the installer.
  rootDir.directories = rootDir.directories.filter(d => d.name !== 'build');

  const descendantDirs = getDescendantDirs(rootDir).filter(d => d.files.length > 0);

  const specialComponents: Record<string, (d: directory, f: { name: string, id: string }) => Element | null> = {
    'Rancher Desktop.exe': (d, f) => {
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
    },

    'electron-builder.yml': () => {
      // This files does not need to be packaged.
      return null;
    },

    'wix-install-wsl.ps1': (d, f) => {
      return <Component>
        <Condition>NOT WSLKERNELINSTALLED</Condition>
        <File
          Name={f.name}
          Source="build\\wix-install-wsl.ps1"
          ReadOnly="yes"
          KeyPath="yes"
          Id={f.id}
        />
      </Component>;
    },

    'resources\\resources\\win32\\internal\\privileged-service.exe': (d, f) => {
      return <Component>
        <Condition>{'MSIINSTALLPERUSER <> 1'}</Condition>
        <File
          Name={f.name}
          Source={path.join('$(var.appDir)', d.name, f.name)}
          ReadOnly="yes"
          KeyPath="yes"
          Id={f.id}
        />
        <ServiceInstall
          DisplayName="Rancher Desktop Privileged Service"
          ErrorControl="ignore"
          Name="RancherDesktopPrivilegedService"
          Start="demand"
          Type="ownProcess"
        >
          {/* SDDL explanation
            * O:SY  // Owner: SDDL_LOCAL_SYSTEM
            * D:()  // DACL (see ACE strings)
            * A;    // ACE type: SDDL_ACCESS_ALLOWED
            * ;     // ACE flags: none
            * GRGX; // Rights: GENERIC_READ + GENERIC_EXECUTE
            * ;     // Object GUID: none
            * ;     // Inherit Object GUID: none
            * IU    // Account SID: SDDL_INTERACTIVE
            *       // Resource attribute: none
            * And for the second ACE, needed for uninstall:
            * A;    // ACE type: SDDL_ACCESS_ALLOWED
            * ;     // ACE flags: none
            * GA;   // Rights: GENERIC_ALL
            * ;     // Object GUID: none
            * ;     // Inherit Object GUID: none
            * SY    // Accound SID: LOCAL_SYSTEM
            *       // Resource attribute: none
            */}
          <PermissionEx Sddl="O:SYD:(A;;GRGX;;;IU)(A;;GA;;;SY)" />
        </ServiceInstall>
        {/* See https://learn.microsoft.com/en-us/windows/win32/msi/deleteservices-action
          * We always run StopServices/DeleteServices/InstallFiles&c/InstallServices
          * in that order; so it makes sense to have Remove="both".
          */}
        <ServiceControl
          Id="RancherDesktopPrivilegedServiceControl"
          Name="RancherDesktopPrivilegedService"
          Stop="both"
          Remove="both"
          Wait="yes"
        />
        <RegistryKey
          Root="HKLM"
          Key="SYSTEM\CurrentControlSet\Services\EventLog\Application\RancherDesktopPrivilegedService"
        >
          <RegistryValue Name="EventMessageFile" Type="expandable" Value="%SYSTEMROOT%\System32\EventCreate.exe" />
          <RegistryValue Name="TypesSupported" Type="integer" Value="7" />{/* Error, warning, info */}
        </RegistryKey>
      </Component>;
    },
  };

  rootDir.files.push({ name: 'wix-install-wsl.ps1', id: 'f_install_wsl' });

  return (<Fragment>
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

    <ComponentGroup Id="ProductComponents" Directory="APPLICATIONFOLDER">
      {rootDir.files.map((f) => {
        if (f.name in specialComponents) {
          return specialComponents[f.name](rootDir, f);
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
      {d.files.map((f) => {
        const relPath = path.join(d.name, f.name);

        if (relPath in specialComponents) {
          return specialComponents[relPath](d, f);
        }

        return <Component>
          <File
            Name={f.name}
            Source={path.join('$(var.appDir)', d.name, f.name)}
            ReadOnly="yes"
            KeyPath="yes"
            Id={f.id}
          />
        </Component>;
      })}
    </ComponentGroup>,
    )}
  </Fragment>).toXML();
}
