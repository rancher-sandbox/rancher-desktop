<script lang="ts">
import Vue from 'vue';
import { mapGetters } from 'vuex';
import PathManagementSelector from '@/components/PathManagementSelector.vue';
import { PathManagementStrategy } from '@/integrations/pathManager';
import RdFieldset from '@/components/form/RdFieldset.vue';

export default Vue.extend({
  name:       'preferences-application-environment',
  components: { PathManagementSelector, RdFieldset },
  computed:   { ...mapGetters('applicationSettings', ['pathManagementStrategy']) },
  methods:    {
    onPathManagementChange(val: PathManagementStrategy) {
      this.$store.dispatch('applicationSettings/commitPathManagementStrategy', val);
    }
  }
});
</script>

<template>
  <rd-fieldset
    :legend-text="t('pathManagement.label')"
    :legend-tooltip="t('pathManagement.tooltip', { }, true)"
  >
    <path-management-selector
      :value="pathManagementStrategy"
      :show-label="false"
      @input="onPathManagementChange"
    />
  </rd-fieldset>
</template>
