import { darkTheme, lightTheme } from "@kleros/ui-components-library";

export type ThemeName = "dark" | "light";

// The app's tokens: the library theme (it wins where it has a token) plus the few the circuit and bulb need that the
// library lacks (stroke-strong, a third text tone, bulb and oracle strand colours).
function extend(base: typeof darkTheme, name: ThemeName) {
  const dark = name === "dark";
  return {
    ...base,
    // The library's light blues (#009AFF, hover #7BCBFF) fall below 4.5:1 against white in both button variants.
    ...(dark ? {} : { klerosUIComponentsPrimaryBlue: "#0077c8", klerosUIComponentsSecondaryBlue: "#005f9e" }),
    name,
    ground: base.klerosUIComponentsLightBackground,
    surface: base.klerosUIComponentsWhiteBackground,
    surface2: dark ? base.klerosUIComponentsLightBlue : base.klerosUIComponentsLightPurple,
    tint: base.klerosUIComponentsTintPurple,
    stroke: base.klerosUIComponentsStroke,
    strokeStrong: dark ? "#4b3a8f" : "#cfc4e6",
    text: base.klerosUIComponentsPrimaryText,
    text2: dark ? base.klerosUIComponentsSecondaryText : "#5c5c66",
    text3: dark ? "#9aa6cf" : "#6a6a74",
    purple: base.klerosUIComponentsPrimaryPurple,
    purple2: base.klerosUIComponentsSecondaryPurple,
    blue: dark ? base.klerosUIComponentsPrimaryBlue : "#0077c8",
    ok: dark ? base.klerosUIComponentsSuccess : "#007a1b",
    okBg: base.klerosUIComponentsSuccessLight,
    warn: dark ? base.klerosUIComponentsWarning : "#8f5500",
    warnBg: base.klerosUIComponentsWarningLight,
    err: dark ? base.klerosUIComponentsError : "#d40a2e",
    errBg: dark ? base.klerosUIComponentsErrorLight : "#fef0f3",
    onAccent: "#ffffff",
    bulbGlass: dark ? "#2d1865" : "#f4f0fa",
    bulbOn: dark ? "#ffd36b" : "#ffc233",
    bulbHalo: dark ? "rgba(255, 211, 107, 0.28)" : "rgba(255, 176, 0, 0.25)",
    bulbFilamentOn: "#8a5a00",
    wireIdle: dark ? "#4b3a8f" : "#d9cfee",
    shadow: dark ? "0 6px 24px rgba(8, 0, 30, 0.45)" : "0 6px 24px rgba(34, 0, 80, 0.08)",
    backdrop: dark ? "rgba(8, 0, 30, 0.6)" : "rgba(34, 0, 80, 0.25)",
    // Oracle strands by oracle id (Vea, CCIP, LayerZero, deBridge), checked for colour-vision contrast on the surface.
    oracles: dark ? ["#b266f0", "#2e94e0", "#d6702a", "#17a386"] : ["#8a3fd9", "#1f7fd0", "#c25f1e", "#0e8a6e"],
  };
}

export const themes = { dark: extend(darkTheme, "dark"), light: extend(lightTheme, "light") };
export type AppTheme = (typeof themes)["dark"];

export const oracleColor = (id: number) => `var(--o-${id % 4})`;

/** The theme as CSS custom properties, so the custom SVG (circuit, bulb) is coloured from the same tokens. */
export function cssVars(t: AppTheme): string {
  const v: Record<string, string> = {
    ground: t.ground,
    surface: t.surface,
    "surface-2": t.surface2,
    tint: t.tint,
    stroke: t.stroke,
    "stroke-strong": t.strokeStrong,
    text: t.text,
    "text-2": t.text2,
    "text-3": t.text3,
    purple: t.purple,
    "purple-2": t.purple2,
    blue: t.blue,
    ok: t.ok,
    "ok-bg": t.okBg,
    warn: t.warn,
    "warn-bg": t.warnBg,
    err: t.err,
    "err-bg": t.errBg,
    "on-accent": t.onAccent,
    "bulb-glass": t.bulbGlass,
    "bulb-on": t.bulbOn,
    "bulb-halo": t.bulbHalo,
    "bulb-filament-on": t.bulbFilamentOn,
    "wire-idle": t.wireIdle,
    shadow: t.shadow,
    backdrop: t.backdrop,
  };
  t.oracles.forEach((c, i) => (v[`o-${i}`] = c));
  return Object.entries(v)
    .map(([k, val]) => `--${k}: ${val};`)
    .join(" ");
}
