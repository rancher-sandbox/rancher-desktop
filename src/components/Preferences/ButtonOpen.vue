<script lang="ts">
import Vue from 'vue';
export default Vue.extend({
  name:    'preferences-button',
  methods: {
    openPreferences() {
      this.$emit('open-preferences');
    }
  }
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
  button.role-fab {
    all: revert;
    cursor: pointer;
    font-size: 1.875rem;
    line-height: 0;
    border: 0;
    padding: 0.5rem;
    background: none;
    color: var(--primary-text);
    transition: background 400ms;
    border-radius: 50%;
  }

  button.ripple {
    background-position: center;
    transition: background 0.8s;
  }

  .ripple:hover {
    background: var(--primary-hover-bg) radial-gradient(circle, transparent 1%, var(--primary-hover-bg) 1%) center/15000%;
  }

  .ripple:active {
    background-color: var(--primary);
    background-size: 100%;
    transition: background 0s;
  }
</style>
