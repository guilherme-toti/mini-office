import type { AgentSnapshot, OfficeSnapshot } from '../../../shared/protocol.ts';
import { between, createRandom, pick } from '../../../shared/random.ts';
import type { Messages } from '../../i18n/index.ts';
import { format } from '../../i18n/index.ts';
import type { AvatarPose } from '../gfx/avatar-art.ts';
import { buildFloor, COMMONS_W, teamTierFor, type TeamRequest } from '../layout/floor-plan.ts';
import { findPath } from '../layout/pathfinding.ts';
import {
  inRect,
  isWalkable,
  lookDir,
  sameRect,
  sameTile,
  stepDir,
  type Desk,
  type FloorPlan,
  type Spot,
  type SpotKind,
  type Tile,
  type Zone,
} from '../layout/types.ts';
import { createPersona, distinctName } from './persona.ts';
import { TUNING } from './tuning.ts';
import type {
  BreakReason,
  Destination,
  GoalKind,
  LogEntry,
  LogKind,
  Person,
  Renovation,
  ScriptKind,
  Team,
} from './types.ts';

type Lines = readonly string[];

interface Goal {
  kind: GoalKind;
  partner: string | null;
  script: ScriptKind | null;
  reason: BreakReason | null;
}

const DOOR_STEP = 0.6;
const MAX_BUBBLES = 3;
const TASK_MAX = 42;

const KITCHEN_SPOTS: readonly SpotKind[] = ['coffee', 'cooler', 'vending'];
type Hangout = 'games' | 'terrace' | 'lounge';
const HANGOUT_SPOTS: Record<Hangout, readonly SpotKind[]> = {
  games: ['arcade', 'tv', 'pingpong'],
  terrace: ['parasol', 'bench'],
  lounge: ['sofa'],
};
/** Where people drift to, by why they are on a break. Idle agents mostly go play. */
const HANGOUT_WEIGHTS: Record<BreakReason, readonly (readonly [Hangout, number])[]> = {
  break: [
    ['games', 0.5],
    ['terrace', 0.3],
    ['lounge', 0.2],
  ],
  coffee: [
    ['terrace', 0.4],
    ['lounge', 0.4],
    ['games', 0.2],
  ],
  renovation: [
    ['lounge', 0.4],
    ['terrace', 0.4],
    ['games', 0.2],
  ],
};
const SPOT_POSE: Record<SpotKind, AvatarPose> = {
  coffee: 'drink',
  cooler: 'drink',
  vending: 'stand',
  arcade: 'play',
  pingpong: 'play',
  tv: 'type',
  sofa: 'sit',
  meeting: 'sit',
  parasol: 'sit',
  bench: 'sit',
};

export interface WorldOptions {
  say: Messages['say'];
  seed?: number;
}

/**
 * The office simulation: it reconciles snapshots from the server with the people on screen and
 * moves everyone around one shared floor like a small, believable workplace.
 */
export class World {
  floor: FloorPlan = buildFloor([]);
  /** Bumped whenever the floor plan is replaced, so art and camera can follow. */
  floorVersion = 0;
  readonly teams = new Map<string, Team>();
  readonly people = new Map<string, Person>();
  renovation: Renovation | null = null;
  readonly log: LogEntry[] = [];
  time = 0;

  private readonly say: Messages['say'];
  private readonly random: () => number;
  private initialized = false;
  private order = 0;
  private logId = 0;
  private now = 0;
  private pendingPlan: FloorPlan | null = null;
  private readonly pendingSpeech: { id: string; text: string; at: number }[] = [];
  /** One conversation starts at a time, so the shared spaces stay readable. */
  private nextChatAt = 0;

  constructor(options: WorldOptions) {
    this.say = options.say;
    this.random = createRandom(options.seed ?? 1);
  }

  // ─── Snapshots ────────────────────────────────────────────────────────────────────────────

  applySnapshot(snapshot: OfficeSnapshot, now: number): void {
    this.now = now;
    for (const room of snapshot.rooms) this.ensureTeam(room.id, room.name);

    const seen = new Set<string>();
    for (const agent of snapshot.agents) {
      seen.add(agent.id);
      const existing = this.people.get(agent.id);
      if (existing) {
        existing.agent = agent;
        if (existing.home !== agent.roomId) this.releaseDesks(existing.id);
        existing.home = agent.roomId;
        existing.departing = false;
      } else {
        this.addPerson(agent);
      }
    }
    for (const person of this.people.values()) {
      if (!seen.has(person.id)) person.departing = true;
    }

    if (!this.initialized) {
      this.initialized = true;
      this.replaceFloor(buildFloor(this.desiredTeams()));
      for (const person of this.people.values()) this.placeInstantly(person);
    }
  }

  /** Drops everyone and every team, e.g. when switching between live and demo. */
  reset(): void {
    this.teams.clear();
    this.people.clear();
    this.log.length = 0;
    this.pendingSpeech.length = 0;
    this.renovation = null;
    this.pendingPlan = null;
    this.initialized = false;
    this.replaceFloor(buildFloor([]));
  }

