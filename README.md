# Wisper CLI

## Install without Git

### Windows PowerShell

```powershell
iwr -useb https://raw.githubusercontent.com/dix105/wisper-cli/master/install.ps1 | iex
```

The installer also tries to install SoX automatically with `winget` if it is missing.

Then:

```powershell
wisper setup
```

### macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/dix105/wisper-cli/master/install.sh | bash
```

Then:

```bash
wisper setup
```

To update later without redoing setup:

```bash
wisper update
```

The updater installs the latest version, keeps existing API key/shortcut/history, asks only for missing new options, refreshes autostart, and restarts the listener.

The installer downloads the repo, builds it, and links `wisper` into your user bin directory.


Clean CLI-first base for a Wispr Flow-style dictation tool.

## Simple UX

Start with one command:

```bash
wisper setup
```

It asks you to choose model from a menu, paste API key, verifies it, captures shortcut by pressing keys, asks whether to enable startup automatically, then starts the listener immediately.

Useful commands:

```bash
wisper provider   # choose provider from menu + verify key
wisper polish on  # enable auto polish before paste
wisper polish "rough dictated text" # polish text manually
wisper media on 35 # lower system volume to 35% while recording
wisper media test # test ducking/restoring system volume
wisper autostart on # enable startup listener
wisper autostart off # disable startup listener
wisper shortcut   # set shortcut
wisper mic --auto # test microphones and pick working one
wisper status     # show current setup
wisper update     # install latest and only ask missing setup prompts
wisper listen     # run background listener
wisper stop       # stop background listener
wisper restart    # restart background listener
wisper logs       # show listener logs
wisper open       # open local web app
```

## Base features

- CLI entrypoint: `wisper`
- Local transcript storage in `~/.wisper-cli/history.json`
- `wisper setup` for simple first-time setup
- `wisper provider` to choose provider from a menu
- `wisper polish on/off` to enable or disable auto-polish before paste
- `wisper polish "text"` to rewrite text manually with Groq polish mode
- `wisper media on/off/status/volume/test` to control Windows audio ducking while recording
- `wisper autostart on/off/status` to control startup listener without rerunning setup
- `wisper shortcut` to set shortcut from a prompt
- `wisper mic --auto` to record tiny test samples and pick the working microphone
- Windows listener watches for newly connected/removed microphones and auto-switches to the strongest working input
- `wisper status` to show current setup
- `wisper update` to install latest version while preserving setup
- `wisper listen` background listener target
- automatic startup after `wisper setup`
- optional auto-polish mode powered by Groq chat completions (`llama-3.3-70b-versatile`)
- optional Windows audio ducking: lower system/media volume while holding shortcut, then restore after release
- `wisper history` to print transcript history
- `wisper add "text"` to save a manual transcript while the base is being built
- `wisper app` / `wisper open` to launch a local web dashboard
- Local web dashboard at `http://127.0.0.1:3838`

## Not included in this base

- Meeting transcription
- Desktop/Tauri app shell
- Full recorder/hotkey implementation
- Cloud sync

See `docs/PLAN.md` for the full completion plan.

## Planned next features

1. `wisper record` — record mic audio from CLI.
2. `wisper transcribe <file>` — transcribe audio file.
3. Provider adapters — Groq first, then ElevenLabs/Sarvam.
4. `wisper polish "text"` — rewrite dictated text.
5. Settings command + local config file.
6. Better history search/filter/copy in the web dashboard.
