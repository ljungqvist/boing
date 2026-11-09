/**
 * app.json plus CI-only settings (`.github/workflows/android.yml`):
 *  - the build number and commit become Android's version (Settings → Apps → Boing → App info) and, through
 *    the EXPO_PUBLIC_ variables, the "Build" row in the app's settings;
 *  - builds of the dev branch get the id suffix ".dev" and the name "Boing Dev", so the dev and main builds
 *    install side by side as two apps.
 * Local builds keep app.json as it is (set EXPO_PUBLIC_BOING_BRANCH=dev to get the dev variant locally).
 */
module.exports = ({ config }) => {
  const build = Number(process.env.EXPO_PUBLIC_BOING_BUILD) || 0;
  const dev = process.env.EXPO_PUBLIC_BOING_BRANCH === "dev";
  const play = process.env.EXPO_PUBLIC_BOING_BRANCH === "play";
  let out = config;
  if (dev) {
    out = {
      ...out,
      name: `${out.name} Dev`,
      scheme: `${out.scheme}-dev`,
      ios: { ...out.ios, bundleIdentifier: `${out.ios.bundleIdentifier}.dev` },
      android: { ...out.android, package: `${out.android.package}.dev` },
    };
  }
  if (build) {
    const commit = process.env.EXPO_PUBLIC_BOING_COMMIT || "?";
    out = {
      ...out,
      android: { ...out.android, versionCode: build, version: play ? out.version : `${out.version} (build ${build}, ${commit})` },
    };
  }
  return out;
};
