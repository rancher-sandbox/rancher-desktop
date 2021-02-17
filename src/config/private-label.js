export const ANY = 0;
export const STANDARD = 1;
export const CUSTOM = 2;

let mode = STANDARD;
let vendor = 'Rancher';
let product = 'Dashboard';

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
  return vendor;
}

export function getProduct() {
  return product;
}
