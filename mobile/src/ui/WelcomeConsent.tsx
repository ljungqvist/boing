import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { ABOUT_URL, CONTACT, WELCOME_INTRO, WELCOME_TITLE, consentText } from "../logic/consent";
import { C } from "./theme";
import { Sheet } from "./Sheets";

/**
 * Asks once at first start (and again when the consent text changes) whether jumps may be sent to the
 * developer. Closing it counts as "Not now". The full consent text is shown here, so agreeing is informed.
 */
export function WelcomeConsent({ phoneId, onAgree, onLater }: { phoneId: string; onAgree: () => void; onLater: () => void }) {
  return (
    <Sheet title={WELCOME_TITLE} onClose={onLater}>
      {WELCOME_INTRO.map((p, i) => (
        <Text key={i} style={s.intro}>{p}</Text>
      ))}
      <Text style={s.heading}>What you agree to</Text>
      {consentText(phoneId).map((p, i) => (
        <Text key={i} style={s.text}>{p}</Text>
      ))}
      <View style={s.choices}>
        <Pressable style={[s.button, s.secondary]} onPress={onLater} accessibilityRole="button">
          <Text style={s.secondaryText}>Not now</Text>
        </Pressable>
        <Pressable style={s.button} onPress={onAgree} accessibilityRole="button">
          <Text style={s.buttonText}>Yes, I'll help</Text>
        </Pressable>
      </View>
      <View style={s.links}>
        <Pressable onPress={() => void Linking.openURL(ABOUT_URL)}>
          <Text style={s.link}>About Boing (source code)</Text>
        </Pressable>
        <Pressable onPress={() => void Linking.openURL(`mailto:${CONTACT}`)}>
          <Text style={s.link}>Questions? {CONTACT}</Text>
        </Pressable>
      </View>
    </Sheet>
  );
}

const s = StyleSheet.create({
  intro: { color: C.text, fontSize: 15, lineHeight: 22, marginTop: 10 },
  heading: { color: C.text, fontWeight: "700", fontSize: 16, marginTop: 20 },
  text: { color: C.muted, fontSize: 13, lineHeight: 19, marginTop: 8 },
  choices: { flexDirection: "row", gap: 10, marginTop: 8 },
  button: { flex: 1, marginTop: 12, paddingVertical: 12, borderRadius: 12, backgroundColor: C.accent, alignItems: "center" },
  buttonText: { color: "#1f0d00", fontWeight: "700", fontSize: 15 },
  secondary: { backgroundColor: "transparent", borderWidth: 1, borderColor: C.muted },
  secondaryText: { color: C.text, fontWeight: "700", fontSize: 15 },
  links: { marginTop: 8, gap: 4 },
  link: { color: C.accent, fontSize: 13, paddingVertical: 6 },
});
