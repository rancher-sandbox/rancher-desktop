<script lang="ts">
import { defineComponent } from 'vue';

import { State as K8sState } from '@pkg/backend/backend';
import { mapTypedGetters, mapTypedState } from '@pkg/entry/store';

export default defineComponent({
  name:     'dashboard-open',
  computed: {
    ...mapTypedGetters('preferences', ['getPreferences']),
    ...mapTypedGetters('k8sManager', { k8sState: 'getK8sState' }),
    ...mapTypedState('steve', ['port']),
    kubernetesEnabled(): boolean {
      return this.getPreferences.kubernetes.enabled;
    },
    dashboardReady(): boolean {
      return this.k8sState === K8sState.STARTED && this.port > 0;
    },
  },
  methods: {
    openDashboard() {
      this.$emit('open-dashboard');
    },
  },
});
</script>

<template>
  <button
    v-if="kubernetesEnabled"
    :disabled="!dashboardReady"
    class="btn role-secondary btn-icon-text"
    @click="openDashboard"
  >
    {{ t('nav.userMenu.clusterDashboard') }}
  </button>
</template>