  private ensureTeam(id: string, name: string): void {
    const existing = this.teams.get(id);
    if (existing) {
      existing.name = name;
      existing.emptyFor = 0;
      return;
    }
    this.order += 1;
    this.teams.set(id, {
      id,
      name,
      order: this.order,
      tier: -1,
      emptyFor: 0,
      shrinkFor: 0,
      deskOwner: new Map(),
    });
    if (this.initialized) this.addLog('opened', { room: name });
  }

  private addPerson(agent: AgentSnapshot): void {
    const persona = createPersona(agent.id);
    const taken = new Set([...this.people.values()].map((person) => person.name));
    this.people.set(agent.id, {
      id: agent.id,
      persona,
      name: distinctName(persona, agent.id, taken),
      agent,
      home: agent.roomId,
      x: 0,
      y: 0,
      dir: 'se',
      path: [],
      hurry: false,
      stage: 'hidden',
      stageTime: 0,
      alpha: 0,
      dest: null,
      goalKey: '',
      goalSince: this.time,
      arrivedAt: null,
      walkTime: 0,
      bubbles: [],
      departing: false,
      briefed: agent.kind === 'session' || !this.initialized,
      reported: agent.kind === 'session',
      script: null,
      visit: null,
      lookAt: null,
      nextChatAt: this.time + between(this.random, 3, TUNING.chatGapMax),
      nextCheckInAt: 0,
      sipUntil: 0,
      brainTimer: this.random() * TUNING.brainEvery,
      lastActivity: agent.activity,
      spawnedAt: this.time,
      shown: false,
    });
  }

  private placeInstantly(person: Person): void {
    const goal = this.decide(person);
    this.adoptGoal(person, goal, true);
    if (person.visit) person.visit.phase = 'hangout';
    const dest = this.resolve(person, goal);
    if (!dest || dest.goal === 'exit') return;
    person.dest = dest;
    person.x = dest.tile.x;
    person.y = dest.tile.y;
    person.dir = dest.facing;
    person.stage = 'present';
    person.shown = true;
    person.alpha = 1;
    person.arrivedAt = this.time - 5;
    if (person.visit) person.visit.until = this.time + between(this.random, 4, TUNING.hangoutMax);
  }

  // ─── Simulation step ──────────────────────────────────────────────────────────────────────

  tick(dt: number, now: number): void {
    this.time += dt;
    this.now = now;
    this.updateTeams(dt);
    this.updateRenovation(dt);
    for (const person of [...this.people.values()]) this.updatePerson(person, dt);
    this.updateChatter();
    this.flushSpeech();
  }

  private updatePerson(person: Person, dt: number): void {
    for (const bubble of person.bubbles) bubble.age += dt;
    person.bubbles = person.bubbles.filter((bubble) => bubble.age < TUNING.bubbleTtl);
    if (person.lookAt && person.lookAt.until < this.time) person.lookAt = null;

    person.brainTimer -= dt;
    if (person.brainTimer <= 0) {
      person.brainTimer = TUNING.brainEvery;
      this.think(person);
    }
    this.runScript(person, dt);
    this.navigate(person, dt);

    if (person.stage === 'gone') {
      this.releaseDesks(person.id);
      this.people.delete(person.id);
      if (person.shown) this.addLog('left', { name: person.name });
    }
  }

  private releaseDesks(personId: string): void {
    for (const team of this.teams.values()) {
      for (const [index, owner] of team.deskOwner) {
        if (owner === personId) team.deskOwner.delete(index);
      }
    }
  }

  // ─── Decisions ────────────────────────────────────────────────────────────────────────────

  private think(person: Person): void {
    if (person.stage === 'hidden') {
      if (person.departing) person.stage = 'gone';
      return;
    }
    this.noticeActivityChange(person);
    this.advanceVisit(person);

    const goal = this.decide(person);
    const key = goalKey(goal);
    if (key !== person.goalKey) {
      const held = this.time - person.goalSince;
      const scripted =
        person.script !== null && goal.kind !== 'exit' && goal.reason !== 'renovation';
      if (scripted || (held < TUNING.minGoalHold && !this.isUrgent(person, goal))) return;
      this.adoptGoal(person, goal, false);
    }
    const dest = this.resolve(person, goal);
    if (dest) person.dest = dest;
  }

