// Portrait both ways up on Android: a phone propped up upside down (camera at the bottom, to see
// the feet) shows the app upright, and the preview matches the analysed frames.
const { AndroidConfig, withAndroidManifest } = require("expo/config-plugins");

module.exports = function withSensorPortrait(config) {
  return withAndroidManifest(config, (c) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(c.modResults);
    activity.$["android:screenOrientation"] = "sensorPortrait";
    return c;
  });
};
