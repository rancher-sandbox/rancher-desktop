import Vue from 'vue';

Vue.directive('focus', {
  inserted(_el, _binding, vnode) {
    const element = getElement(vnode);

    if (element) {
      element.focus();
    }
  }
});

const getElement = (vnode) => {
  const { componentInstance, componentOptions: { tag } } = vnode;

  if (tag === 'labeled-input') {
    return componentInstance.$refs.value;
  }
};
