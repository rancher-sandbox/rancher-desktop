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
    <span
      class="icon icon-gear"
    />
    {{ t('nav.userMenu.preferences') }}
  </button>
</template>
