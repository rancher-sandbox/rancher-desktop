import DOMPurify from 'dompurify';

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

export default {
  name: 'clean-html-directive',
  install(app) {
    app.directive('clean-html', {
      mounted(el, binding) {
        el.innerHTML = purifyHTML(binding.value);
      },
      updated(el, binding) {
        el.innerHTML = purifyHTML(binding.value);
      },
      unmounted(el) {
        el.innerHTML = '';
      },
    });
  },
};
