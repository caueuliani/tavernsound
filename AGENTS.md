# Repository Guidelines

## Project Structure

TavernSound is an npm workspaces monorepo. The NestJS API lives in `apps/api/src`, with Prisma schema and migrations in `apps/api/prisma`. The Next.js client is under `apps/web/app`; browser assets and sample maps are in `apps/web/public`. Deployment and local orchestration scripts are in `deploy/` and `work/` when present. Product and operational notes belong in `docs/`.

## Build, Test, and Development Commands

Run commands from the repository root with Node.js 22.12–24:

- `npm run dev:api` starts the NestJS API in watch mode.
- `npm run dev:web` starts the Next.js development server.
- `npm run build` builds the API and web application.
- `npm test --workspace=api -- --runInBand` runs the API Jest suite serially.
- `npm run test:proxy` runs deployment proxy tests with Node’s test runner.
- `npm run db:generate` regenerates Prisma Client; `npm run db:migrate` applies committed migrations.
- `npm start` runs the assembled deployment entry point. For the LAN HTTPS test environment, use the documented `work/start-tavernsound.mjs --lan` workflow.

## Coding Style and Naming

Use TypeScript with two-space indentation, single quotes, and semicolons where existing files use them. Keep React components and hooks in PascalCase/camelCase (`Grid.tsx`, `useSpatialAudio.ts`); NestJS classes use PascalCase and feature files use kebab-free descriptive names. Run `npm run format --workspace=api` before submitting API changes. Keep browser-only code inside client components or hooks.

## Testing Guidelines

API tests use Jest and `*.spec.ts`; end-to-end tests are in `apps/api/test`. Add regression coverage for authentication, room access, gateways, migrations, and spatial-audio behavior when changing those areas. Run focused validation during interactive development.
Run the full API suite and both builds only before a PR, release,
or when explicitly requested.

## Commits and Pull Requests

Use short imperative Conventional Commit subjects such as `feat: add scene editor`, `fix: sync Agora identities`, or `chore: update docs`. Pull requests should explain user-visible behavior, list validation commands, identify configuration or migration changes, and include screenshots or a short recording for UI changes. Never commit `.env` files, Agora certificates, TLS private keys, sessions, or uploaded user media.

## Security and Configuration

Copy the relevant `.env.example` files and keep secrets local. Do not enable billing, publish deployments, or alter test safety limits as part of routine development. Treat local uploads and self-signed HTTPS as development-only until persistent storage and trusted certificates are configured.

## Agent Working Guidelines

Prefer the smallest possible scope for each task.

- For simple questions, inspect only the files directly relevant to the question.
- Do not scan the entire repository unless the task explicitly requires architectural investigation.
- If the user mentions a specific file, directory, environment variable, component, or service, inspect that location first.
- For explanatory questions, do not modify files unless explicitly requested.
- For small changes, make the smallest viable patch and avoid unrelated refactors.
- Do not run full builds or full test suites for trivial changes unless necessary.
- Prefer focused tests for the affected workspace or feature.
- Do not reinstall dependencies unless required.
- Do not regenerate lockfiles unless dependency changes are requested.
- Do not modify generated files unless necessary.
- Preserve existing architecture and conventions unless the user explicitly requests a refactor.
- Before changing multiple unrelated areas of the repository, explain why they are required.

## Validation Strategy

Use validation proportional to the change.

For trivial configuration or text changes:
- verify the edited file only;
- do not run the full build.

For isolated frontend changes:
- run the narrowest relevant lint/type/build check when necessary.

For isolated API changes:
- run the relevant Jest spec first.

For cross-cutting changes:
- run focused tests first, then broader validation if needed.

Avoid running both full API and web builds after every small change.

## TavernSound Development Notes

TavernSound currently uses:

- Next.js frontend in `apps/web`
- NestJS backend in `apps/api`
- Prisma for persistence
- realtime/audio features that may involve WebRTC/Agora-related code

Treat authentication, room membership, realtime synchronization, and spatial audio as high-risk areas.

Changes in these areas should preserve existing behavior and should normally include focused regression testing.

## Local Test Environment

For LAN testing, prefer:

`node work/start-tavernsound.mjs --lan --skip-build`

Do not replace the documented LAN workflow with a different startup strategy unless explicitly requested.

When troubleshooting the LAN environment, distinguish between:
- application bugs;
- local network accessibility;
- HTTPS/self-signed certificate behavior;
- browser permissions;
- realtime/audio connectivity.

## Configuration

Beta/test access emails are controlled by configuration such as:

`TEST_ALLOWED_EMAILS`

When asked to modify test access, inspect the relevant environment configuration first instead of searching the entire authentication implementation.

Never expose secret values from `.env` files in responses.