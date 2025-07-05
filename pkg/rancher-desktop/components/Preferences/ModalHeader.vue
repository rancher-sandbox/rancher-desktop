<script lang="ts">
import { defineComponent } from 'vue';
export default defineComponent({ name: 'preferences-header' });
</script>

<template>
  <div class="preferences-header">
    <div class="title">
      Preferences
    </div>
  </div>
</template>

<style lang="scss" scoped>
  .preferences-header {
    height: 3rem;
    font-size: 1.5rem;
    line-height: 2rem;
    display: flex;
    align-items: center;
    padding: 0 0.75rem;
    width: 100%;
    border-bottom: 1px solid var(--header-border);
  }

  .title {
    flex: 1;
  }
</style>
