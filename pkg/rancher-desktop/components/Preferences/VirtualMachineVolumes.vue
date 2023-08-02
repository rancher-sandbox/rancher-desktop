<script lang="ts">

import MountTypeSelector from '@pkg/components/MountTypeSelector.vue';
import { Settings } from '@pkg/config/settings';
import { RecursiveTypes } from '@pkg/utils/typeUtils';
import Vue from 'vue';

import type { PropType } from 'vue';

export default Vue.extend({
  name:       'preferences-virtual-machine-volumes',
  components: { MountTypeSelector },
  props:      {
    preferences: {
      type:     Object as PropType<Settings>,
      required: true,
    },
  },
  methods: {
    onChange<P extends keyof RecursiveTypes<Settings>>(property: P, value: RecursiveTypes<Settings>[P]) {
      this.$store.dispatch('preferences/updatePreferencesData', { property, value });
    },
  },
});
</script>

<template>
  <div class="virtual-machine-volumes">
    <mount-type-selector
      :preferences="preferences"
      @update:tab="$emit('update:tab', $event)"
      @update="onChange"
    />
  </div>
</template>
