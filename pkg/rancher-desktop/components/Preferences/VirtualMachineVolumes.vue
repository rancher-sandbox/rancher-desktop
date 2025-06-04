<script lang="ts">

import Vue from 'vue';
import { mapGetters } from 'vuex';

import MountTypeSelector from '@pkg/components/MountTypeSelector.vue';
import RdCheckbox from '@pkg/components/form/RdCheckbox.vue';
import RdFieldset from '@pkg/components/form/RdFieldset.vue';
import { Settings } from '@pkg/config/settings';
import { RecursiveTypes } from '@pkg/utils/typeUtils';

import type { PropType } from 'vue';

export default Vue.extend({
  name:       'preferences-virtual-machine-volumes',
  components: {
    MountTypeSelector, RdCheckbox, RdFieldset,
  },
  props: {
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
    <rd-fieldset
      is-experimental
      :legend-text="t('virtualMachine.mount.inotify.label')"
    >
      <rd-checkbox
        class="inotify-options"
        label-key="virtualMachine.mount.inotify.enabled"
        description-key="virtualMachine.mount.inotify.description"
        :value="preferences.experimental.virtualMachine.mount.inotify"
        :is-locked="isPreferenceLocked('experimental.virtualMachine.mount.inotify')"
        @input="onChange('experimental.virtualMachine.mount.inotify', $event)"
      />
    </rd-fieldset>
  </div>
</template>

<style lang="scss" scoped>
  .virtual-machine-volumes {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
</style>
