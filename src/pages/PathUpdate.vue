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
  beforeMount() {
    window.addEventListener('beforeunload', this.commitStrategy);
  },
  mounted() {
    ipcRenderer.send('dialog/ready');
  },
  beforeDestroy() {
    window.removeEventListener('beforeunload', this.commitStrategy);
  },
  methods: {
    setPathManagementStrategy(val: PathManagementStrategy) {
      this.$store.dispatch('applicationSettings/setPathManagementStrategy', val);
    },
    async commitStrategy() {
      await this.$store.dispatch('applicationSettings/commitPathManagementStrategy', this.pathManagementStrategy);
      ipcRenderer.send('window/close');
    }
  },
});
</script>

<template>
  <div>
    <h3>{{ t('app.name') }}</h3>
    <div>{{ t('app.update', { }, true) }}</div>
    <path-management-selector
      :value="pathManagementStrategy"
      @input="setPathManagementStrategy"
    />
    <div class="button-area">
      <button
        data-test="accept-btn"
        class="role-primary"
        @click="commitStrategy"
      >
        {{ t('pathManagement.accept') }}
      </button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
  .button-area {
    align-self: flex-end;
  }
</style>
