# Multi-scene migration — expansion phase

This is an **additive preparatory phase**, not yet scene switching in gameplay.

## Guarantees

- No existing Room map, fog, tokens, or sceneData columns are deleted.
- Every existing room gets a `Scene` with deterministic ID `initial-<roomId>`, using its exact current stored map and fog.
- Existing tokens are linked to their initial scene.
- Token.sceneId stays **nullable** so that the currently deployed gateway can continue creating tokens while scene-aware writes are developed.
- Scene FK uses **ON DELETE SET NULL**, not cascade, to avoid accidental token deletion if a scene is deleted.
- Room members are assigned to their room's initial scene.
- The existing scene editor and VTT runtime still read the legacy Room fields, so this stage does not enable switching or introduce divergent live scene state.
- GM-only scene list/create/rename endpoints; non-GMs only see their own assigned scene.

## Preflight

Before applying this migration in Neon, back up the database and make sure no prior attempt of `20261007000000_multi_scenes` from the old PR #14 was executed. Do not run both migrations: they create the same table names.

Read-only sanity checks on Neon:

```sql
SELECT COUNT(*) AS rooms FROM "Room";
SELECT COUNT(*) AS tokens FROM "Token";
SELECT to_regclass('public."Scene"') AS scene_table;
SELECT to_regclass('public."RoomSceneAssignment"') AS assignment_table;
```

If either new table already exists, STOP and review migration history and contents before running anything.

## Post-migration checks

```sql
SELECT (SELECT COUNT(*) FROM "Room") AS rooms,
       (SELECT COUNT(*) FROM "Scene") AS scenes,
       (SELECT COUNT(*) FROM "Token") AS tokens,
       (SELECT COUNT(*) FROM "Token" WHERE "sceneId" IS NULL) AS tokens_without_scene;
```

Expect `scenes >= rooms` and `tokens_without_scene = 0` immediately after migration (before fresh legacy token writes).

Use a compatible Prisma 6 CLI for this repo. If executed via Neon SQL Editor instead of `prisma migrate deploy`, register it with `prisma migrate resolve --applied` only after confirming the entire SQL and backfill succeeded.

## Next PRs

1. Scene-aware map editor CRUD and persistence, preserving legacy room values during cutover.
2. Scene switching, per-player assignments, scene-scoped tokens, fog and Socket.IO events.
3. Audio-scene isolation, webcam and ambience compatibility, plus integration tests with two players.
4. Deprecate legacy fields only after a verified production backfill and rollback plan.

**Do not merge this PR before applying the matching additive migration to Neon**, because Render auto-deploys `main`.
