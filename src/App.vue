<template>
  <div class="wrapper">
    <Header class="header" />
    <Nav class="nav" :items="navItems" />
    <router-view></router-view>
  </div>
</template>

<script>
import Header from './components/Header.vue'
import Nav from './components/Nav.vue'

export default {
  name: 'Rancher Desktop',
  components: {
    Nav,
    Header
  },

  data() {
    return {
      navItems: [{ name: 'Welcome', url: '/' }, { name: 'Kubernetes Settings', url: '/k8s' }] 
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
