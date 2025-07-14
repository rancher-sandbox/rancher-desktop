import DOMPurify from 'dompurify';
import { vTooltip } from 'floating-vue';
import { App, DirectiveHook } from 'vue';

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

export default ({
  name: 'clean-tooltip-directive',
  install(app: App, ..._options: any) {
    const fn: DirectiveHook<HTMLElement, any, any> = (el, binding) => {
      let { value } = binding;

      value = DOMPurify.sanitize(value, { ALLOWED_TAGS });

      return vTooltip.beforeMount(el, { ...binding, value });
    };

    app.directive('clean-tooltip', {
      ...vTooltip,
      beforeMount: fn,
      updated:     fn,
    });
  },
});
