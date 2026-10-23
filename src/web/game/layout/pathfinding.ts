import { isWalkable, type Grid, type Tile } from './types.ts';

const NEIGHBOURS: readonly Tile[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

/**
 * A* over the room grid with four-way moves, so people always walk along the two isometric
 * axes like Habbo avatars. Returns the tiles after `from`, ending on `to`, or null.
 */
export function findPath(
  layout: Grid,
  from: Tile,
  to: Tile,
  avoid: ReadonlySet<string> = new Set(),
): Tile[] | null {
  if (from.x === to.x && from.y === to.y) return [];
  if (!isWalkable(layout, to)) return null;
  const width = layout.width;
  const index = (tile: Tile) => tile.y * width + tile.x;
  const goal = index(to);
  const heuristic = (tile: Tile) => Math.abs(tile.x - to.x) + Math.abs(tile.y - to.y);

  const cost = new Map<number, number>([[index(from), 0]]);
  const cameFrom = new Map<number, number>();
  const open: { tile: Tile; score: number }[] = [{ tile: from, score: heuristic(from) }];

  while (open.length > 0) {
    let best = 0;
    for (let i = 1; i < open.length; i += 1) {
      if ((open[i]?.score ?? Infinity) < (open[best]?.score ?? Infinity)) best = i;
    }
    const current = open.splice(best, 1)[0];
    if (!current) break;
    const currentIndex = index(current.tile);
    if (currentIndex === goal) return rebuild(cameFrom, goal, index(from), width);
    const currentCost = cost.get(currentIndex) ?? 0;

    for (const step of NEIGHBOURS) {
      const next = { x: current.tile.x + step.x, y: current.tile.y + step.y };
      if (!isWalkable(layout, next)) continue;
      const nextIndex = index(next);
      // Other people's spots cost extra rather than block, so a crowd never traps anyone.
      const penalty = avoid.has(`${next.x},${next.y}`) && nextIndex !== goal ? 6 : 0;
      const nextCost = currentCost + 1 + penalty;
      if (nextCost >= (cost.get(nextIndex) ?? Infinity)) continue;
      cost.set(nextIndex, nextCost);
      cameFrom.set(nextIndex, currentIndex);
      open.push({ tile: next, score: nextCost + heuristic(next) });
    }
  }
  return null;
}

function rebuild(
  cameFrom: Map<number, number>,
  goal: number,
  start: number,
  width: number,
): Tile[] {
  const path: Tile[] = [];
  let cursor = goal;
  while (cursor !== start) {
    path.push({ x: cursor % width, y: Math.floor(cursor / width) });
    const previous = cameFrom.get(cursor);
    if (previous === undefined) break;
    cursor = previous;
  }
  return path.reverse();
}

/** Every walkable tile reachable from `from`. */
export function reachable(layout: Grid, from: Tile): Set<string> {
  const seen = new Set<string>([`${from.x},${from.y}`]);
  const queue: Tile[] = [from];
  while (queue.length > 0) {
    const tile = queue.shift();
    if (!tile) break;
    for (const step of NEIGHBOURS) {
      const next = { x: tile.x + step.x, y: tile.y + step.y };
      const key = `${next.x},${next.y}`;
      if (seen.has(key) || !isWalkable(layout, next)) continue;
      seen.add(key);
      queue.push(next);
    }
  }
  return seen;
}
