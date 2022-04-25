<router lang="yaml">
  name: Application Settings
</router>
<template>
  <div>
    <path-management-selector
      :value="pathManagementStrategy"
      @input="onPathMananagementChange"
    />
    <section>
      <h3>
        Administrative Access
        <i v-tooltip="sudoAllowedTooltip" class="icon icon-info icon-lg" />
      </h3>
      <checkbox
        label="Allow sudo access"
        :value="sudoAllowed"
        @input="onSudoAllowedChange"
      />
    </section>
  </div>
</template>

<script lang="ts">
import { ipcRenderer } from 'electron';
import Vue from 'vue';
import { mapGetters } from 'vuex';

import Checkbox from '@/components/form/Checkbox.vue';
import { PathManagementStrategy } from '@/integrations/pathManager';
import PathManagementSelector from '@/components/PathManagementSelector.vue';
import type { Settings } from '@/config/settings';

export default Vue.extend({
  components: { Checkbox, PathManagementSelector },
  data() {
    return {
      sudoAllowedTooltip: `
        If checked, Rancher Desktop will attempt to acquire administrative
        credentials ("sudo access") when starting for some operations.  This
        allows for enhanced functionality, including bridged networking and
        default docker socket support.  Changes will only be applied next time
        Rancher Desktop starts.
      `,
    };
  },
  fetch() {
    ipcRenderer.once('settings-read', (_event, settings) => {
      this.onSettingsUpdate(settings);
    });
    ipcRenderer.on('settings-update', (_event, settings) => {
      this.onSettingsUpdate(settings);
    });
    ipcRenderer.send('settings-read');
  },
  computed: { ...mapGetters('applicationSettings', ['pathManagementStrategy', 'sudoAllowed']) },
  mounted() {
    this.$store.dispatch(
      'page/setHeader',
      { title: 'Application Settings' }
    );
  },
  methods: {
    onPathMananagementChange(val: PathManagementStrategy) {
      this.$store.dispatch('applicationSettings/commitPathManagementStrategy', val);
    },
    onSudoAllowedChange(val: boolean) {
      this.$store.dispatch('applicationSettings/commitSudoAllowed', val);
    },
    onSettingsUpdate(settings: Settings) {
      this.$store.dispatch('applicationSettings/setPathManagementStrategy', settings.pathManagementStrategy);
      this.$store.dispatch('applicationSettings/setSudoAllowed', !settings.kubernetes.suppressSudo);
    },
  }
});
</script>