  private decide(person: Person): Goal {
    const goal = (kind: GoalKind, extra: Partial<Goal> = {}): Goal => ({
      kind,
      partner: null,
      script: null,
      reason: null,
      ...extra,
    });
    const { agent } = person;
    const parentId = agent.parentId;

    if (person.departing) {
      if (agent.kind === 'subagent' && !person.reported && parentId && this.isAvailable(parentId)) {
        return goal('visit', { partner: parentId, script: 'report' });
      }
      return goal('exit');
    }
    if (!this.hasDesks(person.home)) return goal('commons', { reason: 'renovation' });

    // New helpers get briefed in the meeting room; whoever called them joins them there.
    if (!person.briefed) {
      if (parentId && this.isAvailable(parentId) && this.time - person.spawnedAt < 30) {
        return goal('meeting', { partner: parentId, script: 'brief' });
      }
      person.briefed = true;
    }
    const newcomer = [...this.people.values()].find(
      (other) =>
        other.agent.parentId === person.id && !other.briefed && other.goalKey.startsWith('meeting'),
    );
    if (newcomer) return goal('meeting', { partner: newcomer.id });
    if (person.script?.kind === 'checkIn') {
      return goal('visit', { partner: person.script.partner, script: 'checkIn' });
    }

    const age = this.now - agent.activitySince;
    switch (agent.activity) {
      case 'waiting':
        if (age < TUNING.waitAtDeskMs || age > TUNING.dozeAfterMs) return goal('desk');
        return goal('commons', { reason: 'break' });
      case 'running':
        return age > TUNING.longCommandMs ? goal('commons', { reason: 'coffee' }) : goal('desk');
      case 'delegating': {
        if (age < TUNING.checkInAfterMs || this.time < person.nextCheckInAt) return goal('desk');
        const helper = [...this.people.values()].find(
          (other) =>
            other.agent.parentId === person.id && other.briefed && this.isAvailable(other.id),
        );
        return helper ? goal('visit', { partner: helper.id, script: 'checkIn' }) : goal('desk');
      }
      default:
        return goal('desk');
    }
  }

  private isUrgent(person: Person, goal: Goal): boolean {
    if (goal.kind === 'exit' || goal.kind === 'visit' || goal.kind === 'meeting') return true;
    if (goal.reason === 'renovation') return true;
    return person.goalKey.startsWith('commons') && goal.kind === 'desk';
  }

  private adoptGoal(person: Person, goal: Goal, silent: boolean): void {
    const previous = person.goalKey;
    person.goalKey = goalKey(goal);
    person.goalSince = this.time;
    person.hurry = false;
    person.dest = null;
    person.arrivedAt = null;
    person.visit =
      goal.kind === 'commons' && goal.reason
        ? {
            reason: goal.reason,
            phase: goal.reason === 'renovation' ? 'hangout' : 'coffee',
            until: 0,
          }
        : null;
    if (goal.script && !person.script) {
      person.script = { kind: goal.script, partner: goal.partner ?? '', step: -1, timer: 0 };
    }
    if (silent) return;

    if (goal.kind === 'commons' && goal.reason === 'break' && this.random() < 0.6) {
      this.speak(person, this.say.breakStart);
    } else if (goal.kind === 'commons' && goal.reason === 'coffee') {
      this.speak(person, this.say.longCommand);
    } else if (
      goal.kind === 'desk' &&
      previous.startsWith('commons') &&
      person.agent.activity !== 'waiting'
    ) {
      person.hurry = true;
      if (!previous.includes('renovation')) this.speak(person, this.say.backToWork);
    } else if (goal.kind === 'exit' && person.agent.kind === 'session') {
      this.speak(person, this.say.leave);
    }
  }

  private noticeActivityChange(person: Person): void {
    const activity = person.agent.activity;
    if (activity === person.lastActivity) return;
    person.lastActivity = activity;
    if (activity === 'waiting' && person.dest?.goal === 'desk' && person.arrivedAt !== null) {
      this.speak(person, this.say.yourTurn);
    }
  }

  private advanceVisit(person: Person): void {
    const visit = person.visit;
    if (!visit || person.arrivedAt === null || person.dest?.goal !== 'commons') return;
    if (this.time < visit.until) {
      const standing = visit.phase === 'hangout' && person.dest.pose === 'stand';
      if (standing && this.time > person.sipUntil + 6 && this.random() < 0.05) {
        person.sipUntil = this.time + 1.4;
      }
      return;
    }
    if (visit.phase === 'coffee') visit.phase = 'hangout';
    else if (this.random() < 0.25 && visit.reason !== 'renovation') visit.phase = 'coffee';
    visit.until = Number.POSITIVE_INFINITY;
    person.dest = null;
    person.arrivedAt = null;
  }

  // ─── Destinations ─────────────────────────────────────────────────────────────────────────

  private resolve(person: Person, goal: Goal): Destination | null {
    switch (goal.kind) {
      case 'desk':
        return this.deskDestination(person);
      case 'commons':
        if (person.dest?.goal === 'commons' && this.isStillFree(person.dest.tile)) {
          return person.dest;
        }
        return this.commonsDestination(person);
      case 'visit':
        return goal.partner ? this.visitDestination(person, goal.partner) : null;
      case 'meeting':
        if (person.dest?.goal === 'meeting' && this.isStillFree(person.dest.tile)) {
          return person.dest;
        }
        return goal.partner ? this.meetingDestination(person, goal.partner) : null;
      case 'exit':
        return { goal: 'exit', tile: this.floor.door, facing: 'nw', pose: 'stand', partner: null };
    }
  }

  /** A kept destination is still usable after a floor swap. */
  private isStillFree(tile: Tile): boolean {
    return isWalkable(this.floor, tile) && !this.inRenovation(tile);
  }

