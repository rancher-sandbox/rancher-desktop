import { SETTING } from './settings';

export const ANY = 0;
export const STANDARD = 1;
export const CUSTOM = 2;

const STANDARD_VENDOR = 'Rancher';
const STANDARD_PRODUCT = 'Explorer';

let mode = STANDARD;
let vendor = STANDARD_VENDOR;
let product = STANDARD_PRODUCT;

export function setMode(m) {
  mode = m;
}

export function setVendor(v) {
  vendor = v;
}

export function setProduct(p) {
  product = p;
}

// -------------------------------------

export function getMode() {
  return mode;
}

export function isStandard() {
  return mode === STANDARD;
}

export function matches(pl) {
  if ( pl === ANY ) {
    return true;
  }

  return pl === mode;
}

export function getVendor() {
  if ( vendor === SETTING.PL_RANCHER_VALUE ) {
    return STANDARD_VENDOR;
  }

  return vendor;
}

export function getProduct() {
  return product;
}
