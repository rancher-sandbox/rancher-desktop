/**
 * Clone a given object, returning a disconnected copy.
 *
 * @note This should be replaced via StructuredClone in NodeJS 18.
 * @note This only supports primitive objects (array, object, string, etc.)
 */
export default function clone<T>(input: T): T {
  return JSON.parse(JSON.stringify(input));
}