  private deskDestination(person: Person): Destination | null {
    const desk = this.claimDesk(person);
    if (!desk) return this.commonsDestination(person);
    return {
      goal: 'desk',
      tile: desk.seat,
      facing: desk.facing,
      pose: deskPose(person, this.now),
      partner: null,
    };
  }

  private zoneOfTeam(teamId: string): Zone | undefined {
    return this.floor.zones.find((zone) => zone.kind === 'team' && zone.id === teamId);
  }

  private hasDesks(teamId: string): boolean {
    return this.zoneOfTeam(teamId) !== undefined && !this.renovation?.zones.has(teamId);
  }

  private claimDesk(person: Person): Desk | null {
    const team = this.teams.get(person.home);
    const zone = this.zoneOfTeam(person.home);
    if (!team || !zone) return null;
    for (const [index, owner] of team.deskOwner) {
      if (owner !== person.id) continue;
      const desk = zone.desks[index];
      if (desk) return desk;
      team.deskOwner.delete(index);
    }
    const free = zone.desks.find((desk) => !team.deskOwner.has(desk.index));
    if (!free) return null;
    team.deskOwner.set(free.index, person.id);
    return free;
  }

  private freeSpots(kinds: readonly SpotKind[], personId: string): Spot[] {
    return this.floor.spots.filter(
      (spot) =>
        kinds.includes(spot.kind) &&
        !this.isTaken(spot.tile, personId) &&
        !this.inRenovation(spot.tile),
    );
  }

  private commonsDestination(person: Person): Destination | null {
    const reason = person.visit?.reason ?? 'break';
    let spot: Spot | undefined;
    if (person.visit?.phase === 'coffee') {
      const kitchen = this.freeSpots(KITCHEN_SPOTS, person.id);
      spot = kitchen.find((candidate) => candidate.kind === 'coffee') ?? kitchen[0];
    } else {
      const area = weighted(this.random, HANGOUT_WEIGHTS[reason]);
      const preferred = this.freeSpots(HANGOUT_SPOTS[area], person.id);
      const pool =
        preferred.length > 0
          ? preferred
          : this.freeSpots(Object.values(HANGOUT_SPOTS).flat(), person.id);
      // Join someone who is already hanging out, the way people drift into conversations.
      const company = [...this.people.values()].filter(
        (other) =>
          other.id !== person.id && other.visit?.phase === 'hangout' && other.arrivedAt !== null,
      );
      const near = pool.filter((candidate) =>
        company.some(
          (other) =>
            Math.abs(other.x - candidate.tile.x) + Math.abs(other.y - candidate.tile.y) <= 2,
        ),
      );
      const choices = near.length > 0 && this.random() < 0.7 ? near : pool;
      spot = choices.length > 0 ? pick(this.random, choices) : undefined;
    }
    if (spot) {
      return {
        goal: 'commons',
        tile: spot.tile,
        facing: spot.facing,
        pose: SPOT_POSE[spot.kind],
        partner: null,
      };
    }
    const tile = this.freeTile(person.id, (x) => x < COMMONS_W);
    return tile ? { goal: 'commons', tile, facing: 'sw', pose: 'stand', partner: null } : null;
  }

  private meetingDestination(person: Person, partnerId: string): Destination | null {
    const seats = this.freeSpots(['meeting'], person.id);
    const partner = this.people.get(partnerId);
    const anchor = partner?.dest?.goal === 'meeting' ? partner.dest.tile : null;
    const distance = (tile: Tile) =>
      anchor ? Math.abs(tile.x - anchor.x) + Math.abs(tile.y - anchor.y) : 0;
    // Sit next to whoever is already at the table, or take the first free chair.
    const seat = [...seats].sort((a, b) => distance(a.tile) - distance(b.tile))[0];
    if (!seat) return this.visitDestination(person, partnerId);
    return {
      goal: 'meeting',
      tile: seat.tile,
      facing: seat.facing,
      pose: 'sit',
      partner: partnerId,
    };
  }

  private visitDestination(person: Person, partnerId: string): Destination | null {
    const partner = this.people.get(partnerId);
    if (partner?.stage !== 'present') return null;
    const base = { x: Math.round(partner.x), y: Math.round(partner.y) };
    const candidates: Tile[] = [
      { x: base.x, y: base.y + 1 },
      { x: base.x + 1, y: base.y },
      { x: base.x - 1, y: base.y },
      { x: base.x + 1, y: base.y + 1 },
      { x: base.x - 1, y: base.y + 1 },
      { x: base.x, y: base.y + 2 },
      { x: base.x, y: base.y - 1 },
    ];
    const current = person.dest?.partner === partnerId ? person.dest.tile : null;
    const seats = new Set(
      this.floor.zones.flatMap((zone) => zone.desks.map((desk) => `${desk.seat.x},${desk.seat.y}`)),
    );
    const usable = (tile: Tile) =>
      isWalkable(this.floor, tile) &&
      !this.isTaken(tile, person.id) &&
      !seats.has(`${tile.x},${tile.y}`) &&
      !this.inRenovation(tile);
    const keep =
      current && candidates.some((candidate) => sameTile(candidate, current)) && usable(current);
    const tile = keep ? current : candidates.find(usable);
    if (!tile) return null;
    return {
      goal: 'visit',
      tile,
      facing: lookDir(tile, base, 'ne'),
      pose: 'stand',
      partner: partnerId,
    };
  }

