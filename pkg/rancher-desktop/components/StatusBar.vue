<script lang="ts">
import { defineComponent } from 'vue';
import { mapGetters } from 'vuex';

import BackendProgress from '@pkg/components/BackendProgress.vue';
import StatusBarItem, { StatusBarItemData } from '@pkg/components/StatusBarItem.vue';

type BarItem = {
  name: string,
  component?: string,
  icon: string,
  data?: StatusBarItemData,
};

export default defineComponent({
  name:       'status-bar',
  components: { BackendProgress, StatusBarItem },
  computed:   {
    ...mapGetters('preferences', ['getPreferences']),
    kubernetesVersion(): string {
      return this.getPreferences.kubernetes.version;
    },
    kubernetesEnabled(): boolean {
      return this.getPreferences.kubernetes.enabled;
    },
    containerEngine(): string {
      return this.getPreferences.containerEngine.name;
    },
    items(): BarItem[] {
      return [
        {
          name: 'version', component: 'Version', icon: 'icon icon-rancher-desktop',
        }, {
          name: 'network', component: 'NetworkStatus', icon: 'icon icon-globe',
        }, {
          name: 'kubernetesVersion',
          icon: 'kubernetes-black.svg',
          data: {
            label: {
              bar:     'product.kubernetesVersion',
              tooltip: 'product.kubernetesVersion',
            },
            value: this.kubernetesEnabled ? this.kubernetesVersion : this.t('product.deactivated'),
          },
        }, {
          name: 'containerEngine',
          icon: 'icon icon-init_container',
          data: {
            label: {
              bar:     'product.containerEngine.abbreviation',
              tooltip: 'product.containerEngine.fullName',
            },
            value: this.containerEngine,
          },
        },
      ];
    },
  },
});
</script>

<template>
  <footer>
    <div class="left-column">
      <status-bar-item
        v-for="item in items"
        :key="item.name"
        :sub-component="item.component"
        :data="item.data"
        :icon="item.icon"
        class="status-bar-item"
      >
      </status-bar-item>
    </div>
    <div class="right-column">
      <BackendProgress class="progress" />
    </div>
  </footer>
</template>

<style scoped lang="scss">
footer {
  align-items: center;
  display: flex;
  flex-direction: row;
  padding: 5px 10px;
  background-color: var(--footer-bg);
  font-size: 12px;

  .left-column {
    display: flex;
    white-space: nowrap;
  }

  .right-column {
    display: flex;
    justify-content: flex-end;
    flex: 1;
  }

  .status-bar-item {
    padding-right: 18px;
    text-overflow: ellipsis;
    overflow: hidden;
  }
}
</style>
