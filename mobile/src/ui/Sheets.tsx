import type { ReactNode } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { toSignals } from "../../../src/analysis/signals";
import { cm, NOTE_TEXT } from "../logic/measure";
import type { Measured } from "../logic/video";
import { Icon } from "./Icon";
import { JumpPlot } from "./JumpPlot";
import { C } from "./theme";

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} />
      <View style={[s.sheet, { paddingBottom: insets.bottom + 12 }]}>
        <View style={s.header}>
          <Text style={s.title}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close">
            <Icon name="close" />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={s.body}>{children}</ScrollView>
      </View>
    </Modal>
  );
}

export function JumpDetails({ m, index, count, onClose }: { m: Measured; index: number; count: number; onClose: () => void }) {
  const j = m.jump;
  const notes = j.flags.map((f) => NOTE_TEXT[f]).filter((n): n is string => !!n);
  if (m.approximate) notes.push("Measured from fewer frames (live analysis only); the result may be less accurate.");
  const frames = m.refined && m.framesFirst !== undefined ? `${j.airborneFrames} (first pass: ${m.framesFirst})` : `${j.airborneFrames}`;
  const signals = toSignals({ ...m.size, fps: m.fps, frames: m.frames });
  return (
    <Sheet title={`Jump ${index + 1} of ${count}`} onClose={onClose}>
      <Text style={s.big}>
        {m.approximate ? "≈" : ""}
        {cm(j.hPrimary)}
        <Text style={s.unit}> cm</Text>
      </Text>
      <Row label="Flight-time height" value={`${cm(j.hFlight)} cm`} />
      <Row label="Time in the air" value={`${((j.tOn - j.tOff) * 1000).toFixed(0)} ms`} />
      <Row label="Frame rate" value={`${m.fps.toFixed(0)} fps`} />
      <Row label="Frames in the air" value={frames} />
      {notes.map((n) => (
        <Text key={n} style={s.note}>{n}</Text>
      ))}
      <View style={{ marginTop: 12 }}>
        <JumpPlot signals={signals} jump={j} />
      </View>
      <View style={s.legend}>
        <Text style={[s.legendItem, { color: C.hip }]}>■ Hips</Text>
        <Text style={[s.legendItem, { color: C.toe }]}>■ Toes</Text>
        <Text style={s.legendItem}>dashed: takeoff · top · landing</Text>
      </View>
    </Sheet>
  );
}

export function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    backgroundColor: C.surfaceSolid, borderTopLeftRadius: 16, borderTopRightRadius: 16,
    borderColor: C.line, borderWidth: 1, maxHeight: "80%",
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, paddingBottom: 8 },
  title: { color: C.text, fontSize: 18, fontWeight: "600" },
  body: { paddingHorizontal: 16, paddingBottom: 16 },
  big: { color: C.text, fontSize: 52, fontWeight: "800", fontVariant: ["tabular-nums"], marginBottom: 8 },
  unit: { fontSize: 18, fontWeight: "500", color: C.muted },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomColor: C.line, borderBottomWidth: StyleSheet.hairlineWidth },
  rowLabel: { color: C.muted, fontSize: 15 },
  rowValue: { color: C.text, fontSize: 15, fontVariant: ["tabular-nums"] },
  note: { color: C.warn, fontSize: 14, marginTop: 10 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 6 },
  legendItem: { color: C.muted, fontSize: 12 },
});
