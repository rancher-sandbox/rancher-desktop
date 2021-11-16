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

  if (tag === 'LabeledInput') {
    return componentInstance.$refs.value;
  }

  if (tag === 'LabeledSelect') {
    componentInstance.shouldOpen = false;

    return componentInstance.$refs['select-input'].$refs.search;
  }

  if (tag === 'SelectPrincipal') {
    const labeledSelect = componentInstance.$refs['labeled-select'];

    labeledSelect.shouldOpen = false;

    return labeledSelect.$refs['select-input'].$refs.search;
  }

  if (tag === 'TextAreaAutoGrow') {
    return componentInstance.$refs.ta;
  }

  if (tag === 'Password') {
    return componentInstance.$refs.input.$refs.value;
  }
};
