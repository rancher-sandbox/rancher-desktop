<script lang="ts">
import { defineComponent } from 'vue';
export default defineComponent({
  name:    'preferences-button',
  emits: ['open-preferences'],
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
