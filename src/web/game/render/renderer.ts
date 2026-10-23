import {
  AVATAR_ANCHOR_X,
  AVATAR_ANCHOR_Y,
  AVATAR_HEAD_TOP,
  AVATAR_W,
  type AvatarView,
} from '../gfx/avatar-art.ts';
import { FURNITURE_ANCHOR_X, FURNITURE_ANCHOR_Y } from '../gfx/furniture-art.ts';
import { HALF_H, HALF_W, project } from '../gfx/iso.ts';
import {
  SCREEN_FRAMES,
  screenPatternFor,
  type ScreenPattern,
  type StatusIcon,
} from '../gfx/overlay-art.ts';
import { type Pixmap } from '../gfx/pixmap.ts';
import { WALL_HEIGHT } from '../layout/office-layout.ts';
import type { Furniture } from '../layout/types.ts';
import { TUNING } from '../sim/tuning.ts';
import { LOUNGE_ID, type Bubble, type Person, type WorldRoom } from '../sim/types.ts';
import type { World } from '../sim/world.ts';
import type { Camera } from './camera.ts';
import { LabelPlacer } from './label-placer.ts';
import { SpriteCache } from './sprites.ts';

/** Overlay paint comes from the same CSS tokens as the HUD, read once at startup. */
function readInk() {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue(`--${name}`).trim();
  return {
    void: token('color-void'),
    voidGlow: token('color-void-glow'),
    bubble: token('color-bubble'),
    bubbleBorder: token('color-ink'),
    text: token('color-ink'),
    plate: token('color-plate'),
    plateBorder: token('color-panel-edge'),
    plateText: token('color-cream'),
    plateCount: token('color-sun'),
    renovate: token('color-amber'),
    shadow: token('color-shade'),
    arrow: token('color-bubble'),
    font: token('font-ui'),
  };
}

type Ink = ReturnType<typeof readInk>;
/** CSS px; the floor for any text on screen. */
const TEXT_SIZE = 14;
/** At most this many speech bubbles at once, newest first, so the office stays readable. */
const MAX_BUBBLES = 6;
/** Art pixels between the head and the first line of text: status bubble, then arrow. */
const STACK_PLAIN = 25;
const STACK_SELECTED = 34;

export interface RenderView {
  width: number;
  height: number;
  dpr: number;
  time: number;
  selectedId: string | null;
  hoverId: string | null;
  showNames: boolean;
  loungeName: string;
  renovatingLabel: string;
}

interface DrawnPerson {
  person: Person;
  pm: Pixmap;
  /** Device-pixel rectangle of the sprite. */
  x: number;
  y: number;
  scale: number;
  head: { x: number; y: number };
}

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const easeOutBack = (t: number) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;

export class Renderer {
  private readonly sprites = new SpriteCache();
  private drawn: DrawnPerson[] = [];
  private readonly context: CanvasRenderingContext2D;
  private readonly ink: Ink = readInk();

  constructor(context: CanvasRenderingContext2D) {
    this.context = context;
  }

  render(world: World, camera: Camera, view: RenderView): void {
    const ctx = this.context;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawVoid(view);
    const origin = camera.offset(view.width, view.height);
    const scale = camera.scale;
    ctx.setTransform(scale, 0, 0, scale, origin.x, origin.y);
    ctx.imageSmoothingEnabled = false;

    this.drawn = [];
    const rooms = [...world.rooms.values()].sort((a, b) => a.origin.y - b.origin.y);
    for (const room of rooms) this.drawRoom(world, room, view, scale, origin);
    for (const item of this.drawn) this.drawStatus(world, item, view, scale, origin);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Plates claim their spot first, so names and speech stack around them instead of hiding them.
    const placer = new LabelPlacer(4 * view.dpr);
    for (const room of rooms) this.drawRoomLabel(world, room, view, scale, origin, placer);
    const audible = newestBubbles(this.drawn.map((item) => item.person));
    for (const item of this.drawn) this.drawNameAndSpeech(item, view, audible, placer);
  }

