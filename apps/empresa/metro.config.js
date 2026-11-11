// Monorepo: o Metro do Expo deteta os workspaces automaticamente.
const { getDefaultConfig } = require("expo/metro-config");
module.exports = getDefaultConfig(__dirname);
