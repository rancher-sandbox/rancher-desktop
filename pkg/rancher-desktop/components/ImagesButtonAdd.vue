<template>
  <button
    data-test="addImageButton"
    type="button"
    class="btn btn-xs role-secondary"
    @click="route"
  >
    {{ t('images.action.add') }}
  </button>
</template>

<script lang="ts">
import Vue from 'vue';

export default Vue.extend({
  name: 'images-button-add',

  methods: {
    route() {
      this.$router.push({ name: 'images-add' });
    },
  },
});
</script>

<style lang="scss" scoped>

  .btn-xs {
    min-height: 2.25rem;
    max-height: 2.25rem;
    line-height: 0.25rem;
  }

</style>
