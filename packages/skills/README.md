# Saad Studio — Claude Code Skills Pack

Four production-ready skills that teach [Claude Code](https://claude.ai/code) how to use [Saad Studio](https://www.saadstudio.app) end-to-end via the [`@saadstudio/cli`](https://www.npmjs.com/package/@saadstudio/cli). Once installed, Claude Code fires the right skill automatically based on what you ask.

| Skill | Fires on prompts like |
|---|---|
| `saadstudio-image` | "generate an image of...", "make a picture of...", "render a shot of..." |
| `saadstudio-video` | "make a video of...", "animate this image", "turn this into a clip" |
| `saadstudio-ugc-video` | "make a UGC ad for...", "TikTok-style video of my product", "Reels ad for..." |
| `saadstudio-storyboard` | "give me a few options", "storyboard this", "concept sheet for..." |

## Install

### One-liner (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/saadstudio-source/saad-studio/main/packages/skills/install.sh | bash
```

Copies the four skill files into `~/.claude/skills/`. Re-run to update.

### Manual

Copy each `.md` file from `skills/` into `~/.claude/skills/` (or the project-scoped `.claude/skills/` if you only want them in one repo).

### Requirements

The skills call out to the `saadstudio` CLI, so install it separately:

```bash
npm i -g @saadstudio/cli
saadstudio login
```

Both `npm i -g` and `saadstudio login` are one-time setup — the login opens your browser, you approve on saadstudio.app, and the token is saved to `~/.saadstudio/token.json`.

## Try it

Open Claude Code and try any of:

- `generate a cinematic image of a desert sunset, 16:9`
- `make me 4 concepts for a matcha tin product ad`
- `animate this image with a slow push-in — 5 seconds, 9:16` *(with an image attached)*
- `create a full UGC ad for my new lantern brand, from concept to finished 9:16 video`

Claude Code picks the matching skill, calls the CLI, and streams the result files back into your session.

## Uninstall

```bash
rm ~/.claude/skills/saadstudio-*.md
```

## What's in a skill

Each `.md` file is a plain markdown document with YAML frontmatter:

```yaml
---
name: saadstudio-image
description: When Claude Code should invoke this skill
---

# instructions Claude Code follows when the skill fires
```

Read the individual files under [`skills/`](./skills) — they document the exact CLI calls, model choices, and guardrails for each workflow. Fork them if you want a house-style variant.

## License

MIT
