import DOMPurify from 'dompurify';
import Vue from 'vue';

const ALLOWED_TAGS = [
  'code',
  'li',
  'a',
  'p',
  'b',
  'br',
  'ul',
  'pre',
  'span',
  'div',
  'i',
  'em',
  'strong',
];

const purifyHTML = value => DOMPurify.sanitize(value, { ALLOWED_TAGS });

export const cleanHtmlDirective = {
  mounted(el, binding) {
    el.innerHTML = purifyHTML(binding.value);
  },
  updated(el, binding) {
    el.innerHTML = purifyHTML(binding.value);
  },
  unmounted(el) {
    el.innerHTML = '';
  },
};

Vue.directive('clean-html', cleanHtmlDirective);
