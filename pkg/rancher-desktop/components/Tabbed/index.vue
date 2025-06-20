<script>
import head from 'lodash/head';
import isEmpty from 'lodash/isEmpty';
import { addObject, removeObject, findBy } from '@pkg/utils/array';
import { sortBy } from '@pkg/utils/sort';
import findIndex from 'lodash/findIndex';

export default {
  name: 'Tabbed',

  props: {
    defaultTab: {
      type:    String,
      default: null,
    },

    sideTabs: {
      type:    Boolean,
      default: false
    },

    hideSingleTab: {
      type:    Boolean,
      default: false
    },

    showTabsAddRemove: {
      type:    Boolean,
      default: false
    },

    // whether or not to scroll to the top of the new tab on tab change. This is particularly ugly with side tabs
    scrollOnChange: {
      type:    Boolean,
      default: false
    },

    useHash: {
      type:    Boolean,
      default: true,
    },

    noContent: {
      type:    Boolean,
      default: false,
    },

    // Remove padding and box-shadow
    flat: {
      type:    Boolean,
      default: false,
    },

    tabsOnly: {
      type:    Boolean,
      default: false,
    }
  },

  provide() {
    const tabs = this.tabs;

    return {
      sideTabs: this.sideTabs,

      addTab(tab) {
        const existing = findBy(tabs, 'name', tab.name);

        if ( existing ) {
          removeObject(tabs, existing);
        }

        addObject(tabs, tab);
      },

      removeTab(tab) {
        removeObject(tabs, tab);
      }
    };
  },

  data() {
    return {
      tabs:          [],
      activeTabName: null,
    };
  },

  computed: {
    // keep the tabs list ordered for dynamic tabs
    sortedTabs() {
      return sortBy(this.tabs, ['weight:desc', 'labelDisplay', 'name']);
    },

    // hide tabs based on tab count IF flag is active
    hideTabs() {
      return this.hideSingleTab && this.sortedTabs.length === 1;
    }
  },

  watch: {
    sortedTabs(tabs) {
      const {
        defaultTab,
        useHash
      } = this;
      const activeTab = tabs.find((t) => t.active);

      const hash = useHash ? this.$route.hash : undefined;
      const windowHash = useHash ? hash.slice(1) : undefined;
      const windowHashTabMatch = tabs.find((t) => t.name === windowHash && !t.active);
      const firstTab = head(tabs) || null;

      if (isEmpty(activeTab)) {
        if (useHash && !isEmpty(windowHashTabMatch)) {
          this.select(windowHashTabMatch.name);
        } else if (!isEmpty(defaultTab) && !isEmpty(tabs.find((t) => t.name === defaultTab))) {
          this.select(defaultTab);
        } else if (firstTab?.name) {
          this.select(firstTab.name);
        }
      } else if (useHash && activeTab?.name === windowHash) {
        this.select(activeTab.name);
      }
    },
  },

  mounted() {
    if ( this.useHash ) {
      window.addEventListener('hashchange', this.hashChange);
    }
  },

  unmounted() {
    if ( this.useHash ) {
      window.removeEventListener('hashchange', this.hashChange);
    }
  },

  methods: {
    hasIcon(tab) {
      return tab.displayAlertIcon || (tab.error && !tab.active);
    },
    hashChange() {
      if (!this.scrollOnChange) {
        const scrollable = document.getElementsByTagName('main')[0];

        if (scrollable) {
          scrollable.scrollTop = 0;
        }
      }

      this.select(this.$route.hash);
    },

    find(name) {
      return this.sortedTabs.find((x) => x.name === name );
    },

    select(name/* , event */) {
      const { sortedTabs } = this;

      const selected = this.find(name);
      const hashName = `#${ name }`;

      if ( !selected || selected.disabled) {
        return;
      }
      /**
       * Exclude logic with URL anchor (hash) for projects without routing logic (vue-router)
       */
      if ( this.useHash ) {
        const currentRoute = this.$router.currentRoute._value;
        const routeHash = currentRoute.hash;

        if (this.useHash && routeHash !== hashName) {
          const kurrentRoute = { ...currentRoute };

          kurrentRoute.hash = hashName;

          this.$router.replace(kurrentRoute);
        }
      }

      for ( const tab of sortedTabs ) {
        tab.active = (tab.name === selected.name);
      }

      this.$emit('changed', { tab: selected, selectedName: selected.name });
      this.activeTabName = selected.name;
    },

    selectNext(direction) {
      const { sortedTabs } = this;
      const currentIdx = sortedTabs.findIndex((x) => x.active);
      const nextIdx = getCyclicalIdx(currentIdx, direction, sortedTabs.length);
      const nextName = sortedTabs[nextIdx].name;

      this.select(nextName);

      this.$nextTick(() => {
        this.$refs.tablist.focus();
      });

      function getCyclicalIdx(currentIdx, direction, tabsLength) {
        const nxt = currentIdx + direction;

        if (nxt >= tabsLength) {
          return 0;
        } else if (nxt <= 0) {
          return tabsLength - 1;
        } else {
          return nxt;
        }
      }
    },

    tabAddClicked() {
      const activeTabIndex = findIndex(this.tabs, (tab) => tab.active);

      this.$emit('addTab', activeTabIndex);
    },

    tabRemoveClicked() {
      const activeTabIndex = findIndex(this.tabs, (tab) => tab.active);

      this.$emit('removeTab', activeTabIndex);
    },
  },
};
</script>

