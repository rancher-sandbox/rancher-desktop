/*
Copyright © 2022 SUSE LLC

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
 * This script checks the command API schema against the settings file to ensure
 * that we have documented all settings.
 *
 * @note This does not check that we declare enums.
 */

import fs from 'fs';

import yaml from 'yaml';

import { defaultSettings } from '@pkg/config/settings';
import { RecursiveReadonly } from '@pkg/utils/typeUtils';

const schemaPath = 'pkg/rancher-desktop/assets/specs/command-api.yaml';

interface schemaObject {
  type:                  'object';
  properties?:           Record<string, schemaNode>;
  additionalProperties?: boolean;
}
interface schemaString {
  type: 'string';
}
interface schemaInteger {
  type: 'integer';
}
interface schemaBoolean {
  type: 'boolean';
}
interface schemaArray {
  type:  'array';
  items: schemaNode;
}
interface schemaMissing {
  // This is not a real schema type; it's a stand-in for a missing property.
  type: '<missing>';
}
type schemaNode = schemaObject | schemaString | schemaInteger | schemaBoolean | schemaArray | schemaMissing;

const blacklistedPaths = [
  'version',
];

function makePath(pathParts: string[]): string {
  switch (pathParts.length) {
  case 0: return '';
  case 1: return pathParts[0];
  }

  const copyParts = [...pathParts];
  const lastItem = copyParts.pop() ?? '';
  const lastSeparator = lastItem.startsWith('[') ? '' : '.';

  return `${ copyParts.join('.') }${ lastSeparator }${ lastItem }`;
}

function checkObject(setting: RecursiveReadonly<any>, schema: schemaNode, path: string[] = [], allowMissing = false): string[] {
  const errors: string[] = [];
  const pathString = makePath(path);

  function logTypeError(desiredType: schemaNode['type']) {
    errors.push(`${ pathString } has incorrect type "${ schema.type }", should be "${ desiredType }"`);
  }

  if (blacklistedPaths.includes(pathString)) {
    if (schema.type !== '<missing>') {
      errors.push(`${ pathString } should not be in the schema`);
    }

    return errors;
  }

  if (schema.type === '<missing>') {
    if (!allowMissing) {
      errors.push(`${ pathString } is missing in the schema`);
    }

    return errors;
  }

  switch (typeof setting) {
  case 'object': {
    if (schema.type !== 'object') {
      if (schema.type === 'array') {
        if (!Array.isArray(setting)) {
          logTypeError('object');
        } else {
          // check the types of the array's children
          for (let i = 0; i < setting.length; i++) {
            errors.push(...checkObject(setting[i], schema.items, path.concat([`[${ i }]`])));
          }
        }
      } else {
        logTypeError('object');
      }
      break;
    }
    const schemaProps = schema.properties ?? {} as Record<string, schemaNode>;

    for (const prop in setting) {
      const propSchema = schemaProps[prop] ?? { type: '<missing>' };

      errors.push(...checkObject(setting[prop], propSchema, path.concat(prop), schema.additionalProperties));
    }
    for (const prop in schemaProps) {
      if (!(prop in setting)) {
        errors.push(`${ path.concat(prop).join('.') } not found in Settings`);
      }
    }
    break;
  }
  case 'boolean':
    if (schema.type !== 'boolean') {
      logTypeError('boolean');
    }
    break;
  case 'number':
    if (schema.type !== 'integer') {
      logTypeError('integer');
    }
    break;
  case 'string':
    if (schema.type !== 'string') {
      logTypeError('string');
    }
    break;
  default:
    errors.push(`${ pathString } has object of unknown type ${ typeof setting }`);
  }

  return errors;
}

(async function() {
  const schema = yaml.parse(await fs.promises.readFile(schemaPath, { encoding: 'utf-8' }));
  const errors = checkObject(defaultSettings, schema.components.schemas.preferences);

  if (errors.length > 0) {
    console.error(`Preferences schema in ${ schemaPath } contains errors:`);
    for (const error of errors) {
      console.error(`  ${ error }`);
    }
    process.exit(1);
  }
  console.log(`Preferences schema ${ schemaPath } appears to be up to date.`);
})();
