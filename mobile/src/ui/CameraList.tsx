import { StyleSheet, Text, View } from "react-native";
import { useCameraDevices } from "react-native-vision-camera";
import { describeCamera } from "../logic/camera";
import { C } from "./theme";

/** Every camera the phone offers, with lenses, flash, frame rates and sizes (to compare them). */
export function CameraList({ inUse }: { inUse?: string }) {
  const devices = useCameraDevices();
  if (devices.length === 0) return <Text style={s.line}>No cameras found.</Text>;
  const order = (p: string) => (p === "back" ? 0 : p === "front" ? 1 : 2);
  const sorted = [...devices].sort((a, b) => order(a.position) - order(b.position) || a.id.localeCompare(b.id, undefined, { numeric: true }));
  return (
    <View style={s.list}>
      {sorted.map((d) => {
        const c = describeCamera(d, d.id === inUse);
        return (
          <View key={`${d.position}-${d.id}`} style={s.card}>
            <Text style={[s.title, d.id === inUse && s.inUse]}>{c.title}</Text>
            {c.lines.map((l, i) => <Text key={i} style={s.line}>{l}</Text>)}
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  list: { gap: 8, marginTop: 4 },
  card: { borderColor: C.line, borderWidth: 1, borderRadius: 12, padding: 10, gap: 2 },
  title: { color: C.text, fontSize: 14, fontWeight: "700" },
  inUse: { color: C.accent },
  line: { color: C.muted, fontSize: 13 },
});
