import type { AgentSnapshot, OfficeSnapshot } from '../../../shared/protocol.ts';
import { between, createRandom, hashString, pick } from '../../../shared/random.ts';
import type { Messages } from '../../i18n/index.ts';
import { format } from '../../i18n/index.ts';
import type { AvatarPose } from '../gfx/avatar-art.ts';
import { LOUNGE_THEME, ROOM_THEMES } from '../gfx/palette.ts';
import { packOffice, roomBounds } from '../layout/office-layout.ts';
import { findPath } from '../layout/pathfinding.ts';
import { loungeLayout, loungeTierFor, workRoomLayout, workTierFor } from '../layout/room-layout.ts';
import { isWalkable, lookDir, sameTile, stepDir, type Spot, type Tile } from '../layout/types.ts';
import { createPersona, distinctName } from './persona.ts';
import { TUNING } from './tuning.ts';
import {
  LOUNGE_ID,
  type Destination,
  type GoalKind,
  type LogEntry,
  type LogKind,
  type LoungeReason,
  type Person,
  type ScriptKind,
  type WorldRoom,
} from './types.ts';

type Lines = readonly string[];

interface Goal {
  kind: GoalKind;
  partner: string | null;
  script: ScriptKind | null;
  reason: LoungeReason | null;
}

const DOOR_STEP = 0.6;
const MAX_BUBBLES = 3;
const TASK_MAX = 42;

export interface WorldOptions {
  say: Messages['say'];
  seed?: number;
}

/**
 * The office simulation: it reconciles snapshots from the server with the people on screen and
 * moves everyone around like a small, believable workplace.
 */
export class World {
  readonly rooms = new Map<string, WorldRoom>();
  readonly people = new Map<string, Person>();
  readonly log: LogEntry[] = [];
  time = 0;
  aspect = 1.6;
  /** Bumped whenever room sizes or positions change, so the camera can refit. */
  layoutVersion = 0;

  private readonly say: Messages['say'];
  private readonly random: () => number;
  private initialized = false;
  private order = 0;
  private logId = 0;
  private layoutDirty = true;
  private initializedLayout = false;
  private now = 0;
  private readonly pendingSpeech: { id: string; text: string; at: number }[] = [];
  /** One conversation starts at a time, so the lounge stays readable. */
  private nextLoungeChatAt = 0;

  constructor(options: WorldOptions) {
    this.say = options.say;
    this.random = createRandom(options.seed ?? 1);
    const layout = loungeLayout(0);
    this.rooms.set(LOUNGE_ID, {
      id: LOUNGE_ID,
      name: '',
      kind: 'lounge',
      theme: LOUNGE_THEME,
      layout,
      phase: 'open',
      phaseTime: 0,
      pendingTier: null,
      origin: { x: 0, y: 0 },
      target: { x: 0, y: 0 },
      order: -1,
      emptyFor: 0,
      shrinkFor: 0,
      deskOwner: new Map(),
    });
  }

  // ─── Snapshots ────────────────────────────────────────────────────────────────────────────

