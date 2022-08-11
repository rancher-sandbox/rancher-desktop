<template>
  <nav>
    <ul>
      <li v-for="item in items" :key="item.route" :item="item.route">
        <NuxtLink :to="item.route">
          {{ routes[item.route].name }}
          <badge-state
            v-if="item.error"
            color="bg-error"
            :label="item.error"
          />
        </NuxtLink>
      </li>
    </ul>
  </nav>
</template>

<script>
import os from 'os';

import BadgeState from '@/components/BadgeState.vue';

export default {
  components: { BadgeState },
  props:      {
    items: {
      type:      Array,
      required:  true,
      validator: ({ route }) => {
        const routes = global.$nuxt.$router.getRoutes().reduce((paths, route) => {
          paths[route.path] = route;

          return paths;
        }, {});

        return route && (route.length > 0) && route.every((path) => {
          const result = path in routes;

          if (!result) {
            console.error(`<Nav> error: path ${ JSON.stringify(path) } not found in routes ${ JSON.stringify(Object.keys(routes)) }`);
          }

          return result;
        });
      },
    },
  },
  data() {
    return {
      // Generate a route (path) to route entry mapping, so that we can pick out
      // their names based on the paths given.
      routes: this.$nuxt.$router.getRoutes().reduce((paths, route) => {
        paths[route.path] = route;
        if (route.name === 'Supporting Utilities' && os.platform() === 'win32') {
          route.name = 'WSL Integrations';
        }

        return paths;
      }, {}),
    };
  },
};
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped lang="scss">

nav {
    background-color: var(--nav-bg);
    padding: 0;
    margin: 0;
    padding-top: 20px;
}

ul {
    margin: 0;
    padding: 0;
    list-style-type: none;

    li {
        padding: 0;

        a {
            color: var(--body-text);
            text-decoration: none;
            line-height: 24px;
            padding: 7.5px 10px;
            letter-spacing: 1.4px;
            display: block;
            outline: none;
        }

        a.nuxt-link-active {
            background-color: var(--nav-active);
        }
    }
}

</style>
