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
      return this.makeMarks(this.safeMinCPUs, this.availNumCPUs);
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
      const percent = x => (x - this.minMemoryInGB) * 100 / (this.availMemoryInGB - this.minMemoryInGB);

      return [
        [
          percent(Math.max(0, this.availMemoryInGB - this.reservedMemoryInGB)),
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
    updatedMemory(value) {
      let warningMessage = '';

      if (value > this.availMemoryInGB - this.reservedMemoryInGB) {
        warningMessage = `Allocating ${ value } GB to the virtual machine may cause your host machine to be sluggish.`;
      }
      this.$emit('warning', 'memory', warningMessage);
      this.$emit('updateMemory', value);
    },
    updatedCPU(value) {
      let warningMessage = '';

      if (value > this.availNumCPUs - this.reservedNumCPUs) {
        warningMessage = `Allocating ${ value } CPUs to the virtual machine may cause your host machine to be sluggish.`;
      }
      this.$emit('warning', 'cpu', warningMessage);
      this.$emit('updateCPU', value);
    },
    makeMarks(min, max) {
      const size = max - min + 1;

      if (size <= 0) {
        return [max];
      }
      // Have up to 8 marks, at some integral step interval
      const step = Math.ceil((max - min + 1) / 8);
      const marks = [...Array(size)]
        .map((v, i) => (i * step + min))
        .filter(i => i <= max);

      // Ensure that the last mark is the maximum value
      if (marks.slice(-1).pop() !== max) {
        marks.push(max);
      }

      return marks;
    },
  },
};
</script>

<template>
  <div class="system-preferences">
    <div id="memoryInGBWrapper" class="labeled-slider">
      <div class="slider-label">
        Memory (GB):
      </div>
      <vue-slider
        ref="memory"
        :value="safeMemory"
        :min="safeMinMemory"
        :max="availMemoryInGB"
        :marks="memoryMarks"
        :tooltip="'none'"
        :disabled="disableMemory"
        :process="processMemory"
        @change="updatedMemory"
      />
    </div>

    <div id="numCPUWrapper" class="labeled-slider">
      <div class="slider-label">
        # CPUs:
      </div>
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
        @change="updatedCPU"
      />
    </div>
  </div>
</template>

<style scoped>

div.labeled-slider {
  margin: 4px 0 32px 0;
  width: 20em;
}

div.slider-label {
  margin-top: 6px;
}

.vue-slider >>> .vue-slider-process {
  background-color: orange;
}

</style>
