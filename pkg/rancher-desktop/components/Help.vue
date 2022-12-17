<script lang="ts">
import { shell } from 'electron';
import Vue from 'vue';
import { mapState } from 'vuex';

export default Vue.extend({
  name:  'help',
  props: {
    fixedUrl: {
      type:    String,
      default: null,
    },
    tooltip: {
      type:    String,
      default: null,
    },
  },
  computed: {
    ...mapState('help', ['url']),
    helpUrl(): string {
      return this.fixedUrl ?? this.url;
    },
    tooltipContent(): string | null {
      return this.helpUrl ? this.tooltip : null;
    },
  },
  methods: {
    openUrl() {
      if (this.helpUrl) {
        shell.openExternal(this.helpUrl);
      }
    },
  },
});
</script>

<template>
  <div class="help-button">
    <button
      v-tooltip="{
        content: tooltipContent,
        placement: 'right'
      }"
      class="btn role-fab"
      :class="{
        disabled: !helpUrl
      }"
      @click="openUrl"
    >
      <span
        class="icon icon-question-mark"
        :class="{
          disabled: !helpUrl
        }"
      />
    </button>
  </div>
</template>

<style lang="scss" scoped>

  .help-button {

    .icon {
      display: inline-block;
      background-color: var(--primary);
      color: var(--body-bg);
      font-size: 1.3rem;
      width: 1.4rem;
      height: 1.4rem;
      border-radius: 50%;
      cursor: pointer;

      &:before{
        padding-top: 5%;
        padding-left: 2%;
        display: block;
      }

      &:hover {
        background: var(--primary-hover-bg);
      }
    }

    .disabled {
      background: transparent !important;
      color: var(--body-text);
      opacity: 0.2;
      cursor: default;
    }

    // We make use of the term Floating Action Button (fab) here because the
    // design of this button is reminiscent of floating actions buttons from
    // Material Design
    .role-fab {
      all: revert;

      border: 0;
      padding: 0;
      background: transparent;
      transition: background 200ms;
      border-radius: 50%;
      &.disabled {
        border: 0;
      }
    }
  }
</style>
