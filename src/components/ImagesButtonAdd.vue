<template>
  <button
    class="btn role-primary btn-sm"
    type="button"
    @click="route"
  >
    <span
      class="icon icon-plus"
    />
  </button>
</template>

<script>
export default {
  name: 'images-button-add',

  methods: {
    route() {
      this.$router.push({ name: 'images-add' });
    }
  }
};
</script>

<style lang="scss" scoped>
button.btn {
  width: 32px;
  height: 32px;
  border-radius: 50%;
}

span.icon {
  font-weight: bolder;
  font-size: 16px;
}
</style>
