<script lang="ts">

import Vue from 'vue';

import PreferencesBodyApplication from '@pkg/components/Preferences/BodyApplication.vue';
import PreferencesBodyContainerEngine from '@pkg/components/Preferences/BodyContainerEngine.vue';
import PreferencesBodyKubernetes from '@pkg/components/Preferences/BodyKubernetes.vue';
import PreferencesBodyVirtualMachine from '@pkg/components/Preferences/BodyVirtualMachine.vue';
import PreferencesBodyWsl from '@pkg/components/Preferences/BodyWsl.vue';
import PreferencesHelp from '@pkg/components/Preferences/Help.vue';
import { Settings } from '@pkg/config/settings';

import type { PropType } from 'vue';

export default Vue.extend({
  name:       'preferences-body',
  components: {
    PreferencesBodyApplication,
    PreferencesBodyVirtualMachine,
    PreferencesBodyWsl,
    PreferencesBodyContainerEngine,
    PreferencesBodyKubernetes,
    PreferencesHelp,
  },
  props: {
    currentNavItem: {
      type:     String,
      required: true,
    },
    preferences: {
      type:     Object as PropType<Settings>,
      required: true,
    },
  },
  computed: {
    normalizeNavItem(): string {
      return this.currentNavItem.toLowerCase().replaceAll(' ', '-');
    },
    componentFromNavItem(): string {
      return `preferences-body-${ this.normalizeNavItem }`;
    },
  },
});
</script>

<template>
  <div class="preferences-body">
    <slot>
      <component
        :is="componentFromNavItem"
        :preferences="preferences"
        v-on="$listeners"
      />
    </slot>
    <preferences-help class="help" />
  </div>
</template>

<style lang="scss" scoped>
  .preferences-body {
    display: flex;
    flex-direction: column;

    .help {
      margin: auto 0.75rem 0.75rem auto;
    }
  }
</style>
