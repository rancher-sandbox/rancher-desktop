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
  <span
    class="icon icon-gear ripple"
    aria-label="Open Preferences"
    role="button"
    @click="openPreferences"
    @keydown.enter="openPreferences"
    @keydown.space="openPreferences"
  />
</template>

<style lang="scss" scoped>
  .icon-gear {
    cursor: pointer;
    font-size: 1.875rem;
    // line-height: 2.25rem;
    padding: 0.5rem;
    transition: background 400ms;
    border-radius: 50%;
  }

  .ripple {
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
