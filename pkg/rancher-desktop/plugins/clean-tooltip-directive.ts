import DOMPurify from 'dompurify';
import { VTooltip } from 'v-tooltip';
import Vue, { DirectiveHook } from 'vue';

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

const bind: DirectiveHook<HTMLElement, any, any> = (el, binding, vnode, prevVNode) => {
  let { value } = binding;

  value = DOMPurify.sanitize(value, { ALLOWED_TAGS });

  return VTooltip.bind?.(el, { ...binding, value }, vnode, prevVNode);
};

Vue.directive('clean-tooltip', {
  ...VTooltip,
  bind,
  update: bind,
});
