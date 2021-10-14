<template>
  <div>
    <button
      class="btn"
      :class="isPullActive"
      @click="tabSelected('pull')"
    >
      Pull
    </button>
    <button
      class="btn"
      :class="isBuildActive"
      @click="tabSelected('build')"
    >
      Build
    </button>
  </div>
</template>

<script>
export default {
  name: 'image-add-tabs',

  data() {
    return { activeTab: 'pull' };
  },

  computed: {
    isPullActive() {
      return [this.activeTab === 'pull' ? 'role-primary' : 'role-secondary'];
    },
    isBuildActive() {
      return [this.activeTab === 'build' ? 'role-primary' : 'role-secondary'];
    }
  },

  methods: {
    tabSelected(action) {
      this.activeTab = action;
      this.$emit('click', this.activeTab);
    }
  }
};
</script>
