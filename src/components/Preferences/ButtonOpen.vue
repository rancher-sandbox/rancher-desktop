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
    class="btn role-secondary btn-sm"
    type="button"
    aria-label="Open Preferences"
    @click="openPreferences"
  >
    <i class="icon icon-gear" />
  </button>
</template>

<style lang="scss" scoped>
  button.btn {
    background: none;
    border: none;
    box-shadow: none;
    .icon {
      background: var(--primary);
      color: var(--primary-text);
      width: 32px;
      height: 32px;
      border-radius: 50%;
      padding-top: 5px;
      &::before {
        font-size: 22px;
        margin-left: 1px;
      }
    }
    &:focus {
      .icon {
        outline: var(--outline-width) dashed var(--primary-active-bg);
      }
    }
  }
</style>