<template>
  <div
    :class="{'side-tabs': !!sideTabs, 'tabs-only': tabsOnly }"
    data-testid="tabbed"
  >
    <ul
      v-if="!hideTabs"
      ref="tablist"
      role="tablist"
      class="tabs"
      :class="{'clearfix':!sideTabs, 'vertical': sideTabs, 'horizontal': !sideTabs}"
      tabindex="0"
      data-testid="tabbed-block"
      @keydown.right.prevent="selectNext(1)"
      @keydown.left.prevent="selectNext(-1)"
      @keydown.down.prevent="selectNext(1)"
      @keydown.up.prevent="selectNext(-1)"
    >
      <li
        v-for="tab in sortedTabs"
        :id="tab.name"
        :key="tab.name"
        :data-testid="tab.name"
        :class="{tab: true, active: tab.active, disabled: tab.disabled, error: (tab.error)}"
        role="presentation"
      >
        <a
          :data-testid="`btn-${tab.name}`"
          :aria-controls="'#' + tab.name"
          :aria-selected="tab.active"
          role="tab"
          @click.prevent="select(tab.name, $event)"
        >
          <span>{{ tab.labelDisplay }}</span>
          <span
            v-if="tab.badge"
            class="tab-badge"
          >{{ tab.badge }}</span>
          <i
            v-if="hasIcon(tab)"
            v-clean-tooltip="t('validation.tab')"
            class="conditions-alert-icon icon-error"
          />
        </a>
      </li>
      <li
        v-if="sideTabs && !sortedTabs.length"
        class="tab disabled"
      >
        <a
          href="#"
          @click.prevent
        >(None)</a>
      </li>
      <ul
        v-if="sideTabs && showTabsAddRemove"
        class="tab-list-footer"
      >
        <li>
          <button
            type="button"
            class="btn bg-transparent"
            data-testid="tab-list-add"
            @click="tabAddClicked"
          >
            <i class="icon icon-plus" />
          </button>
          <button
            type="button"
            class="btn bg-transparent"
            :disabled="!sortedTabs.length"
            data-testid="tab-list-remove"
            @click="tabRemoveClicked"
          >
            <i class="icon icon-minus" />
          </button>
        </li>
      </ul>
      <slot name="tab-row-extras" />
    </ul>
    <div
      :class="{
        'tab-container': !!tabs.length || !!sideTabs,
        'no-content': noContent,
        'tab-container--flat': !!flat,
      }"
    >
      <slot />
    </div>
  </div>
</template>

<style lang="scss" scoped>
.tabs {
  list-style-type: none;
  margin: 0;
  padding: 0;

  &.horizontal {
    border: solid thin var(--border);
    border-bottom: 0;
    display: flex;
    flex-direction: row;

    + .tab-container {
      border: solid thin var(--border);
    }

    .tab.active {
      border-bottom: solid 2px var(--primary);
    }
  }

  &:focus {
    outline: none;

    & .tab.active a span {
      text-decoration: underline;
    }
  }

  .tab {
    position: relative;
    float: left;
    padding: 0 8px 0 0;
    cursor: pointer;

    A {
      display: flex;
      align-items: center;
      padding: 10px 15px;

      &:hover {
        text-decoration: none;
        span {
          text-decoration: underline;
        }
      }
    }

    .conditions-alert-icon {
      color: var(--error);
      padding-left: 4px;
    }

    &:last-child {
      padding-right: 0;
    }

    &.active {
      > A {
        color: var(--primary);
        text-decoration: none;
      }
    }

    &.error {
      & A > i {
        color: var(--error);
      }
    }

    .tab-badge {
      margin-left: 5px;
      background-color: var(--link);
      color: #fff;
      border-radius: 6px;
      padding: 1px 7px;
      font-size: 11px;
    }
  }
}

.tab-container {
  padding: 20px;

  &.no-content {
    padding: 0 0 3px 0;
  }

  // Example case: Tabbed component within a tabbed component
  &--flat {
    padding: 0;

    .side-tabs {
      box-shadow: unset;
    }
  }
}

.tabs-only {
  margin-bottom: 20px;

  .tab-container {
    display: none;
  }

  .tabs {
    border: 0;
    border-bottom: 2px solid var(--border);
  }
}

.side-tabs {
  display: flex;
  box-shadow: 0 0 20px var(--shadow);
  border-radius: calc(var(--border-radius) * 2);
  background-color: var(--tabbed-sidebar-bg);

  .tab-container {
    padding: 20px;
  }

  & .tabs {
    width: $sideways-tabs-width;
    min-width: $sideways-tabs-width;
    display: flex;
    flex: 1 0;
    flex-direction: column;

    // &.vertical {
    //   .tab.active {
    //     background-color: var(--tabbed-container-bg);
    //   }
    // }

    & .tab {
      width: 100%;
      border-left: solid 5px transparent;

      &.toggle A {
        color: var(--primary);
      }

      A {
        color: var(--primary);
      }

      &.active {
        background-color: var(--body-bg);
        border-left: solid 5px var(--primary);

        & A {
          color: var(--input-label);
        }
      }

      &.disabled {
        background-color: var(--disabled-bg);

        & A {
          color: var(--disabled-text);
          text-decoration: none;
        }
      }
    }
    .tab-list-footer {
      list-style: none;
      padding: 0;
      margin-top: auto;

      li {
        display: flex;
        flex: 1;

        .btn {
          flex: 1 1;
          display: flex;
          justify-content: center;
        }

        button:first-of-type {
          border-top: solid 1px var(--border);
          border-right: solid 1px var(--border);
          border-top-right-radius: 0;
        }
        button:last-of-type {
          border-top: solid 1px var(--border);
          border-top-left-radius: 0;
        }
      }
    }
  }

  &

  .tab-container {
    width: calc(100% - #{$sideways-tabs-width});
    flex-grow: 1;
    background-color: var(--body-bg);
  }
}
</style>
