# WaveSpeed.ai Integration Tracker

Status: IN PROGRESS — no paid generation and no production deployment.
Started: 2026-11-03

## Acceptance rule

An item is complete only when its official endpoint/schema is recorded, UI-to-server payload is implemented, credits are verified, focused tests pass, and browser/API verification has evidence. Registry-only entries are not complete.

## Work items

| ID | Scope | Current state | Evidence / blocker |
|---|---|---|---|
| WS-1 | Kling 4.0 in `/video` | Ready for live test | Five official routes, exact capability contract, mode-aware tariff formula, and model registry tests pass. Live provider/browser test remains intentionally unrun. |
| WS-2 | GPT Image 2.5 Flare/Sunburst | Ready for live test | Four WaveSpeed routes, separate quality/resolution controls, references/output format, official pricing tables, and routing tests pass. Live provider/browser test remains intentionally unrun. |
| WS-3 | Video Edit | Partial | `/video-edit` posts to Kling 4.0 and has provider validation. Output polling, pricing parity, and browser checks remain. |
| WS-4 | Video Extend | Existing / audit required | Existing `/video-extend` flow exists; provider limits, credits, and mobile checks remain under audit. |
| WS-5 | WaveSpeed MCP | Ready for admin discovery test | Real Streamable HTTP JSON-RPC `initialize` + `tools/list` client and admin discovery action are implemented; mocked protocol tests pass. Live authenticated discovery and approved-schema activation remain. |
| WS-6 | Motion Transfer | Partial | Official route, form, payload mapping, validation, and credit formula are wired; no paid/live provider call performed. Browser checks remain. |
| WS-7 | Object Swap | Partial | Official route, form, payload mapping, validation, and credit formula are wired; no paid/live provider call performed. Browser checks remain. |
| WS-8 | Video Upscaler | Partial | Standard/Ultimate routes, exact resolutions/tariffs, form, payload mapping, validation, and output polling are wired; no paid/live provider call performed. Browser checks remain. |
| WS-9 | Verification | Partial | Focused WaveSpeed tests pass 17/17 and TypeScript passes. Full suite still has unrelated existing failures: DB at 198.51.100.1 unavailable, Kling v3 Turbo pricing expectation, Seedance margin expectation, and profile/knowledge/model audit DB-dependent tests. |

## Safety

- No provider generation calls are allowed during development verification.
- No production deployment or push is allowed in this task.
- Do not mark an item complete from a model ID or visual card alone.

## Evidence log — 2026-11-03

- Focused Vitest: **7/7 passed** outside the Windows sandbox. The sandbox-only run stopped before tests with `EPERM` during Vitest temp-file rename.
- TypeScript: still fails on 13 existing errors in generated route checks, unrelated image/profile typings, UI typings, and `DynamicVideoModel.provider`; current WaveSpeed tool page/registry/MCP fixes are not among the failures.
- The standalone tool page now polls `GET /api/video?taskId=...`, renders the returned video, and surfaces terminal failure instead of claiming completion immediately.
- Official Object Swap docs confirm `480p/540p/768p/1080p`, 3–15 billed seconds, and $0.15/$0.17/$0.20/$0.40 per second.
- Official GPT Image 2.5 docs confirm WaveSpeed routes `openai/gpt-image-2.5-{flare,sunburst}/{text-to-image,edit}`, quality `low/medium/high/xhigh/max`, resolution `1k/2k/4k`, 15 fixed ratios, up to 16 edit references, formats `png/jpeg/webp`, and separate text/edit price tables. The app now uses these WaveSpeed routes instead of direct OpenAI for these four IDs.
- Real MCP client uses `POST https://api.wavespeed.ai/mcp` with JSON-RPC 2.0, `Mcp-Method`, `Mcp-Name`, bearer auth, JSON/SSE parsing, and the official `initialize`/`tools/list` lifecycle. Mock tests prove discovery; no live key was used.
- `npx tsc --noEmit`: **passed** after fixing all 13 previous errors (route export leakage, inline result typing, dynamic video provider typing, and the introduced predicate issue).
- The remaining TypeScript fixes also removed the route-helper export that Next forbids and corrected three unrelated UI type errors (`isRTL` and camera movement display fields); final `npx tsc --noEmit` passed with zero errors.
- Full Vitest was run: the WaveSpeed-focused group is green, while the repository-wide failures remain outside this integration scope and are recorded rather than hidden.
