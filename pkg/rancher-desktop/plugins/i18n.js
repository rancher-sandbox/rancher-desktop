import { watchEffect, ref, h } from 'vue';
import { useStore } from 'vuex';

// The i18n/t getter returns the raw translation; escaping is the sink's job.
// Text sinks ({{ }}, textContent) escape themselves; HTML sinks render
// translator-controlled markup and sanitize via v-clean-html where the
// content warrants it.

function directive(el, binding, vnode /*, oldVnode */) {
  const { instance } = binding;
  const str = instance.$store.getters['i18n/t'](binding.value, {});

  if ( binding.arg ) {
    el.setAttribute(binding.arg, str);
  } else {
    el.innerHTML = str;
  }
}

const i18n = {
  name:    'i18n',
  install: (vueApp, _options) => {
    if (vueApp.config.globalProperties.t && vueApp.directive('t') && vueApp.component('t')) {
      console.debug('Skipping i18n install. Directive, component, and option already exist.');
    }

    vueApp.config.globalProperties.t = function(key, args) {
      return this.$store.getters['i18n/t'](key, args);
    };

    // InnerHTML: <some-tag v-t="'some.key'" />
    // As an attribute: <some-tag v-t:title="'some.key'" />
    vueApp.directive('t', {
      beforeMount() {
        directive(...arguments);
      },
      updated() {
        directive(...arguments);
      },
    });

    // Basic (but you might want the directive above): <t k="some.key" />
    // With interpolation: <t k="some.key" count="1" :foo="bar" />
    // raw renders the translation as innerHTML instead of a text child.
    vueApp.component('t', {
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
          default: 'span',
        },
      },
      setup(props, ctx) {
        const msg = ref('');
        const store = useStore();

        watchEffect(() => {
          msg.value = store.getters['i18n/t'](props.k, ctx.attrs);
        });

        return { msg };
      },
      render() {
        if (this.raw) {
          return h(
            this.tag,
            { innerHTML: this.msg },
          );
        } else {
          return h(
            this.tag,
            { },
            [this.msg],
          );
        }
      },
    });
  },
};

export default i18n;
