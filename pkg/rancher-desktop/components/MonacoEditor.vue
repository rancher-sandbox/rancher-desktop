<template>
  <div ref="editor" style="width: 600px; height: 400px;"></div>
</template>

<script lang="ts">
import * as monaco from 'monaco-editor';
import { defineComponent, inject } from 'vue';

interface NonReactiveProps {
  editor: any;
}

const provideProps: NonReactiveProps = { editor: undefined };

export default defineComponent({
  name:  'MonacoEditor',
  props: {
    code: {
      type:     String,
      required: true,
    },
    language: {
      type:    String,
      default: 'javascript',
    },
  },
  setup() {
    const editor = inject('editor', provideProps.editor);

    return { editor };
  },
  watch: {
    code(newCode) {
      if (this.editor) {
        const model = this.editor.getModel();

        model.setValue(newCode);
      }
    },
  },
  mounted() {
    this.editor = monaco.editor.create(this.$refs.editor, {
      value:           this.code,
      language:        this.language,
      automaticLayout: true,
    });

    this.editor.onDidChangeModelContent(() => {
      this.$emit('update:code', this.editor.getValue());
    });
  },
  beforeDestroy() {
    if (this.editor) {
      this.editor.dispose();
    }
  },
});
</script>
