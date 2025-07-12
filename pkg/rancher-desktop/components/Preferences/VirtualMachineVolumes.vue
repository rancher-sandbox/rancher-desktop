<script lang="ts">

import { defineComponent } from 'vue';

import MountTypeSelector from '@pkg/components/MountTypeSelector.vue';
import { Settings } from '@pkg/config/settings';
import { RecursiveTypes } from '@pkg/utils/typeUtils';

import type { PropType } from 'vue';

export default defineComponent({
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
      @update="onChange"
    />
  </div>
</template>
