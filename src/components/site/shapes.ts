// viewBox 0 0 100 100. MorphSVG tweens between any two, including the multi-part binoculars.
export const SHELL = {
  // A stop square: the money is paused, not paid.
  hold: "M32 18H68A14 14 0 0 1 82 32V68A14 14 0 0 1 68 82H32A14 14 0 0 1 18 68V32A14 14 0 0 1 32 18Z",
  // Binoculars: two barrels, a bridge and two lenses.
  check:
    "M16 27A7 7 0 0 1 23 20H38A7 7 0 0 1 45 27V50H16ZM55 27A7 7 0 0 1 62 20H77A7 7 0 0 1 84 27V50H55ZM42 42H58V58H42ZM11 64A20 20 0 1 0 51 64A20 20 0 1 0 11 64ZM49 64A20 20 0 1 0 89 64A20 20 0 1 0 49 64Z",
  capture: "M14 54L29 39L43 53L72 24L87 39L43 83Z",
  void: "M25 13L50 38L75 13L87 25L62 50L87 75L75 87L50 62L25 87L13 75L38 50L13 25Z",
} as const;

export type Stage = keyof typeof SHELL;

export const STAGE_COLOR: Record<Stage, string> = {
  hold: "var(--color-accent)",
  check: "var(--color-ink)",
  capture: "var(--color-go)",
  void: "var(--color-ink-3)",
};
