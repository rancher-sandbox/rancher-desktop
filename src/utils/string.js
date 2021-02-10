export function camelToTitle(str) {
  return dasherize((str || '')).split('-').map((str) => {
    return ucFirst(str);
  }).join(' ');
}

export function ucFirst(str) {
  str = str || '';

  return str.substr(0, 1).toUpperCase() + str.substr(1);
}

export function lcFirst(str) {
  str = str || '';

  return str.substr(0, 1).toLowerCase() + str.substr(1);
}

export function strPad(str, toLength, padChars = ' ', right = false) {
  str = `${ str }`;

  if (str.length >= toLength) {
    return str;
  }

  const neededLen = toLength - str.length + 1;
  const padStr = (new Array(neededLen)).join(padChars).substr(0, neededLen);

  if (right) {
    return str + padStr;
  } else {
    return padStr + str;
  }
}

// Turn thing1 into thing00000001 so that the numbers sort numerically
export function sortableNumericSuffix(str) {
  str = str || '';
  const match = str.match(/^(.*[^0-9])([0-9]+)$/);

  if (match) {
    return match[1] + strPad(match[2], 8, '0');
  }

  return str;
}

const entityMap = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '/': '&#x2F;'
};

export function escapeHtml(html) {
  return String(html).replace(/[&<>"']/g, (s) => {
    return entityMap[s];
  });
}

export function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

export function random32(count) {
  count = Math.max(0, count || 1);

  const out = [];
  let i;

  if ( process.server ) {
    const crypto = require('crypto');

    for ( i = 0 ; i < count ; i++ ) {
      out[i] = crypto.randomBytes(4).readUInt32BE(0, true);
    }
  } else if (window.crypto && window.crypto.getRandomValues) {
    const tmp = new Uint32Array(count);

    window.crypto.getRandomValues(tmp);
    for (i = 0; i < tmp.length; i++) {
      out[i] = tmp[i];
    }
  } else {
    for (i = 0; i < count; i++) {
      out[i] = Math.random() * 4294967296; // Math.pow(2,32);
    }
  }

  if (count === 1) {
    return out[0];
  } else {
    return out;
  }
}

const alpha = 'abcdefghijklmnopqrstuvwxyz';
const num = '0123456789';
const sym = '!@#$%^&*()_+-=[]{};:,./<>?|';

export const CHARSET = {
  NUMERIC:     num,
  NO_VOWELS:   'bcdfghjklmnpqrstvwxz2456789',
  ALPHA:       alpha + alpha.toUpperCase(),
  ALPHA_NUM:   alpha + alpha.toUpperCase() + num,
  ALPHA_LOWER: alpha,
  ALPHA_UPPER: alpha.toUpperCase(),
  HEX:         `${ num }ABCDEF`,
  PASSWORD:    alpha + alpha.toUpperCase() + num + alpha + alpha.toUpperCase() + num + sym,
  // ^-- includes alpha / ALPHA / num twice to reduce the occurrence of symbols
};

export function randomStr(length = 16, chars = CHARSET.ALPHA_NUM) {
  if (!chars || !chars.length) {
    return null;
  }

  return random32(length).map((val) => {
    return chars[val % chars.length];
  }).join('');
}

export function formatPercent(value, maxPrecision = 2) {
  if (value < 1 && maxPrecision >= 2) {
    return `${ Math.round(value * 100) / 100 }%`;
  } else if (value < 10 && maxPrecision >= 1) {
    return `${ Math.round(value * 10) / 10 }%`;
  } else {
    return `${ Math.round(value) }%`;
  }
}

export function pluralize(str) {
  if ( str.match(/.*[^aeiou]y$/i) ) {
    return `${ str.substr(0, str.length - 1) }ies`;
  } else if ( str.endsWith('s') ) {
    return `${ str }es`;
  } else {
    return `${ str }s`;
  }
}

export function indent(lines, count = 2, token = ' ', afterRegex = null) {
  if (typeof lines === 'string') {
    lines = lines.split(/\n/);
  } else {
    lines = lines || [];
  }

  const padStr = (new Array(count + 1)).join(token);

  const out = lines.map((line) => {
    let prefix = '';
    let suffix = line;

    if (afterRegex) {
      const match = line.match(afterRegex);

      if (match) {
        prefix = match[match.length - 1];
        suffix = line.substr(match[0].length);
      }
    }

    return `${ prefix }${ padStr }${ suffix }`;
  });

  const str = out.join('\n');

  return str;
}

const decamelizeRegex = /([a-z\d])([A-Z])/g;

export function decamelize(str) {
  return str.replace(decamelizeRegex, '$1_$2').toLowerCase();
}

const dasherizeRegex = /[ _]/g;

export function dasherize(str) {
  return decamelize(str).replace(dasherizeRegex, '-');
}

export function asciiLike(str) {
  str = str || '';

  if ( str.match(/[^\r\n\t\x20-\x7F]/) ) {
    return false;
  }

  return true;
}

export function coerceStringTypeToScalarType(val, type) {
  if ( type === 'float' ) {
    // Coerce strings to floats
    val = parseFloat(val) || null; // NaN becomes null
  } else if ( type === 'int' ) {
    // Coerce strings to ints
    val = parseInt(val, 10);

    if ( isNaN(val) ) {
      val = null;
    }
  } else if ( type === 'boolean') {
    // Coerce strings to boolean
    if (val.toLowerCase() === 'true') {
      val = true;
    } else if (val.toLowerCase() === 'false') {
      val = false;
    }
  }

  return val;
}

export function matchesSomeRegex(stringRaw, regexes = []) {
  return regexes.some((regexRaw) => {
    const string = stringRaw || '';
    const regex = ensureRegex(regexRaw);

    return string.match(regex);
  });
}

export function ensureRegex(strOrRegex, exact = true) {
  if ( typeof strOrRegex === 'string' ) {
    if ( exact ) {
      return new RegExp(`^${ escapeRegex(strOrRegex) }$`, 'i');
    } else {
      return new RegExp(`${ escapeRegex(strOrRegex) }`, 'i');
    }
  }

  return strOrRegex;
}

export function nlToBr(value) {
  return escapeHtml(value || '').replace(/(\r\n|\r|\n)/g, '<br/>\n');
}
