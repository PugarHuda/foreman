/**
 * Bearing health: telemetry replay + remaining-useful-life trending.
 *
 * Vibration severity bands are ISO 10816-3, Class II (medium machines,
 * 15-75 kW, rigid mount), expressed as RMS velocity in mm/s:
 *   Zone A <= 2.8   newly commissioned
 *   Zone B <= 4.5   unrestricted long-term operation
 *   Zone C <= 7.1   restricted operation, plan the repair
 *   Zone D  > 7.1   damage occurring, stop the machine
 *
 * RUL is trended the way condition-monitoring actually does it: bearing decay
 * is exponential once a fault initiates, so fit a line to log(RMS) and
 * extrapolate to the Zone C/D boundary.
 */

export const ISO_10816_CLASS_II = {
  zoneAB: 2.8,
  zoneBC: 4.5,
  zoneCD: 7.1,
} as const;

export type Zone = "A" | "B" | "C" | "D";

export interface Sample {
  hours: number;
  rms: number; // mm/s RMS velocity
}

export function zoneOf(rms: number): Zone {
  if (rms <= ISO_10816_CLASS_II.zoneAB) return "A";
  if (rms <= ISO_10816_CLASS_II.zoneBC) return "B";
  if (rms <= ISO_10816_CLASS_II.zoneCD) return "C";
  return "D";
}

/** Deterministic PRNG so a recorded demo replays identically. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SimOptions {
  hours?: number;
  stepMinutes?: number;
  baseline?: number; // healthy RMS, mm/s
  onsetHours?: number; // when the fault initiates
  growthPerHour?: number; // exponential decay rate after onset
  noise?: number; // relative measurement noise
  seed?: number;
}

/**
 * Replay a run-to-failure bearing signature. Synthetic, but the shape
 * (flat baseline, then exponential growth after fault onset) and the
 * severity bands are the real ones — swap in a CSV of {hours, rms} from
 * a plant historian and every downstream step is unchanged.
 */
export function simulateBearing(opts: SimOptions = {}): Sample[] {
  const {
    hours = 400,
    stepMinutes = 30,
    baseline = 1.6,
    onsetHours = 220,
    growthPerHour = 0.011,
    noise = 0.05,
    seed = 42,
  } = opts;

  const rand = mulberry32(seed);
  const step = stepMinutes / 60;
  const out: Sample[] = [];

  for (let h = 0; h <= hours; h += step) {
    const decay = Math.exp(growthPerHour * Math.max(0, h - onsetHours));
    const jitter = 1 + (rand() * 2 - 1) * noise;
    out.push({ hours: Number(h.toFixed(2)), rms: Number((baseline * decay * jitter).toFixed(4)) });
  }
  return out;
}

export interface Health {
  currentRms: number;
  zone: Zone;
  /** Hours until the signal is projected to cross Zone D. null = no clear trend. */
  rulHours: number | null;
  growthPerHour: number;
  r2: number;
}

export interface RulOptions {
  /** Samples to fit over. Too short is noise, too long dilutes a fresh fault. */
  windowSize?: number;
  /** Minimum fit quality before we are willing to act on the trend. */
  minR2?: number;
}

/**
 * Log-linear trend on the recent window, extrapolated to the Zone D boundary.
 * Returns rulHours = null when the machine is not measurably degrading, so
 * callers cannot mistake "healthy" for "fails immediately".
 */
export function estimateRUL(samples: Sample[], opts: RulOptions = {}): Health {
  const { windowSize = 96, minR2 = 0.7 } = opts;

  if (samples.length === 0) throw new Error("estimateRUL needs at least one sample");

  const last = samples[samples.length - 1];
  const win = samples.slice(-windowSize).filter((s) => s.rms > 0);
  const base: Health = {
    currentRms: last.rms,
    zone: zoneOf(last.rms),
    rulHours: null,
    growthPerHour: 0,
    r2: 0,
  };
  if (win.length < 8) return base;

  // Least squares on (hours, log rms).
  const n = win.length;
  const xs = win.map((s) => s.hours);
  const ys = win.map((s) => Math.log(s.rms));
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;

  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return base;

  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = (sxy * sxy) / (sxx * syy);

  base.growthPerHour = slope;
  base.r2 = r2;

  // Not degrading, or the fit is too poor to bet money on.
  if (slope <= 0 || r2 < minR2) return base;

  const crossAt = (Math.log(ISO_10816_CLASS_II.zoneCD) - intercept) / slope;
  const rul = crossAt - last.hours;
  base.rulHours = rul <= 0 ? 0 : Number(rul.toFixed(1));
  return base;
}
