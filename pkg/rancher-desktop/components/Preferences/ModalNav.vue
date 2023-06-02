<script lang="ts">
import Vue from 'vue';

import PreferencesNavItem from '@pkg/components/Preferences/ModalNavItem.vue';

export default Vue.extend({
  name:       'preferences-nav',
  components: { NavItem: PreferencesNavItem },
  props:      {
    currentNavItem: {
      type:     String,
      required: true,
    },
    navItems: {
      type:     Array,
      required: true,
    },
  },

  methods: {
    navClicked(tabName: string) {
      console.log('NOT FAIL');
      if (tabName !== this.$props.currentNavItem) {
        this.$emit('nav-changed', tabName);
      }
    },
    navToKebab(navItem: string): string {
      return `nav-${ navItem.toLowerCase().replaceAll(' ', '-') }`;
    },
  },
});
</script>

<template>
  <div
    class="preferences-nav"
    aria-label="Preferences navigation"
    role="menu"
  >
    <nav-item
      v-for="navItem in navItems"
      :key="navItem"
      :data-test="navToKebab(navItem)"
      :name="navItem"
      :active="currentNavItem === navItem"
      :aria-describedby="'menu-item-description-' + navItem"
      tabindex="0"
      role="menuitem"
      @click="navClicked"
    >
      <span :id="'menu-item-description-' + navItem">{{ navItem }}</span>
    </nav-item>
  </div>
</template>

<style lang="scss" scoped>
  .preferences-nav {
    display: flex;
    flex-direction: column;
    height: 100%;
    border-right: 1px solid var(--header-border);
    padding-top: 0.75rem;
  }
</style>
