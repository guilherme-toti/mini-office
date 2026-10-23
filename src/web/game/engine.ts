import type { Activity, AgentInsight, AgentKind, OfficeSnapshot } from '../../shared/protocol.ts';
import { messages } from '../i18n/index.ts';
import { project } from './gfx/iso.ts';
import { floorBounds } from './gfx/floor-art.ts';
import { Camera, type Insets } from './render/camera.ts';
import { Renderer } from './render/renderer.ts';
import type { Look } from './sim/persona.ts';
import type { LogEntry, Person } from './sim/types.ts';
import { World } from './sim/world.ts';

export type Whereabouts =
  'desk' | 'kitchen' | 'lounge' | 'games' | 'meeting' | 'terrace' | 'walking' | 'away' | 'dozing';

export interface HudPerson {
  id: string;
  name: string;
  look: Look;
  kind: AgentKind;
  role: string | null;
  label: string | null;
  activity: Activity;
  detail: string | null;
  activitySince: number;
  roomId: string;
  roomName: string;
  parentId: string | null;
  parentName: string | null;
  insight: AgentInsight;
  whereabouts: Whereabouts;
}

export interface HudRoom {
  id: string;
  name: string;
  count: number;
  phase: 'open' | 'renovating';
}

export interface HudState {
  people: HudPerson[];
  rooms: HudRoom[];
  log: LogEntry[];
  selectedId: string | null;
  showNames: boolean;
  autoFit: boolean;
}

const HUD_EVERY = 0.25;
const MAX_DT = 0.1;
const DRAG_THRESHOLD = 5;

/** Runs the office: simulation, camera, input and drawing, plus a small state feed for React. */
export class OfficeEngine {
  readonly world = new World({ say: messages.say, seed: Date.now() % 100_000 });
  private readonly camera = new Camera();
  private canvas: HTMLCanvasElement | null = null;
  private renderer: Renderer | null = null;
  private observer: ResizeObserver | null = null;
  private frame = 0;
  private last = 0;
  private hudTimer = 0;
  private hud: HudState = {
    people: [],
    rooms: [],
    log: [],
    selectedId: null,
    showNames: false,
    autoFit: true,
  };
  private readonly listeners = new Set<() => void>();
  private width = 0;
  private height = 0;
  private dpr = 1;
  private selectedId: string | null = null;
  private hoverId: string | null = null;
  private showNames = false;
  private fittedVersion = -1;
  private hasFitted = false;
  private insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private dragDistance = 0;
  private pinchDistance = 0;
  private followId: string | null = null;
  private readonly cleanup: (() => void)[] = [];

