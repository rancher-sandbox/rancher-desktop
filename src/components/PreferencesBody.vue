<script lang="ts">
import Vue from 'vue';
import PreferencesBodyApplication from '@/components/PreferencesBodyApplication.vue';

export default Vue.extend({
  name:       'preferences-body',
  components: { PreferencesBodyApplication }
});
</script>

<template>
  <div class="preferences-body">
    <preferences-body-application />
  </div>
</template>

<style lang="scss" scoped>
  .preferences-body {
    padding: 0.75rem;
  }
</style>
