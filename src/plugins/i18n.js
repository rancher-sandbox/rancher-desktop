import Vue from 'vue';
import { escapeHtml } from '../utils/string';

function stringFor(store, key, args, raw = false) {
  const translation = store.getters['i18n/t'](key, args);

  let out;

  if ( translation !== undefined ) {
    out = translation;
  } else if ( args && Object.keys(args).length ) {
    const argStr = Object.keys(args).map(k => `${ k }: ${ args[k] }`).join(', ');

    out = `%${ key }(${ argStr })%`;
    raw = true;
  } else {
    out = `%${ key }%`;
  }

  if ( raw ) {
    return out;
  } else {
    return escapeHtml(out);
  }
}

Vue.prototype.t = function(key, args, raw) {
  return stringFor(this.$store, key, args, raw);
};

function directive(el, binding, vnode /*, oldVnode */) {
  const { context } = vnode;
  const raw = binding.modifiers && binding.modifiers.raw === true;
  const str = stringFor(context.$store, binding.value, {}, raw);

  if ( binding.arg ) {
    el.setAttribute(binding.arg, str);
  } else {
    el.innerHTML = str;
  }
}

export function directiveSsr(vnode, binding) {
  const { context } = vnode;
  const raw = binding.modifiers && binding.modifiers.raw === true;
  const str = stringFor(context.$store, binding.value, {}, raw);

  if ( binding.arg ) {
    vnode.data.attrs[binding.arg] = str;
  } else {
    vnode.data.domProps = { innerHTML: str };
  }
}

// InnerHTML: <some-tag v-t="'some.key'" />
// As an attribute: <some-tag v-t:title="'some.key'" />
Vue.directive('t', {
  bind() {
    directive(...arguments);
  },

  update() {
    directive(...arguments);
  },
});

// Basic (but you might want the directive above): <t k="some.key" />
// With interpolation: <t k="some.key" count="1" :foo="bar" />
Vue.component('t', {
  inheritAttrs: false,
  props:        {
    k: {
      type:     String,
      required: true,
    },
    raw: {
      type:    Boolean,
      default: false,
    },
    tag: {
      type:    [String, Object],
      default: 'span'
    },
  },

  render(h) {
    const msg = stringFor(this.$store, this.k, this.$attrs, this.raw);

    if ( this.raw ) {
      return h(
        this.tag,
        { domProps: { innerHTML: msg } }
      );
    } else {
      return h(
        this.tag,
        [msg]
      );
    }
  },
});
