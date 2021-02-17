export const platform = ( typeof window === 'undefined' ? 'server' : window.navigator.platform.toLowerCase() );
export const userAgent = ( typeof window === 'undefined' ? 'server' : window.navigator.userAgent );

export const isLinuxy = platform.includes('linux') || platform.includes('unix');
export const isMac = platform.includes('mac');
export const isWin = platform.includes('win');

export const alternateKey = (isMac ? 'metaKey' : 'ctrlKey');
export const alternateLabel = (isMac ? 'Command' : 'Control');

export const moreKey = alternateKey;
export const moreLabel = alternateLabel;

export const rangeKey = 'shiftKey';
export const rangeLabel = 'Shift';

export function isAlternate(event) {
  return !!event[alternateKey];
}

export function isMore(event) {
  return !!event[moreKey];
}

export function isRange(event) {
  return !!event[rangeKey];
}

export function suppressContextMenu(event) {
  return event.ctrlKey && event.button === 2;
}

// Only intended to work for Mobile Safari at the moment...
export function version() {
  const match = userAgent.match(/\s+Version\/([0-9.]+)/);

  if ( match ) {
    return parseFloat(match[1]);
  }

  return null;
}

export const isGecko = userAgent.includes('Gecko/');
export const isBlink = userAgent.includes('Chrome/');
export const isWebKit = !isBlink && userAgent.includes('AppleWebKit/');
export const isSafari = !isBlink && userAgent.includes('Safari/');
export const isMobile = /Android|webOS|iPhone|iPad|iPod|IEMobile/i.test(userAgent);

export const KEY = {
  LEFT:      37,
  UP:        38,
  RIGHT:     39,
  DOWN:      40,
  ESCAPE:    27,
  CR:        13,
  LF:        10,
  TAB:       9,
  SPACE:     32,
  PAGE_UP:   33,
  PAGE_DOWN: 34,
  HOME:      35,
  END:       36,
};
