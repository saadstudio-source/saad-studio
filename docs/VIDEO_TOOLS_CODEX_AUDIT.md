# Video Tools Codex Audit — 2026-11-04

## Follow-up verification — 2026-11-04

- Vitest `EPERM` root cause: Vite/Vitest attempted cache renames under the Codex-managed Windows Temp directory. Setting process-local `TEMP` and `TMP` to the retained workspace directory `artifacts/vitest-tmp` resolved the cache error without changing application files or system settings.
- Focused video/WaveSpeed/Mock contracts: **PASS — 5 files / 19 tests** (`video-tools-sidebar-contract`, `wavespeed-video-tools-contract`, `wavespeed-new-models-contract`, `wavespeed-mcp-contract`, `wavespeed-gpt-image-contract`). No provider generation was called.
- `npx tsc --noEmit`: **PASS** on the latest rerun.
- Focused rerun with the safe Temp override: **PASS — 5 files / 19 tests**. The additional legacy pricing group reported 8 expectation mismatches in `test/pricing-core.test.ts` (Google video, Seedance 2.0, Alibaba Wan 3.0, and Gemini Omni Flash); these are classified as old expectations, not changed.
- Full Vitest was started with the safe Temp override. It exposed DB-dependent failures using the intentionally unreachable safety URL `198.51.100.1:5432`, plus legacy pricing mismatches; the bounded Codex run did not reach a clean suite summary. No expectations were changed, and the full suite is **not PASS**.
- `npm run test:db:status`: **BLOCKED** because Docker Desktop is not responding from this environment (`permission denied ... dockerDesktopLinuxEngine`). Integration DB tests were not falsely marked pass.
- `npm run build`: **BLOCKED** by Windows/Codex filesystem behavior while Next attempted `mkdir .next/server/app/api/cinema/shot/[id]` (`EPERM`). The `.next` directories are ordinary writable directories and no system permissions were changed; no build success is claimed.
- Backend mock coverage is represented by the focused contract suites; live WaveSpeed calls and paid generation were not performed. The isolated end-to-end UI/DB run remains pending outside Codex with Docker available.

## Scope

Read-only audit plus two minimal confirmed fixes. No paid provider call, production database access, Lara/Firecrawl change, or design change.

| Tool | Model ID / route | UI location | Status | Evidence / remaining |
|---|---|---|---|---|
| Text to Video | selected registry model; `/api/video` | `/video` Create Video | PASS (code) | Registry selection, validation, job/polling are present; live provider test blocked/not run. |
| Image to Video | selected registry model; `/api/video` | `/video` Create Video | PASS (code) | Reference upload and route mapping exist; live provider test blocked/not run. |
| Reference to Video | selected registry model; `/api/video` | `/video` reference mode | PASS (code) | Reference lists and media verification exist; live provider test blocked/not run. |
| Video Extension | model `video_api_route` / `/api/video` | `/video` Extension and `/video-extend` | PASS (code) | Polling/result paths exist; live provider test blocked/not run. |
| Edit Video | `kwaivgi/kling-v4.0/video-edit` | `/video` Edit Video and `/video-edit` | FIXED | Unified sidebar previously sent `kwaivgi/kling-v2.6-std/video-edit`, inconsistent with the registered Kling 4.0 route. Fixed in `components/video/EditVideoSidebarPanel.tsx`; direct page already used Kling 4.0. |
| Object Swap | `wavespeed-ai/openjutsu/object-swap` | `/video` Edit tools and `/video-tools/object-swap` | PASS (code) | Required video/target/change_to-or-image validation, upload and polling exist; no paid call. |
| Video Upscaler | `wavespeed-ai/video-upscaler` (Ultimate route in registry) | `/video` Edit tools and `/video-tools/video-upscaler` | FIXED | UI lacked 720p and used a pricing formula unrelated to Backend. Added 720p and matched standard rate table/duration bounds in `EditVideoSidebarPanel.tsx`. Live provider test remains blocked/not run. |
| Motion Transfer / Control | `kwaivgi/kling-v2.6-std/motion-control` | `/video` Motion Control and `/video-tools/motion-transfer` | PASS (code) | Image + motion video + orientation, upload, polling and validation exist; no paid call. |

## Unified prompt and button

`video/page.tsx` routes the single central button to Create, Edit, or Motion state. The edit panel disables prompt for Upscaler, uses prompt for Edit/Object Swap, and Motion only includes prompt when non-empty. No second generation button was added.

## Credits

Backend remains authoritative in `lib/credit-pricing.ts`. The confirmed UI mismatch was Upscaler pricing; it now uses the same standard rates (`0.025/0.025/0.05/0.1 USD per 5 seconds`) and 3–600 second bounds. Object Swap and Motion formulas were already aligned with the backend tables in the inspected paths.

## Verification

- `npx tsc --noEmit`: PASS.
- New contract test: added `test/video-tools-sidebar-contract.test.ts`.
- Focused Vitest rerun with process-local `TEMP`/`TMP` override: PASS for the 19 video/WaveSpeed contract tests; legacy pricing mismatches remain documented. No test result was falsely marked pass.
- `npm run build`: started but did not complete in the bounded Codex run; no successful build is claimed.
- Browser/provider/live API: BLOCKED/not run; no paid generation was attempted.

## Files changed by this audit

- `components/video/EditVideoSidebarPanel.tsx`
- `test/video-tools-sidebar-contract.test.ts`
- `docs/VIDEO_TOOLS_CODEX_AUDIT.md`
- `PROJECT_CONTEXT.md`

