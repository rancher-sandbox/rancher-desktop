<template>
  <button
    class="btn role-primary btn-sm"
    type="button"
    aria-label="Add an Image"
    @click="route"
  >
    <span
      class="icon icon-plus"
    />
  </button>
</template>

<script lang="ts">
import Vue from 'vue';

export default Vue.extend({
  name: 'images-button-add',

  methods: {
    route() {
      this.$router.push({ name: 'images-add' });
    }
  }
});
</script>

<style lang="scss" scoped>
button.btn {
  display: flex;
  width: 32px;
  height: 32px;
  border-radius: 50%;
}

span.icon {
  margin: auto;
  font-weight: bolder;
  font-size: 16px;
}
</style>
