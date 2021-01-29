<template>
  <nav>
    <ul>
      <li v-bind:item="item" v-bind:key="item" v-for="item in items">
        <NuxtLink :to="item">{{ routes[item].name }}</NuxtLink>
      </li>
    </ul>
  </nav>
</template>

<script>
export default {
  data() {
    return {
      // Generate a route (path) to route entry mapping, so that we can pick out
      // their names based on the paths given.
      routes: $nuxt.$router.getRoutes().reduce((paths, route) => {
        // The root route has an empty path here; translate it to "/" because if
        // we have a <NuxtLink to=""> then it does nothing (empty href).
        paths[route.path || "/"] = route;
        return paths;
      }, {}),
    };
  },
  props: {
    items: {
      type: Array,
      required: true,
      validator: value => {
        let routes = $nuxt.$router.getRoutes().reduce((paths, route) => {
          // The root route has an empty path here; translate it to "/" because if
          // we have a <NuxtLink to=""> then it does nothing (empty href).
          paths[route.path || "/"] = route;
          return paths;
        }, {});
        return value && (value.length > 0) && value.every(path => {
          let result = path in routes;
          if (!result) {
            console.error(`<Nav> error: path ${JSON.stringify(path)} not found in routes ${JSON.stringify(Object.keys(routes))}`);
          }
          return result;
        });
      },
    }
  },
}
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped lang="scss">

nav {
    background-color: var(--nav-bg);
    height: 91vh;
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
            color: var(--link-text);
            text-decoration: none;
            line-height: 24px;
            padding: 7.5px 10px;
            letter-spacing: 1.4px;
            display: block;
            outline: none;
        }

        a.router-link-exact-active {
            background-color: var(--nav-active);
            border-left: 5px solid var(--primary);
            color: var(--body-text);
        }
    }
}

</style>
