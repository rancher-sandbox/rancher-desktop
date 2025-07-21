/*
Copyright © 2023 SUSE LLC

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

/**
 * This script generates the options module used for the rdctl `set` and `start` subcommands,
 * according to the preferences spec from pkg/rancher-desktop/assets/specs/command-api.yaml
 * Doing this avoids manually keeping these `rdctl` commands in sync with the supported settings.
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import ejs from 'ejs';
import yaml from 'yaml';

import { CURRENT_SETTINGS_VERSION } from '@pkg/config/settings';

interface commandFlagType {
  /**
   * The capitalized name of the final part of a dotted property name,
   * like Flannel` in `kubernetes.options.flannel`. Capitalized names are used for
   * exported golang struct fields.
   */
  capitalizedName: string;
  /**
   * The default value to enter as a string in the `cmd.Flags()...` statement.
   * This is a string internally, but is written as the appropriate type for `cmd.Flags.TVar(...)`.
   */
  defaultValue:    string;
  /**
   * Capitalized name of the type given in command-api.yaml.
   * This maps to go code like `cmdFlags.StringVar(...)`.
   */
  flagType:        goCmdFlagTypeName;
  /**
   * Lower-case name of a scalar golang type, like `string`.
   */
  lcTypeName?:     goTypeName;
  /**
   * A property name from the API spec, like `kubernetes`.
   * Can be the name of a leaf or a compound object.
   */
  propertyName:    string;
  /**
   * Used to map a shortcut option (like `--container-engine` to the full name `--kubernetes.containerEngine`)
   */
  aliasFor:        string;
  /**
   * Some options can be specified with a limited set of possible values.
   * This field carries those values as a string, to be inserted into the golang command definition.
   */
  enums:           string;
  /**
   * Used to insert an optional `x-rd-usage` field from a preference spec
   * into the help text for the command in the generated go code.
   */
  usageNote?:      string;
  /**
   * Used to format the specified value for a command-line option depending on the value's golang type.
   */
  valuePart:       string;
  /**
   * The option is not available for the current platform
   */
  notAvailable:    boolean;
}

type yamlObject = any;

type goTypeName = 'string' | 'bool' | 'int' | 'array';
type goCmdFlagTypeName = 'String' | 'Bool' | 'Int' | 'Array';
type typeValue = goTypeName | settingsTreeType | 'hash';
interface settingsTypeObject { type: typeValue }
type settingsTreeType = Record<string, settingsTypeObject>;

function assert(predicate: boolean, error: string) {
  if (!predicate) {
    throw new Error(error);
  }
}

const digit = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];

function capitalize(s: string) {
  // Also turn a leading digit into a string so '9p' becomes 'NineP'
  return s.replace(/^(\d?)(.)(.*)/,
    (_, maybeDigit, first, rest) => (digit[maybeDigit] || '') + first.toUpperCase() + rest);
}

function capitalizeParts(s: string) {
  return s.split('.').map(capitalize).join('.');
}

/**
 * Replace each sequence of capital letters after a lower-case one with a "-"
 * followed by its lower-case conversion. Different from lodash.kebabCase,
 * which assumes the last upper-case letter in a sequence starts the next
 * inner word-part, and would convert `numberCPUs` to `number-cp-us`
 */
function kebabCase(s: string) {
  return s.replace(/(?<=[a-z])([A-Z]+)/g, m => `-${ m.toLowerCase() }`);
}

function lastName(s: string): string {
  return s.split('.').pop() ?? '';
}

class Generator {
  constructor() {
    this.commandFlags = [];
    this.settingsTree = { version: { type: 'int' } };
  }

  commandFlags: commandFlagType[];
  settingsTree: settingsTreeType;

  protected async loadInput(inputFile: string): Promise<yamlObject> {
    const contents = (await fs.promises.readFile(inputFile)).toString();

    try {
      return yaml.parse(contents);
    } catch (e) {
      console.error(`Can't parse input file ${ inputFile }\n${ contents }\n\nError: ${ e }`, e);
      throw (e);
    }
  }

  protected processInput(obj: yamlObject, inputFile: string): void {
    const preferences = obj?.components?.schemas?.preferences;

    if (!preferences) {
      throw new Error(`Can't find components.schemas.preferences in ${ inputFile }`);
    }
    assert(preferences.type === 'object', `Expected preferences.type = 'object', got ${ preferences.type }`);
    assert(Object.keys(preferences.properties).length > 0, `Not a properties object: ${ preferences.properties }`);
    for (const propertyName of Object.keys(preferences.properties)) {
      this.walkProperty(propertyName, preferences.properties[propertyName], false, this.settingsTree);
    }
  }

