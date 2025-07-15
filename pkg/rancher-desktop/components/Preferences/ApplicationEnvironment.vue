<script lang="ts">

import { defineComponent } from 'vue';
import { mapGetters } from 'vuex';

import PathManagementSelector from '@pkg/components/PathManagementSelector.vue';
import RdFieldset from '@pkg/components/form/RdFieldset.vue';
import { Settings } from '@pkg/config/settings';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';
import { RecursiveTypes } from '@pkg/utils/typeUtils';

import type { PropType } from 'vue';

export default defineComponent({
  name:       'preferences-application-environment',
  components: { PathManagementSelector, RdFieldset },
  props:      {
    preferences: {
      type:     Object as PropType<Settings>,
      required: true,
    },
  },
  computed: {
    ...mapGetters('applicationSettings', ['pathManagementStrategy']),
    ...mapGetters('preferences', ['isPreferenceLocked']),
  },
  mounted() {
    ipcRenderer.on('settings-read', (_, currentSettings: Settings) => {
      this.$store.dispatch('preferences/updatePreferencesData', { property: 'application.pathManagementStrategy', value: currentSettings.application.pathManagementStrategy });
    });
    ipcRenderer.send('settings-read');
  },
  methods: {
    onChange<P extends keyof RecursiveTypes<Settings>>(property: P, value: RecursiveTypes<Settings>[P]) {
      this.$store.dispatch('preferences/updatePreferencesData', { property, value });
    },
  },
});
</script>

<template>
  <rd-fieldset
    data-test="pathManagement"
    :legend-text="t('pathManagement.label')"
    :legend-tooltip="t('pathManagement.tooltip', { }, true)"
    :is-locked="isPreferenceLocked('application.pathManagementStrategy')"
  >
    <template #default="{ isLocked }">
      <path-management-selector
        :show-label="false"
        :value="preferences.application.pathManagementStrategy"
        :is-locked="isLocked"
        @input="onChange('application.pathManagementStrategy', $event)"
      />
    </template>
  </rd-fieldset>
</template>
