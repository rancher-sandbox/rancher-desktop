<template>
  <card :show-highlight-border="false" :show-actions="false">
    <template #title>
      <h3 v-text="title" />
    </template>
    <template #body>
      <p v-if="description" class="description" v-text="description" />
      <ul v-if="integrations" class="integrations">
        <li v-for="item of integrationsList" :key="item.name">
          <checkbox
            :value="item.enabled"
            :label="item.name"
            :description="item.error"
            :disabled="isDisabled(item)"
            @input="toggleIntegration(item.name, $event)"
          />
        </li>
      </ul>
    </template>
  </card>
</template>

<script lang="ts">
import Vue, { PropType } from 'vue';
import Component from 'vue-class-component';

import Card from '@/components/Card.vue';
import Checkbox from '@/components/form/Checkbox.vue';

const IntegrationProps = Vue.extend({
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
      default: () => ({}),
    },
  }
});

@Component({ components: { Card, Checkbox } })
class Integration extends IntegrationProps {
  /**
   * A mapping to temporarily disable a selection while work happens
   * asynchronously, to prevent the user from retrying to toggle too quickly.
   */
  protected busy: Record<string, boolean> = {};

  get integrationsList() {
    const results: {name: string, enabled: boolean, error?: string}[] = [];

    for (const [name, value] of Object.entries(this.integrations)) {
      if (typeof value === 'boolean') {
        results.push({ name, enabled: value });
        if (value === this.busy[name]) {
          this.$delete(this.busy, name);
        }
      } else {
        results.push({
          name, enabled: false, error: value
        });
        this.$delete(this.busy, name);
      }
    }

    return results.sort((x, y) => x.name.localeCompare(y.name));
  }

  toggleIntegration(name: string, value: boolean) {
    this.$set(this.busy, name, value);
    this.$emit('integration-set', name, value);
  }

  isDisabled(item: {name: string, enabled: boolean, error?: string}): boolean {
    if (item.error) {
      return true;
    }

    return item.name in this.busy;
  }
}

export default Integration;
</script>

<style lang="scss" scoped>
  .integrations {
    padding: 0;
  }
  .integrations li {
    list-style-type: none;
  }
</style>
