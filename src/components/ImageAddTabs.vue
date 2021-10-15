<template>
  <tabbed
    v-bind="$attrs"
    default-tab="pull"
    class="action-tabs"
    :no-content="true"
    @changed="tabSelected"
  >
    <tab
      label="Build"
      name="build"
      :weight="0"
    />
    <tab
      label="Pull"
      name="pull"
      :weight="1"
    />
    <slot></slot>
  </tabbed>
</template>

<script>
import Tabbed from '@/components/Tabbed';
import Tab from '@/components/Tabbed/Tab';

export default {
  name: 'image-add-tabs',

  components: {
    Tabbed,
    Tab
  },

  data() {
    return { activeTab: 'pull' };
  },

  methods: {
    tabSelected({ tab }) {
      this.activeTab = tab.name;
      this.$emit('click', this.activeTab);
    }
  }
};
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