  /** The topmost person under a canvas point, tested against the actual sprite pixels. */
  hitTest(x: number, y: number): string | null {
    for (let index = this.drawn.length - 1; index >= 0; index -= 1) {
      const item = this.drawn[index];
      if (!item) continue;
      const localX = (x - item.x) / item.scale;
      const localY = (y - item.y) / item.scale;
      if (localX < 0 || localY < 0 || localX >= item.pm.width || localY >= item.pm.height) continue;
      // A little slack around thin sprites makes them easy to tap.
      for (const [dx, dy] of [
        [0, 0],
        [2, 0],
        [-2, 0],
        [0, 2],
        [0, -2],
      ] as const) {
        if (item.pm.isOpaqueAt(localX + dx, localY + dy)) return item.person.id;
      }
    }
    return null;
  }

  private drawVoid(view: RenderView): void {
    const ctx = this.context;
    const gradient = ctx.createRadialGradient(
      view.width / 2,
      view.height * 0.35,
      0,
      view.width / 2,
      view.height * 0.35,
      Math.max(view.width, view.height) * 0.75,
    );
    gradient.addColorStop(0, this.ink.voidGlow);
    gradient.addColorStop(1, this.ink.void);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, view.width, view.height);
  }

  private drawRoom(
    world: World,
    room: WorldRoom,
    view: RenderView,
    scale: number,
    origin: { x: number; y: number },
  ): void {
    const ctx = this.context;
    const ox = Math.round(room.origin.x);
    const oy = Math.round(room.origin.y);
    const { width: w, depth: d } = room.layout;

    // Skip rooms that are fully off screen.
    const left = origin.x + (ox - d * HALF_W - 20) * scale;
    const right = origin.x + (ox + w * HALF_W + 20) * scale;
    const top = origin.y + (oy - WALL_HEIGHT - 40) * scale;
    const bottom = origin.y + (oy + (w + d) * HALF_H + 20) * scale;
    if (right < 0 || left > view.width || bottom < 0 || top > view.height) return;

    const building = room.phase === 'opening' || room.phase === 'building';
    const progress = building ? clamp(room.phaseTime / TUNING.build) : 1;
    const fade = room.phase === 'closing' ? clamp(1 - room.phaseTime / TUNING.close) : 1;
    const art = this.sprites.room(room.layout, room.theme);
    ctx.globalAlpha = fade;

    if (progress >= 1) {
      ctx.drawImage(art.walls, ox - art.originX, oy - art.originY);
      ctx.drawImage(art.floor, ox - art.originX, oy - art.originY);
    } else {
      ctx.globalAlpha = fade * clamp((progress - 0.45) / 0.3);
      ctx.drawImage(art.walls, ox - art.originX, oy - art.originY);
      const span = w + d;
      for (let y = 0; y < d; y += 1) {
        for (let x = 0; x < w; x += 1) {
          const local = clamp((progress - ((x + y) / span) * 0.5) / 0.18);
          if (local <= 0) continue;
          const tile = this.sprites.floorTile(room.theme, (x + y) % 2);
          const topPoint = project(x, y);
          ctx.globalAlpha = fade * local;
          ctx.drawImage(
            tile.canvas,
            ox + topPoint.x - 16,
            Math.round(oy + topPoint.y - (1 - local) * 12),
          );
        }
      }
      this.drawDust(room, progress, ox, oy);
    }
    ctx.globalAlpha = fade;

    // Furniture and people, back to front.
    const items: { depth: number; draw: () => void }[] = [];
    room.layout.furniture.forEach((item, index) => {
      const appear = building
        ? clamp((progress - 0.55 - (index / room.layout.furniture.length) * 0.3) / 0.15)
        : 1;
      if (appear <= 0) return;
      items.push({
        depth: item.x + item.y,
        draw: () => this.drawFurniture(world, room, item, ox, oy, appear, fade, view.time),
      });
    });
    for (const person of world.people.values()) {
      if (person.room !== room.id || person.stage === 'transit' || person.stage === 'hidden')
        continue;
      items.push({
        depth: person.x + person.y + 0.05,
        draw: () => this.drawPerson(world, person, ox, oy, fade, view, scale, origin),
      });
    }
    items.sort((a, b) => a.depth - b.depth);
    for (const item of items) item.draw();
    ctx.globalAlpha = 1;
  }

  private drawDust(room: WorldRoom, progress: number, ox: number, oy: number): void {
    const ctx = this.context;
    ctx.fillStyle = 'rgba(255, 246, 225, 0.75)';
    for (let index = 0; index < 10; index += 1) {
      const seed = (index * 9301 + room.order * 49297) % 233280;
      const u = ((seed % 97) / 97) * room.layout.width;
      const v = ((seed % 89) / 89) * room.layout.depth;
      const phase = (progress * 3 + index / 10) % 1;
      const point = project(u, v, phase * 18);
      const size = Math.max(1, Math.round(3 * (1 - phase)));
      ctx.globalAlpha = 0.8 * (1 - phase);
      ctx.fillRect(Math.round(ox + point.x), Math.round(oy + point.y), size, size);
    }
  }

  private drawFurniture(
    world: World,
    room: WorldRoom,
    item: Furniture,
    ox: number,
    oy: number,
    appear: number,
    fade: number,
    time: number,
  ): void {
    const ctx = this.context;
    const sprite = this.sprites.furniture(
      item.kind,
      item.kind === 'chair' ? room.order : item.variant,
    );
    const point = project(item.x, item.y);
    const drop = Math.round((1 - easeOutBack(appear)) * 22);
    const x = ox + point.x - FURNITURE_ANCHOR_X;
    const y = oy + point.y - FURNITURE_ANCHOR_Y - drop;
    ctx.globalAlpha = fade * clamp(appear * 1.6);
    ctx.drawImage(sprite.canvas, x, y);
    if (item.kind === 'desk' && item.deskIndex !== undefined) {
      const pattern = this.screenFor(world, room, item.deskIndex);
      if (pattern !== 'off') {
        const frame = Math.floor(time * 3) % SCREEN_FRAMES;
        ctx.drawImage(this.sprites.screen(pattern, frame).canvas, x, y);
      }
    }
  }

  private screenFor(world: World, room: WorldRoom, deskIndex: number): ScreenPattern {
    const ownerId = room.deskOwner.get(deskIndex);
    const owner = ownerId ? world.people.get(ownerId) : undefined;
    if (!owner) return 'off';
    const seated =
      owner.room === room.id && owner.dest?.goal === 'desk' && owner.arrivedAt !== null;
    if (!seated) return 'saver';
    if (world.isDozing(owner)) return 'saver';
    return screenPatternFor(owner.agent.activity);
  }

  private drawPerson(
    world: World,
    person: Person,
    ox: number,
    oy: number,
    fade: number,
    view: RenderView,
    scale: number,
    origin: { x: number; y: number },
  ): void {
    const ctx = this.context;
    const pose = world.poseOf(person);
    const view2: AvatarView = person.dir === 'se' || person.dir === 'sw' ? 'front' : 'back';
    const mirror = person.dir === 'sw' || person.dir === 'nw';
    const frame =
      pose === 'walk'
        ? Math.floor(person.walkTime * 7) % 4
        : pose === 'type'
          ? Math.floor(view.time * 5 + person.x) % 2
          : pose === 'wave'
            ? Math.floor(view.time * 4) % 2
            : 0;
    const sprite = this.sprites.avatar(
      {
        look: person.persona.look,
        view: view2,
        pose,
        frame,
        badge: person.agent.kind === 'subagent',
      },
      mirror,
    );
    const feet = project(person.x + 0.5, person.y + 0.5);
    const fx = Math.round(ox + feet.x);
    const fy = Math.round(oy + feet.y);
    const anchorX = mirror ? AVATAR_W - 1 - AVATAR_ANCHOR_X : AVATAR_ANCHOR_X;
    const seated = pose === 'sit' || pose === 'type' || pose === 'sleep';

    ctx.globalAlpha = fade * person.alpha;
    if (!seated) {
      ctx.fillStyle = this.ink.shadow;
      ctx.fillRect(fx - 6, fy - 1, 12, 2);
      ctx.fillRect(fx - 4, fy - 2, 8, 4);
    }
    const x = fx - anchorX;
    const y = fy - AVATAR_ANCHOR_Y;
    ctx.drawImage(sprite.canvas, x, y);
    ctx.globalAlpha = fade;

    const headY = fy - AVATAR_HEAD_TOP + (seated ? 4 : 0);
    this.drawn.push({
      person,
      pm: sprite.pm,
      x: origin.x + x * scale,
      y: origin.y + y * scale,
      scale,
      head: { x: origin.x + fx * scale, y: origin.y + headY * scale },
    });
  }

  private statusIcon(world: World, person: Person): StatusIcon | null {
    if (person.stage !== 'present' || person.alpha < 1) return null;
    if (world.isDozing(person)) return 'sleeping';
    if (person.agent.activity === 'waiting') return 'waiting';
    if (world.poseOf(person) === 'drink') return 'coffee';
    return person.agent.activity;
  }

  private drawStatus(
    world: World,
    item: DrawnPerson,
    view: RenderView,
    scale: number,
    origin: { x: number; y: number },
  ): void {
    const icon = this.statusIcon(world, item.person);
    const ctx = this.context;
    const headX = (item.head.x - origin.x) / scale;
    const headY = (item.head.y - origin.y) / scale;
    if (icon) {
      const sprite = this.sprites.status(icon);
      // Waiting bubbles bounce so they catch the eye without relying on color.
      const bounce = icon === 'waiting' ? Math.round(Math.abs(Math.sin(view.time * 5)) * -3) : 0;
      ctx.drawImage(
        sprite.canvas,
        Math.round(headX - sprite.pm.width / 2),
        Math.round(headY - sprite.pm.height - 3 + bounce),
      );
    }
    if (item.person.id === view.selectedId) {
      const bob = Math.round(Math.sin(view.time * 4) * 1.5);
      const tipY = Math.round(headY - (icon ? 24 : 6) + bob);
      ctx.fillStyle = this.ink.bubbleBorder;
      ctx.fillRect(Math.round(headX) - 5, tipY - 7, 11, 5);
      ctx.fillRect(Math.round(headX) - 3, tipY - 2, 7, 2);
      ctx.fillRect(Math.round(headX) - 1, tipY, 3, 2);
      ctx.fillStyle = this.ink.arrow;
      ctx.fillRect(Math.round(headX) - 4, tipY - 6, 9, 3);
      ctx.fillRect(Math.round(headX) - 2, tipY - 3, 5, 2);
      ctx.fillRect(Math.round(headX), tipY - 1, 1, 2);
    }
  }

  private drawNameAndSpeech(
    item: DrawnPerson,
    view: RenderView,
    audible: ReadonlySet<Bubble>,
    placer: LabelPlacer,
  ): void {
    const ctx = this.context;
    const { person } = item;
    const dpr = view.dpr;
    // Clear the status bubble (and the selection arrow) drawn above the head in art pixels.
    const selected = person.id === view.selectedId;
    let cursorY = item.head.y - (selected ? STACK_SELECTED : STACK_PLAIN) * item.scale;

    const showName = view.showNames || person.id === view.hoverId || selected;
    if (showName && person.alpha > 0.5) {
      ctx.font = `500 ${TEXT_SIZE * dpr}px ${this.ink.font}`;
      const text = person.name;
      const width = ctx.measureText(text).width + 10 * dpr;
      const height = 20 * dpr;
      const x = Math.round(onScreen(item.head.x - width / 2, width, view));
      const y = Math.round(placer.place(x, cursorY - height, width, height));
      ctx.fillStyle = this.ink.plate;
      roundRect(ctx, x, y, width, height, 4 * dpr);
      ctx.fill();
      ctx.fillStyle = this.ink.plateText;
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x + 5 * dpr, y + height / 2 + dpr * 0.5);
      cursorY = y - 4 * dpr;
    }

    for (let index = person.bubbles.length - 1; index >= 0; index -= 1) {
      const bubble = person.bubbles[index];
      if (!bubble || !audible.has(bubble)) continue;
      const life = TUNING.bubbleTtl - bubble.age;
      ctx.globalAlpha = clamp(life / 0.6) * clamp(bubble.age / 0.15);
      const rise = Math.min(bubble.age, 0.4) * 10 * dpr;
      const top = this.drawBubble(
        person.name,
        bubble.text,
        item.head.x,
        cursorY + rise,
        view,
        placer,
      );
      cursorY = top - 4 * dpr;
    }
    ctx.globalAlpha = 1;
  }

  /** A Habbo chat bubble: "Name: text". Returns the top edge it was drawn at. */
  private drawBubble(
    name: string,
    text: string,
    centerX: number,
    bottom: number,
    view: RenderView,
    placer: LabelPlacer,
  ): number {
    const ctx = this.context;
    const dpr = view.dpr;
    const size = TEXT_SIZE * dpr;
    const padding = 6 * dpr;
    const maxWidth = 200 * dpr;
    ctx.font = `700 ${size}px ${this.ink.font}`;
    const nameText = `${name}: `;
    const nameWidth = ctx.measureText(nameText).width;
    ctx.font = `400 ${size}px ${this.ink.font}`;
    const lines = wrap(ctx, text, maxWidth, nameWidth);
    const lineHeight = size * 1.25;
    const contentWidth = Math.max(
      ...lines.map((line, index) => ctx.measureText(line).width + (index === 0 ? nameWidth : 0)),
    );
    const width = contentWidth + padding * 2;
    const height = lines.length * lineHeight + padding * 1.4;
    const tail = 5 * dpr;
    // Keep the bubble on screen; only its tail has to point at the speaker.
    const x = Math.round(onScreen(centerX - width / 2, width, view));
    const y = Math.round(placer.place(x, bottom - height - tail, width, height + tail));

    ctx.fillStyle = this.ink.bubble;
    ctx.strokeStyle = this.ink.bubbleBorder;
    ctx.lineWidth = 2 * dpr;
    roundRect(ctx, x, y, width, height, 5 * dpr);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(centerX - 5 * dpr, y + height - dpr);
    ctx.lineTo(centerX, y + height + 5 * dpr);
    ctx.lineTo(centerX + 5 * dpr, y + height - dpr);
    ctx.fill();
    ctx.stroke();
    ctx.fillRect(centerX - 4 * dpr, y + height - 2 * dpr, 8 * dpr, 2 * dpr);

    ctx.textBaseline = 'top';
    lines.forEach((line, index) => {
      let lineX = x + padding;
      const lineY = y + padding * 0.8 + index * lineHeight;
      if (index === 0) {
        ctx.font = `700 ${size}px ${this.ink.font}`;
        ctx.fillStyle = this.ink.text;
        ctx.fillText(nameText, lineX, lineY);
        lineX += nameWidth;
      }
      ctx.font = `400 ${size}px ${this.ink.font}`;
      ctx.fillStyle = this.ink.text;
      ctx.fillText(line, lineX, lineY);
    });
    return y;
  }

  private drawRoomLabel(
    world: World,
    room: WorldRoom,
    view: RenderView,
    scale: number,
    origin: { x: number; y: number },
    placer: LabelPlacer,
  ): void {
    if (room.phase === 'closing') return;
    const ctx = this.context;
    const dpr = view.dpr;
    const anchor = {
      x: origin.x + Math.round(room.origin.x) * scale,
      y: origin.y + (Math.round(room.origin.y) - WALL_HEIGHT - 8) * scale,
    };
    if (
      anchor.x < -200 ||
      anchor.x > view.width + 200 ||
      anchor.y < -40 ||
      anchor.y > view.height + 40
    )
      return;
    const name = room.id === LOUNGE_ID ? view.loungeName : room.name;
    const count = [...world.people.values()].filter(
      (person) => person.home === room.id && !person.departing,
    ).length;
    const renovating = room.phase === 'evacuating' || room.phase === 'building';
    const size = TEXT_SIZE * dpr;
    ctx.font = `700 ${size}px ${this.ink.font}`;
    const nameWidth = ctx.measureText(name).width;
    const countText = room.id === LOUNGE_ID ? '' : String(count);
    const countWidth = countText ? ctx.measureText(countText).width + 18 * dpr : 0;
    const tag = renovating ? view.renovatingLabel : '';
    const tagWidth = tag ? ctx.measureText(tag).width + 14 * dpr : 0;
    const padding = 8 * dpr;
    const width = padding * 2 + nameWidth + countWidth + tagWidth;
    const height = 24 * dpr;
    const x = Math.round(onScreen(anchor.x - width / 2, width, view));
    const y = Math.round(placer.place(x, anchor.y - height, width, height));

    ctx.fillStyle = this.ink.plate;
    ctx.strokeStyle = renovating ? this.ink.renovate : this.ink.plateBorder;
    ctx.lineWidth = 2 * dpr;
    roundRect(ctx, x, y, width, height, 6 * dpr);
    ctx.fill();
    ctx.stroke();
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${size}px ${this.ink.font}`;
    ctx.fillStyle = this.ink.plateText;
    ctx.fillText(name, x + padding, y + height / 2 + dpr);
    let cursor = x + padding + nameWidth;
    if (countText) {
      // A tiny person glyph next to the head count.
      const glyphX = Math.round(cursor + 8 * dpr);
      const glyphY = Math.round(y + height / 2 - 5 * dpr);
      ctx.fillStyle = this.ink.plateCount;
      ctx.fillRect(glyphX + 2 * dpr, glyphY, 4 * dpr, 4 * dpr);
      ctx.fillRect(glyphX, glyphY + 5 * dpr, 8 * dpr, 5 * dpr);
      ctx.fillText(countText, glyphX + 10 * dpr, y + height / 2 + dpr);
      cursor += countWidth;
    }
    if (tag) {
      const tagX = cursor + 8 * dpr;
      ctx.fillStyle = this.ink.renovate;
      // Hazard stripes mark renovation by shape as well as color.
      for (let stripe = 0; stripe < 3; stripe += 1) {
        ctx.fillRect(tagX + stripe * 3 * dpr, y + 6 * dpr, 2 * dpr, height - 12 * dpr);
      }
      ctx.fillText(tag, tagX + 10 * dpr, y + height / 2 + dpr);
    }
  }
}

/** Shifts a label horizontally so it stays inside the canvas. */
function onScreen(x: number, width: number, view: RenderView): number {
  const margin = 8 * view.dpr;
  return clamp(x, margin, Math.max(margin, view.width - width - margin));
}

function newestBubbles(people: readonly Person[]): Set<Bubble> {
  const all = people.flatMap((person) => person.bubbles);
  all.sort((a, b) => a.age - b.age);
  return new Set(all.slice(0, MAX_BUBBLES));
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  firstIndent: number,
): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    const indent = lines.length === 0 ? firstIndent : 0;
    if (ctx.measureText(candidate).width + indent > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}
