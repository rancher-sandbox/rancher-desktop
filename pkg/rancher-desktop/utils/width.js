/**
 * Sets the width of a DOM element. Adapted from [youmightnotneedjquery.com](https://youmightnotneedjquery.com/#set_width)
 * @param {Element} el - The target DOM element
 * @param {function | string | number} val - The desired width represented as a Number
 */
export function setWidth(el, val) {
  if (!el) {
    return;
  }

  if (typeof val === 'function') {
    val = val();
  }

  if (typeof val === 'string') {
    el.style.width = val;

    return;
  }

  el.style.width = `${ val }px`;
}

/**
 * Gets the width of a DOM element. Adapted from [youmightnotneedjquery.com](https://youmightnotneedjquery.com/#get_width)
 * @param {Element} el - The target DOM element
 * @returns Number representing the width for the provided element
 */
export function getWidth(el) {
  if (!el || !el.length) {
    return;
  }

  if (el.length) {
    return parseFloat(getComputedStyle(el[0]).width.replace('px', ''));
  } else {
    return parseFloat(getComputedStyle(el).width.replace('px', ''));
  }
}
