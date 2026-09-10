# Repository safeguards

- Keep `extensions/kimetsu.ts` and `skills/kimetsu-brain/SKILL.md` synchronized with
  the canonical assets in `RodCor/kimetsu`. Changes affecting both need paired PRs.
- Tests that run the real Kimetsu CLI must use `tests/helpers/sandbox.ts`. Create
  and verify an independent Git root before running any Kimetsu command. Use the
  fixture environment for every subprocess, including subprocesses the extension
  starts. Never run test `init`, config, memory, or migration commands against a
  developer checkout or home brain.
- Keep test homes, user brains, caches, and transcripts under the fixture root.
  Do not inherit credentials, Git redirection, or Kimetsu configuration overrides.
  Check resolved cleanup paths before recursive deletion. Do not globally install
  or upgrade Kimetsu to run tests.
- Before merging, run typecheck, the full suite including the real CLI integration,
  the dependency audit, and package dry-run. CI must pass on all three platforms.
  `npm run test:integration` fails if `KIMETSU_TEST_BINARY` is missing.
- Use PRs and the required checks for `main`. Do not bypass or weaken repository
  protection to land a change. Keep Actions pinned to full commit SHAs and tokens
  scoped to the jobs that need them. A release needs matching package/tag versions
  and successful CI for the tagged commit on `main`.
