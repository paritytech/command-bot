const { getConfiguration } = require("opstooling-js-style/src/eslint/configuration");

const tsConfParams = { rootDir: __dirname };

const conf = getConfiguration({ typescript: tsConfParams });

module.exports = conf;
