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
    Header
  },

  data() {
    return {
      routes: ['/', '/K8s', '/Troubleshooting'],
    };
  },
};
</script>

<style lang="scss">
@import "@/assets/styles/app.scss";

.wrapper {
  display: grid;
  grid-template-columns: repeat(4, 1fr);

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
