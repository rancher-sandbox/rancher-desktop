<script lang="ts">
import Vue from 'vue';
import { ipcRenderer } from 'electron';
import { mapGetters } from 'vuex';
import PathManagementSelector from '~/components/PathManagementSelector.vue';
import { PathManagementStrategy } from '~/integrations/pathManager';

export default Vue.extend({
  name:       'path-update',
  components: { PathManagementSelector },
  layout:     'dialog',
  computed:   { ...mapGetters('applicationSettings', { pathManagementStrategy: 'getPathManagementStrategy' }) },
  mounted() {
    ipcRenderer.send('dialog/ready');
  },
  methods: {
    setPathManagementStrategy(val: PathManagementStrategy) {
      this.$store.dispatch('applicationSettings/setPathManagementStrategy', val);
    }
  }
});
</script>

<template>
  <path-management-selector
    :value="pathManagementStrategy"
    @input="setPathManagementStrategy"
  />
</template>