  applySnapshot(snapshot: OfficeSnapshot, now: number): void {
    this.now = now;
    const members = new Map<string, number>();
    for (const agent of snapshot.agents)
      members.set(agent.roomId, (members.get(agent.roomId) ?? 0) + 1);
    for (const room of snapshot.rooms)
      this.ensureRoom(room.id, room.name, members.get(room.id) ?? 1);

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
      for (const person of this.people.values()) this.placeInstantly(person);
    }
  }

  /** Drops everyone and every room, e.g. when switching between live and demo. */
  reset(): void {
    for (const id of [...this.rooms.keys()]) if (id !== LOUNGE_ID) this.rooms.delete(id);
    this.people.clear();
    this.log.length = 0;
    this.pendingSpeech.length = 0;
    this.initialized = false;
    this.layoutDirty = true;
  }

  private ensureRoom(id: string, name: string, members: number): void {
    const existing = this.rooms.get(id);
    if (existing) {
      existing.name = name;
      return;
    }
    const theme = ROOM_THEMES[hashString(id) % ROOM_THEMES.length] ?? LOUNGE_THEME;
    this.order += 1;
    this.rooms.set(id, {
      id,
      name,
      kind: 'work',
      theme,
      layout: workRoomLayout(workTierFor(Math.max(1, members)), id),
      phase: this.initialized ? 'opening' : 'open',
      phaseTime: 0,
      pendingTier: null,
      origin: { x: 0, y: 0 },
      target: { x: Number.NaN, y: Number.NaN },
      order: this.order,
      emptyFor: 0,
      shrinkFor: 0,
      deskOwner: new Map(),
    });
    this.layoutDirty = true;
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
      room: null,
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
      lounge: null,
      lookAt: null,
      nextChatAt: this.time + between(this.random, 3, TUNING.chatGapMax),
      nextCheckInAt: 0,
      sipUntil: 0,
      brainTimer: this.random() * TUNING.brainEvery,
      lastActivity: agent.activity,
    });
  }

  private placeInstantly(person: Person): void {
    const goal = this.decide(person);
    this.adoptGoal(person, goal, true);
    if (person.lounge) person.lounge.phase = 'hangout';
    const dest = this.resolve(person, goal);
    if (!dest || dest.goal === 'exit') return;
    person.dest = dest;
    person.room = dest.room;
    person.x = dest.tile.x;
    person.y = dest.tile.y;
    person.dir = dest.facing;
    person.stage = 'present';
    person.alpha = 1;
    person.arrivedAt = this.time - 5;
    if (person.lounge) person.lounge.until = this.time + between(this.random, 4, TUNING.hangoutMax);
  }

  // ─── Simulation step ──────────────────────────────────────────────────────────────────────

  tick(dt: number, now: number): void {
    this.time += dt;
    this.now = now;
    this.updateRooms(dt);
    for (const person of [...this.people.values()]) this.updatePerson(person, dt);
    this.updateChatter();
    this.flushSpeech();
    if (this.layoutDirty) this.relayout();
    this.easeRooms(dt);
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
      if (person.room !== null || person.alpha > 0) {
        this.addLog('left', { name: person.name });
      }
    }
  }

  private releaseDesks(personId: string): void {
    for (const room of this.rooms.values()) {
      for (const [index, owner] of room.deskOwner) {
        if (owner === personId) room.deskOwner.delete(index);
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
    this.advanceLounge(person);

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
    const home = this.rooms.get(person.home);
    if (!home || home.phase !== 'open') return goal('lounge', { reason: 'renovation' });

    if (!person.briefed) {
      if (parentId && this.isAvailable(parentId) && this.time - person.goalSince < 12) {
        return goal('visit', { partner: parentId, script: 'brief' });
      }
      person.briefed = true;
    }
    if (person.script?.kind === 'checkIn') {
      return goal('visit', { partner: person.script.partner, script: 'checkIn' });
    }

    const age = this.now - agent.activitySince;
    switch (agent.activity) {
      case 'waiting':
        if (age < TUNING.waitAtDeskMs || age > TUNING.dozeAfterMs) return goal('desk');
        return goal('lounge', { reason: 'break' });
      case 'running':
        return age > TUNING.longCommandMs ? goal('lounge', { reason: 'coffee' }) : goal('desk');
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
    if (goal.kind === 'exit' || goal.kind === 'visit' || goal.reason === 'renovation') return true;
    return person.goalKey.startsWith('lounge') && goal.kind === 'desk';
  }

  private adoptGoal(person: Person, goal: Goal, silent: boolean): void {
    const previous = person.goalKey;
    person.goalKey = goalKey(goal);
    person.goalSince = this.time;
    person.hurry = false;
    person.dest = null;
    person.arrivedAt = null;
    person.lounge =
      goal.kind === 'lounge' && goal.reason
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

    if (goal.kind === 'lounge' && goal.reason === 'break' && this.random() < 0.6) {
      this.speak(person, this.say.breakStart);
    } else if (goal.kind === 'lounge' && goal.reason === 'coffee') {
      this.speak(person, this.say.longCommand);
    } else if (
      goal.kind === 'desk' &&
      previous.startsWith('lounge') &&
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

  private advanceLounge(person: Person): void {
    const visit = person.lounge;
    if (!visit || person.arrivedAt === null || person.dest?.room !== LOUNGE_ID) return;
    if (this.time < visit.until) {
      const standing = visit.phase === 'hangout' && person.dest.pose === 'stand';
      if (standing && this.time > person.sipUntil + 6 && this.random() < 0.05) {
        person.sipUntil = this.time + 1.4;
      }
      return;
    }
    if (visit.phase === 'coffee') {
      visit.phase = 'hangout';
    } else if (this.random() < 0.3 && visit.reason !== 'renovation') {
      visit.phase = 'coffee';
    }
    visit.until = Number.POSITIVE_INFINITY;
    person.dest = null;
    person.arrivedAt = null;
  }

  // ─── Destinations ─────────────────────────────────────────────────────────────────────────

  private resolve(person: Person, goal: Goal): Destination | null {
    switch (goal.kind) {
      case 'desk':
        return this.deskDestination(person);
      case 'lounge':
        if (person.dest?.goal === 'lounge') return person.dest;
        return this.loungeDestination(person);
      case 'visit':
        return goal.partner ? this.visitDestination(person, goal.partner) : null;
      case 'exit': {
        const room = this.rooms.get(person.room ?? person.home);
        if (!room) return null;
        return {
          goal: 'exit',
          room: room.id,
          tile: room.layout.door,
          facing: 'nw',
          pose: 'stand',
          partner: null,
        };
      }
    }
  }

  private deskDestination(person: Person): Destination | null {
    const room = this.rooms.get(person.home);
    if (!room) return null;
    const desk = this.claimDesk(room, person.id);
    if (!desk) return this.loungeDestination(person);
    return {
      goal: 'desk',
      room: room.id,
      tile: desk.seat,
      facing: desk.facing,
      pose: deskPose(person, this.now),
      partner: null,
    };
  }

  private claimDesk(room: WorldRoom, personId: string) {
    for (const [index, owner] of room.deskOwner) {
      if (owner === personId) {
        const desk = room.layout.desks[index];
        if (desk) return desk;
        room.deskOwner.delete(index);
      }
    }
    const free = room.layout.desks.find((desk) => !room.deskOwner.has(desk.index));
    if (!free) return null;
    room.deskOwner.set(free.index, personId);
    return free;
  }

  private loungeDestination(person: Person): Destination | null {
    const lounge = this.rooms.get(LOUNGE_ID);
    if (!lounge) return null;
    const wantsCoffee = person.lounge?.phase === 'coffee';
    const free = lounge.layout.spots.filter(
      (spot) => !this.isTaken(LOUNGE_ID, spot.tile, person.id),
    );
    const appliances = free.filter(
      (spot) => spot.kind === 'coffee' || spot.kind === 'cooler' || spot.kind === 'vending',
    );
    const social = free.filter(
      (spot) => spot.kind === 'sofa' || spot.kind === 'stand' || spot.kind === 'arcade',
    );
    let spot: Spot | undefined;
    if (wantsCoffee) {
      spot = appliances.find((candidate) => candidate.kind === 'coffee') ?? appliances[0];
    } else {
      // Join someone who is already hanging out, the way people drift into conversations.
      const company = [...this.people.values()].filter(
        (other) =>
          other.id !== person.id && other.room === LOUNGE_ID && other.lounge?.phase === 'hangout',
      );
      const near = social.filter((candidate) =>
        company.some(
          (other) =>
            Math.abs(other.x - candidate.tile.x) + Math.abs(other.y - candidate.tile.y) <= 2,
        ),
      );
      const pool = near.length > 0 && this.random() < 0.75 ? near : social;
      spot = pool.length > 0 ? pick(this.random, pool) : undefined;
    }
    if (spot) {
      return {
        goal: 'lounge',
        room: LOUNGE_ID,
        tile: spot.tile,
        facing: spot.facing,
        pose: spot.sit ? 'sit' : wantsCoffee ? 'drink' : 'stand',
        partner: null,
      };
    }
    const tile = this.freeTile(LOUNGE_ID, person.id);
    if (!tile) return null;
    return { goal: 'lounge', room: LOUNGE_ID, tile, facing: 'sw', pose: 'stand', partner: null };
  }

  private visitDestination(person: Person, partnerId: string): Destination | null {
    const partner = this.people.get(partnerId);
    if (!partner?.room) return null;
    const room = this.rooms.get(partner.room);
    if (!room) return null;
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
    const tile =
      (current && candidates.some((candidate) => sameTile(candidate, current)) ? current : null) ??
      candidates.find(
        (candidate) =>
          isWalkable(room.layout, candidate) &&
          !this.isTaken(room.id, candidate, person.id) &&
          !room.layout.desks.some((desk) => sameTile(desk.seat, candidate)),
      );
    if (!tile) return null;
    return {
      goal: 'visit',
      room: room.id,
      tile,
      facing: lookDir(tile, base, 'ne'),
      pose: 'stand',
      partner: partnerId,
    };
  }

  private isTaken(roomId: string, tile: Tile, exceptId: string): boolean {
    for (const other of this.people.values()) {
      if (other.id === exceptId) continue;
      if (other.dest?.room === roomId && sameTile(other.dest.tile, tile)) return true;
      if (
        other.room === roomId &&
        Math.round(other.x) === tile.x &&
        Math.round(other.y) === tile.y &&
        other.path.length === 0
      ) {
        return true;
      }
    }
    return false;
  }

  private freeTile(roomId: string, personId: string): Tile | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const options: Tile[] = [];
    for (let y = 1; y < room.layout.depth; y += 1) {
      for (let x = 1; x < room.layout.width; x += 1) {
        const tile = { x, y };
        if (isWalkable(room.layout, tile) && !this.isTaken(roomId, tile, personId))
          options.push(tile);
      }
    }
    return options.length > 0 ? pick(this.random, options) : null;
  }

  private isAvailable(id: string): boolean {
    const other = this.people.get(id);
    return Boolean(
      other && other.stage === 'present' && other.room && other.path.length === 0 && !other.script,
    );
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
      // Start talking once there; give up if the other person never becomes reachable.
      if (this.time - person.goalSince > 15) {
        if (script.kind === 'brief') person.briefed = true;
        if (script.kind === 'report') person.reported = true;
        this.finishScript(person);
        return;
      }
      if (person.arrivedAt === null || person.dest?.goal !== 'visit') return;
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
    const loungers = [...this.people.values()].filter(
      (person) =>
        person.room === LOUNGE_ID &&
        person.stage === 'present' &&
        person.arrivedAt !== null &&
        person.path.length === 0 &&
        !person.script,
    );
    for (const speaker of loungers) {
      if (this.time < this.nextLoungeChatAt) return;
      if (speaker.nextChatAt > this.time) continue;
      const partner = loungers.find(
        (other) =>
          other !== speaker &&
          other.nextChatAt <= this.time + 6 &&
          Math.abs(other.x - speaker.x) + Math.abs(other.y - speaker.y) <= 3,
      );
      if (!partner) {
        speaker.nextChatAt = this.time + 3;
        continue;
      }
      const room = this.rooms.get(partner.home)?.name ?? '';
      const detail = speaker.agent.detail ?? '';
      const reason = speaker.lounge?.reason;
      const lines =
        reason === 'renovation'
          ? this.say.renovationTalk
          : this.say.smallTalk.filter(
              (line) =>
                (!line.includes('{detail}') || detail) && (!line.includes('{room}') || room),
            );
      this.speak(speaker, lines, { room, detail });
      this.queueSpeech(partner, pick(this.random, this.say.smallTalkReply), TUNING.replyDelay);
      this.face(speaker, partner);
      this.nextLoungeChatAt = this.time + TUNING.loungeChatGap;
      speaker.nextChatAt = this.time + between(this.random, TUNING.chatGapMin, TUNING.chatGapMax);
      partner.nextChatAt = this.time + between(this.random, TUNING.chatGapMin, TUNING.chatGapMax);
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
        person.x = -DOOR_STEP * (1 - progress);
        if (progress >= 1) this.setStage(person, 'present');
        return;
      }
      case 'exiting': {
        const progress = Math.min(1, person.stageTime / TUNING.doorFade);
        person.alpha = 1 - progress;
        person.x = -DOOR_STEP * progress;
        if (progress < 1) return;
        // Someone who came back mid-exit walks on instead of vanishing.
        if (person.departing && (!person.dest || person.dest.goal === 'exit')) {
          person.stage = 'gone';
          return;
        }
        person.room = null;
        this.setStage(person, 'transit');
        return;
      }
      case 'transit': {
        if (person.stageTime < TUNING.transit) return;
        if (person.departing && (!person.dest || person.dest.goal === 'exit')) {
          person.stage = 'gone';
          return;
        }
        this.think(person);
        const target = person.dest?.room;
        const room = target ? this.rooms.get(target) : undefined;
        if (room && (room.phase === 'open' || room.kind === 'lounge')) this.enter(person, room.id);
        else if (person.stageTime > 5) this.enter(person, LOUNGE_ID);
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
    const home = this.rooms.get(person.home);
    if (!home || home.phase === 'opening' || home.phase === 'closing') return;
    this.enter(person, home.phase === 'open' ? home.id : LOUNGE_ID);
    if (person.agent.kind === 'session') this.speak(person, this.say.greet);
    this.addLog('joined', { name: person.name, room: home.name });
  }

  private enter(person: Person, roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    person.room = roomId;
    person.x = -DOOR_STEP;
    person.y = room.layout.door.y;
    person.dir = 'se';
    person.path = [];
    person.alpha = 0;
    person.arrivedAt = null;
    this.setStage(person, 'entering');
  }

  private setStage(person: Person, stage: Person['stage']): void {
    person.stage = stage;
    person.stageTime = 0;
  }

  private walk(person: Person, dt: number): void {
    const room = person.room ? this.rooms.get(person.room) : undefined;
    const dest = person.dest;
    if (!room || !dest) return;
    const leaving = dest.goal === 'exit' || dest.room !== room.id;
    const target = leaving ? room.layout.door : dest.tile;

    const here = { x: Math.round(person.x), y: Math.round(person.y) };
    if (!isWalkable(room.layout, here) && person.path.length === 0) {
      // The floor changed under someone; put them back by the door.
      person.x = room.layout.door.x;
      person.y = room.layout.door.y;
      return;
    }
    const pathEnd = person.path.at(-1);
    if (
      person.path.length === 0 ? !sameTile(here, target) : pathEnd && !sameTile(pathEnd, target)
    ) {
      const from = person.path[0] ?? here;
      const avoid = new Set(
        [...this.people.values()]
          .filter((other) => other !== person && other.room === room.id && other.path.length === 0)
          .map((other) => `${Math.round(other.x)},${Math.round(other.y)}`),
      );
      const route = findPath(room.layout, from, target, avoid);
      if (route === null) {
        person.x = target.x;
        person.y = target.y;
        person.path = [];
      } else {
        person.path =
          sameTile(from, here) && person.x === here.x && person.y === here.y
            ? route
            : [from, ...route];
      }
    }

    const next = person.path[0];
    if (!next) {
      if (leaving) {
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
    const visit = person.lounge;
    if (visit && person.dest?.room === LOUNGE_ID) {
      visit.until =
        this.time +
        (visit.phase === 'coffee'
          ? TUNING.coffeeFor
          : between(this.random, TUNING.hangoutMin, TUNING.hangoutMax));
    }
    // Coming back to a freshly built room is worth a comment.
    const home = this.rooms.get(person.home);
    if (
      person.dest?.goal === 'desk' &&
      home?.phase === 'open' &&
      home.phaseTime < 12 &&
      this.random() < 0.3
    ) {
      this.speak(person, this.say.returning);
    }
  }

  private restingDir(person: Person, dest: Destination): Person['dir'] {
    const other = person.lookAt ? this.people.get(person.lookAt.id) : undefined;
    if (other && other.room === person.room) {
      return lookDir({ x: person.x, y: person.y }, { x: other.x, y: other.y }, dest.facing);
    }
    return dest.facing;
  }

  // ─── Rooms ────────────────────────────────────────────────────────────────────────────────

  private updateRooms(dt: number): void {
    const members = new Map<string, number>();
    for (const person of this.people.values()) {
      if (!person.departing) members.set(person.home, (members.get(person.home) ?? 0) + 1);
    }
    for (const room of [...this.rooms.values()]) {
      room.phaseTime += dt;
      if (room.kind === 'lounge') {
        this.updateLounge(room);
        continue;
      }
      const count = members.get(room.id) ?? 0;
      const occupied = this.isOccupied(room.id);
      switch (room.phase) {
        case 'opening':
        case 'building':
          if (room.phaseTime >= TUNING.build) this.setPhase(room, 'open');
          break;
        case 'open': {
          const wanted = workTierFor(Math.max(1, count));
          if (wanted > room.layout.tier) {
            this.renovate(room, wanted);
          } else if (wanted + 1 < room.layout.tier) {
            // Shrink with a tier of headroom, so one newcomer doesn't trigger another rebuild.
            room.shrinkFor += dt;
            if (room.shrinkFor > TUNING.shrinkAfter) this.renovate(room, wanted + 1);
          } else {
            room.shrinkFor = 0;
          }
          const anyone = [...this.people.values()].some((person) => person.home === room.id);
          room.emptyFor = anyone || occupied ? 0 : room.emptyFor + dt;
          if (room.emptyFor > TUNING.closeAfterEmpty) this.setPhase(room, 'closing');
          break;
        }
        case 'evacuating':
          if (!occupied || room.phaseTime > TUNING.evacuateTimeout) this.rebuild(room);
          break;
        case 'closing':
          if (count > 0) {
            this.setPhase(room, 'opening');
          } else if (room.phaseTime >= TUNING.close) {
            this.rooms.delete(room.id);
            this.layoutDirty = true;
            this.addLog('closed', { room: room.name });
          }
          break;
      }
    }
  }

  private updateLounge(lounge: WorldRoom): void {
    if (lounge.phase === 'building') {
      if (lounge.phaseTime >= TUNING.build) this.setPhase(lounge, 'open');
      return;
    }
    const wanted = loungeTierFor(this.people.size);
    if (wanted !== lounge.layout.tier && !this.isOccupied(LOUNGE_ID)) {
      lounge.layout = loungeLayout(wanted);
      this.setPhase(lounge, 'building');
      this.layoutDirty = true;
    }
  }

  /** Someone is inside, walking through the door, or on the way. */
  private isOccupied(roomId: string): boolean {
    for (const person of this.people.values()) {
      if (person.room === roomId) return true;
      if (person.stage === 'transit' && person.dest?.room === roomId) return true;
    }
    return false;
  }

  private renovate(room: WorldRoom, tier: number): void {
    room.pendingTier = tier;
    room.shrinkFor = 0;
    this.setPhase(room, 'evacuating');
    this.addLog(tier > room.layout.tier ? 'growing' : 'shrinking', { room: room.name });
    const speaker = [...this.people.values()].find(
      (person) => person.room === room.id && person.stage === 'present',
    );
    if (speaker) this.speak(speaker, this.say.evacuate, { room: room.name });
    // Everyone re-thinks right away instead of waiting out their current plan.
    for (const person of this.people.values()) if (person.home === room.id) person.brainTimer = 0;
  }

  private rebuild(room: WorldRoom): void {
    for (const person of this.people.values()) {
      if (person.room !== room.id) continue;
      // Stragglers are shown the door.
      person.room = null;
      person.path = [];
      person.dest = null;
      this.setStage(person, 'transit');
    }
    room.layout = workRoomLayout(room.pendingTier ?? room.layout.tier, room.id);
    room.pendingTier = null;
    for (const index of [...room.deskOwner.keys()]) {
      if (index >= room.layout.desks.length) room.deskOwner.delete(index);
    }
    this.setPhase(room, 'building');
    this.layoutDirty = true;
  }

  private setPhase(room: WorldRoom, phase: WorldRoom['phase']): void {
    room.phase = phase;
    room.phaseTime = 0;
  }

  private relayout(): void {
    this.layoutDirty = false;
    const ordered = [...this.rooms.values()].sort((a, b) => a.order - b.order);
    const origins = packOffice(
      ordered.map((room) => ({
        id: room.id,
        bounds: roomBounds(room.layout.width, room.layout.depth),
      })),
      this.aspect,
    );
    for (const room of ordered) {
      const target = origins.get(room.id);
      if (!target) continue;
      const fresh = Number.isNaN(room.target.x);
      room.target = target;
      if (fresh || !this.initializedLayout) room.origin = { ...target };
    }
    this.initializedLayout = true;
    this.layoutVersion += 1;
  }

  /** Re-packs the office for a new screen shape. */
  setAspect(aspect: number): void {
    if (Math.abs(aspect - this.aspect) < 0.05) return;
    this.aspect = aspect;
    this.layoutDirty = true;
  }

  private easeRooms(dt: number): void {
    const blend = 1 - Math.exp(-dt * 5);
    for (const room of this.rooms.values()) {
      room.origin.x += (room.target.x - room.origin.x) * blend;
      room.origin.y += (room.target.y - room.origin.y) * blend;
      if (Math.abs(room.target.x - room.origin.x) < 0.3) room.origin.x = room.target.x;
      if (Math.abs(room.target.y - room.origin.y) < 0.3) room.origin.y = room.target.y;
    }
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
