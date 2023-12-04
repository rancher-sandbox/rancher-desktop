<script lang="ts">
import Vue from 'vue';

import PreferencesButton from '@pkg/components/Preferences/ButtonOpen.vue';

export default Vue.extend({
  name:       'rd-header',
  components: { PreferencesButton },
  methods:    {
    openPreferences() {
      this.$emit('open-preferences');
    },
  },
});
</script>

<template>
  <header>
    <div class="header-actions">
      <preferences-button @open-preferences="openPreferences" />
    </div>
  </header>
</template>

<style lang="scss" scoped>
  header {
    height:  var(--header-height);
    background-color: var(--header-bg);
    position: relative;
    display: flex;
    flex-direction: row-reverse;
    align-items: center;
    gap: 1rem;
    padding: 0 0.75rem 0 0.75rem;

    .header-actions {
      display: flex;
      align-items: center;
    }
  }
</style>
