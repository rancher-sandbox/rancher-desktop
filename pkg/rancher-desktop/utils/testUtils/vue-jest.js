// This is a transformer for Vue to compile single-file components in jest.
// @vue/vue3-jest forces CommonJS which breaks with dependencies that are now
// ESM-only.

// @ts-check

import crypto from 'crypto';

import babelJest from 'babel-jest';
import typescript from 'typescript';
import { compileTemplate, parse } from 'vue/compiler-sfc';

/**
 * @import { SFCDescriptor, SFCParseOptions } from 'vue/compiler-sfc'
 * @import { SyncTransformer, TransformOptions } from '@jest/transform'
 * @import { TransformOptions as BabelTransformOptions } from '@babel/core';
 */

/**
 * @typedef {Object} VueJestTransformOptions
 * @property vue {SFCParseOptions}
 * @property babel {BabelTransformOptions}
 */

const babelTransformer = (function() {
  const result = babelJest.createTransformer();
  if ('then' in result) {
    throw new Error('babel transformer creation should be synchronous');
  }
  return result;
}());

/** @type (source: string, fileName: string) => string */
function compileTypeScript(source, fileName) {
  const result = typescript.transpileModule(source, {
    fileName,
    compilerOptions: {
      module: typescript.ModuleKind.ESNext,
    },
  });

  return result.outputText;
}

/** @type (descriptor: SFCDescriptor, options: TransformOptions<VueJestTransformOptions>) => string */
function processScript(descriptor, options) {
  const { script } = descriptor;

  if (!script) {
    return '';
  }

  if (!script.content) {
    throw new Error(`Script ${ descriptor.filename } has no content`);
  }

  const isTS = /typescript|^ts/.test(script.lang ?? 'js');
  let { content } = script;

  if (isTS) {
    content = compileTypeScript(content, descriptor.filename);
  }

  return content.replace(/^export default/m, 'const __default__ =');
}

/** @type (descriptor: SFCDescriptor) => string */
function processTemplate(descriptor) {
  const { template } = descriptor;

  if (!template) {
    return '';
  }

  if (!template.content) {
    throw new Error(`Template ${ descriptor.filename } does not have content`);
  }

  const lang = descriptor.scriptSetup?.lang ?? descriptor.script?.lang ?? 'js';
  const isTS = /typescript|^ts/.test(lang);
  const results = compileTemplate({
    source:          template.content,
    ast:             template.ast,
    filename:        descriptor.filename,
    id:              descriptor.filename,
    compilerOptions: { mode: 'module', isTS },
    preprocessLang:  template.lang,
  });

  if (isTS) {
    return compileTypeScript(results.code, descriptor.filename);
  }

  return results.code;
}

/** @type {SyncTransformer<VueJestTransformOptions>} */
export default {
  getCacheKey(sourceText, sourcePath, options) {
    const sourceHasher = crypto.createHash('sha512');

    sourceHasher.update(sourceText, 'utf-8');

    return sourceHasher.digest('hex') + sourcePath;
  },

  process(sourceText, filename, options) {
    const { descriptor } = parse(sourceText, { filename, ...options.transformerConfig });
    const code = `
      ${ processScript(descriptor, options) }
      ${ processTemplate(descriptor) }
      /* Don't bother with styles, we don't need it yet */
      __default__.render = render;
      export default __default__;
    `;

    return { code };
  },
};
