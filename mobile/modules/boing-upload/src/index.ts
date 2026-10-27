import { requireOptionalNativeModule } from "expo-modules-core";

interface BoingUploadNative {
  start(dir: string, server: string, phoneId: string, key: string): void;
  stop(): void;
}

const native = requireOptionalNativeModule<BoingUploadNative>("BoingUpload");

/**
 * Starts (or wakes) the Android foreground service that uploads every ready jump folder in `dir`
 * (see android/…/UploadService.kt). Does nothing where there is no native module (iOS, tests).
 */
export function startUploads(dir: string, server: string, phoneId: string, key: string): void {
  native?.start(dir, server, phoneId, key);
}

/** Stops the service and any upload in progress. */
export function stopUploads(): void {
  native?.stop();
}
