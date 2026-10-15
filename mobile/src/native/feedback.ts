import * as Haptics from "expo-haptics";
import * as Speech from "expo-speech";

/** Spoken height (centimetres, one decimal) and a short vibration. */
export function announce(heightM: number, sound: boolean): void {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  if (!sound) return;
  Speech.stop();
  Speech.speak((heightM * 100).toFixed(1), { language: "en-US" });
}

/** Spoken notice that a movement was seen but no height could be determined. */
export function announceFailure(sound: boolean): void {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  if (!sound) return;
  Speech.stop();
  Speech.speak("Couldn't determine the height", { language: "en-US" });
}
