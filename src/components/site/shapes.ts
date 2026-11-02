// viewBox 0 0 100 100. Each shell is one closed path so MorphSVG can tween between any two.
export const SHELL = {
  hold: "M82.77 27.06A40 40 0 1 0 82.77 72.94L71.30 64.91A26 26 0 1 1 71.30 35.09Z",
  check: "M89.95 47.91A40 40 0 1 0 89.95 52.09L75.96 51.36A26 26 0 1 1 75.96 48.64Z",
  capture: "M16 53L30 39L43 52L71 24L85 38L43 80Z",
  void: "M24 14L50 40L76 14L86 24L60 50L86 76L76 86L50 60L24 86L14 76L40 50L14 24Z",
} as const;

export type Stage = keyof typeof SHELL;
