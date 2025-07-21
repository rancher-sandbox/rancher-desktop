<script>
import $ from 'jquery';
import { mapGetters } from 'vuex';

import { isAlternate } from '@pkg/utils/platform';
import { AUTO, CENTER, fitOnScreen } from '@pkg/utils/position';

const HIDDEN = 'hide';
const CALC = 'calculate';
const SHOW = 'show';

export default {
  data() {
    return {
      phase: HIDDEN,
      style: {},
    };
  },

  computed: {
    ...mapGetters({
      targetElem:  'action-menu/elem',
      targetEvent: 'action-menu/event',
      shouldShow:  'action-menu/showing',
      options:     'action-menu/options',
    }),

    showing() {
      return this.phase !== HIDDEN;
    },

  },

  watch: {
    shouldShow: {
      handler(show) {
        if ( show ) {
          this.phase = CALC;
          this.updateStyle();
          this.$nextTick(() => {
            if ( this.phase === CALC ) {
              this.phase = SHOW;
              this.updateStyle();
            }
          });
        } else {
          this.phase = HIDDEN;
        }
      },
    },

    '$route.path'(val, old) {
      this.hide();
    },
  },

  methods: {
    hide() {
      this.$store.commit('action-menu/hide');
    },

    updateStyle() {
      if ( this.phase === SHOW ) {
        const menu = $('.menu', this.$el)[0];
        const event = this.targetEvent;
        const elem = this.targetElem;

        this.style = fitOnScreen(menu, event || elem, {
          overlapX:  true,
          fudgeX:    elem ? 4 : 0,
          fudgeY:    elem ? 4 : 0,
          positionX: (elem ? AUTO : CENTER),
          positionY: AUTO,
        });

        this.style.visibility = 'visible';
      } else {
        this.style = {};
      }
    },

    execute(action, event, args) {
      const opts = { alt: isAlternate(event) };

      this.$store.dispatch('action-menu/execute', {
        action, args, opts,
      });
      this.hide();
    },

    hasOptions(options) {
      return options.length !== undefined ? options.length : Object.keys(options).length > 0;
    },
  },
};
</script>

<template>
  <div v-if="showing">
    <div
      class="background"
      @click="hide"
      @contextmenu.prevent
    />
    <ul
      class="list-unstyled menu"
      :style="style"
    >
      <li
        v-for="opt in options"
        :key="opt.action"
        :class="{ divider: opt.divider }"
        @click="execute(opt, $event)"
      >
        <i
          v-if="opt.icon"
          :class="{ icon: true, [opt.icon]: true }"
        />
        <span v-html="opt.label" />
      </li>
      <li
        v-if="!hasOptions(options)"
        class="no-actions"
      >
        <span v-t="'sortableTable.noActions'" />
      </li>
    </ul>
  </div>
</template>

<style lang="scss" scoped>
  .root {
    position: absolute;
  }

  .menu {
    position: absolute;
    visibility: hidden;
    top: 0;
    left: 0;
    z-index: z-index('dropdownContent');

    color: var(--dropdown-text);
    background-color: var(--dropdown-bg);
    border: 1px solid var(--dropdown-border);
    border-radius: 5px;
    box-shadow: 0 5px 20px var(--shadow);

    LI {
      padding: 10px;
      margin: 0;

      &.divider {
        padding: 0;
        border-bottom: 1px solid var(--dropdown-divider);
      }

      &:not(.divider):hover {
        background-color: var(--dropdown-hover-bg);
        color: var(--dropdown-hover-text);
        cursor: pointer;
      }

      .icon {
        display: unset;
      }

      &.no-actions {
        color: var(--disabled-text);
      }

      &.no-actions:hover {
        background-color: initial;
        color: var(--disabled-text);
        cursor: default;
      }
    }
  }

  .background {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    opacity: 0;
    z-index: z-index('dropdownOverlay');
  }
</style>
