# Wisper CLI

## Install without Git

If you have Node.js/npm installed, run:

```bash
curl -fsSL https://raw.githubusercontent.com/dix105/wisper-cli/master/install.sh | bash
```

Then:

```bash
wisper setup
```

The installer downloads the repo, builds it, and links `wisper` into `~/.local/bin`.


Clean CLI-first base for a Wispr Flow-style dictation tool.

## Simple UX

Start with one command:

```bash
wisper setup
```

It asks you to choose model from a menu, paste API key, verifies it, asks shortcut, then asks whether to enable startup automatically.

Useful commands:

```bash
wisper provider   # choose provider from menu + verify key
wisper shortcut   # set shortcut
wisper status     # show current setup
wisper listen     # run background listener
wisper open       # open local web app
```

## Base features

- CLI entrypoint: `wisper`
- Local transcript storage in `~/.wisper-cli/history.json`
- `wisper setup` for simple first-time setup
- `wisper provider` to choose provider from a menu
- `wisper shortcut` to set shortcut from a prompt
- `wisper status` to show current setup
- `wisper listen` background listener target
- automatic startup after `wisper setup`
- `wisper history` to print transcript history
- `wisper add "text"` to save a manual transcript while the base is being built
- `wisper app` / `wisper open` to launch a local web dashboard
- Local web dashboard at `http://127.0.0.1:3838`

## Not included in this base

- Meeting transcription
- Desktop/Tauri app shell
- Full recorder/hotkey implementation
- Cloud sync

## Planned next features

1. `wisper record` — record mic audio from CLI.
2. `wisper transcribe <file>` — transcribe audio file.
3. Provider adapters — Groq first, then ElevenLabs/Sarvam.
4. `wisper polish "text"` — rewrite dictated text.
5. Settings command + local config file.
6. Better history search/filter/copy in the web dashboard.
