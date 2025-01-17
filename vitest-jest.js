const { patchSymbols } = require('@whatwg-node/disposablestack');
patchSymbols();

module.exports = new Proxy(require('@jest/globals'), {
  get(jestGlobals, prop, receiver) {
    if (prop === 'vitest' || prop === 'vi') {
      return jestGlobals.jest;
    }
    if (prop === 'describe') {
      const describeFn = function describe(name, ...args) {
        return jestGlobals.describe(name, ...args);
      };
      describeFn.skipIf = function describeSkipIf(condition) {
        return condition ? describeFn.skip : describeFn;
      };
      describeFn.skip = function describeSkip(name, ...args) {
        return jestGlobals.describe.skip(name, ...args);
      };
      describeFn.only = function describeOnly(name, ...args) {
        return jestGlobals.describe.only(name, ...args);
      };
      return describeFn;
    }
    return Reflect.get(jestGlobals, prop, receiver);
  },
});
