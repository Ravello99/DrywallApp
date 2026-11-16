// Metro bundler config. Defaults, with fewer workers so builds fit on a small server.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.maxWorkers = 2;

module.exports = config;
