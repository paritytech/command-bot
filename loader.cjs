const esm = require("./node_modules/ts-node/dist/esm");
const { parse: parsePath, join: joinPath } = require("path");

const { resolve: tsNodeResolve, load, getFormat, transformSource } = esm.registerAndCreateEsmHooks();

const resolve = (specifier, ...args) => {
  if (specifier.startsWith("src/")) {
    const parsed = parsePath(specifier);
    return tsNodeResolve(joinPath(__dirname, parsed.dir, `${parsed.name}.ts`), ...args);
  }

  return tsNodeResolve(specifier, ...args);
};

module.exports = { load, getFormat, transformSource, resolve };
