<template>
  <rd-tabbed
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
  </rd-tabbed>
</template>

<script lang="ts">

import { defineComponent } from 'vue';

import RdTabbed from '@pkg/components/Tabbed/RdTabbed.vue';
import Tab from '@pkg/components/Tabbed/Tab.vue';

export default defineComponent({
  name: 'image-add-tabs',

  components: {
    RdTabbed,
    Tab,
  },

  data() {
    return { activeTab: 'pull' };
  },

  methods: {
    tabSelected({ tab }: { tab: any }) {
      this.activeTab = tab.name;
      this.$emit('click', this.activeTab);
    },
  },
});
</script>