  mount(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) return;
    this.renderer = new Renderer(context);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
    this.bindInput(canvas);
    this.last = performance.now();
    const loop = (now: number) => {
      this.step(now);
      this.frame = requestAnimationFrame(loop);
    };
    this.frame = requestAnimationFrame(loop);
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.observer?.disconnect();
    for (const undo of this.cleanup) undo();
    this.cleanup.length = 0;
    this.canvas = null;
    this.renderer = null;
  }

  applySnapshot(snapshot: OfficeSnapshot): void {
    this.world.applySnapshot(snapshot, Date.now());
    this.publish();
  }

  reset(): void {
    this.world.reset();
    this.selectedId = null;
    this.camera.autoFit = true;
    this.fittedVersion = -1;
    this.publish();
  }

  // ─── React bridge ─────────────────────────────────────────────────────────────────────────

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getHud = (): HudState => this.hud;

  /** The part of the canvas covered by HUD panels, so fitting keeps the office visible. */
  setInsets(insets: Insets): void {
    this.insets = insets;
    this.fittedVersion = -1;
  }

  select(id: string | null): void {
    this.selectedId = id;
    this.publish();
  }

  focus(id: string): void {
    this.selectedId = id;
    this.followId = id;
    this.publish();
  }

  zoom(direction: 1 | -1): void {
    this.followId = null;
    this.camera.zoomStep(direction, this.width / 2, this.height / 2, this.width, this.height);
    this.publish();
  }

  fit(): void {
    this.followId = null;
    this.camera.autoFit = true;
    this.fittedVersion = -1;
    this.publish();
  }

  toggleNames(): void {
    this.showNames = !this.showNames;
    this.publish();
  }

  // ─── Loop ─────────────────────────────────────────────────────────────────────────────────

  private step(now: number): void {
    const dt = Math.min(MAX_DT, (now - this.last) / 1000);
    this.last = now;
    if (!this.renderer || this.width === 0) return;
    this.world.tick(dt, Date.now());

    if (this.camera.autoFit && this.fittedVersion !== this.world.floorVersion) {
      const bounds = floorBounds(this.world.floor.width, this.world.floor.depth);
      this.camera.fit(bounds, this.width, this.height, this.scaledInsets(), !this.hasFitted);
      this.hasFitted = true;
      this.fittedVersion = this.world.floorVersion;
    }
    if (this.followId) this.follow(this.followId);
    this.camera.update(dt);
    this.renderer.render(this.world, this.camera, {
      width: this.width,
      height: this.height,
      dpr: this.dpr,
      time: now / 1000,
      selectedId: this.selectedId,
      hoverId: this.hoverId,
      showNames: this.showNames,
      zoneNames: messages.zones,
      renovatingLabel: messages.room.renovating,
    });

    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = HUD_EVERY;
      this.publish();
    }
  }

  private follow(id: string): void {
    const person = this.world.people.get(id);
    if (!person) return;
    // Aim a little above the feet, at the middle of the body.
    const { x: feetX, y: feetY } = project(person.x + 0.5, person.y + 0.5, 20);
    this.camera.focus(feetX, feetY, 3 * this.dpr);
    // Follow only until the camera arrives; after that the user is free to look around.
    if (Math.abs(this.camera.x - feetX) < 2 && Math.abs(this.camera.y - feetY) < 2)
      this.followId = null;
  }

  private scaledInsets(): Insets {
    const { top, right, bottom, left } = this.insets;
    return {
      top: top * this.dpr,
      right: right * this.dpr,
      bottom: bottom * this.dpr,
      left: left * this.dpr,
    };
  }

  private resize(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    this.dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
    const rect = canvas.getBoundingClientRect();
    this.width = Math.round(rect.width * this.dpr);
    this.height = Math.round(rect.height * this.dpr);
    canvas.width = this.width;
    canvas.height = this.height;
    this.fittedVersion = -1;
  }

  // ─── Input ────────────────────────────────────────────────────────────────────────────────

  private bindInput(canvas: HTMLCanvasElement): void {
    const point = (event: PointerEvent | WheelEvent) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (event.clientX - rect.left) * this.dpr,
        y: (event.clientY - rect.top) * this.dpr,
      };
    };
    const on = <K extends keyof HTMLElementEventMap>(
      type: K,
      handler: (event: HTMLElementEventMap[K]) => void,
    ) => {
      canvas.addEventListener(type, handler, { passive: false });
      this.cleanup.push(() => canvas.removeEventListener(type, handler));
    };

    on('pointerdown', (event) => {
      canvas.setPointerCapture(event.pointerId);
      this.pointers.set(event.pointerId, point(event));
      this.dragDistance = 0;
      this.pinchDistance = this.currentPinch();
    });
    on('pointermove', (event) => {
      const here = point(event);
      const before = this.pointers.get(event.pointerId);
      if (!before) {
        const hover = this.renderer?.hitTest(here.x, here.y) ?? null;
        if (hover !== this.hoverId) this.hoverId = hover;
        canvas.style.cursor = hover ? 'pointer' : 'grab';
        return;
      }
      this.pointers.set(event.pointerId, here);
      if (this.pointers.size === 2) {
        const distance = this.currentPinch();
        if (this.pinchDistance > 0 && Math.abs(distance - this.pinchDistance) > 40 * this.dpr) {
          const center = this.pinchCenter();
          this.camera.zoomStep(
            distance > this.pinchDistance ? 1 : -1,
            center.x,
            center.y,
            this.width,
            this.height,
          );
          this.pinchDistance = distance;
          this.dragDistance = Infinity;
        }
        return;
      }
      const dx = here.x - before.x;
      const dy = here.y - before.y;
      this.dragDistance += Math.abs(dx) + Math.abs(dy);
      if (this.dragDistance > DRAG_THRESHOLD * this.dpr) {
        this.followId = null;
        this.camera.panBy(dx, dy);
        canvas.style.cursor = 'grabbing';
      }
    });
    const release = (event: PointerEvent) => {
      const wasTap = this.pointers.size === 1 && this.dragDistance <= DRAG_THRESHOLD * this.dpr;
      this.pointers.delete(event.pointerId);
      if (wasTap) {
        const here = point(event);
        this.select(this.renderer?.hitTest(here.x, here.y) ?? null);
      }
      canvas.style.cursor = 'grab';
      this.publish();
    };
    on('pointerup', release);
    on('pointercancel', (event) => this.pointers.delete(event.pointerId));
    on('pointerleave', () => {
      this.hoverId = null;
    });
    on('wheel', (event) => {
      event.preventDefault();
      if (Math.abs(event.deltaY) < 4) return;
      const here = point(event);
      this.followId = null;
      this.camera.zoomStep(event.deltaY < 0 ? 1 : -1, here.x, here.y, this.width, this.height);
      this.publish();
    });
  }

  private currentPinch(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private pinchCenter(): { x: number; y: number } {
    const [a, b] = [...this.pointers.values()];
    return a && b
      ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      : { x: this.width / 2, y: this.height / 2 };
  }

  private whereabouts(person: Person): Whereabouts {
    const world = this.world;
    if (person.stage !== 'present') return 'away';
    if (person.path.length > 0 || person.arrivedAt === null) return 'walking';
    if (world.isDozing(person)) return 'dozing';
    if (person.dest?.goal === 'desk') return 'desk';
    const zone = world.zoneAt(person.x, person.y);
    return zone && zone.kind !== 'team' ? zone.kind : 'walking';
  }

  // ─── HUD feed ─────────────────────────────────────────────────────────────────────────────

  private publish(): void {
    const world = this.world;
    const people: HudPerson[] = [];
    for (const person of world.people.values()) {
      if (person.departing && person.stage === 'hidden') continue;
      const team = world.teams.get(person.home);
      const parent = person.agent.parentId ? world.people.get(person.agent.parentId) : undefined;
      people.push({
        id: person.id,
        name: person.name,
        look: person.persona.look,
        kind: person.agent.kind,
        role: person.agent.role,
        label: person.agent.label,
        activity: person.agent.activity,
        detail: person.agent.detail,
        activitySince: person.agent.activitySince,
        roomId: person.home,
        roomName: team?.name ?? '',
        parentId: person.agent.parentId,
        parentName: parent?.name ?? null,
        insight: person.agent.insight,
        whereabouts: this.whereabouts(person),
      });
    }
    const rooms: HudRoom[] = [...world.teams.values()]
      .sort((a, b) => a.order - b.order)
      .map((team) => ({
        id: team.id,
        name: team.name,
        count: people.filter((person) => person.roomId === team.id).length,
        phase: world.teamPhase(team.id),
      }));
    this.hud = {
      people,
      rooms,
      log: [...world.log],
      selectedId: this.selectedId && world.people.has(this.selectedId) ? this.selectedId : null,
      showNames: this.showNames,
      autoFit: this.camera.autoFit,
    };
    for (const listener of this.listeners) listener();
  }
}
