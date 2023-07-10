import { simpleSpawn } from 'scripts/simple_process';

(async() => {
  let exitCode;

  try {
    // Do this because building the code in `build-rest.ts` is going to hit the `paths.ts` code, which depends
    // on being able to find `rdctl`. When starting out, we still need to build `rdctl`, so we build it
    // (and all the other go utilities) in a process that has limited well-understood dependencies on the
    // core typescript code (mainly to lose type info).
    await simpleSpawn('node', ['scripts/ts-wrapper.js', 'scripts/postinstall-build-go-utilities.ts']);
    await simpleSpawn('node', ['scripts/ts-wrapper.js', 'scripts/postinstall-build-rest.ts']);
    exitCode = 0;
  } catch (e: any) {
    console.error('POSTINSTALL ERROR: ', e);
  } finally {
    process.exit(exitCode);
  }
})();
