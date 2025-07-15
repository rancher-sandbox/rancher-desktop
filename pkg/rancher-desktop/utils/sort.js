import { get } from './object';
import { strPad } from './string';

// Based on https://github.com/emberjs/ember.js/blob/master/packages/@ember/-internals/runtime/lib/type-of.js
// and      https://github.com/emberjs/ember.js/blob/master/packages/@ember/-internals/runtime/lib/mixins/array.js
/*
Copyright (c) 2019 Yehuda Katz, Tom Dale and Ember.js contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

// ........................................
// TYPING & ARRAY MESSAGING
//
const TYPE_MAP = {
  '[object Boolean]':  'boolean',
  '[object Number]':   'number',
  '[object String]':   'string',
  '[object Function]': 'function',
  '[object Array]':    'array',
  '[object Date]':     'date',
  '[object RegExp]':   'regexp',
  '[object Object]':   'object',
  '[object FileList]': 'filelist',
};

const { toString } = Object.prototype;

/**
  Returns a consistent type for the passed object.

  Use this instead of the built-in `typeof` to get the type of an item.
  It will return the same result across all browsers and includes a bit
  more detail. Here is what will be returned:

      | Return Value  | Meaning                                              |
      |---------------|------------------------------------------------------|
      | 'string'      | String primitive or String object.                   |
      | 'number'      | Number primitive or Number object.                   |
      | 'boolean'     | Boolean primitive or Boolean object.                 |
      | 'null'        | Null value                                           |
      | 'undefined'   | Undefined value                                      |
      | 'function'    | A function                                           |
      | 'array'       | An instance of Array                                 |
      | 'regexp'      | An instance of RegExp                                |
      | 'date'        | An instance of Date                                  |
      | 'filelist'    | An instance of FileList                              |
      | 'error'       | An instance of the Error object                      |
      | 'object'      | A JavaScript object                                  |

  Examples:

  import { typeOf } from '@shell/utils/type-of';

  typeOf();                       // 'undefined'
  typeOf(null);                   // 'null'
  typeOf(undefined);              // 'undefined'
  typeOf('michael');              // 'string'
  typeOf(new String('michael'));  // 'string'
  typeOf(101);                    // 'number'
  typeOf(new Number(101));        // 'number'
  typeOf(true);                   // 'boolean'
  typeOf(new Boolean(true));      // 'boolean'
  typeOf(A);                      // 'function'
  typeOf([1, 2, 90]);             // 'array'
  typeOf(/abc/);                  // 'regexp'
  typeOf(new Date());             // 'date'
  typeOf(event.target.files);     // 'filelist'
  typeOf(new Error('teamocil'));  // 'error'

  // 'normal' JavaScript object
  typeOf({ a: 'b' });             // 'object'
*/
export function typeOf(item) {
  if (item === null) {
    return 'null';
  }
  if (item === undefined) {
    return 'undefined';
  }
  let ret = TYPE_MAP[toString.call(item)] || 'object';

  if (ret === 'object') {
    if (item instanceof Error) {
      ret = 'error';
    } else if (item instanceof Date) {
      ret = 'date';
    }
  }

  return ret;
}

export function spaceship(a, b) {
  const diff = a - b;

  return (diff > 0) - (diff < 0);
}

const TYPE_ORDER = {
  undefined: 0,
  null:      1,
  boolean:   2,
  number:    3,
  string:    4,
  array:     5,
  object:    6,
  instance:  7,
  function:  8,
  class:     9,
  date:      10,
};

export function compare(a, b) {
  const typeA = typeOf(a);
  const typeB = typeOf(b);

  const res = spaceship(TYPE_ORDER[typeA], TYPE_ORDER[typeB]);

  if ( res ) {
    return res;
  }

  switch (typeA) {
  case 'boolean':
  case 'number':
    return spaceship(a, b);

  case 'string':
    return spaceship(a.localeCompare(b), 0);

  case 'array': {
    const aLen = a.length;
    const bLen = b.length;
    const len = Math.min(aLen, bLen);

    for (let i = 0; i < len; i++) {
      const r = compare(a[i], b[i]);

      if (r !== 0) {
        return r;
      }
    }

    // all elements are equal now
    // shorter array should be ordered first
    return spaceship(aLen, bLen);
  }
  case 'date':
    return spaceship(a.getTime(), b.getTime());
  }

  return 0;
}

export function parseField(str) {
  const parts = str.split(/:/);

  if ( parts.length === 2 && parts[1] === 'desc' ) {
    return { field: parts[0], reverse: true };
  } else {
    return { field: str, reverse: false };
  }
}

export function sortBy(ary, keys, desc) {
  if ( !Array.isArray(keys) ) {
    keys = [keys];
  }

  return (ary || []).slice().sort((objA, objB) => {
    for ( let i = 0 ; i < keys.length ; i++ ) {
      const parsed = parseField(keys[i]);
      const a = get(objA, parsed.field);
      const b = get(objB, parsed.field);
      let res = compare(a, b);

      if ( res ) {
        if ( desc ) {
          res *= -1;
        }

        if ( parsed.reverse ) {
          res *= -1;
        }

        return res;
      }
    }

    return 0;
  });
}

// Turn foo1-bar2 into foo0000000001-bar0000000002 so that the numbers sort numerically
const splitRegex = /([^\d]+)/;
const notNumericRegex = /^[0-9]+$/;

export function sortableNumericSuffix(str) {
  if ( typeof str !== 'string' ) {
    return str;
  }

  return str.split(splitRegex).map((x) => x.match(notNumericRegex) ? strPad(x, 10, '0') : x).join('').trim();
}

export function isNumeric(num) {
  return !!`${ num }`.match(notNumericRegex);
}
