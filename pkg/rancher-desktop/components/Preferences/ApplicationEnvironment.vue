<script lang="ts">

import Vue from 'vue';
import { mapGetters } from 'vuex';

import PathManagementSelector from '@pkg/components/PathManagementSelector.vue';
import RdFieldset from '@pkg/components/form/RdFieldset.vue';
import { Settings } from '@pkg/config/settings';
import { RecursiveTypes } from '@pkg/utils/typeUtils';

import type { PropType } from 'vue';

export default Vue.extend({
  name:       'preferences-application-environment',
  components: { PathManagementSelector, RdFieldset },
  props:      {
    preferences: {
      type:     Object as PropType<Settings>,
      required: true,
    },
  },
  computed: { ...mapGetters('applicationSettings', ['pathManagementStrategy']) },
  methods:  {
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
  >
    <path-management-selector
      :show-label="false"
      :value="preferences.pathManagementStrategy"
      @input="onChange('pathManagementStrategy', $event)"
    />
  </rd-fieldset>
</template>
