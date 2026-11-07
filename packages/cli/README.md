# @saadstudio/cli

Command-line access to [Saad Studio](https://saadstudio.app). Generate images and videos from your terminal — the same credits, models, and history you use on the website.

## Install

```bash
npm i -g @saadstudio/cli
```

Requires Node 18 or newer.

## Sign in

```bash
saadstudio login
```

Opens your browser, asks you to approve access on saadstudio.app, and saves a token to `~/.saadstudio/token.json`. The token is scoped to `smart_cli.generate smart_cli.read` — the same scope the Claude connector uses. Revoke any time by disconnecting the connector on saadstudio.app or by running `saadstudio logout`.

## Commands

```bash
saadstudio whoami
saadstudio balance
saadstudio models --kind image
saadstudio models --kind video

saadstudio generate image "a cinematic desert sunset" --aspect 16:9 --out sunset.png
saadstudio generate image "a product shot of a matcha tin" -m seedream/5-pro -n 4

saadstudio generate video "camera pushes in on a lantern glow" \
  --image https://.../sunset.png --duration 8 --out lantern.mp4

saadstudio generations --limit 20
saadstudio generations --kind video
```

Add `--json` to any command that prints a summary to get the raw API response instead.

## Using it inside Claude Code

Once logged in, you can pipe Claude Code straight at the CLI:

```
> generate a 9:16 UGC-style shot of my product using the last image I made
```

Claude Code will call `saadstudio generations --kind image --limit 1 --json`, pick the URL, and pass it to `saadstudio generate video --image <url>`. See the Claude Code tab on <https://saadstudio.app/smart-cli> for the recommended skills pack.

## Configuration

- `SAADSTUDIO_API_BASE` — override the API host (default `https://saadstudio.app`). Useful for self-hosted or staging deployments.
- `SAADSTUDIO_CONFIG_DIR` — override the token directory (default `~/.saadstudio`).

## License

MIT
