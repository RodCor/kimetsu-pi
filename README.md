# kimetsu-pi

Kimetsu brain as a Pi.dev package: persistent, cross-session memory for the Pi coding agent.

## What it is

Pi (the Pi.dev coding agent) has no MCP support, so this package brings Kimetsu's
persistent memory to Pi through Pi's own extension points instead:

- **Extension** (`extensions/kimetsu.ts`) — a TypeScript Pi extension that hooks into
  Pi lifecycle events (`session_start`, `agent_end`, `session_shutdown`) and shells out
  to the `kimetsu` binary to warm, load, and persist brain context around each session.
- **Skill** (`skills/kimetsu-brain/SKILL.md`) — a Pi skill that teaches the agent when
  and how to consult and record memories during a task.

## Prerequisite

The `kimetsu` binary must be on `PATH`. Install it with:

```sh
npm install -g kimetsu-ai
```

or via cargo, or one of the prebuilt archives — see
[github.com/RodCor/kimetsu](https://github.com/RodCor/kimetsu) for all install options.

If the binary is not found, the extension silently no-ops on every lifecycle hook —
Pi's startup and session behavior are completely unaffected.

## Install

```sh
pi install npm:kimetsu-pi
```

## What it does on each event

| Pi lifecycle event | Kimetsu command run |
| --- | --- |
| `session_start` | `kimetsu brain warm` then `kimetsu brain context-hook` |
| `agent_end` | `kimetsu brain stop-hook` |
| `session_shutdown` | `kimetsu brain session-end-hook` |

## Development

```sh
npm install
npm test
npm run typecheck
```

## License

MIT OR Apache-2.0

## See also

Main project: [github.com/RodCor/kimetsu](https://github.com/RodCor/kimetsu)
