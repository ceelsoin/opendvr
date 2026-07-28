## Description

<!-- What does this PR do, and why? -->

## Related issue(s)

<!-- Closes #123, relates to #456 -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Documentation
- [ ] Refactor / internal change (no functional change)
- [ ] Other:

## How was this tested?

<!--
There is currently no automated test suite (see docs/development.md#testing).
Describe how you manually verified this change, e.g.:
- `npx tsc --noEmit` / `npm run build` passes (backend and/or frontend)
- Tested against a real camera (brand/model?) — what did you check?
- `docker compose up -d --build` and exercised the affected UI/API path
-->

## Checklist

- [ ] Backend typechecks: `cd backend && npx tsc --noEmit -p tsconfig.json`
- [ ] Frontend builds: `cd frontend && npm run build`
- [ ] Docs updated if behavior/config/env vars changed (`docs/`)
- [ ] No secrets/credentials committed (camera passwords, webhook URLs, tokens, `.env` files)
- [ ] For camera-compatibility changes: confirmed the change doesn't rely on hardware unavailable to reviewers (note if it does, and how you tested it)

## Screenshots (UI changes)

<!-- Before/after screenshots if this touches the frontend. -->
