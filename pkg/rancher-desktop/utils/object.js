import jsonpath from 'jsonpath';
import cloneDeep from 'lodash/cloneDeep';
import compact from 'lodash/compact';
import difference from 'lodash/difference';
import flattenDeep from 'lodash/flattenDeep';
import isEqual from 'lodash/isEqual';
import isObject from 'lodash/isObject';
import transform from 'lodash/transform';
import Vue from 'vue';

const quotedKey = /['"]/;
const quotedMatch = /[^."']+|"([^"]*)"|'([^']*)'/g;

export function set(obj, path, value) {
  let ptr = obj;
  let parts;

  if (!ptr) {
    return;
  }

  if ( path.match(quotedKey) ) {
    // Path with quoted section
    parts = path.match(quotedMatch).map(x => x.replace(/['"]/g, ''));
  } else {
    // Regular path
    parts = path.split('.');
  }

  for (let i = 0; i < parts.length; i++) {
    const key = parts[i];

    if ( i === parts.length - 1 ) {
      Vue.set(ptr, key, value);
    } else if ( !ptr[key] ) {
      // Make sure parent keys exist
      Vue.set(ptr, key, {});
    }

    ptr = ptr[key];
  }

  return obj;
}

export function get(obj, path) {
  if ( path.startsWith('$') ) {
    try {
      return jsonpath.query(obj, path)[0];
    } catch (e) {
      console.log('JSON Path error', e);

      return '(JSON Path err)';
    }
  }

  let parts;

  if ( path.match(quotedKey) ) {
    // Path with quoted section
    parts = path.match(/[^."']+|"([^"]*)"|'([^']*)'/g).map(x => x.replace(/['"]/g, ''));
  } else {
    // Regular path
    parts = path.split('.');
  }

  for (let i = 0; i < parts.length; i++) {
    if (!obj) {
      return;
    }

    obj = obj[parts[i]];
  }

  return obj;
}

export function getter(path) {
  return function(obj) {
    return get(obj, path);
  };
}

export function clone(obj) {
  return cloneDeep(obj);
}

export function isEmpty(obj) {
  if ( !obj ) {
    return true;
  }

  return !Object.keys(obj).length;
}

/**
 * Checks to see if the object is a simple key value pair where all values are
 * just primitives.
 * @param {any} obj
 */
export function isSimpleKeyValue(obj) {
  return obj !== null &&
    !Array.isArray(obj) &&
    typeof obj === 'object' &&
    Object.values(obj || {}).every(v => typeof v !== 'object');
}

/*
returns an object with no key/value pairs (including nested) where the value is:
  empty array
  empty object
  null
  undefined
*/
export function cleanUp(obj) {
  Object.keys(obj).map((key) => {
    const val = obj[key];

    if ( Array.isArray(val) ) {
      obj[key] = compact(val.map((each) => {
        if (each) {
          const cleaned = cleanUp(each);

          if (!isEmpty(cleaned)) {
            return cleaned;
          }
        }
      }));
      if (compact(obj[key]).length === 0) {
        delete obj[key];
      }
    } else if (typeof val === 'undefined' || val === null) {
      delete obj[key];
    } else if ( isObject(val) ) {
      if (isEmpty(val)) {
        delete obj[key];
      }
      obj[key] = cleanUp(val);
    }
  });

  return obj;
}

export function definedKeys(obj) {
  const keys = Object.keys(obj).map((key) => {
    const val = obj[key];

    if ( Array.isArray(val) ) {
      return key;
    } else if ( isObject(val) ) {
      return ( definedKeys(val) || [] ).map(subkey => `${ key }.${ subkey }`);
    } else {
      return key;
    }
  });

  return compact(flattenDeep(keys));
}

export function diff(from, to) {
  from = from || {};
  to = to || {};

  // Copy values in 'to' that are different than from
  const out = transform(to, (res, toVal, k) => {
    const fromVal = from[k];

    if ( isEqual(toVal, fromVal) ) {
      return;
    }

    if ( Array.isArray(toVal) || Array.isArray(fromVal) ) {
      // Don't diff arrays, just use the whole value
      res[k] = toVal;
    } else if ( isObject(toVal) && isObject(from[k]) ) {
      res[k] = diff(fromVal, toVal);
    } else {
      res[k] = toVal;
    }
  });

  const fromKeys = definedKeys(from);
  const toKeys = definedKeys(to);
  const missing = difference(fromKeys, toKeys);

  for ( const k of missing ) {
    set(out, k, null);
  }

  return out;
}

export function nonEmptyValueKeys(obj) {
  const validKeys = Object.keys(obj).map((key) => {
    const val = obj[key];

    if ( isObject(val) ) {
      const recursed = nonEmptyValueKeys(val);

      if (recursed) {
        return recursed.map((subkey) => {
          return `"${ key }"."${ subkey }"`;
        });
      }
    } else if ( Array.isArray(val) ) {
      if (compact(val).length) {
        return key;
      }
    } else if (!!val || val === false || val === 0) {
      return key;
    }
  });

  return compact(flattenDeep(validKeys));
}
