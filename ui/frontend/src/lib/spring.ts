// Estimated spring resistance from wrist angle. PLACEHOLDER values until bench calibration:
// replace TORQUE_AT_60 with measured numbers per notch (hang weights, sweep the angle).
// Model: linear torsional spring, tau = k * |angle|, same in both directions.
// If the exo only resists one direction, or uses linear springs on a lever, change torqueAt().

/** Torque (N·m) each spring setting gives at 60 degrees from neutral. */
export const TORQUE_AT_60: Record<number, number> = { 1: 0.75, 2: 1.1, 3: 1.5 };

export const REFERENCE_DEG = 60;

export function maxTorque(setting: number): number {
  return TORQUE_AT_60[setting] ?? TORQUE_AT_60[1];
}

/** Estimated resisting torque (N·m, >= 0) at this angle and setting. NaN if angle unknown. */
export function torqueAt(angleDeg: number, setting: number): number {
  if (!Number.isFinite(angleDeg)) return NaN;
  return (maxTorque(setting) / REFERENCE_DEG) * Math.abs(angleDeg);
}
