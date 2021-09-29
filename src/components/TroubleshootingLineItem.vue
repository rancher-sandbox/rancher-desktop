<script lang="ts">

import Vue from 'vue';
export default Vue.extend({});

</script>

<template>
  <div class="troubleshooting-line-item">
    <div class="description">
      <h3>
        <slot name="title">
        </slot>
      </h3>
      <span>
        <slot name="description">
        </slot>
      </span>
    </div>
    <slot>
    </slot>
  </div>
</template>

<style lang="scss" scoped>
  .troubleshooting-line-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 16px;
    margin-bottom: 16px;
  }

  .description {
    margin-right: 24px;
  }
</style>