  private isTaken(tile: Tile, exceptId: string): boolean {
    for (const other of this.people.values()) {
      if (other.id === exceptId || other.stage === 'hidden') continue;
      if (other.dest && sameTile(other.dest.tile, tile)) return true;
      if (
        Math.round(other.x) === tile.x &&
        Math.round(other.y) === tile.y &&
        other.path.length === 0
      ) {
        return true;
      }
    }
    return false;
  }

  private freeTile(personId: string, area: (x: number, y: number) => boolean): Tile | null {
    const options: Tile[] = [];
    for (let y = 1; y < this.floor.depth; y += 1) {
      for (let x = 1; x < this.floor.width; x += 1) {
        const tile = { x, y };
        if (
          area(x, y) &&
          isWalkable(this.floor, tile) &&
          !this.isTaken(tile, personId) &&
          !this.inRenovation(tile)
        ) {
          options.push(tile);
        }
      }
    }
    return options.length > 0 ? pick(this.random, options) : null;
  }

  private isAvailable(id: string): boolean {
    const other = this.people.get(id);
    return Boolean(other && other.stage === 'present' && !other.departing);
  }

  // ─── Conversations ────────────────────────────────────────────────────────────────────────

  private runScript(person: Person, dt: number): void {
    const script = person.script;
    if (!script) return;
    const partner = this.people.get(script.partner);
    if (!partner || partner.stage === 'gone') {
      this.finishScript(person);
      return;
    }
    if (script.step < 0) {
      // Start once both are there; give up if the other person never makes it.
      if (this.time - person.goalSince > 20) {
        if (script.kind === 'brief') person.briefed = true;
        if (script.kind === 'report') person.reported = true;
        this.finishScript(person);
        return;
      }
      if (person.arrivedAt === null || !person.dest || person.dest.goal === 'desk') return;
      const partnerSeated = partner.dest?.goal === 'meeting' && partner.arrivedAt !== null;
      if (script.kind === 'brief' && !partnerSeated) return;
      script.step = 0;
      script.timer = 0;
    }
    script.timer -= dt;
    if (script.timer > 0) return;
    this.face(person, partner);
    const helper = person.agent.kind === 'subagent' ? person : partner;
    const task = shorten(helper.agent.label);
    switch (script.kind) {
      case 'brief':
        if (script.step === 0) {
          this.speak(partner, task ? this.say.brief : this.say.briefNoTask, {
            child: person.name,
            task,
          });
        } else if (script.step === 1) {
          this.speak(person, this.say.accept);
        } else {
          person.briefed = true;
          this.finishScript(person);
          return;
        }
        break;
      case 'report':
        if (script.step === 0) {
          this.speak(person, this.say.report, { task: task || '…' });
        } else if (script.step === 1) {
          this.speak(partner, this.say.thanks, { child: person.name });
        } else {
          person.reported = true;
          this.finishScript(person);
          return;
        }
        break;
      case 'checkIn':
        if (script.step === 0) {
          this.speak(person, this.say.checkIn, { child: partner.name });
        } else if (script.step === 1) {
          this.speak(partner, this.say.checkInReply);
        } else {
          person.nextCheckInAt = this.time + TUNING.checkInEvery;
          this.finishScript(person);
          return;
        }
        break;
    }
    script.step += 1;
    script.timer = script.step === 2 ? 1.4 : TUNING.replyDelay;
  }

  private finishScript(person: Person): void {
    person.script = null;
    person.goalSince = this.time - TUNING.minGoalHold;
  }

  private face(a: Person, b: Person): void {
    const until = this.time + 3.5;
    a.lookAt = { id: b.id, until };
    b.lookAt = { id: a.id, until };
  }

  private updateChatter(): void {
    if (this.time < this.nextChatAt) return;
    const resting = [...this.people.values()].filter(
      (person) =>
        person.stage === 'present' &&
        person.dest?.goal === 'commons' &&
        person.arrivedAt !== null &&
        person.path.length === 0 &&
        !person.script,
    );
    for (const speaker of resting) {
      if (speaker.nextChatAt > this.time) continue;
      const partner = resting.find(
        (other) =>
          other !== speaker &&
          other.nextChatAt <= this.time + 6 &&
          Math.abs(other.x - speaker.x) + Math.abs(other.y - speaker.y) <= 3,
      );
      if (!partner) {
        speaker.nextChatAt = this.time + 3;
        continue;
      }
      const room = this.teams.get(partner.home)?.name ?? '';
      const detail = speaker.agent.detail ?? '';
      const lines =
        speaker.visit?.reason === 'renovation'
          ? this.say.renovationTalk
          : this.say.smallTalk.filter(
              (line) =>
                (!line.includes('{detail}') || detail) && (!line.includes('{room}') || room),
            );
      this.speak(speaker, lines, { room, detail });
      this.queueSpeech(partner, pick(this.random, this.say.smallTalkReply), TUNING.replyDelay);
      this.face(speaker, partner);
      this.nextChatAt = this.time + TUNING.loungeChatGap;
      speaker.nextChatAt = this.time + between(this.random, TUNING.chatGapMin, TUNING.chatGapMax);
      partner.nextChatAt = this.time + between(this.random, TUNING.chatGapMin, TUNING.chatGapMax);
      return;
    }
  }

