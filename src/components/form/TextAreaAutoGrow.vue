<script>
import $ from 'jquery';
import debounce from 'lodash/debounce';
import { _EDIT, _VIEW } from '@/config/query-params';

export default {
  inheritAttrs: false,

  props: {
    mode: {
      type:    String,
      default: _EDIT
    },

    minHeight: {
      type:    Number,
      default: 35,
    },
    maxHeight: {
      type:    Number,
      default: 200,
    },
    placeholder: {
      type:    String,
      default: '',
    },
    spellcheck: {
      type:    Boolean,
      default: true
    },

    disabled: {
      type:    Boolean,
      default: false,
    }
  },

  data() {
    return {
      curHeight: this.minHeight,
      overflow:  'hidden',
    };
  },

  computed: {
    isDisabled() {
      return this.disabled || this.mode === _VIEW;
    },

    style() {
      // This sets the height to one-line for SSR pageload so that it's already right
      // (unless the input is long)
      return `height: ${ this.curHeight }px; overflow: ${ this.overflow };`;
    },
  },

  watch: {
    $attrs: {
      deep: true,
      handler() {
        this.queueResize();
      }
    },
  },

  created() {
    this.queueResize = debounce(this.autoSize, 100);
  },

  mounted() {
    $(this.$refs.ta).css('height', `${ this.curHeight }px`);
    this.$nextTick(() => {
      this.autoSize();
    });
  },

  methods: {
    onInput(val) {
      this.$emit('input', val);
      this.queueResize();
    },

    focus() {
      this.$refs.ta.focus();
    },

    autoSize() {
      const el = this.$refs.ta;

      if ( !el ) {
        return;
      }

      const $el = $(el);

      $el.css('height', '1px');

      const border = parseInt($el.css('borderTopWidth'), 10) || 0 + parseInt($el.css('borderBottomWidth'), 10) || 0;
      const neu = Math.max(this.minHeight, Math.min(el.scrollHeight + border, this.maxHeight));

      $el.css('overflowY', (el.scrollHeight > neu ? 'auto' : 'hidden'));
      $el.css('height', `${ neu }px`);

      this.curHeight = neu;
    }
  }
};
</script>

<template>
  <textarea
    ref="ta"
    :disabled="isDisabled"
    :style="style"
    :placeholder="placeholder"
    class="no-resize no-ease"
    v-bind="$attrs"
    :spellcheck="spellcheck"
    @paste="$emit('paste', $event)"
    @input="onInput($event.target.value)"
    @focus="$emit('focus', $event)"
    @blur="$emit('blur', $event)"
  />
</template>

<style lang='scss' scoped>
</style>
