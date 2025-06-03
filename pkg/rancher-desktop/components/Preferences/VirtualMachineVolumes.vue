<script lang="ts">

import Vue from 'vue';
import { mapGetters } from 'vuex';

import MountTypeSelector from '@pkg/components/MountTypeSelector.vue';
import RdCheckbox from '@pkg/components/form/RdCheckbox.vue';
import { Settings } from '@pkg/config/settings';
import { RecursiveTypes } from '@pkg/utils/typeUtils';

import type { PropType } from 'vue';

export default Vue.extend({
  name:       'preferences-virtual-machine-volumes',
  components: { MountTypeSelector, RdCheckbox },
  props:      {
    preferences: {
      type:     Object as PropType<Settings>,
      required: true,
    },
  },
  computed: { ...mapGetters('preferences', ['isPreferenceLocked']) },
  methods:  {
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
    <rd-checkbox
      is-experimental
      label-key="virtualMachine.mount.inotify.label"
      tooltip-key="virtualMachine.mount.inotify.tooltip"
      :value="preferences.experimental.virtualMachine.mount.inotify"
      :is-locked="isPreferenceLocked('experimental.virtualMachine.mount.inotify')"
      @input="onChange('experimental.virtualMachine.mount.inotify', $event)"
    />
  </div>
</template>
