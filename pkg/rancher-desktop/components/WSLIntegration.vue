<template>
  <section class="wsl-integrations">
    <h3
      v-if="description"
      v-text="description"
    />
    <div
      v-for="item of integrationsList"
      :key="item.name"
      :data-test="`item-${item.name}`"
    >
      <checkbox
        :value="item.value"
        :label="item.name"
        :disabled="item.disabled"
        :description="item.description"
        @input="toggleIntegration(item.name, $event)"
      />
    </div>
  </section>
</template>

<script lang="ts">
import { Checkbox } from '@rancher/components';
import { defineComponent } from 'vue';

import type { PropType } from 'vue';

export default defineComponent({
  name:       'wsl-integration',
  components: { Checkbox },

  props: {
    title: {
      type:    String,
      default: 'System Integration',
    },
    description: {
      type:    String,
      default: '',
    },
    integrations: {
      type:    Object as PropType<Record<string, boolean | string>>,
      default: () => ({} as Record<string, boolean | string>),
    },
  },

  data() {
    return {
      name: 'wsl-integration',
      /**
       * A mapping to temporarily disable a selection while work happens
       * asynchronously, to prevent the user from retrying to toggle too quickly.
       */
      busy: {} as Record<string, boolean>,
    };
  },

  computed: {
    integrationsList() {
      const results: {name: string, value: boolean, disabled: boolean, description: string}[] = [];

      for (const [name, value] of Object.entries(this.integrations)) {
        if (typeof value === 'boolean') {
          if (value === this.busy[name]) {
            this.$delete(this.busy, name);
          }
          results.push({
            name, value, disabled: name in this.busy, description: '',
          });
        } else {
          results.push({
            name, value: false, disabled: true, description: value,
          });
          this.$delete(this.busy, name);
        }
      }

      return results.sort((x, y) => x.name.localeCompare(y.name));
    },
  },

  methods: {
    toggleIntegration(name: string, value: boolean) {
      this.$set(this.busy, name, value);
      this.$emit('integration-set', name, value);
    },
  },
});
</script>

<style lang="scss" scoped>
  .wsl-integrations {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
</style>
