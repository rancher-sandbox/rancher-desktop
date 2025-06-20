export function getParent(el, parentSelector) {
  el = el?.parentElement;

  if (!el) {
    return null;
  }

  const matchFn = el.matches || el.matchesSelector;

  if (!matchFn.call(el, parentSelector)) {
    return getParent(el, parentSelector);
  }

  return el;
}
