<script lang="ts">

import { defineComponent } from 'vue';
import { mapState } from 'vuex';

import PreferencesBodyApplication from '@pkg/components/Preferences/BodyApplication.vue';
import PreferencesBodyContainerEngine from '@pkg/components/Preferences/BodyContainerEngine.vue';
import PreferencesBodyKubernetes from '@pkg/components/Preferences/BodyKubernetes.vue';
import PreferencesBodyVirtualMachine from '@pkg/components/Preferences/BodyVirtualMachine.vue';
import PreferencesBodyWsl from '@pkg/components/Preferences/BodyWsl.vue';
import PreferencesHelp from '@pkg/components/Preferences/Help.vue';
import { Settings } from '@pkg/config/settings';

import type { PropType } from 'vue';

export default defineComponent({
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
    ...mapState('credentials', ['credentials']),
    normalizeNavItem(): string {
      return this.currentNavItem.toLowerCase().replaceAll(' ', '-');
    },
    componentFromNavItem(): string {
      return `preferences-body-${ this.normalizeNavItem }`;
    },
  },
  mounted() {
    (this.$root as any).navigate = this.navigate;
  },
  methods: {
    navigate(navItem: string, tab: string) {
      console.log('Navigate!', Array.from(arguments));
      this.$store.dispatch(
        'transientSettings/navigatePrefDialog',
        {
          ...this.credentials,
          navItem,
          tab,
        },
      );
    },
  },
});
</script>

<template>
  <div class="preferences-body">
    <slot>
      <component
        v-bind="$attrs"
        :is="componentFromNavItem"
        :preferences="preferences"
      />
    </slot>
    <preferences-help class="help" />
  </div>
</template>

<style lang="scss" scoped>
  .preferences-body {
    position: relative;
    display: flex;
    flex-direction: column;

    .help {
      position: absolute;
      bottom: 0.75rem;
      right: 0.75rem;
    }
  }
</style>
