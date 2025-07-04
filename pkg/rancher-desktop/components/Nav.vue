<template>
  <nav>
    <ul>
      <li
        v-for="item in items"
        :key="item.route"
        :item="item.route"
      >
        <RouterLink
          :class="{'rd-link-active': isRouteActive(item.route) }"
          :to="item.route"
        >
          {{ routes[item.route].name }}
          <badge-state
            v-if="item.error"
            color="bg-error"
            class="nav-badge"
            :label="item.error.toString()"
          />
          <i
            v-if="item.experimental"
            v-tooltip="{
              content: t('prefs.experimental'),
              placement: 'right',
            }"
            :class="`icon icon-flask`"
          />
        </RouterLink>
      </li>
    </ul>
    <hr v-if="extensionsWithUI.length">
    <div class="nav-extensions">
      <RouterLink
        v-for="extension in extensionsWithUI"
        :key="extension.id"
        :data-test="`extension-nav-${ extension.metadata.ui['dashboard-tab'].title.toLowerCase() }`"
        :to="extensionRoute(extension)"
      >
        <nav-item :id="`extension:${extension.id}`">
          <template #before>
            <nav-icon-extension :extension-id="extension.id" />
          </template>
          {{ extension.metadata.ui['dashboard-tab'].title }}
        </nav-item>
      </RouterLink>
    </div>
    <div class="nav-button-container">
      <dashboard-button
        data-testid="dashboard-button"
        class="nav-button"
        @open-dashboard="openDashboard"
      />
      <preferences-button
        data-testid="preferences-button"
        class="nav-button"
        @open-preferences="openPreferences"
      />
    </div>
  </nav>
</template>

<script lang="ts">
import os from 'os';

import { BadgeState } from '@rancher/components';
import Vue, { PropType } from 'vue';
import { RouteRecordPublic } from 'vue-router';

import NavIconExtension from './NavIconExtension.vue';
import NavItem from './NavItem.vue';

import DashboardButton from '@pkg/components/DashboardOpen.vue';
import PreferencesButton from '@pkg/components/Preferences/ButtonOpen.vue';
import router from '@pkg/entry/router';
import type { ExtensionState } from '@pkg/store/extensions';
import { hexEncode } from '@pkg/utils/string-encode';

type ExtensionWithUI = ExtensionState & {
  metadata: { ui: { 'dashboard-tab': { title: string } } };
};

export default Vue.extend({
  components: {
    BadgeState,
    NavItem,
    NavIconExtension,
    DashboardButton,
    PreferencesButton,
  },
  props: {
    items: {
      type:      Array as PropType<{route: string; error?: number; experimental?: boolean}[]>,
      required:  true,
      validator: (value: {route: string, error?: number}[]) => {
        const routes = router.getRoutes().reduce((paths: Record<string, RouteRecordPublic>, route) => {
          paths[route.path] = route;

          return paths;
        }, {});

        return value && (value.length > 0) && value.every(({ route }) => {
          const result = route in routes;

          if (!result) {
            console.error(`<Nav> error: path ${ JSON.stringify(route) } not found in routes ${ JSON.stringify(Object.keys(routes)) }`);
          }

          return result;
        });
      },
    },
    extensions: {
      type:     Array as PropType<ExtensionState[]>,
      required: true,
    },
  },
  data() {
    return {
      // Generate a route (path) to route entry mapping, so that we can pick out
      // their names based on the paths given.
      routes: this.$router.getRoutes().reduce((paths: Record<string, RouteRecordPublic>, route) => {
        paths[route.path] = route;
        if (route.name === 'Supporting Utilities' && os.platform() === 'win32') {
          route.name = 'WSL Integrations';
        }

        return paths;
      }, {}),
    };
  },
  computed: {
    extensionsWithUI(): ExtensionWithUI[] {
      function hasUI(ext: ExtensionState): ext is ExtensionWithUI {
        return !!ext.metadata.ui?.['dashboard-tab']?.title;
      }

      return this.extensions.filter<ExtensionWithUI>(hasUI);
    },
  },
  methods: {
    extensionRoute({ id, metadata }: { id: string, metadata: any }) {
      const { ui: { 'dashboard-tab': { root, src } } } = metadata;

      return {
        name:   'rdx-root-src-id',
        params: {
          root,
          src,
          id: hexEncode(id),
        },
      };
    },
    isRouteActive(route: string): boolean {
      // It is needed e.g. for sub-route /images/add not matching /Images
      // Prevents the parent item "Extensions" to be shown as active if an extension child (e.g. Epinio, Logs Explorer,
      // ...) is selected.
      if (this.$route.name === 'rdx-root-src-id') {
        return false;
      }

      return this.$route.path.toLowerCase().startsWith(route.toLowerCase());
    },
    openPreferences(): void {
      this.$emit('open-preferences');
    },
    openDashboard(): void {
      this.$emit('open-dashboard');
    },
  },
});
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped lang="scss">
nav {
    background-color: var(--nav-bg);
    padding: 0;
    margin: 0;
    padding: 20px 0;
    display: flex;
    flex-direction: column;

    a {
      text-decoration: none;
    }

    .nav-extensions {
      overflow: auto;
      flex-grow: 1
    }
}

ul {
    margin: 0;
    padding: 0;
    list-style-type: none;

    li {
        padding: 0;

        a {
            display: flex;
            align-items: center;
            gap: 0.25rem;
            color: var(--body-text);
            text-decoration: none;
            line-height: 24px;
            padding: 7.5px 10px;
            letter-spacing: 1.4px;
            outline: none;
        }

        a:is(.router-link-active, .rd-link-active) {
            background-color: var(--nav-active);
        }
    }
}

a {
  &:hover {
    text-decoration: none;
  }

  &:is(.router-link-active, .rd-link-active)::v-deep div {
    background-color: var(--nav-active);
  }
}

.nav-badge {
  line-height: initial;
  letter-spacing: initial;
  font-size: 0.75rem;
}

.nav-button-container {
  display: flex;
  flex-direction: column;
  justify-content: center;

  .nav-button {
    flex: 1;
    margin: 5px 10px 0px 10px;
    justify-content: center;
  }
}

</style>
