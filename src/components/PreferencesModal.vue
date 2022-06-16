<script lang="ts">
import Vue from 'vue';
import PreferencesHeader from '@/components/PreferencesHeader.vue';
import PreferencesNav from '@/components/PreferencesNav.vue';

export default Vue.extend({
  name:       'preferences-modal',
  components: { PreferencesHeader, PreferencesNav }
});
</script>

<template>
  <modal
    name="preferences"
    class="modal"
  >
    <preferences-header />
    <preferences-nav />
  </modal>
</template>

<style lang="scss">
  .modal .vm--modal {
    background-color: var(--body-bg);
  }
</style>
