<template>
  <tabbed
    v-bind="$attrs"
    default-tab="pull"
    class="action-tabs"
    :no-content="true"
    @changed="tabSelected"
  >
    <tab
      :label="t('images.add.action.build')"
      name="build"
      :weight="0"
    />
    <tab
      :label="t('images.add.action.pull')"
      name="pull"
      :weight="1"
    />
    <slot></slot>
  </tabbed>
</template>

<script lang="ts">
import Vue from 'vue';
import Tabbed from '@/components/Tabbed/index.vue';
import Tab from '@/components/Tabbed/Tab.vue';

export default Vue.extend({
  name: 'image-add-tabs',

  components: {
    Tabbed,
    Tab
  },

  data() {
    return { activeTab: 'pull' };
  },

  methods: {
    tabSelected({ tab }: { tab: any }) {
      this.activeTab = tab.name;
      this.$emit('click', this.activeTab);
    }
  }
});
</script>

<style lang="scss" scoped>
  .action-tabs::v-deep li.tab {
    margin-right: 0;
    padding-right: 0;
    border-bottom: 1px solid;
    border-color: var(--border);
    padding-bottom: 7px;

    A {
      color: var(--muted);
    }
  }

  .action-tabs::v-deep .tabs .tab.active {
    border-color: var(--primary);
    background-color: transparent;

    A {
      color: var(--link);
    }
  }

  .action-tabs::v-deep ul {
    border-bottom: 1px solid;
    border-color: var(--border);
  }

  .action-tabs::v-deep .tab-container {
    background-color: transparent;
    margin-top: 1rem;
  }
</style>