## Remaining before production

Run the focused Vitest suite, full build, and Playwright UI checks from ordinary PowerShell outside the Codex sandbox with the isolated test database. Then perform separately approved live provider smoke tests; none were performed here.

## Final verification update — 2026-11-04

- External build: **PASS (reported from ordinary PowerShell)**. The owner confirmed `npm run build` completed, printed the Next.js page table, and returned to the prompt without visible errors. This is evidence supplied after the Codex sandbox build was blocked; it was not re-executed inside Codex.
- Pricing review: the eight failures were stale expectations in `test/pricing-core.test.ts`, not current pricing defects. The implementation's tariff and margin rules were retained; only test expectations were updated. Current expected values include Google Veo 3.1 Fast `53.76`, Seedance 2.0 Fast turbo `96.6`, Seedance 2.0 `201.6`, Wan 3.0 `84/168/336` for 30 seconds, Wan route checks `5.6/11.2/22.4`, and Gemini Omni Flash `16.8/56/84/168` for 10 seconds by quality.
- Re-run after the test-only correction: **PASS — 6 files / 50 tests**, including pricing and focused video/WaveSpeed contracts. `npx tsc --noEmit`: **PASS**.
- Full Vitest: **NOT PASS / not cleanly completed in this environment**. Database-dependent and unrelated existing failures remain; the latest bounded run did not provide a final summary. No full-suite pass is claimed.
- Docker: **BLOCKED**. `docker info` reaches the client but the server returns `permission denied` for `npipe:////./pipe/dockerDesktopLinuxEngine`; the isolated database could not be started or verified. Production was not touched.
- Video/credits review: focused route, option, pricing, MCP-contract, and sidebar tests pass; no paid provider call was made. Live provider execution, isolated DB integration, and full UI/DB E2E remain unverified.

## Database and credits closure attempt — 2026-11-04

- Docker diagnosis: Docker named pipes are visible, but no Docker Desktop process was visible to this environment and both `docker info` and `npm run test:db:status` fail at the server connection with `permission denied` on `dockerDesktopLinuxEngine`. No permission or Docker setting was changed.
- Isolated DB integration: **BLOCKED**, not PASS. The integration runner explicitly confirmed nothing is listening on `127.0.0.1:5433`; it stopped before tests ran. Production DB was not contacted.
- Credits/idempotency tests: the available non-DB group initially had one stale Veo expectation (`26.88` vs current `53.76`); this test expectation was corrected in `test/provider-cost-capture-and-reconciliation.test.ts` without changing pricing code. The earlier focused pricing/video/WaveSpeed group remains 50/50 PASS; the full combined rerun did not produce a clean final summary in the bounded environment, so no combined PASS is claimed.
- Ready-to-run outside Codex (ordinary PowerShell, from the repository):
  `$env:TEST_DATABASE_URL='postgresql://saad_test:saad_test@127.0.0.1:5433/saad_studio_test'; $env:DATABASE_URL=$env:TEST_DATABASE_URL; $env:DIRECT_URL=$env:TEST_DATABASE_URL; npm run test:db:status; npm run test:db:up; npm run test:integration; npm run test:db:down`
  These commands use only the isolated port `5433`; run them only after Docker Desktop is running and accessible in that PowerShell session.

## External isolated database verification — 2026-11-04

- `npm run test:db:status`: **PASS** — `saad-studio-test-db` was running and healthy, with 57 public tables, at the isolated `localhost:5433/saad_studio_test` URL.
- `npm run test:db:up`: **PASS** — container accepted connections on `127.0.0.1:5433`; Prisma reported the test database already in sync with the schema.
- `npm run test:integration`: **PASS — 7 files / 50 tests**. Credit reconciliation, provider pricing, storage protection, admin control-plane, analytics, and knowledge hardening integration tests all passed.
- `npm run test:db:down`: **PASS** — only the disposable test container/network were removed; production was not touched.
- This result was executed from the repository root in ordinary Windows PowerShell and is distinct from the earlier Codex named-pipe permission block.

## Database and credits closure attempt — 2026-11-04

- Docker diagnosis: Docker named pipes are visible, but no Docker Desktop process was visible to this environment and both `docker info` and `npm run test:db:status` fail at the server connection with `permission denied` on `dockerDesktopLinuxEngine`. No permission or Docker setting was changed.
- Isolated DB integration: **BLOCKED**, not PASS. The integration runner explicitly confirmed nothing is listening on `127.0.0.1:5433`; it stopped before tests ran. Production DB was not contacted.
- Credits/idempotency tests: the available non-DB group initially had one stale Veo expectation (`26.88` vs current `53.76`); this test expectation was corrected in `test/provider-cost-capture-and-reconciliation.test.ts` without changing pricing code. The earlier focused pricing/video/WaveSpeed group remains 50/50 PASS; the full combined rerun did not produce a clean final summary in the bounded environment, so no combined PASS is claimed.
- Ready-to-run outside Codex (ordinary PowerShell, from the repository):
  `$env:TEST_DATABASE_URL='postgresql://saad_test:saad_test@127.0.0.1:5433/saad_studio_test'; $env:DATABASE_URL=$env:TEST_DATABASE_URL; $env:DIRECT_URL=$env:TEST_DATABASE_URL; npm run test:db:status; npm run test:db:up; npm run test:integration; npm run test:db:down`
  These commands use only the isolated port `5433`; run them only after Docker Desktop is running and accessible in that PowerShell session.
