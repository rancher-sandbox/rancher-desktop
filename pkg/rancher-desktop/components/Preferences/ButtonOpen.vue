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
    class="btn role-secondary btn-icon-text"
    @click="openPreferences"
  >
    {{ t('nav.userMenu.preferences') }}
  </button>
</template>
