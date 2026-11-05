/**
 * Orrery layout for the entity-swarm header.
 *
 * Distances are AU-like and periods follow a compressed Kepler curve so inner
 * planets lap the outer ones. Positions are percent of the header box so the
 * canvas and the bot sprites share one coordinate system.
 *
 * Screen Y grows downward. Increasing theta moves counter-clockwise: the
 * positive-Y math axis is flipped so the disk matches a north-pole view.
 */

export interface OrbitSpec {
  id: string;
  au: number;
  /** Seconds per revolution. */
  period: number;
  phase: number;
}

export interface OrbitPoint {
  /** Percent of the header width. */
  x: number;
  /** Percent of the header height. */
  y: number;
  /** Far (top) is negative, near (bottom) is positive. */
  depth: number;
  angle: number;
}

export const BASE_FLATTEN = 0.33;

/** Phone-sized header the layout is tuned for (CSS pixels, inside the panel). */
export const REFERENCE_BOX = { width: 366, height: 268 };

export const STILL_TIME = 7.4;

export const PLANETS: OrbitSpec[] = [
  { id: 'mercury', au: 0.22, period: 8, phase: 0.55 },
  { id: 'venus', au: 0.34, period: 14.8, phase: 2.15 },
  { id: 'earth', au: 0.47, period: 23.2, phase: 3.55 },
  { id: 'mars', au: 0.6, period: 32.4, phase: 5.05 },
  { id: 'jupiter', au: 0.8, period: 48.6, phase: 1.15 },
  { id: 'saturn', au: 1.02, period: 68.5, phase: 4.15 },
  { id: 'uranus', au: 1.22, period: 88, phase: 2.45 },
  { id: 'neptune', au: 1.42, period: 108, phase: 0.35 },
];

/**
 * Bot sprites sit in the gaps between planets, phased so the still frame
 * doesn't stack them on a body. Outer bots stay inside a phone-width frame.
 */
export const BOT_ORBITS: OrbitSpec[] = [
  { id: 'scout', au: 0.28, period: 18, phase: 0.35 },
  { id: 'sniper', au: 0.4, period: 24, phase: 2.45 },
  { id: 'pulse', au: 0.53, period: 29, phase: 4.35 },
  { id: 'ledger', au: 0.69, period: 36, phase: 1.05 },
  { id: 'shield', au: 0.86, period: 44, phase: 3.55 },
  { id: 'liquid98', au: 0.63, period: 33, phase: 5.55 },
  { id: 'chief', au: 0.5, period: 27, phase: 0.15 },
];

const BOT_ORBIT_BY_ID = new Map(BOT_ORBITS.map((orbit) => [orbit.id, orbit]));

export function botOrbit(id: string): OrbitSpec | undefined {
  return BOT_ORBIT_BY_ID.get(id);
}

export interface Stage {
  /** CSS pixels per AU. */
  scale: number;
  cx: number;
  cy: number;
  flatten: number;
}

export function stageFor(boxW: number, boxH: number, tilt = 0): Stage {
  const tiltClamped = Math.max(-1, Math.min(1, tilt));
  const flatten = BASE_FLATTEN + tiltClamped * 0.045;
  const maxAu = 1.48;
  // Fill a phone width so Jupiter and Saturn read clearly. Outer planets may
  // swing past the side edges; the vertical cap keeps the disk in frame.
  const scale = Math.min((boxW * 0.58) / 1.02, (boxH * 0.44) / (maxAu * flatten));
  return {
    scale,
    cx: boxW * 0.5,
    cy: boxH * 0.5,
    flatten,
  };
}

export function orbitTheta(spec: OrbitSpec, timeSec: number): number {
  return spec.phase + (timeSec / spec.period) * Math.PI * 2;
}

export function projectAu(au: number, theta: number, boxW: number, boxH: number, tilt = 0): OrbitPoint {
  if (boxW < 1 || boxH < 1) {
    return { x: 50, y: 50, depth: 0, angle: theta };
  }
  const stage = stageFor(boxW, boxH, tilt);
  const x = stage.cx + Math.cos(theta) * au * stage.scale;
  const y = stage.cy - Math.sin(theta) * au * stage.scale * stage.flatten;
  return {
    x: (x / boxW) * 100,
    y: (y / boxH) * 100,
    depth: -Math.sin(theta),
    angle: theta,
  };
}

export function projectBody(spec: OrbitSpec, timeSec: number, boxW: number, boxH: number, tilt = 0): OrbitPoint {
  return projectAu(spec.au, orbitTheta(spec, timeSec), boxW, boxH, tilt);
}

/** Bound comet: perihelion near the sun, aphelion around Saturn's neighborhood. */
export function cometState(timeSec: number, boxW: number, boxH: number, tilt = 0): OrbitPoint & { au: number } {
  const theta = timeSec * 0.48 + 1.15;
  const eccentricity = 0.8;
  const semiMajor = 0.58;
  const au = (semiMajor * (1 - eccentricity * eccentricity)) / (1 + eccentricity * Math.cos(theta));
  return { ...projectAu(au, theta, boxW, boxH, tilt), au };
}

export function earthMoonAngle(timeSec: number): number {
  return timeSec * 2.15 + 0.7;
}

export function jupiterMoonAngles(timeSec: number): number[] {
  return [timeSec * 1.7 + 0.2, timeSec * 1.15 + 1.4, timeSec * 0.82 + 2.5, timeSec * 0.55 + 4.1];
}
