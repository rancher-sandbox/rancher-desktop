import { isArray } from './array';

/**
 * Can be used to merge arrays of primitive data types in lodash.mergeWith() function
 *
 * @param {*} objValue first array
 * @param {*} srcValue second array
 * @returns always second array (incoming value)
 */
export function arrayCustomizer(objValue: any, srcValue: any) {
  if (isArray(objValue) && objValue.every((i: any) => typeof i !== 'object')) {
    return srcValue;
  }
}
