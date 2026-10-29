/**
 * app.json plus the CI build number and commit (`.github/workflows/android.yml`): they become Android's
 * version (Settings → Apps → Boing → App info) and, through the EXPO_PUBLIC_ variables, the "Build" row
 * in the app's settings. Local builds keep app.json as it is.
 */
module.exports = ({ config }) => {
  const build = Number(process.env.EXPO_PUBLIC_BOING_BUILD) || 0;
  if (!build) return config;
  const commit = process.env.EXPO_PUBLIC_BOING_COMMIT || "?";
  return {
    ...config,
    android: { ...config.android, versionCode: build, version: `${config.version} (build ${build}, ${commit})` },
  };
};
