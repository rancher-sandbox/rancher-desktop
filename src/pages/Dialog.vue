<script lang="ts">
import Vue from 'vue';
import Checkbox from '@/components/form/Checkbox.vue';

export default Vue.extend({
  name:       'rd-dialog',
  components: { Checkbox },
  layout:     'dialog',
  data() {
    return {
      message:           '',
      detail:          '',
      checkboxLabel:   '',
      buttons:         [],
      response:        0,
      checkboxChecked: false
    };
  }
});
</script>

<template>
  <div class="dialog-container">
    <div class="message">
      <slot name="message">
        This is an example message
      </slot>
    </div>
    <div class="detail">
      <slot name="detail">
        This is some great detail.
      </slot>
    </div>
    <div class="checkbox">
      <slot name="checkbox">
        <checkbox v-model="checkboxChecked" label="I think this is great?" />
      </slot>
    </div>
    <div class="actions">
      <slot name="actions">
        <template v-if="!buttons.length">
          <button class="btn role-primary">
            OK
          </button>
        </template>
        <template v-else>
          <button
            v-for="(buttonText, index) in buttons"
            :key="index"
            class="btn role-primary"
            :class="index === 0 ? 'role-primary' : 'role-secondary'"
          >
            {{ buttonText }}
          </button>
        </template>
      </slot>
    </div>
  </div>
</template>

<style lang="scss" scoped>
  .dialog-container {
    display: flex;
  }

  .message {
    font-size: 1.5rem;
    line-height: 2rem;
  }

  .actions {
    display: flex;
    flex-direction: row;
    justify-content: flex-end;
    gap: 0.25rem;
    padding-top: 1rem;
  }
</style>
