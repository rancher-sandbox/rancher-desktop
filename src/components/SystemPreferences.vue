<script>
import VueSlider from 'vue-slider-component';
import 'vue-slider-component/theme/default.css';
export default {
  components: { VueSlider },
  props:      {
    // Memory limits
    memoryInGB: {
      type:    Number,
      default: 2,
    },
    availMemoryInGB: {
      type:    Number,
      default: 0,
    },
    minMemoryInGB: {
      type:    Number,
      default: 2,
    },
    reservedMemoryInGB: {
      type:    Number,
      default: 1,
    },

    // CPU limits
    numberCPUs: {
      type:    Number,
      default: 2,
    },
    availNumCPUs: {
      type:    Number,
      default: 0,
    },
    minNumCPUs: {
      type:    Number,
      default: 2,
    },
    reservedNumCPUs: {
      type:    Number,
      default: 0,
    },
  },
  computed: {
    memoryMarks() {
      return this.makeMarks(this.safeMinMemory, this.availMemoryInGB);
    },
    CPUMarks() {
      return this.makeMarks(this.safeMinCPUs, this.availNumCPUs, 2);
    },
    disableMemory() {
      return this.availMemoryInGB <= this.minMemoryInGB;
    },
    disableCPUs() {
      return this.availNumCPUs <= this.minNumCPUs;
    },
    safeMinMemory() {
      return Math.min(this.minMemoryInGB, this.availMemoryInGB);
    },
    safeMinCPUs() {
      return Math.min(this.minNumCPUs, this.availNumCPUs);
    },
    safeMemory() {
      if (this.memoryInGB < this.safeMinMemory) {
        return this.safeMinMemory;
      } else if (this.memoryInGB > this.availMemoryInGB) {
        return this.availMemoryInGB;
      } else {
        return this.memoryInGB;
      }
    },
    safeReservedMemoryInGB() {
      return Math.min(this.reservedMemoryInGB, this.availMemoryInGB - this.safeMinMemory);
    },
    safeCPUs() {
      if (this.numberCPUs < this.safeMinCPUs) {
        return this.safeMinCPUs;
      } else if (this.numberCPUs > this.availNumCPUs) {
        return this.availNumCPUs;
      } else {
        return this.numberCPUs;
      }
    },
  },
  methods: {
    processMemory() {
      // The values here seem to always be in percentage.
      const percent = x => (x - this.safeMinMemory) * 100 / (this.availMemoryInGB - this.safeMinMemory);

      return [
        [
          percent(this.availMemoryInGB - this.safeReservedMemoryInGB),
          percent(this.availMemoryInGB),
          {},
        ],
      ];
    },
    processCPUs() {
      const percent = x => (x - this.minNumCPUs) * 100 / (this.availNumCPUs - this.minNumCPUs);

      return [
        [
          percent(Math.max(0, this.availNumCPUs - this.reservedNumCPUs)),
          percent(this.availNumCPUs),
          {},
        ],
      ];
    },
    updatedVal(value, key = 'memory') {
      const unit = key === 'memory' ? 'GB' : 'CPUs';
      let warningMessage = '';

      if (this.hasError(key, value)) {
        const comparison = (key === 'memory' && value > this.availMemoryInGB) || (key === 'cpu' && value > this.availNumCPUs) ? 'Less' : 'More';
        const threshold = this.threshold(key, comparison);

        this.$emit('error', key, `${ comparison } than ${ threshold } ${ unit } needs to be allocated to the virtual machine.`);

        return;
      }

      if (this.hasWarning(key, value)) {
        warningMessage = `Allocating ${ value } ${ unit } to the virtual machine may cause your host machine to be sluggish.`;
      }

      this.$emit('warning', key, warningMessage);
      this.$emit(`update:${ key }`, Number(value));
    },
    hasError(key, val) {
      return (
        (key === 'memory' && (val > this.availMemoryInGB || val < this.safeMinMemory)) ||
        (key === 'cpu' && (val > this.availNumCPUs || val < this.safeMinCPUs))
      );
    },
    hasWarning(key, val) {
      return (
        (key === 'memory' && val > this.availMemoryInGB - this.safeReservedMemoryInGB) ||
        (key === 'cpu' && val > this.availNumCPUs - this.reservedNumCPUs)
      );
    },
    threshold(key, val) {
      if (val === 'Less') {
        return key === 'memory' ? this.availMemoryInGB : this.availNumCPUs;
      } else {
        return key === 'memory' ? this.safeMinMemory : this.safeMinCPUs;
      }
    },
    makeMarks(min, max, mult = 8, steps = 8) {
      const marks = [...Array(Math.floor(max / mult))]
        .map((_x, i) => (i + 1) * mult);

      if (!marks.includes(min)) {
        marks.unshift(min);
      }

      if (!marks.includes(max)) {
        marks.push(max);
      }

      const step = Math.ceil((marks.length - min) / steps);

      return marks
        .filter((_val, i, arr) => i === 0 || i === arr.length - 1 || !(i % step));
    }
  },
};
</script>

<template>
  <div class="system-preferences">
    <div id="memoryInGBWrapper" class="labeled-input">
      <label>Memory (GB)</label>
      <section class="slider-container">
        <input
          type="number"
          class="slider-input"
          :value="safeMemory"
          @input="updatedVal($event.target.value, 'memory')"
        />
        <vue-slider
          ref="memory"
          :value="safeMemory"
          :min="safeMinMemory"
          :max="availMemoryInGB"
          :marks="memoryMarks"
          :tooltip="'none'"
          :disabled="disableMemory"
          :process="processMemory"
          @change="updatedVal($event, 'memory')"
        />
      </section>
    </div>

    <div id="numCPUWrapper" class="labeled-input">
      <label># CPUs</label>
      <section class="slider-container">
        <input
          type="number"
          class="slider-input"
          :value="safeCPUs"
          @input="updatedVal($event.target.value, 'cpu')"
        />
        <vue-slider
          ref="cpu"
          :value="safeCPUs"
          :min="safeMinCPUs"
          :max="availNumCPUs"
          :interval="1"
          :marks="CPUMarks"
          :tooltip="'none'"
          :disabled="disableCPUs"
          :process="processCPUs"
          @change="updatedVal($event, 'cpu')"
        />
      </section>
    </div>
  </div>
</template>

<style scoped>

.labeled-input .vue-slider {
  margin: 2em 1em;
  flex: 1;
}
.vue-slider >>> .vue-slider-rail {
  background-color: var(--progress-bg);
}
.vue-slider >>> .vue-slider-mark-step {
  background-color: var(--checkbox-tick-disabled);
  opacity: 0.5;
}
.vue-slider >>> .vue-slider-dot-handle {
  background-color: var(--scrollbar-thumb);
  box-shadow: 0.5px 0.5px 2px 1px var(--darker);
}
@media screen and (prefers-color-scheme: dark) {
  .vue-slider >>> .vue-slider-dot-handle {
    background-color: var(--checkbox-tick-disabled);
  }
}
.vue-slider >>> .vue-slider-process {
  background-color: var(--error);
}

.slider-container {
  display: flex;
  align-items: center;
}

.slider-input, .slider-input:focus, .slider-input:hover {
  max-width: 6rem;
  border: solid var(--border-width) var(--input-border);
  padding:10px;
}

</style>
