<template>
  <div class="wrapper">
    <Header class="header" />
    <Nav class="nav" :items="navItems" />
    <Welcome class="body" />
  </div>
</template>

<script>
import Welcome from './components/Welcome.vue'
import Header from './components/Header.vue'
import Nav from './components/Nav.vue'

export default {
  name: 'Rancher Desktop',
  components: {
    Welcome,
    Nav,
    Header
  },

  data() {
    return {
      navItems: [{ name: 'Welcome', url: 'foo', active: true }, { name: 'Kubernetes Settings', url: 'bar', active: false }] 
    }
  }
}
</script>

<style lang="scss">
@import "./src/assets/styles/app.scss";

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
  }
}

BODY {
  font-size: 14px;
}

</style>
