<script lang="ts">
import Vue from 'vue';
import { mapGetters } from 'vuex';
import Checkbox from '@/components/form/Checkbox.vue';

export default Vue.extend({
  name:       'preferences-body-application',
  components: { Checkbox },
  data() {
    return {
      sudoAllowedTooltip: `
        If checked, Rancher Desktop will attempt to acquire administrative
        credentials ("sudo access") when starting for some operations.  This
        allows for enhanced functionality, including bridged networking and
        default docker socket support.  Changes will only be applied next time
        Rancher Desktop starts.
      `,
      automaticUpdates: true,
      statistics:       false,
    };
  },
  // TODO: Move mapgetters up to page that will be managing the modal and replace
  // usage with props
  computed: { ...mapGetters('applicationSettings', ['sudoAllowed']) },
  methods:  {
    onSudoAllowedChange(val: boolean) {
      this.$store.dispatch('applicationSettings/commitSudoAllowed', val);
    },
  }
});
</script>

<template>
  <div class="application-body">
    <div>
      <div class="checkbox-title">
        <span>Administrative Access</span>
        <i v-tooltip="sudoAllowedTooltip" class="icon icon-info icon-lg" />
      </div>
      <checkbox
        label="Allow Rancher Desktop to acquire administrative credentials (sudo access)"
        :value="sudoAllowed"
        @input="onSudoAllowedChange"
      />
    </div>
    <div>
      <div class="checkbox-title">
        <span>Automatic Updates</span>
      </div>
      <checkbox
        v-model="automaticUpdates"
        label="Check for updates automatically"
      />
    </div>
    <div>
      <div class="checkbox-title">
        <span>Statistics</span>
      </div>
      <checkbox
        v-model="statistics"
        label="Allow collection of anonymous statistics to help us improve Rancher Desktop"
      />
    </div>
  </div>
</template>

<style lang="scss" scoped>
  .checkbox-title {
    font-size: 1rem;
    line-height: 1.5rem;
    padding-bottom: 0.5rem;
  }

  .application-body {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
</style>