  protected async emitOutput(outputFile: string) {
    const options = { rmWhitespace: false };
    const templateFile = 'scripts/assets/options.go.templ';

    const linesForJSON = this.collectServerSettingsForJSON(this.settingsTree, true, '');
    const linesWithoutJSON = this.collectServerSettingsForJSON(this.settingsTree, false, '');
    const data = {
      commandFlags:     this.commandFlags,
      linesForJSON:     linesForJSON.join('\n'),
      linesWithoutJSON: linesWithoutJSON.join('\n'),
      settingsVersion:  CURRENT_SETTINGS_VERSION,
      kebabCase,
    };
    const renderedContent = await ejs.renderFile(templateFile, data, options);

    if (!renderedContent) {
      throw new Error('ejs.renderFile returned nothing');
    }
    if (outputFile === '-') {
      console.log(renderedContent);

      return;
    }
    await fs.promises.mkdir(path.dirname(outputFile), { recursive: true });
    await fs.promises.writeFile(outputFile, renderedContent);
  }

  protected collectServerSettingsForJSON(settingsTree: settingsTreeType, includeJSONTag: boolean, indent: string): string[] {
    return Object.keys(settingsTree).flatMap((propertyName) => {
      return this.collectServerSettingsForJSONProperty(propertyName, settingsTree[propertyName], includeJSONTag, indent);
    });
  }

  protected collectServerSettingsForJSONProperty(propertyName: string, typeWrapper: settingsTypeObject, includeJSONTag: boolean, indent: string): string[] {
    if (typeof (typeWrapper.type) === 'object') {
      const lines: string[] = [];

      lines.push(`${ indent }${ capitalize(propertyName) } struct {`);
      lines.push(...this.collectServerSettingsForJSON(typeWrapper.type, includeJSONTag, `${ indent }  `));
      const lastLineParts = [indent, '}'];

      if (includeJSONTag) {
        lastLineParts.push(` \`json:"${ propertyName }"\``);
      }
      lines.push(lastLineParts.join(''));

      return lines;
    } else {
      const onlyLineParts = [indent, capitalize(propertyName), ' '];

      if (typeWrapper.type === 'array') {
        onlyLineParts.push('[]string');
      } else if (typeWrapper.type === 'hash') {
        onlyLineParts.push('map[string]interface{}');
      } else {
        if (includeJSONTag) {
          onlyLineParts.push('*');
        }
        onlyLineParts.push(typeWrapper.type);
      }
      if (includeJSONTag) {
        onlyLineParts.push(`\`json:"${ propertyName },omitempty"\``);
      }

      return [onlyLineParts.join('')];
    }
  }

  protected convertStringsToGolang(enums: string[] | undefined): string {
    return !enums ? '' : `[]string{${ enums.map(s => JSON.stringify(s) ).join(', ') }}`;
  }

  protected getCommandLineArgValue(flagType: goCmdFlagTypeName, capitalizedName: string) {
    switch (flagType) {
    case 'Bool':
      return `+"="+strconv.FormatBool(specifiedSettings.${ capitalizedName })`;
    case 'Int':
      return `, strconv.Itoa(specifiedSettings.${ capitalizedName })`;
    case 'String':
      return `, specifiedSettings.${ capitalizedName }`;
    case 'Array':
      return '';
    }
  }

  protected getFullUsageNote(usageNote: string, rawEnums: undefined | string[]): string {
    const usageParts = [usageNote];

    if (rawEnums) {
      usageParts.push(`(allowed values: [${ rawEnums.join(', ' ) }])`);
    }

    return usageParts.join(' ').trim();
  }

  protected updateLeaf(propertyName: string,
    capitalizedName: string,
    lcTypeName: goTypeName,
    flagType: goCmdFlagTypeName,
    defaultValue: string,
    preference: yamlObject,
    notAvailable: boolean,
    settingsTree: settingsTreeType) {
    const enums = this.convertStringsToGolang(preference.enum);
    const usageNote = preference['x-rd-usage'] ?? '';
    const newFlag: commandFlagType = {
      capitalizedName,
      defaultValue,
      flagType,
      propertyName,
      enums,
      aliasFor:  '',
      valuePart: this.getCommandLineArgValue(flagType, capitalizedName),
      notAvailable,
    };

    newFlag.usageNote = this.getFullUsageNote(usageNote, preference.enum);
    settingsTree[lastName(propertyName)] = { type: lcTypeName };
    this.commandFlags.push(newFlag);
    for (const alias of preference['x-rd-aliases'] ?? []) {
      this.commandFlags.push(Object.assign({}, newFlag, { propertyName: alias, aliasFor: propertyName }));
    }
  }

