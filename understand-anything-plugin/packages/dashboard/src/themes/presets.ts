import type { AccentSwatch, ThemePreset } from "./types.ts";

const DARK_ACCENT_SWATCHES: AccentSwatch[] = [
  { id: "cyan", name: "Neon Cyan", accent: "#00f5ff", accentDim: "#00b0ff", accentBright: "#39f3bb" },
  { id: "purple", name: "Electric Purple", accent: "#a855f7", accentDim: "#7000ff", accentBright: "#c084fc" },
];

export const PRESETS: ThemePreset[] = [
  {
    id: "dark-techy",
    name: "SystemaOps Console (Dark)",
    isDark: true,
    defaultAccentId: "cyan",
    accentSwatches: DARK_ACCENT_SWATCHES,
    colors: {
      root: "#0a0a0f",
      surface: "#0f172a",
      elevated: "#1e293b",
      panel: "#0f172a",
      "text-primary": "#ffffff",
      "text-secondary": "#e2e8f0",
      "text-muted": "#94a3b8",
      "node-file": "#00f5ff",
      "node-function": "#38bdf8",
      "node-class": "#a855f7",
      "node-module": "#f43f5e",
      "node-concept": "#ec4899",
      "node-config": "#06b6d4",
      "node-document": "#7dd3fc",
      "node-service": "#a855f7",
      "node-table": "#10b981",
      "node-endpoint": "#f97316",
      "node-pipeline": "#f43f5e",
      "node-schema": "#eab308",
      "node-resource": "#6366f1",
    },
  }
];

export function getPreset(id: string): ThemePreset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0];
}

export function getAccent(preset: ThemePreset, accentId: string): AccentSwatch {
  return (
    preset.accentSwatches.find((s) => s.id === accentId) ??
    preset.accentSwatches.find((s) => s.id === preset.defaultAccentId) ??
    preset.accentSwatches[0]
  );
}
