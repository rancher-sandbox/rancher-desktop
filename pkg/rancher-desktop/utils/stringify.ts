export function jsonStringifyWithWhiteSpace(obj: Record<string, any>): string {
  return `${ JSON.stringify(obj, undefined, 2) }\n`;
}
