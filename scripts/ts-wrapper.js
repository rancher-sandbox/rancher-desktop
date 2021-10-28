/**
 * This script is a wrapper to run TypeScript scripts via node.  This wrapper is
 * necessary as ts-node by default doesn't override the tsconfig.json at all,
 * which means that the `module` compiler option will be ESNext, which works
 * fine elsewhere, but not on the command line.
 */

// Load tsconfig-paths so that ts-node can resolve files based on the 'paths'
// compiler options key in tsconfig.json.
require('tsconfig-paths/register');

const { main: tsNodeMain } = require('ts-node/dist/bin');

function main(args) {
  return tsNodeMain(args, { '--compiler-options': { module: 'commonjs' } });
}

if (require.main === module) {
  main(process.argv.slice(2));
}
