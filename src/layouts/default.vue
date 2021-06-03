<template>
  <div class="wrapper">
    <Header class="header" />
    <Nav class="nav" :items="routes" />
    <Nuxt class="body" />
  </div>
</template>

<script>
import Header from '@/components/Header.vue';
import Nav from '@/components/Nav.vue';

export default {
  name:       'App',
  components: {
    Nav,
    Header,
  },

  data() {
    return { routes: ['/General', '/K8s', '/PortForwarding', '/Images', '/Troubleshooting'] };
  },

  head() {
    // If dark-mode is set to auto (follow system-prefs) this is all we need
    // In a possible future with a three-way pref
    // (Always off // Always on // Follow system pref)
    // the "dark" part will be a dynamic pref.
    // See https://github.com/rancher/dashboard/blob/3454590ff6a825f7e739356069576fbae4afaebc/layouts/default.vue#L227 for an example
    return { bodyAttrs: { class: 'theme-dark' } };
  },
};
</script>

<style lang="scss" scoped>
@import "@/assets/styles/app.scss";

.wrapper {
  display: grid;
  grid-template:
    "header header"
    "nav    body" 1fr
    / 1fr   3fr;
  background-color: var(--body-bg);
  width: 100vw;
  height: 100vh;

  .header {
    grid-area: header;
  }

  .nav {
    grid-area: nav;
  }

  .body {
    grid-area: body;
    padding: 20px;
    overflow: auto;
  }
}

body {
  font-size: 14px;
}

</style>
