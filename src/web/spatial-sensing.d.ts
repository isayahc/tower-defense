export interface SpatialSensor {
  id: string;
  range: number;
  duration_ms: number;
  power_w: number;
  kit: string | null;
  establishes: string;
}

export interface SpatialObservation {
  id: string;
  target_id: string;
  target_revision: number;
  sensor: string;
  sensor_version: string;
  position: { x: number; y: number };
  timestamp_ms: number;
  range: number;
  quality: string;
  confidence_bps: number;
  candidate_classes: string[];
  cues: string[];
  next_actions: string[];
  uncertainty_meaning: string;
}

export interface SpatialRobot {
  id: string;
  sensors: string[];
  retired?: boolean;
  position: { x: number; y: number };
}

export interface SpatialDeposit {
  id: string;
  position: { x: number; y: number };
  revision: number;
  depleted: boolean;
}

export interface SpatialSnapshot {
  match_id: string;
  revision: number;
  status: string;
  world: { deposits: SpatialDeposit[] };
  field: {
    sensor_catalog: SpatialSensor[];
    observations: SpatialObservation[];
    robots: SpatialRobot[];
    jobs: Array<{ id: string; robot_id: string; state: string }>;
  };
  science: {
    components: Array<{
      id: string;
      kind: string;
      quantity: number;
      tested: boolean;
      condition: string;
    }>;
  };
}

export interface CoverageRecord extends SpatialObservation {
  sensor_range: number;
}

export interface TargetSummary {
  title: string;
  detail: string;
  current: boolean;
}

export function latestObservation(
  snapshot: SpatialSnapshot | undefined,
  targetId: string,
): SpatialObservation | undefined;
export function sensorReady(
  snapshot: SpatialSnapshot,
  robot: SpatialRobot,
  sensor: SpatialSensor,
): boolean;
export function coverageRecords(snapshot: SpatialSnapshot): CoverageRecord[];
export function targetSummary(snapshot: SpatialSnapshot, deposit: SpatialDeposit): TargetSummary;
export function installSpatialSensing(
  request: (path: string, options?: Record<string, unknown>) => Promise<unknown>,
): void;
