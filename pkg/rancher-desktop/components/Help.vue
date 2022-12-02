<script lang="ts">
import os from 'os';

import { shell } from 'electron';
import Vue from 'vue';

const validateKey = (event: KeyboardEvent) => ({
  darwin: event.metaKey && event.key === '?',
  linux:  event.key === 'F1',
  win32:  event.key === 'F1',
} as Record<string, boolean>);

export default Vue.extend({
  name:       'help',
  props:      {
    url: {
      type:     String,
      default:  null,
    },
    tooltip: {
      type:    String,
      default: null,
    },
    disabled: {
      type:    Boolean,
      default: false,
    },
  },
  mounted() {
    window.addEventListener('keydown', this.onKeydown);
  },
  destroyed() {
    window.removeEventListener('keydown', this.onKeydown);
  },
  methods:  {
    onKeydown(event: KeyboardEvent) {
      if (validateKey(event)[os.platform()]) {
        this.openUrl();
      }
    },
    openUrl() {
      if (this.url) {
        shell.openExternal(this.url);
      } else {
        this.$emit('open:url');
      }
    },
  },
});
</script>

<template>
  <div class="help-button">
    <button
      v-tooltip="{
        content: tooltip,
        placement: 'right'
      }"
      class="btn role-fab"
      :class="{
        disabled
      }"
      @click="openUrl"
    >
      <span
        class="icon icon-question-mark"
        :class="{
          disabled
        }"
      />
    </button>
  </div>
</template>

<style lang="scss" scoped>

  .help-button {

    .icon {
      display: inline-block;
      background-color: var(--primary);
      color: var(--body-bg);
      font-size: 1.3rem;
      width: 1.4rem;
      height: 1.4rem;
      border-radius: 50%;
      cursor: pointer;

      &:before{
        padding-top: 5%;
        padding-left: 2%;
        display: block;
      }

      &:hover {
        background: var(--primary-hover-bg);
      }
    }

    .disabled {
      background: transparent !important;
      color: var(--body-text);
      opacity: 0.2;
      cursor: default;
    }

    // We make use of the term Floating Action Button (fab) here because the
    // design of this button is reminiscent of floating actions buttons from
    // Material Design
    .role-fab {
      all: revert;

      border: 0;
      padding: 0;
      background: transparent;
      transition: background 200ms;
      border-radius: 50%;
      &.disabled {
        border: 0;
      }
    }
  }
</style>
