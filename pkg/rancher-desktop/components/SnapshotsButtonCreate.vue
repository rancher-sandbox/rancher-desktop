<template>
  <button
    data-test="createSnapshotButton"
    type="button"
    class="btn btn-xs role-secondary"
    @click="route"
  >
    {{ t('snapshots.action.create') }}
  </button>
</template>

<script lang="ts">
import Vue from 'vue';

export default Vue.extend({
  name: 'snapshots-button-create',

  methods: {
    route() {
      this.$router.push({ name: 'snapshots-create' });
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
