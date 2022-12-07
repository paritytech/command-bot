const esm = require("./node_modules/ts-node/dist/esm")
const fs = require("fs")
const { parse: parsePath, join: joinPath } = require("path")
const { compileFromFile } = require('json-schema-to-typescript')

const { resolve: tsNodeResolve, load, getFormat, transformSource } = esm.registerAndCreateEsmHooks()

const resolve = (specifier, ...args) => {
  if (specifier.startsWith("src/")) {
    const parsed = parsePath(specifier)
    return tsNodeResolve(joinPath(__dirname, parsed.dir, `${parsed.name}.ts`), ...args)
  }

  // compile schema file
  compileFromFile('src/schema/schema.cmd.json')
    .then(ts => fs.writeFileSync('src/schema/schema.cmd.d.ts', ts))


  return tsNodeResolve(specifier, ...args)
}

module.exports = { load, getFormat, transformSource, resolve }
