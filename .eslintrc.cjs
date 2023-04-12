const { getConfiguration } = require("@eng-automation/js-style/src/eslint/configuration");

const tsConfParams = { rootDir: __dirname };

const conf = getConfiguration({ typescript: tsConfParams });

module.exports = conf;
