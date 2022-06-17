<script lang="ts">
import Vue from 'vue';
import { mapGetters } from 'vuex';
import PathManagementSelector from '@/components/PathManagementSelector.vue';
import { PathManagementStrategy } from '@/integrations/pathManager';

export default Vue.extend({
  name:       'preferences-application-environment',
  components: { PathManagementSelector },
  computed:   { ...mapGetters('applicationSettings', ['pathManagementStrategy']) },
  methods:    {
    onPathManagementChange(val: PathManagementStrategy) {
      this.$store.dispatch('applicationSettings/commitPathManagementStrategy', val);
    }
  }
});
</script>

<template>
  <path-management-selector
    :value="pathManagementStrategy"
    @input="onPathManagementChange"
  />
</template>
