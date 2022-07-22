<script lang="ts">
import Vue from 'vue';
import Checkbox from '@/components/form/Checkbox.vue';

export default Vue.extend({
  name:       'rd-dialog',
  components: { Checkbox },
  layout:     'dialog'
});
</script>

<template>
  <div class="dialog-container">
    <div class="title">
      <slot name="title">
        This is an example title
      </slot>
    </div>
    <div class="detail">
      <slot name="detail">
        This is some great detail.
      </slot>
    </div>
    <div class="checkbox">
      <slot name="checkbox">
        <checkbox label="I think this is great?" />
      </slot>
    </div>
    <div class="actions">
      <slot name="actions">
        <button class="btn role-primary">
          OK
        </button>
      </slot>
    </div>
  </div>
</template>

<style lang="scss" scoped>
  .dialog-container {
    display: flex;
  }

  .title {
    font-size: 1.5rem;
    line-height: 2rem;
  }

  .actions {
    display: flex;
    flex-direction: row;
    justify-content: flex-end;
    padding-top: 1rem;
  }
</style>
