/*
 * Geometry of the Backup page's topology: where drive nodes sit, the curves of
 * the pipes between them, and how many "energy" particles a transfer sends. Isomorphic and pure,
 * so it is unit tested without a browser.
 */
import type { BackupMode, BackupPhase } from "@/lib/api-types";

export interface Point {
  x: number;
  y: number;
}

/** The stage's SVG coordinate space; the SVG scales it to fit. */
export const STAGE_WIDTH = 1000;
export const STAGE_HEIGHT = 560;
/** A little above the middle: drive labels hang below their nodes. */
export const MACHINE_CENTER: Point = { x: STAGE_WIDTH / 2, y: STAGE_HEIGHT / 2 - 5 };

/** Drives sit on an ellipse around the machine. */
const ORBIT_RADIUS_X = 400;
const ORBIT_RADIUS_Y = 180;

/** At most this many particles are on screen per pipe. */
export const MAX_PARTICLES = 60;
/** Seconds a particle takes from source to destination. */
export const PARTICLE_TRAVEL_SECONDS = 1.6;

/** Particle and glow colours by mode; verification is green whatever the mode. */
export const MODE_COLORS: Record<BackupMode | "verify", string> = {
  copy: "#22d3ee",
  mirror: "#f59e0b",
  snapshot: "#a78bfa",
  verify: "#22c55e",
};

/** A stable number in [0, 1) for a string (FNV-1a), so a drive keeps its place across plug-ins. */
export function hashToUnit(value: string): number {
  let hash = 0x81_1c_9d_c5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01_00_01_93) >>> 0;
  }
  return hash / 2 ** 32;
}

function toPoint(angleDegrees: number): Point {
  const radians = (angleDegrees * Math.PI) / 180;
  return {
    x: Math.round((MACHINE_CENTER.x + ORBIT_RADIUS_X * Math.cos(radians)) * 10) / 10,
    y: Math.round((MACHINE_CENTER.y + ORBIT_RADIUS_Y * Math.sin(radians)) * 10) / 10,
  };
}

/**
 * Places drive nodes on the orbit around the machine. Each drive's angle comes from its id, so it
 * reappears in the same place when plugged in again; drives that would overlap are pushed apart
 * just enough (at least 360° / 12, or less when there are more drives).
 *
 * @example
 * placeDriveNodes(["ext-4E1D", "ext-USB2"]).get("ext-4E1D"); // { x: 812.4, y: 371.1, angle: 15.3 }
 */
export function placeDriveNodes(driveIds: readonly string[]): Map<string, Point & { angle: number }> {
  const minimumGap = Math.min(30, 360 / Math.max(driveIds.length, 1));
  const preferred = driveIds
    .map((driveId) => ({ driveId, angle: hashToUnit(driveId) * 360 }))
    .toSorted((first, second) => first.angle - second.angle || first.driveId.localeCompare(second.driveId));
  for (let index = 1; index < preferred.length; index += 1) {
    const previous = preferred[index - 1];
    const current = preferred[index];
    if (previous && current && current.angle - previous.angle < minimumGap) current.angle = previous.angle + minimumGap;
  }
  const placed = new Map<string, Point & { angle: number }>();
  for (const { driveId, angle } of preferred) placed.set(driveId, { ...toPoint(angle % 360), angle: angle % 360 });
  return placed;
}

/** Where a node flies in from: the stage edge in the direction of its place. */
export function readEntryPoint(target: Point): Point {
  const deltaX = target.x - MACHINE_CENTER.x;
  const deltaY = target.y - MACHINE_CENTER.y;
  const scale = 1.9;
  return { x: MACHINE_CENTER.x + deltaX * scale, y: MACHINE_CENTER.y + deltaY * scale };
}

/** A pipe: a quadratic Bézier from `from` to `to` through `control`. */
export interface Pipe {
  from: Point;
  control: Point;
  to: Point;
  pathData: string;
}

/**
 * A curved pipe from `from` to `to`: a quadratic Bézier whose control point is pushed sideways
 * by `bend` (a share of the distance). Pipes between two drives bend away from the machine, so
 * they don't cross it.
 *
 * @example
 * buildPipe({ x: 500, y: 290 }, { x: 860, y: 290 }, 0.18).pathData; // "M 500 290 Q 680 354.8 860 290"
 */
export function buildPipe(from: Point, to: Point, bend: number, awayFrom?: Point): Pipe {
  const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  let normal = { x: -deltaY, y: deltaX };
  if (awayFrom) {
    const outward = { x: middle.x - awayFrom.x, y: middle.y - awayFrom.y };
    if (normal.x * outward.x + normal.y * outward.y < 0) normal = { x: deltaY, y: -deltaX };
  }
  const control = {
    x: Math.round((middle.x + normal.x * bend) * 10) / 10,
    y: Math.round((middle.y + normal.y * bend) * 10) / 10,
  };
  return { from, control, to, pathData: `M ${from.x} ${from.y} Q ${control.x} ${control.y} ${to.x} ${to.y}` };
}

/** The SVG path data of `buildPipe`. */
export function buildPipePath(from: Point, to: Point, bend: number, awayFrom?: Point): string {
  return buildPipe(from, to, bend, awayFrom).pathData;
}

/**
 * The point `share` of the way along a pipe (0 at its start, 1 at its end).
 *
 * @example
 * readPipePoint(pipe, 0.5);
 */
export function readPipePoint({ from, control, to }: Pipe, share: number): Point {
  const rest = 1 - share;
  return {
    x: rest * rest * from.x + 2 * rest * share * control.x + share * share * to.x,
    y: rest * rest * from.y + 2 * rest * share * control.y + share * share * to.y,
  };
}

/**
 * Particles per second for a transfer speed: grows with log(speed), so a fast SSD looks busier
 * than a slow stick without flooding the screen. Capped so at most `MAX_PARTICLES` are in flight.
 *
 * @example
 * readParticleRate(50 * 1024 * 1024); // about 16.5 per second
 */
export function readParticleRate(speedBytesPerSecond: number | undefined): number {
  const speed = Math.max(0, speedBytesPerSecond ?? 0);
  const rate = 3 + 1.4 * Math.log2(1 + speed / 1024 / 64);
  return Math.min(rate, MAX_PARTICLES / PARTICLE_TRAVEL_SECONDS);
}

/** The colour of a transfer's particles: green while verifying, else by mode. */
export function readFlowColor(mode: BackupMode, phase: BackupPhase | undefined): string {
  return phase === "verifying" ? MODE_COLORS.verify : MODE_COLORS[mode];
}
