<template>
  <Header />
  <Welcome />
</template>

<script>
import Welcome from './components/Welcome.vue'
import Header from './components/Header.vue'

export default {
  name: 'App',
  components: {
    Welcome,
    Header
  }
}
</script>

<style lang="scss">
@import "./src/assets/styles/app.scss";
</style>
