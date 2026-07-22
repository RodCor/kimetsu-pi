---
name: kimetsu-brain
description: Use Kimetsu brain shell commands as a persistent memory sidecar across Pi sessions.
---
Kimetsu is a persistent brain sidecar accessible via the `kimetsu` CLI. Use it
when the task may benefit from prior session knowledge, workflow memory, or
durable cross-session context.

Brain-first workflow:
1. Before planning or editing broad coding, review, debugging, or setup tasks,
   run `kimetsu brain context <query>` and read the returned capsules as working
   context before deciding on a plan.
2. After solving a non-obvious problem, run `kimetsu brain record` with a
   concrete, actionable lesson and 2-5 domain tags so future sessions benefit.
3. Run `kimetsu brain status` when you need to know whether the brain is
   initialized, has accepted memories, or has pending proposals.

Optional mode: Kimetsu brain context is a preferred first step for non-trivial
work. If the binary is unavailable, note the absence and continue normally.
