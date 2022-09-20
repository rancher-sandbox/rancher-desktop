<script lang="ts">
import Vue from 'vue';
export default Vue.extend({
  name:    'preferences-button',
  methods: {
    openPreferences() {
      this.$emit('open-preferences');
    },
  },
});
</script>

<template>
  <button
    class="btn role-fab ripple"
    @click="openPreferences"
  >
    <span
      class="icon icon-gear"
    />
  </button>
</template>

<style lang="scss" scoped>
  // We make use of the term Floating Action Button (fab) here because the
  // design of this button is reminiscent of floating actions buttons from
  // Material Design
  button {
    &.role-fab {
      all: revert;
      cursor: pointer;
      font-size: 1.875rem;
      line-height: 0;
      border: 0;
      padding: 0.5rem;
      background: none;
      color: var(--body-text);
      transition: background 400ms;
      border-radius: 50%;
    }

    &:not([disabled]).ripple {
      background-position: center;
      transition: background 0.8s;

      &:hover {
        background: var(--tooltip-bg) radial-gradient(circle, transparent 1%, var(--tooltip-bg) 1%) center/15000%;
      }

      &:active {
        background-color: var(--default);
        background-size: 100%;
        transition: background 0s;
      }
    }

    &:disabled {
      cursor: not-allowed;
    }
  }
</style>
