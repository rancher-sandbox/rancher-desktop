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
    return { routes: ['/Welcome', '/K8s', '/PortForwarding', '/Troubleshooting'] };
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

<style lang="scss">
@import "@/assets/styles/app.scss";

.wrapper {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  background-color: var(--body-bg);

  .header {
    grid-column: 1 / 5;
    grid-row: 1;
  }

  .nav {
    grid-column: 1;
    grid-row: 2 / 5;
  }

  .body {
    grid-column: 2 / 5;
    grid-row: 2 / 5;
    padding: 20px 0 0 20px;
  }
}

body {
  font-size: 14px;
}

</style>
