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
  .role-tab {
    border-radius: 0;
    border-bottom: 0.25rem solid;
    border-color: var(--muted);
    color: var(--muted);
    background-color: transparent;
  }

  .role-tab-active {
    border-radius: 0;
    border-bottom: 0.25rem solid;
    border-color: var(--primary);
    color: var(--primary);
    background-color: transparent;
  }

  .btn:focus, .btn:active {
    outline-style: none;
    box-shadow: none;
  }

  .tabs {
    margin-bottom: 1rem;
  }
</style>
