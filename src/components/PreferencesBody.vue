<script lang="ts">
import Vue from 'vue';
import PreferencesBodyApplication from '@/components/PreferencesBodyApplication.vue';
import PreferencesBodyVirtualMachine from '@/components/PreferencesBodyVirtualMachine.vue';
import PreferencesBodyContainerRuntime from '@/components/PreferencesBodyContainerRuntime.vue';
import PreferencesBodyKubernetes from '@/components/PreferencesBodyKubernetes.vue';

export default Vue.extend({
  name:       'preferences-body',
  components: {
    PreferencesBodyApplication,
    PreferencesBodyVirtualMachine,
    PreferencesBodyContainerRuntime,
    PreferencesBodyKubernetes
  },
  props:      {
    currentNavItem: {
      type:     String,
      required: true
    }
  },
  computed: {
    normalizeNavItem(): string {
      return this.currentNavItem.toLowerCase().replaceAll(' ', '-');
    },
    componentFromNavItem(): string {
      return `preferences-body-${ this.normalizeNavItem }`;
    }
  }
});
</script>

<template>
  <div>
    <component :is="componentFromNavItem" />
  </div>
</template>
