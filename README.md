# Mini Office

A Habbo-style pixel office where every project is a room and every AI agent is a person.

Mini Office watches the Claude Code sessions running on your machine and turns them into a
living office:

- **Every project folder is a room.** Worktrees and hidden work folders (`.claude/worktrees/x`,
  `.work/sites/x`) share their project's room.
- **Every agent is a person** with a stable random name, gender and look. Subagents wear a
  lanyard badge and are listed under the person who called them.
- **New agents walk in through the door** and say hi. Agents that finish go home.
- **Monitors show the work**: code for edits, a terminal for commands, pages for reading, a
  browser for web lookups. A bubble over each head says the same thing with an icon.
- **Real-life routines**: an agent that finishes waits at the desk with a raised hand, then goes
  for coffee, and dozes off if you leave it long enough. A long command is a good excuse for a
  coffee. A new helper gets briefed at the caller's desk and reports back before leaving.
  People chat in the lounge.
- **Rooms grow and shrink without breaking the layout.** When a room runs out of desks, everyone
  steps out to the lounge, the room is rebuilt bigger, and they walk back to their new desks.
  The office re-packs itself into the arrangement that fits your screen best.

## Run it

Requires Node 22.18+ and pnpm.

```sh
pnpm install
pnpm dev          # http://127.0.0.1:5199
```

No agents running? Click **Try the demo** (or open `/?source=demo`) for a scripted office.

To run it without Vite:

```sh
pnpm build
pnpm start        # http://127.0.0.1:4321 (PORT=… to change)
```

The server only listens on `127.0.0.1`.

## How it knows what agents do

The server reads Claude Code's own files, read-only:

| Source                                                                         | Used for                                                                                                                          |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `~/.claude/sessions/<pid>.json`                                                | Live sessions: id, folder, busy/idle. Dead pids are skipped. The sibling `.key` files are never read.                             |
| `~/.claude/projects/<folder>/<session>.jsonl`                                  | The tail of each transcript: the tool in flight, thinking, end of turn, title. Only appended bytes are read after the first look. |
| `~/.claude/projects/<folder>/<session>/subagents/agent-*.jsonl` + `.meta.json` | Helpers: their type, task, activity, and when they hand back.                                                                     |
| Recently written transcripts with no registry entry                            | Headless runs (`claude -p`, SDK).                                                                                                 |

Only short, safe hints reach the screen: a file name, the command's description (or just the
program name, never the full command line), a host name, a search query.

Snapshots stream to the browser over SSE (`/api/events?source=live|demo`). The API only answers
requests addressed to `127.0.0.1`, `localhost` or `[::1]`.

## Project layout

```
src/shared/          protocol (zod) and seeded randomness, used by both sides
src/server/          Node server: Claude Code source, demo source, SSE API
src/web/game/gfx/    procedural pixel art: avatars, furniture, rooms, icons, monitor screens
src/web/game/layout/ room tiers, lounge, A* pathfinding, office packing
src/web/game/sim/    the office simulation: people, goals, renovations, conversations
src/web/game/render/ canvas renderer, camera, sprite cache
src/web/app/         React HUD: team panel, person card, controls
src/web/i18n/        English and Brazilian Portuguese
```

## Checks

```sh
pnpm check   # typecheck, lint, prettier, tests, build
```
