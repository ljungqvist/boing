// The jump analysis is shared with the web app: ../src/analysis and ../src/media.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, "../src")];
// Files outside this folder (../src) resolve their packages from here.
config.resolver.nodeModulesPaths = [path.resolve(__dirname, "node_modules")];

module.exports = config;
