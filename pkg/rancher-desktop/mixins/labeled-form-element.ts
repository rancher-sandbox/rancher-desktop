import { _EDIT, _VIEW } from '@pkg/config/query-params';
import { getWidth, setWidth } from '@pkg/utils/width';

interface LabeledFormElement {
  raised: boolean;
  focused: boolean;
  blurred: number | null;
}

export default {
  inheritAttrs: false,

  props: {
    mode: {
      type:    String,
      default: _EDIT,
    },

    label: {
      type:    String,
      default: null
    },

    labelKey: {
      type:    String,
      default: null
    },

    placeholderKey: {
      type:    String,
      default: null
    },

    tooltip: {
      type:    [String, Object],
      default: null
    },

    hoverTooltip: {
      type:    Boolean,
      default: true,
    },

    tooltipKey: {
      type:    String,
      default: null
    },

    required: {
      type:    Boolean,
      default: false,
    },

    disabled: {
      type:    Boolean,
      default: false,
    },

    placeholder: {
      type:    [String, Number],
      default: ''
    },

    value: {
      type:    [String, Number, Object],
      default: ''
    },

    options: {
      default: null,
      type:    Array
    },

    searchable: {
      default: false,
      type:    Boolean
    },

    filterable: {
      default: true,
      type:    Boolean
    },

    rules: {
      default:   () => [],
      type:      Array,
      // we only want functions in the rules array
      validator: (rules: any) => rules.every((rule: any) => ['function'].includes(typeof rule))
    },

    requireDirty: {
      default: true,
      type:    Boolean
    }
  },

  data(): LabeledFormElement {
    return {
      raised:  this.mode === _VIEW || !!`${ this.value }`,
      focused: false,
      blurred: null,
    };
  },

  computed: {
    requiredField(): boolean {
      // using "any" for a type on "rule" here is dirty but the use of the optional chaining operator makes it safe for what we're doing here.
      return (this.required || this.rules.some((rule: any): boolean => rule?.name === 'required'));
    },
    empty(): boolean {
      return !!`${ this.value }`;
    },

    isView(): boolean {
      return this.mode === _VIEW;
    },

    isDisabled(): boolean {
      return this.disabled || this.isView;
    },

    isSearchable(): boolean {
      const { searchable, canPaginate } = this as any; // This will be resolved when we migrate from mixin

      if (canPaginate) {
        return true;
      }
      const options = ( this.options || [] );

      if (searchable || options.length >= 10) {
        return true;
      }

      return false;
    },

    isFilterable(): boolean {
      const { filterable, canPaginate } = this as any; // This will be resolved when we migrate from mixin

      if (canPaginate) {
        return false;
      }

      return filterable;
    },

    validationMessage(): string | undefined {
      // we want to grab the required rule passed in if we can but if it's not there then we can just grab it from the formRulesGenerator
      const requiredRule = this.rules.find((rule: any) => rule?.name === 'required') as Function;
      const ruleMessages = [];
      const value = this?.value;

      if (requiredRule && this.blurred && !this.focused) {
        const message = requiredRule(value);

        if (!!message) {
          this.$emit('update:validation', false);

          return message;
        }
      }

      for (const rule of this.rules as Function[]) {
        const message = rule(value);

        if (!!message && rule.name !== 'required') { // we're catching 'required' above so we can ignore it here
          ruleMessages.push(message);
        }
      }
      if (ruleMessages.length > 0 && (this.blurred || this.focused || !this.requireDirty)) {
        this.$emit('update:validation', false);

        return ruleMessages.join(', ');
      } else {
        this.$emit('update:validation', true);

        return undefined;
      }
    }
  },

  methods: {
    resizeHandler() {
      // since the DD is positioned there is no way to 'inherit' the size of the input, this calcs the size of the parent and set the dd width if it is smaller. If not let it grow with the regular styles
      this.$nextTick(() => {
        const DD = (this.$refs.select as HTMLElement).querySelector('ul.vs__dropdown-menu');

        const selectWidth = getWidth(this.$refs.select as Element) || 0;
        const dropWidth = getWidth(DD as Element) || 0;

        if (dropWidth < selectWidth) {
          setWidth(DD as Element, selectWidth);
        }
      });
    },
    onFocus() {
      this.$emit('on-focus');

      return this.onFocusLabeled();
    },

    onFocusLabeled() {
      this.raised = true;
      this.focused = true;
    },

    onBlur() {
      this.$emit('on-blur');

      return this.onBlurLabeled();
    },

    onBlurLabeled() {
      this.focused = false;

      if ( !this.value ) {
        this.raised = false;
      }

      this.blurred = Date.now();
    }
  }
};
