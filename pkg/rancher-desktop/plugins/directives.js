import Vue from 'vue';

Vue.directive('focus', {
  mounted(_el, _binding, vnode) {
    const { components, refs } = vnode.ctx;

    if ('LabeledTooltip' in components) {
      refs.value?.focus();
    }
  },
});
