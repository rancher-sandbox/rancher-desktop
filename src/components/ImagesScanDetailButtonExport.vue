<template>
  <button
    class="btn role-primary btn-sm"
    type="button"
    aria-label="Add an Image"
    @click="route"
  >
    Export Scan Details
  </button>
</template>

<script lang="ts">
import Vue from 'vue';

export default Vue.extend({
  name: 'images-scan-detail-button-export',

  methods: {
    route() {
      this.$router.push({ name: 'images-add' });
    }
  }
});
</script>