  private speak(person: Person, lines: Lines, params: Record<string, string> = {}): void {
    if (lines.length === 0 || person.stage === 'hidden') return;
    this.pushBubble(person, format(pick(this.random, lines), { name: person.name, ...params }));
  }

  private queueSpeech(person: Person, text: string, delay: number): void {
    this.pendingSpeech.push({ id: person.id, text, at: this.time + delay });
  }

  private flushSpeech(): void {
    for (let index = this.pendingSpeech.length - 1; index >= 0; index -= 1) {
      const item = this.pendingSpeech[index];
      if (!item || item.at > this.time) continue;
      this.pendingSpeech.splice(index, 1);
      const person = this.people.get(item.id);
      if (person) this.pushBubble(person, item.text);
    }
  }

  private pushBubble(person: Person, text: string): void {
    person.bubbles.push({ text, age: 0 });
    if (person.bubbles.length > MAX_BUBBLES) person.bubbles.shift();
  }

  // ─── Movement ─────────────────────────────────────────────────────────────────────────────

  private navigate(person: Person, dt: number): void {
    person.stageTime += dt;
    switch (person.stage) {
      case 'hidden':
        this.trySpawn(person);
        return;
      case 'entering': {
        const progress = Math.min(1, person.stageTime / TUNING.doorFade);
        person.alpha = progress;
        person.x = this.floor.door.x - DOOR_STEP * (1 - progress);
        if (progress >= 1) this.setStage(person, 'present');
        return;
      }
      case 'exiting': {
        const progress = Math.min(1, person.stageTime / TUNING.doorFade);
        person.alpha = 1 - progress;
        person.x = this.floor.door.x - DOOR_STEP * progress;
        if (progress < 1) return;
        // Someone who came back mid-exit walks in again instead of vanishing.
        if (person.departing) person.stage = 'gone';
        else this.enter(person);
        return;
      }
      case 'present':
        this.walk(person, dt);
        return;
      case 'gone':
        return;
    }
  }

  private trySpawn(person: Person): void {
    if (person.departing) {
      person.stage = 'gone';
      return;
    }
    this.enter(person);
    if (person.agent.kind === 'session') this.speak(person, this.say.greet);
    this.addLog('joined', { name: person.name, room: this.teams.get(person.home)?.name ?? '' });
  }

  private enter(person: Person): void {
    person.x = this.floor.door.x - DOOR_STEP;
    person.y = this.floor.door.y;
    person.dir = 'se';
    person.path = [];
    person.alpha = 0;
    person.arrivedAt = null;
    person.shown = true;
    this.setStage(person, 'entering');
  }

  private setStage(person: Person, stage: Person['stage']): void {
    person.stage = stage;
    person.stageTime = 0;
  }

  private walk(person: Person, dt: number): void {
    const dest = person.dest;
    if (!dest) return;
    const target = dest.tile;
    const here = { x: Math.round(person.x), y: Math.round(person.y) };

    const pathEnd = person.path.at(-1);
    const needsRoute =
      person.path.length === 0 ? !sameTile(here, target) : pathEnd && !sameTile(pathEnd, target);
    if (needsRoute) {
      const from = person.path[0] ?? here;
      const avoid = new Set(
        [...this.people.values()]
          .filter(
            (other) => other !== person && other.stage === 'present' && other.path.length === 0,
          )
          .map((other) => `${Math.round(other.x)},${Math.round(other.y)}`),
      );
      const route = findPath(this.floor, from, target, avoid);
      if (route === null) {
        person.x = target.x;
        person.y = target.y;
        person.path = [];
      } else {
        const onTile = sameTile(from, here) && person.x === here.x && person.y === here.y;
        person.path = onTile ? route : [from, ...route];
      }
    }

    const next = person.path[0];
    if (!next) {
      if (dest.goal === 'exit') {
        person.dir = 'nw';
        this.setStage(person, 'exiting');
        return;
      }
      if (person.arrivedAt === null) this.arrive(person);
      person.hurry = false;
      person.dir = this.restingDir(person, dest);
      return;
    }

    person.arrivedAt = null;
    const speed = person.hurry ? TUNING.hurrySpeed : TUNING.walkSpeed;
    let budget = speed * dt;
    while (budget > 0 && person.path.length > 0) {
      const step = person.path[0];
      if (!step) break;
      const dx = step.x - person.x;
      const dy = step.y - person.y;
      const distance = Math.abs(dx) + Math.abs(dy);
      person.dir = stepDir({ x: 0, y: 0 }, { x: Math.sign(dx), y: Math.sign(dy) }, person.dir);
      if (distance <= budget) {
        person.x = step.x;
        person.y = step.y;
        person.path.shift();
        budget -= distance;
      } else {
        person.x += Math.sign(dx) * Math.min(Math.abs(dx), budget);
        person.y += Math.sign(dy) * (Math.abs(dx) > 0 ? 0 : Math.min(Math.abs(dy), budget));
        budget = 0;
      }
    }
    person.walkTime += dt;
  }

