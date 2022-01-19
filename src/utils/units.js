export const UNITS = ['', 'K', 'M', 'G', 'T', 'P', 'E', 'Z', 'Y'];
export const FRACTIONAL = ['', 'm', 'u', 'n', 'p', 'f', 'a', 'z', 'y']; // milli micro nano pico femto

export function formatSi(inValue, {
  increment = 1000,
  addSuffix = true,
  suffix = '',
  firstSuffix = null,
  startingExponent = 0,
  minExponent = 0,
  maxExponent = 99,
  maxPrecision = 2
} = {}) {
  let val = inValue;
  let exp = startingExponent;
  const divide = maxExponent >= 0;

  // TODO More to think about re: min > max
  if (divide) {
    while ( ( val >= increment && exp + 1 < UNITS.length && exp < maxExponent ) || exp < minExponent ) {
      val = val / increment;
      exp++;
    }
  } else {
    while ( ( val < increment && exp + 1 < FRACTIONAL.length && exp < (maxExponent * -1) ) || exp < (minExponent * -1) ) {
      val = val * increment;
      exp++;
    }
  }

  let out = '';

  if ( val < 10 && maxPrecision >= 1 ) {
    out = `${ Math.round(val * (10 ** maxPrecision) ) / (10 ** maxPrecision) }`;
  } else {
    out = `${ Math.round(val) }`;
  }

  if ( addSuffix ) {
    if ( exp === 0 && firstSuffix !== null) {
      out += ` ${ firstSuffix }`;
    } else {
      out += ` ${ divide ? UNITS[exp] : FRACTIONAL[exp] }${ suffix }` || '';
    }
  }

  return out;
}

export function exponentNeeded(val, increment = 1000) {
  let exp = 0;

  while ( val >= increment ) {
    val = val / increment;
    exp++;
  }

  return exp;
}

export function parseSi(inValue, opt) {
  opt = opt || {};
  let increment = opt.increment;
  const allowFractional = opt.allowFractional !== false;

  if ( !inValue || typeof inValue !== 'string' || !inValue.length ) {
    return NaN;
  }

  inValue = inValue.replace(/,/g, '');

  // eslint-disable-next-line prefer-const
  let [, valStr, unit, incStr] = inValue.match(/^([0-9.-]+)\s*([^0-9.-]?)([^0-9.-]?)/);
  const val = parseFloat(valStr);

  if ( !unit ) {
    return val;
  }

  // micro "mu" symbol -> u
  if ( unit.charCodeAt(0) === 181 ) {
    unit = 'u';
  }

  const divide = FRACTIONAL.includes(unit);
  const multiply = UNITS.includes(unit.toUpperCase());

  if ( !increment ) {
    // Automatically handle 1 KB = 1000B, 1 KiB = 1024B if no increment set
    if ( (multiply || divide) && incStr === 'i' ) {
      increment = 1024;
    } else {
      increment = 1000;
    }
  }

  if ( divide && allowFractional ) {
    const exp = FRACTIONAL.indexOf(unit);

    return val / (increment ** exp);
  }

  if ( multiply ) {
    const exp = UNITS.indexOf(unit.toUpperCase());

    return val * (increment ** exp);
  }

  // Unrecognized unit character
  return val;
}

export const MEMORY_PARSE_RULES = {
  memory: {
    format: {
      addSuffix:        true,
      firstSuffix:      'B',
      increment:        1024,
      maxExponent:      99,
      maxPrecision:     2,
      minExponent:      0,
      startingExponent: 0,
      suffix:           'iB',
    }
  }
};

export function createMemoryFormat(n) {
  const exponent = exponentNeeded(n, MEMORY_PARSE_RULES.memory.format.increment);

  return {
    ...MEMORY_PARSE_RULES.memory.format,
    maxExponent: exponent,
    minExponent: exponent,
  };
}

function createMemoryUnits(n) {
  const exponent = exponentNeeded(n, MEMORY_PARSE_RULES.memory.format.increment);

  return `${ UNITS[exponent] }${ MEMORY_PARSE_RULES.memory.format.suffix }`;
}

export function createMemoryValues(total, useful) {
  const parsedTotal = parseSi((total || '0').toString());
  const parsedUseful = parseSi((useful || '0').toString());
  const format = createMemoryFormat(parsedTotal);
  const formattedTotal = formatSi(parsedTotal, format);
  const formattedUseful = formatSi(parsedUseful, format);

  return {
    total:  Number.parseFloat(formattedTotal),
    useful: Number.parseFloat(formattedUseful),
    units:  createMemoryUnits(parsedTotal)
  };
}

export default {
  exponentNeeded,
  formatSi,
  parseSi,
};
