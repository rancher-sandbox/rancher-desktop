import xor from 'lodash/xor';

import { get } from '@/utils/object';

export function removeObject(ary, obj) {
  const idx = ary.indexOf(obj);

  if ( idx >= 0 ) {
    ary.splice(idx, 1);
  }

  return ary;
}

export function removeObjects(ary, objs) {
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
  let first, last;

  // Group all the indexes into contiguous ranges
  while ( indexes.length ) {
    first = indexes.shift();
    last = first;

    while ( indexes.length && indexes[0] === last + 1 ) {
      last = indexes.shift();
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

export function addObject(ary, obj) {
  const idx = ary.indexOf(obj);

  if ( idx === -1 ) {
    ary.push(obj);
  }
}

export function addObjects(ary, objs) {
  const unique = [];

  for ( const obj of objs ) {
    if ( !ary.includes(obj) && !unique.includes(obj) ) {
      unique.push(obj);
    }
  }

  ary.push(...unique);
}

export function insertAt(ary, idx, ...objs) {
  ary.splice(idx, 0, ...objs);
}

export function isArray(thing) {
  return Array.isArray(thing);
}

export function removeAt(ary, idx, len = 1) {
  if ( idx < 0 ) {
    throw new Error('Index too low');
  }

  if ( idx + len > ary.length ) {
    throw new Error('Index + length too high');
  }

  ary.splice(idx, len);

  return ary;
}

export function clear(ary) {
  ary.splice(0, ary.length);
}

export function replaceWith(ary, ...objs) {
  ary.splice(0, ary.length, ...objs);
}

function findOrFilterBy(method, ary, keyOrObj, val) {
  ary = ary || [];

  if ( typeof keyOrObj === 'object' ) {
    return ary[method]((item) => {
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
    return ary[method](item => !!get(item, keyOrObj));
  } else {
    return ary[method](item => get(item, keyOrObj) === val);
  }
}

export function filterBy(ary, keyOrObj, val) {
  return findOrFilterBy('filter', ary, keyOrObj, val);
}

export function findBy(ary, keyOrObj, val) {
  return findOrFilterBy('find', ary, keyOrObj, val);
}

export function sameContents(aryA, aryB) {
  return xor(aryA, aryB).length === 0;
}

export function uniq(ary) {
  const out = [];

  addObjects(out, ary);

  return out;
}

/**
 * Can be used to compare array in loadash.mergeWith() function
 *
 * @param {*} objValue first array
 * @param {*} srcValue second array
 * @returns always second array (incoming value)
 */
export function arrayCustomizer(objValue, srcValue) {
  if (isArray(objValue) && objValue.every(i => typeof i !== 'object')) {
    return srcValue;
  }
}