  private arrive(person: Person): void {
    person.arrivedAt = this.time;
    const visit = person.visit;
    if (visit && person.dest?.goal === 'commons') {
      const stay =
        visit.phase === 'coffee'
          ? TUNING.coffeeFor
          : between(this.random, TUNING.hangoutMin, TUNING.hangoutMax);
      visit.until = this.time + stay;
    }
  }

  /** Seated people keep facing their seat, except at a desk; everyone else turns to talk. */
  private restingDir(person: Person, dest: Destination): Person['dir'] {
    const other = person.lookAt ? this.people.get(person.lookAt.id) : undefined;
    const seated = dest.pose === 'sit' || dest.pose === 'type';
    if (other && (!seated || dest.goal === 'desk')) {
      return lookDir({ x: person.x, y: person.y }, { x: other.x, y: other.y }, dest.facing);
    }
    return dest.facing;
  }

  // ─── Teams and renovations ────────────────────────────────────────────────────────────────

  private members(teamId: string): number {
    let count = 0;
    for (const person of this.people.values()) {
      if (person.home === teamId && !person.departing) count += 1;
    }
    return count;
  }

  private updateTeams(dt: number): void {
    for (const team of this.teams.values()) {
      const anyone = [...this.people.values()].some((person) => person.home === team.id);
      team.emptyFor = anyone ? 0 : team.emptyFor + dt;
      const wanted = teamTierFor(Math.max(1, this.members(team.id)));
      team.shrinkFor = team.tier >= 0 && wanted + 1 < team.tier ? team.shrinkFor + dt : 0;
    }
  }

  /** The teams the floor should hold right now, in floor order, with the size each needs. */
  private desiredTeams(): TeamRequest[] {
    return [...this.teams.values()]
      .filter((team) => team.emptyFor <= TUNING.closeAfterEmpty)
      .sort((a, b) => a.order - b.order)
      .map((team) => {
        const wanted = teamTierFor(Math.max(1, this.members(team.id)));
        let tier = team.tier;
        // Grow right away; shrink only after a while, keeping a size of headroom.
        if (tier < 0 || wanted > tier) tier = wanted;
        else if (team.shrinkFor > TUNING.shrinkAfter) tier = wanted + 1;
        return { id: team.id, tier };
      });
  }

  private updateRenovation(dt: number): void {
    if (!this.initialized) return;
    const renovation = this.renovation;
    if (!renovation) {
      this.planRenovation();
      return;
    }
    renovation.time += dt;
    if (renovation.phase === 'evacuating') {
      const occupied = [...this.people.values()].some(
        (person) =>
          person.stage === 'present' &&
          this.inRenovation({ x: Math.round(person.x), y: Math.round(person.y) }),
      );
      if (!occupied || renovation.time > TUNING.evacuateTimeout) this.swapFloor(renovation);
      return;
    }
    if (renovation.time < TUNING.build) return;
    this.renovation = null;
    for (const [id, team] of this.teams) {
      if (team.emptyFor > TUNING.closeAfterEmpty && !this.zoneOfTeam(id)) {
        this.teams.delete(id);
        this.addLog('closed', { room: team.name });
      }
    }
    for (const person of this.people.values()) person.brainTimer = 0;
  }

  private planRenovation(): void {
    const desired = this.desiredTeams();
    const built = this.floor.zones.filter((zone) => zone.kind === 'team');
    const unchanged =
      desired.length === built.length &&
      desired.every(
        (request, index) => built[index]?.id === request.id && built[index].tier === request.tier,
      );
    if (unchanged) return;

    const next = buildFloor(desired);
    const before = new Map(built.map((zone) => [zone.id, zone]));
    const after = new Map(
      next.zones.filter((zone) => zone.kind === 'team').map((zone) => [zone.id, zone]),
    );
    const zones = new Set<string>();
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      const old = before.get(id);
      const fresh = after.get(id);
      if (!old || !fresh || old.tier !== fresh.tier || !sameRect(old.rect, fresh.rect)) {
        zones.add(id);
      }
    }
    const rects = [...zones].flatMap((id) =>
      [before.get(id)?.rect, after.get(id)?.rect].filter((rect) => rect !== undefined),
    );
    const tierOf = (map: Map<string, Zone>, id: string) => map.get(id)?.tier;
    const grew = new Set(
      [...zones].filter((id) => (tierOf(after, id) ?? -1) > (tierOf(before, id) ?? Infinity)),
    );
    const shrank = new Set(
      [...zones].filter((id) => (tierOf(after, id) ?? Infinity) < (tierOf(before, id) ?? -1)),
    );
    for (const id of grew) this.addLog('growing', { room: this.teams.get(id)?.name ?? '' });
    for (const id of shrank) this.addLog('shrinking', { room: this.teams.get(id)?.name ?? '' });

