import * as Brightness from "expo-brightness";
import { Platform } from "react-native";

/** The app's own brightness before blind mode turned it up (iOS keeps it until the phone locks). */
let before: number | null = null;

/**
 * Screen at full brightness (blind mode) or back to normal. Only this app's window: on Android it
 * overrides automatic brightness too, which a phone leaning against a wall would otherwise dim (its
 * light sensor is in the dark).
 */
export async function maxBrightness(on: boolean): Promise<void> {
  try {
    if (on) {
      if (Platform.OS === "ios" && before === null) before = await Brightness.getBrightnessAsync();
      await Brightness.setBrightnessAsync(1);
    } else if (Platform.OS === "android") {
      await Brightness.restoreSystemBrightnessAsync();
    } else if (before !== null) {
      await Brightness.setBrightnessAsync(before);
      before = null;
    }
  } catch {
    // Brightness is a help, not a must.
  }
}
