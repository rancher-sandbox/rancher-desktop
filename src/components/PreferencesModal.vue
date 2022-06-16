<script lang="ts">
import Vue from 'vue';
import PreferencesHeader from '@/components/PreferencesHeader.vue';
export default Vue.extend({
  name:       'preferences-modal',
  components: { PreferencesHeader }
});
</script>

<template>
  <modal
    name="preferences"
    class="modal"
  >
    <preferences-header />
  </modal>
</template>

<style lang="scss">
  .modal .vm--modal {
    background-color: var(--default);
  }
</style>