    this.pendingPlan = next;
    this.renovation = { phase: 'evacuating', time: 0, zones, rects, grew, shrank };
    const speaker = [...this.people.values()].find(
      (person) =>
        person.stage === 'present' &&
        grew.has(person.home) &&
        this.inRenovation({ x: Math.round(person.x), y: Math.round(person.y) }),
    );
    if (speaker) {
      this.speak(speaker, this.say.evacuate, { room: this.teams.get(speaker.home)?.name ?? '' });
    }
    // Everyone re-thinks right away instead of waiting out their current plan.
    for (const person of this.people.values()) person.brainTimer = 0;
  }

  private swapFloor(renovation: Renovation): void {
    const plan = this.pendingPlan;
    this.pendingPlan = null;
    if (!plan) return;
    this.replaceFloor(plan);
    renovation.phase = 'building';
    renovation.time = 0;
    for (const person of this.people.values()) {
      person.path = [];
      const here = { x: Math.round(person.x), y: Math.round(person.y) };
      // Stragglers in the builders' way step aside to the nearest free floor.
      if (person.stage === 'present' && (!isWalkable(plan, here) || this.inRenovation(here))) {
        const spot = this.nearestFree(here);
        person.x = spot.x;
        person.y = spot.y;
      }
      if (person.dest && !this.isStillFree(person.dest.tile)) {
        person.dest = null;
        person.arrivedAt = null;
      }
    }
  }

  private replaceFloor(plan: FloorPlan): void {
    this.floor = plan;
    this.floorVersion += 1;
    for (const zone of plan.zones) {
      const team = this.teams.get(zone.id);
      if (!team || zone.kind !== 'team') continue;
      team.tier = zone.tier;
      team.shrinkFor = 0;
      for (const index of [...team.deskOwner.keys()]) {
        if (index >= zone.desks.length) team.deskOwner.delete(index);
      }
    }
  }

  private nearestFree(from: Tile): Tile {
    const seen = new Set<string>([`${from.x},${from.y}`]);
    const queue: Tile[] = [from];
    while (queue.length > 0) {
      const tile = queue.shift();
      if (!tile) break;
      if (isWalkable(this.floor, tile) && !this.inRenovation(tile)) return tile;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const next = { x: tile.x + dx, y: tile.y + dy };
        const key = `${next.x},${next.y}`;
        const outside =
          next.x < 0 || next.y < 0 || next.x >= this.floor.width || next.y >= this.floor.depth;
        if (seen.has(key) || outside) continue;
        seen.add(key);
        queue.push(next);
      }
    }
    return { ...this.floor.door };
  }

  inRenovation(tile: Tile): boolean {
    return this.renovation?.rects.some((rect) => inRect(rect, tile)) ?? false;
  }

  private addLog(kind: LogKind, params: Record<string, string>): void {
    this.logId += 1;
    this.log.unshift({ id: this.logId, kind, at: this.now, params });
    if (this.log.length > TUNING.maxLog) this.log.pop();
  }

  // ─── Queries for rendering and the HUD ────────────────────────────────────────────────────

  /** Pose to draw right now. */
  poseOf(person: Person): AvatarPose {
    if (person.stage !== 'present') return 'walk';
    if (person.path.length > 0) return 'walk';
    const dest = person.dest;
    if (!dest || person.arrivedAt === null) return 'stand';
    if (dest.goal === 'desk') {
      const seated = deskPose(person, this.now);
      return person.lookAt && seated === 'type' ? 'sit' : seated;
    }
    if (dest.pose === 'stand' && this.time < person.sipUntil) return 'drink';
    return dest.pose;
  }

  isDozing(person: Person): boolean {
    return this.poseOf(person) === 'sleep';
  }

  /** The zone a tile belongs to: a team area or one of the shared spaces. */
  zoneAt(x: number, y: number): Zone | undefined {
    const tile = { x: Math.round(x), y: Math.round(y) };
    return this.floor.zones.find((zone) => inRect(zone.rect, tile));
  }

  /** Whether a team's area is open or being built. */
  teamPhase(teamId: string): 'open' | 'renovating' {
    return this.hasDesks(teamId) ? 'open' : 'renovating';
  }
}

function goalKey(goal: Goal): string {
  return [goal.kind, goal.reason ?? '', goal.partner ?? '', goal.script ?? ''].join(':');
}

function deskPose(person: Person, now: number): AvatarPose {
  const { activity, activitySince } = person.agent;
  if (activity === 'waiting') return now - activitySince > TUNING.dozeAfterMs ? 'sleep' : 'sit';
  if (activity === 'thinking' || activity === 'reading') return 'sit';
  return 'type';
}

function shorten(text: string | null): string {
  if (!text) return '';
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > TASK_MAX ? `${clean.slice(0, TASK_MAX - 1)}…` : clean;
}

function weighted<T>(random: () => number, entries: readonly (readonly [T, number])[]): T {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  const last = entries.at(-1);
  if (!last) throw new Error('weighted() needs entries');
  return last[0];
}
