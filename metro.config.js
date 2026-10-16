// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require("expo/metro-config");

/**
 * The Figma icons are exported as SVG. This teaches Metro to compile an
 * `import Icon from "./icon.svg"` into a React component, so the screens
 * render the DESIGNER'S artwork rather than a redrawn approximation.
 */
const config = getDefaultConfig(__dirname);

config.transformer.babelTransformerPath = require.resolve("react-native-svg-transformer/expo");
config.resolver.assetExts = config.resolver.assetExts.filter((ext) => ext !== "svg");
config.resolver.sourceExts = [...config.resolver.sourceExts, "svg"];

module.exports = config;
