// Allows plain HTTP: to localhost for scripts/analyze-on-device.sh (adb reverse serves a test video
// from the computer), and to a computer on the local network for sending debug recordings
// (tools/devserver.py). Android can't limit cleartext to private addresses, so it's allowed in general;
// the app itself only fetches pose models, over HTTPS.
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="true" />
</network-security-config>
`;

module.exports = function withLanCleartext(config) {
  config = withDangerousMod(config, [
    "android",
    async (c) => {
      const dir = path.join(c.modRequest.platformProjectRoot, "app/src/main/res/xml");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "network_security_config.xml"), XML);
      return c;
    },
  ]);
  return withAndroidManifest(config, (c) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(c.modResults);
    app.$["android:networkSecurityConfig"] = "@xml/network_security_config";
    return c;
  });
};
