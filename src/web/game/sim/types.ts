import type { AgentSnapshot } from '../../../shared/protocol.ts';
import type { AvatarPose } from '../gfx/avatar-art.ts';
import type { Dir, Rect, Tile } from '../layout/types.ts';
import type { Persona } from './persona.ts';

/** A project's area on the floor. */
export interface Team {
  id: string;
  name: string;
  /** Teams keep their place on the floor in the order they first showed up. */
  order: number;
  /** The size step currently built. */
  tier: number;
  emptyFor: number;
  shrinkFor: number;
  deskOwner: Map<number, string>;
}

/**
 * A floor rebuild in progress: people leave the affected areas, the plan is swapped, and the
 * affected areas build up again while everyone else keeps working.
 */
export interface Renovation {
  phase: 'evacuating' | 'building';
  time: number;
  /** Zone ids that change (moved, resized, added or removed). */
  zones: Set<string>;
  /** Old and new footprints of those zones: nobody may stand there during the swap. */
  rects: Rect[];
  grew: Set<string>;
  shrank: Set<string>;
}

export type Stage = 'hidden' | 'entering' | 'present' | 'exiting' | 'gone';

export type GoalKind = 'desk' | 'commons' | 'visit' | 'meeting' | 'exit';

export interface Destination {
  goal: GoalKind;
  tile: Tile;
  facing: Dir;
  pose: AvatarPose;
  /** The person being visited or met, if any. */
  partner: string | null;
}

export interface Bubble {
  text: string;
  age: number;
}

export type ScriptKind = 'brief' | 'report' | 'checkIn';

export interface Script {
  kind: ScriptKind;
  partner: string;
  step: number;
  timer: number;
}

/** Why someone is in the shared spaces, which shapes where they go and what they talk about. */
export type BreakReason = 'break' | 'coffee' | 'renovation';

export interface CommonsVisit {
  reason: BreakReason;
  phase: 'coffee' | 'hangout';
  until: number;
}

export interface Person {
  id: string;
  persona: Persona;
  name: string;
  agent: AgentSnapshot;
  home: string;
  x: number;
  y: number;
  dir: Dir;
  path: Tile[];
  hurry: boolean;
  stage: Stage;
  stageTime: number;
  alpha: number;
  dest: Destination | null;
  goalKey: string;
  goalSince: number;
  arrivedAt: number | null;
  walkTime: number;
  bubbles: Bubble[];
  departing: boolean;
  briefed: boolean;
  reported: boolean;
  script: Script | null;
  visit: CommonsVisit | null;
  lookAt: { id: string; until: number } | null;
  nextChatAt: number;
  nextCheckInAt: number;
  sipUntil: number;
  brainTimer: number;
  lastActivity: string;
  spawnedAt: number;
  /** Ever walked in or was placed on screen, so leaving is worth a log line. */
  shown: boolean;
}

export type LogKind = 'joined' | 'left' | 'growing' | 'shrinking' | 'opened' | 'closed';

export interface LogEntry {
  id: number;
  kind: LogKind;
  at: number;
  params: Record<string, string>;
}
