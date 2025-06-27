<!--
  - Split Button, as found in Windows:
  -
  - Normal State:          Click on the dropdown button (expanded):
  - +-------------+---+    +-------------+---+
  - | Button Text | v |    | Button Text | v |
  - +-------------+---+    +-------------+---+
  -                        | Option 1        |
  -                        | Option 2        |
  -                        +-----------------+
  -
  -->

<script lang="ts">
import Vue from 'vue';

import type { PropType } from 'vue';

type Option = {
  /** The label to display as the option. */
  label: string;
  /** The value that will be emitted on @input */
  id: string;
  /** Optional icon */
  icon?: string;
};

export default Vue.extend({
  props: {
    /** The main button text */
    label: {
      type:    String,
      default: '',
    },
    /**
     * The dropdown options.
     * If the item is a string, then the label will be emitted.
     */
    options: {
      type:    Array as PropType<(Option | string)[]>,
      default: () => [],
    },
    /** The value to emit when the main button is clicked. */
    value: {
      type:    String,
      default: '',
    },
    disabled: {
      type:    Boolean,
      default: false,
    },
  },

  data() {
    return {
      /** Whether the popup is open */
      showing:    false,
      suppressed: false,
    };
  },

  computed: {
    computedOptions(): Option[] {
      return this.options.map((option) => {
        if (typeof (option) === 'string') {
          return { label: option, id: option };
        }

        return option;
      });
    },
  },

  methods: {
    /**
     * Because everything is inside the top <button>, we need to suppress any
     * click events that are fired on it when its children (e.g. the dropdown) are
     * clicked.  Call this to do so.
     * @returns true if suppression is active.
     */
    suppress(): boolean {
      if (this.suppressed) {
        return true;
      }
      this.suppressed = true;
      Promise.resolve().then(() => (this.suppressed = false));

      return false;
    },

    show() {
      this.showing = !this.disabled;
      this.$nextTick(() => this.popupFocus(1));
    },

    hide() {
      // Call suppress here, in case user clicked on .background to close the popup.
      this.suppress();
      this.showing = false;
      (this.$el as HTMLElement).focus();
    },

    execute(id?: string) {
      if (this.suppress()) {
        return;
      }

      this.$emit('input', typeof id === 'undefined' ? this.value : id);
      this.hide();
    },

    popupUp(event: KeyboardEvent) {
      const elem = event.target as Element | null;
      const prev = elem?.previousElementSibling as HTMLElement | null;

      prev?.focus();
    },

    popupDown(event: KeyboardEvent) {
      const elem = event.target as Element | null;
      const next = elem?.nextElementSibling as HTMLElement | null;

      next?.focus();
    },

    popupFocus(n: number) {
      if (n < 0) {
        n += this.computedOptions.length + 1;
      }
      const elem = this.$el.querySelector(`.menu > li:nth-child(${ n })`) as HTMLElement | null;

      elem?.focus();
    },

    popupHover(event: MouseEvent) {
      (event.target as HTMLElement | null)?.focus();
    },

    popupTrigger(event: KeyboardEvent) {
      const newEvent = new MouseEvent('click');

      event.target?.dispatchEvent(newEvent);
    },
  },
});
</script>

<template>
  <button
    class="btn split-button"
    :disabled="disabled"
    @click.self="execute()"
    @keyup.esc="hide"
  >
    {{ label }}
    <button
      v-if="computedOptions.length > 0"
      ref="indicator"
      class="indicator icon-btn icon icon-chevron-down role-multi-action"
      :aria-expanded="showing"
      @click="show"
    >
    </button>
    <div
      v-if="showing"
      class="background"
      @click="hide"
      @contextmenu.prevent
    ></div>
    <ul
      v-if="showing"
      class="list-unstyled menu"
    >
      <li
        v-for="opt in computedOptions"
        :key="opt.id"
        role="menuitem"
        tabindex="0"
        @click.stop="execute(opt.id)"
        @keydown.home.prevent="popupFocus(1)"
        @keydown.end.prevent="popupFocus(-1)"
        @keydown.arrow-up.prevent="popupUp"
        @keydown.arrow-down.prevent="popupDown"
        @keypress.space.prevent="popupTrigger"
        @keypress.enter.prevent="popupTrigger"
        @mouseover="popupHover"
      >
        <i
          v-if="opt.icon"
          :class="{icon: true, [`icon-${opt.icon}`]: true}"
        />
        <span v-text="opt.label" />
      </li>
    </ul>
  </button>
</template>

<style lang="scss" scoped>
  /* $btn-padding copied from _button.scss */
  $btn-padding: 21px;

  .split-button {
    position: relative;
    /* Remove the right padding so that the split button goes all the way */
    padding-right: 0;

    &.role-secondary {
      .indicator {
        border-left: 1px solid var(--primary);
      }
    }
  }
  .indicator {
    margin-left: math.div($btn-padding, 2);
    padding: 0 math.div($btn-padding, 2);
    background: transparent;
    border: none;
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
    box-shadow: none;
    &:focus::before {
      outline: 1px dashed;
    }
  }
  .menu {
    @include list-unstyled;

    position: absolute;
    margin-left: 0px - $btn-padding - /* border */ 1px;
    z-index: z-index('dropdownContent');

    color: var(--dropdown-text);
    background-color: var(--dropdown-bg);
    border: 1px solid var(--dropdown-border);
    border-radius: var(--border-radius);
    box-shadow: 0 5px 20px var(--shadow);
    /* Hide overflow to clip out the corners from border-radius */
    overflow: hidden;

    li {
      margin: 0;
      padding: 0 1em;
      &:focus {
        background-color: var(--dropdown-hover-bg);
        color: var(--dropdown-hover-text);
      }
      .icon {
        display: unset;
      }
    }
  }

  .background {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    opacity: 0;
    z-index: z-index('dropdownOverlay');
  }
  </style>
