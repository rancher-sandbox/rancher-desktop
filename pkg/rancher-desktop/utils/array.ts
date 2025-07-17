import xor from 'lodash/xor.js';
import { get, isEqual } from '@pkg/utils/object';

export function removeObject<T>(ary: T[], obj: T): T[] {
  const idx = ary.indexOf(obj);

  if ( idx >= 0 ) {
    ary.splice(idx, 1);
  }

  return ary;
}

export function removeObjects<T>(ary: T[], objs: T[]): T[] {
  let i;
  let indexes = [];

  for ( i = 0 ; i < objs.length ; i++ ) {
    let idx = ary.indexOf(objs[i]);

    // Find multiple copies of the same value
    while ( idx !== -1 ) {
      indexes.push(idx);
      idx = ary.indexOf(objs[i], idx + 1);
    }
  }

  if ( !indexes.length ) {
    // That was easy...
    return ary;
  }

  indexes = indexes.sort((a, b) => a - b);

  const ranges = [];
  let first: number;
  let last: number;

  // Group all the indexes into contiguous ranges
  while ( indexes.length ) {
    first = indexes.shift() as number;
    last = first;

    while ( indexes.length && indexes[0] === last + 1 ) {
      last = indexes.shift() as number;
    }

    ranges.push({ start: first, end: last });
  }

  // Remove the items by range
  for ( i = ranges.length - 1 ; i >= 0 ; i--) {
    const { start, end } = ranges[i];

    ary.splice(start, end - start + 1);
  }

  return ary;
}

export function addObject<T>(ary: T[], obj: T): void {
  const idx = ary.indexOf(obj);

  if ( idx === -1 ) {
    ary.push(obj);
  }
}

export function addObjects<T>(ary: T[], objs: T[]): void {
  const unique: T[] = [];

  for ( const obj of objs ) {
    if ( !ary.includes(obj) && !unique.includes(obj) ) {
      unique.push(obj);
    }
  }

  ary.push(...unique);
}

export function insertAt<T>(ary: T[], idx: number, ...objs: T[]): void {
  ary.splice(idx, 0, ...objs);
}

export function isArray<T>(thing: T[] | T): thing is T[] {
  return Array.isArray(thing);
}

export function toArray<T>(thing: T[] | T): T[] {
  return isArray(thing) ? thing : [thing];
}

export function removeAt<T>(ary: T[], idx: number, length = 1): T[] {
  if ( idx < 0 ) {
    throw new Error('Index too low');
  }

  if ( idx + length > ary.length ) {
    throw new Error('Index + length too high');
  }

  ary.splice(idx, length);

  return ary;
}

export function clear<T>(ary: T[]): void {
  ary.splice(0, ary.length);
}

export function replaceWith<T>(ary: T[], ...values: T[]): void {
  ary.splice(0, ary.length, ...values);
}

function findOrFilterBy<T, K, V>(
  method: 'filter', ary: T[] | null, keyOrObj: string | K, val?: V
): T[];
function findOrFilterBy<T, K, V>(
  method: 'find', ary: T[] | null, keyOrObj: string | K, val?: V
): T;
function findOrFilterBy<T, K, V>(
  method: keyof T[], ary: T[] | null, keyOrObj: string | K, val?: V
): T[] {
  ary = ary || [];

  if ( typeof keyOrObj === 'object' ) {
    return (ary[method] as Function)((item: T) => {
      for ( const path in keyOrObj ) {
        const want = keyOrObj[path];
        const have = get(item, path);

        if ( typeof want === 'undefined' ) {
          if ( !have ) {
            return false;
          }
        } else if ( have !== want ) {
          return false;
        }
      }

      return true;
    });
  } else if ( val === undefined ) {
    return (ary[method] as Function)((item: T) => !!get(item, keyOrObj));
  } else {
    return (ary[method] as Function)((item: T) => get(item, keyOrObj) === val);
  }
}

export function filterBy<T, K, V>(
  ary: T[] | null, keyOrObj: string | K, val?: V
): T[] {
  return findOrFilterBy('filter', ary, keyOrObj, val);
}

export function findBy<T, K, V>(
  ary: T[] | null, keyOrObj: string | K, val?: V
): T {
  return findOrFilterBy('find', ary, keyOrObj, val);
}

export function findStringIndex(items: string[], item: string, trim = true): number {
  return items.indexOf(trim ? item?.trim() : item);
}

export function hasDuplicatedStrings(items: string[], caseSensitive = true): boolean {
  const normalizedItems = items.map((i) => (caseSensitive ? i : i.toLowerCase()).trim());

  for (let i = 0; i < items.length; i++) {
    const index = findStringIndex(
      normalizedItems,
      (caseSensitive ? items[i] : items[i].toLowerCase()),
    );

    if (i !== index) {
      return true;
    }
  }

  return false;
}

export function sameContents<T>(aryA: T[], aryB: T[]): boolean {
  return xor(aryA, aryB).length === 0;
}

export function sameArrayObjects<T>(aryA: T[], aryB: T[], positionAgnostic = false): boolean {
  if (!aryA && !aryB) {
    // catch calls from js (where props aren't type checked)
    return false;
  }
  if (aryA?.length !== aryB?.length) {
    // catch one null and not t'other, and different lengths
    return false;
  }

  if (positionAgnostic) {
    const consumedB: { [pos: number]: boolean } = {};

    aryB.forEach((_, index) => {
      consumedB[index] = false;
    });

    for (let i = 0; i < aryA.length; i++) {
      const a = aryA[i];

      const validA = aryB.findIndex((arB, index) => isEqual(arB, a) && !consumedB[index] );

      if (validA >= 0) {
        consumedB[validA] = true;
      } else {
        return false;
      }
    }
  } else {
    for (let i = 0; i < aryA.length; i++) {
      if (!isEqual(aryA[i], aryB[i])) {
        return false;
      }
    }
  }

  return true;
}

export function uniq<T>(ary: T[]): T[] {
  const out: T[] = [];

  addObjects(out, ary);

  return out;
}

export function concatStrings(a: string[], b: string[]): string[] {
  return [...a.map((aa) => b.map((bb) => aa.concat(bb)))].reduce((acc, arr) => [...arr, ...acc], []);
}

interface KubeResource { metadata: { labels: { [name: string]: string} } } // Migrate to central kube types resource when those are brought in
export function getUniqueLabelKeys<T extends KubeResource>(aryResources: T[]): string[] {
  const uniqueObj = aryResources.reduce((res, r) => {
    Object.keys(r.metadata.labels).forEach((l) => (res[l] = true));

    return res;
  }, {} as {[label: string]: boolean});

  return Object.keys(uniqueObj).sort();
}
