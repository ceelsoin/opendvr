# Contributing to OpenDVR

Thanks for your interest in contributing! This is a self-hosted ONVIF/RTSP camera manager (Node.js/TypeScript backend, React frontend, MediaMTX as the streaming engine). This guide covers how to get set up, the conventions the codebase follows, and how to submit changes.

For a full tour of the codebase, start with [docs/development.md](./docs/development.md) and [docs/architecture.md](./docs/architecture.md) — this file focuses on the contribution workflow itself.

## Before you start

- **Search existing issues/PRs first** to avoid duplicate work.
- **Camera-compatibility bugs**: check [docs/troubleshooting.md](./docs/troubleshooting.md) and [docs/chinese-oem-cameras.md](./docs/chinese-oem-cameras.md) first — several quirks with cheap/OEM cameras (Yoosee, iCSee, etc.) are already documented, known limitations rather than bugs.
- **Large changes**: open an issue first to discuss the approach before investing significant time, especially for anything touching MediaMTX provisioning, ONVIF connection handling, or the database schema.

## Getting set up

```bash
git clone https://github.com/ceelsoin/opendvr.git
cd opendvr
docker compose build
docker compose up -d
```

Or for local development with hot reload (no Docker), see [docs/getting-started.md](./docs/getting-started.md).

## Project layout

See [docs/development.md#repository-layout](./docs/development.md#repository-layout) for the full breakdown of `backend/` and `frontend/`.

## Conventions to follow

- **Backend**: TypeScript 7, no ORM (hand-written SQL against `better-sqlite3`), one repository module per table (`backend/src/db/*.repository.ts`), one router per resource (`backend/src/api/routes/*.routes.ts`). See [docs/development.md#typescript-conventions](./docs/development.md#typescript-conventions).
- **Frontend**: React 19 + Vite + Tailwind CSS v4, React Query for data fetching (one hook module per backend resource in `frontend/src/api/`), zustand for lightweight global state, Oxlint (not ESLint) for linting.
- **Docs**: all documentation is in English (see `docs/`). If your change affects configuration, environment variables, an API endpoint, or user-facing behavior, update the relevant doc in the same PR.
- **No new dependencies for things solvable with what's already there** — e.g. system stats use Node's built-in `os`/`fs` modules rather than adding `systeminformation`; prefer the same restraint unless there's a strong reason.
- **Secrets**: never commit real camera credentials, webhook URLs/tokens, or `.env` files. Use the `.env.example` pattern already in place.

## Validating your changes

There is currently **no automated test suite** for either backend or frontend — see [docs/development.md#testing](./docs/development.md#testing). At minimum, before opening a PR:

```bash
# Backend
cd backend && npx tsc --noEmit -p tsconfig.json

# Frontend (also typechecks via tsc -b)
cd frontend && npm run build

# Full stack smoke test
cd .. && docker compose up -d --build
curl http://localhost:4000/api/health
```

If your change affects a specific camera behavior (ONVIF/RTSP quirk, motion detection, etc.) and you have access to real hardware, test against it and mention the brand/model in your PR — this codebase has been shaped a lot by real-camera testing, and reviewers without your specific hardware can't always verify this themselves.

Contributions adding actual automated tests (e.g. for `lib/onvifUri.ts`, `lib/rtsp.ts`, `db/*.repository.ts` — pure logic that doesn't need a real camera or Docker) are very welcome, since none exist yet.

## Submitting a pull request

1. Fork the repo and create a branch off `main`.
2. Keep PRs focused — one logical change per PR is easier to review than a large mixed one.
3. Fill out the PR template (description, how it was tested, checklist).
4. Make sure `docs/` is updated if behavior, configuration, or the API surface changed.
5. Be responsive to review feedback — this is a small project, reviews may take a bit.

## Reporting bugs / requesting features

Use the issue templates (`.github/ISSUE_TEMPLATE/`) — they prompt for the information needed to reproduce/evaluate the request (steps to reproduce, environment, camera model, logs, etc.).

## Security

This project currently has **no built-in authentication** (see [docs/configuration.md](./docs/configuration.md) and [docs/features.md](./docs/features.md)) — this is a known, intentional gap for a trusted-LAN tool, not something to silently "fix" with a half-implemented auth layer in an unrelated PR. If you want to work on authentication, open an issue first to discuss the approach (session-based vs. the unused `jsonwebtoken`/`bcryptjs` deps already in `package.json`, scope, etc.).

If you find a security vulnerability, please open an issue describing it (there's no dedicated security contact/process yet for this project).

## License

No license file is currently included in this repository — treat all rights as reserved until one is added. By contributing, you agree your contribution may be included under whatever license is eventually adopted for the project.
