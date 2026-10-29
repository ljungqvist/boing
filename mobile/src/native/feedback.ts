import * as Speech from "expo-speech";

/** Longest wait for the speech engine to report the end of an announcement. */
const MAX_SPEECH_MS = 6000;

/**
 * Spoken height (centimetres, one decimal). No vibration: the phone stands on its own while measuring.
 * Resolves when it has been said (at once without sound).
 */
export function announce(heightM: number, sound: boolean): Promise<void> {
  return say((heightM * 100).toFixed(1), sound);
}

/** Spoken notice that a movement was seen but no height could be determined. */
export function announceFailure(sound: boolean): Promise<void> {
  return say("Couldn't determine the height", sound);
}

function say(text: string, sound: boolean): Promise<void> {
  if (!sound) return Promise.resolve();
  return new Promise((done) => {
    // Never wait forever if the speech engine doesn't report back.
    const timer = setTimeout(done, MAX_SPEECH_MS);
    const end = () => {
      clearTimeout(timer);
      done();
    };
    Speech.stop();
    Speech.speak(text, { language: "en-US", onDone: end, onStopped: end, onError: end });
  });
}
