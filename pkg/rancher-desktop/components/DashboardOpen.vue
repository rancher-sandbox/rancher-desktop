<script lang="ts">
import Vue from 'vue';
import { mapGetters } from 'vuex';

import { State as K8sState } from '@pkg/backend/backend';

export default Vue.extend({
  name:     'dashboard-button',
  computed: {
    ...mapGetters('preferences', ['getPreferences']),
    ...mapGetters('k8sManager', { k8sState: 'getK8sState' }),
    kubernetesEnabled(): boolean {
      return this.getPreferences.kubernetes.enabled;
    },
    kubernetesStarted(): boolean {
      return this.k8sState === K8sState.STARTED;
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
    :disabled="!kubernetesStarted"
    class="btn role-secondary btn-icon-text"
    @click="openDashboard"
  >
    {{ t('nav.userMenu.clusterDashboard') }}
  </button>
</template>
