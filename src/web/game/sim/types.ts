import type { AgentSnapshot } from '../../../shared/protocol.ts';
import type { AvatarPose } from '../gfx/avatar-art.ts';
import type { RoomTheme } from '../gfx/palette.ts';
import type { Dir, RoomLayout, Tile } from '../layout/types.ts';
import type { Persona } from './persona.ts';

export const LOUNGE_ID = '__lounge__';

export type RoomPhase = 'opening' | 'open' | 'evacuating' | 'building' | 'closing';

export interface WorldRoom {
  id: string;
  name: string;
  kind: 'work' | 'lounge';
  theme: RoomTheme;
  layout: RoomLayout;
  phase: RoomPhase;
  phaseTime: number;
  pendingTier: number | null;
  /** Native-pixel position of the room's back floor corner; eases toward `target`. */
  origin: { x: number; y: number };
  target: { x: number; y: number };
  order: number;
  emptyFor: number;
  shrinkFor: number;
  deskOwner: Map<number, string>;
}

export type Stage = 'hidden' | 'entering' | 'present' | 'exiting' | 'transit' | 'gone';

export type GoalKind = 'desk' | 'lounge' | 'visit' | 'exit';

export interface Destination {
  goal: GoalKind;
  room: string;
  tile: Tile;
  facing: Dir;
  pose: AvatarPose;
  /** The person being visited, if any. */
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

export type LoungeReason = 'break' | 'coffee' | 'renovation';

export interface LoungeVisit {
  reason: LoungeReason;
  phase: 'coffee' | 'hangout';
  until: number;
}

export interface Person {
  id: string;
  persona: Persona;
  name: string;
  agent: AgentSnapshot;
  home: string;
  room: string | null;
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
  lounge: LoungeVisit | null;
  lookAt: { id: string; until: number } | null;
  nextChatAt: number;
  nextCheckInAt: number;
  sipUntil: number;
  brainTimer: number;
  lastActivity: string;
}

export type LogKind = 'joined' | 'left' | 'growing' | 'shrinking' | 'opened' | 'closed';

export interface LogEntry {
  id: number;
  kind: LogKind;
  at: number;
  params: Record<string, string>;
}