  protected walkProperty(
    propertyName: string,
    preference: yamlObject,
    notAvailable: boolean,
    settingsTree: settingsTreeType): void {
    const platforms = preference['x-rd-platforms'] ?? [];

    notAvailable ||= preference['x-rd-hidden'];
    notAvailable ||= platforms.length > 0 && !platforms.includes(process.platform);
    switch (preference.type) {
    case 'object':
      return this.walkPropertyObject(propertyName, preference, notAvailable, settingsTree);
    case 'boolean':
      return this.walkPropertyBoolean(propertyName, preference, notAvailable, settingsTree);
    case 'string':
      return this.walkPropertyString(propertyName, preference, notAvailable, settingsTree);
    case 'integer':
      return this.walkPropertyInteger(propertyName, preference, notAvailable, settingsTree);
    case 'array':
      // not yet available
      return this.walkPropertyArray(propertyName, preference, settingsTree);
    default:
      throw new Error(`walkProperty: unexpected preference.type: '${ preference.type }'`);
    }
  }

  protected walkPropertyArray(
    propertyName: string,
    preference: yamlObject,
    settingsTree: settingsTreeType,
  ): void {
    this.updateLeaf(propertyName, capitalizeParts(propertyName),
      'array', 'Array', 'nil',
      preference,
      true,
      settingsTree);
  }

  protected walkPropertyBoolean(
    propertyName: string,
    preference: yamlObject,
    notAvailable: boolean,
    settingsTree: settingsTreeType,
  ): void {
    this.updateLeaf(propertyName, capitalizeParts(propertyName),
      'bool', 'Bool', 'false',
      preference,
      notAvailable,
      settingsTree);
  }

  protected walkPropertyInteger(
    propertyName: string,
    preference: yamlObject,
    notAvailable: boolean,
    settingsTree: settingsTreeType,
  ): void {
    this.updateLeaf(propertyName, capitalizeParts(propertyName),
      'int', 'Int', '0',
      preference,
      notAvailable,
      settingsTree);
  }

  protected walkPropertyObject(
    propertyName: string,
    preference: yamlObject,
    notAvailable: boolean,
    settingsTree: settingsTreeType): void {
    if (preference.additionalProperties) {
      settingsTree[lastName(propertyName)] = { type: 'hash' };

      return;
    }
    const properties = preference.properties;

    assert(Object.keys(properties).length > 0, `Not a properties object: ${ properties }`);
    const innerSetting: settingsTreeType = {};

    for (const innerName in properties) {
      this.walkProperty(`${ propertyName }.${ innerName }`, properties[innerName], notAvailable, innerSetting);
    }

    settingsTree[lastName(propertyName)] = { type: innerSetting };
  }

  protected walkPropertyString(
    propertyName: string,
    preference: yamlObject,
    notAvailable: boolean,
    settingsTree: settingsTreeType,
  ): void {
    this.updateLeaf(propertyName, capitalizeParts(propertyName),
      'string', 'String', '""',
      preference,
      notAvailable,
      settingsTree);
  }

  async run(argv: string[]): Promise<void> {
    if (argv.length < 1) {
      throw new Error(`Not enough arguments: [${ argv.join(' ') }]; Usage: scriptFile inputFile [outputFile]`);
    }
    const obj = await this.loadInput(argv[0]);

    this.processInput(obj, argv[0]);
    await this.emitOutput(argv[1] ?? '-');
    if (argv[1]) {
      execFileSync('gofmt', ['-w', argv[1]]);
    }
  }
}

const idx = process.argv.findIndex(node => node.endsWith('generateCliCode.ts'));

if (idx === -1) {
  console.error("Can't find generateCliCode.ts in argv ", process.argv);
  process.exit(1);
}
const args = process.argv.slice(idx + 1);

if (args[args.length - 1] !== '-') {
  console.log(`Generating ${ args[args.length - 1] }...`);
}
(new Generator()).run(args).catch((e) => {
  console.error(e);
  if (e.stderr) {
    console.log(e.stderr.toString());
  }
  if (e.stdout) {
    console.log(e.output.toString());
  }
  process.exit(1);
});
