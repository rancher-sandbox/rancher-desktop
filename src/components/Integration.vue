<template>
  <section>
    <h3 v-text="description" />
    <section class="body">
      <ul>
        <li v-for="item of integrationsList" :key="item.name">
          <checkbox
            :value="item.value"
            :label="item.name"
            :disabled="item.disabled"
            @input="toggleIntegration(item.name, $event)"
          />
        </li>
      </ul>
    </section>
  </section>
</template>

<script lang="ts">
import Vue from 'vue';
import type { PropType } from 'vue';
import Component from 'vue-class-component';
import Banner from '@/components/Banner.vue';
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
  },
});

@Component({
  components: {
    Banner, Card, Checkbox
  }
})
class Integration extends IntegrationProps {
  /**
   * A mapping to temporarily disable a selection while work happens
   * asynchronously, to prevent the user from retrying to toggle too quickly.
   */
  protected busy: Record<string, boolean> = {};

  get integrationsList() {
    const results: {name: string, value: boolean, disabled: boolean}[] = [];

    for (const [name, value] of Object.entries(this.integrations)) {
      if (typeof value === 'boolean') {
        if (value === this.busy[name]) {
          this.$delete(this.busy, name);
        }
        results.push({
          name, value, disabled: name in this.busy
        });
      } else {
        results.push({
          name, value: false, disabled: true
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
}
export default Integration;
</script>

<style lang="scss" scoped>
  li::v-deep div.checkbox-outer-container-description {
    margin-top: -0.25rem;
    white-space: pre-line;
  }
  ul {
    list-style-type: none;
    padding-left: 0;
  }
  li {
    margin: 1.25rem 0;
  }
</style>
