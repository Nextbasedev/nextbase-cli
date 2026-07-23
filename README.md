# Nextbase CLI

**Wisper** is the first tool in Nextbase CLI: a voice-to-text utility that remains available as the `wisper` command. **NoteBot** is the second tool: it records meetings and turns them into transcripts, summaries, decisions, and action items. Future Nextbase command-line tools will live in this repository alongside them.


## Nextbase umbrella command

Use the umbrella command when you want a menu:

```bash
nextbase
```

It shows:

```txt
1. Wisper  - dictation / polish / spell fix
2. NoteBot - meetings / audio notes / tasks
```

You can also route directly through it:

```bash
nextbase wisper setup
nextbase notebot open
```

Individual tool commands still work:

```bash
wisper setup
notebot open
```

## macOS listener behavior

`wisper listen` starts the listener in the background so it survives closing Terminal. Use foreground mode only for debugging:

```bash
wisper listen --foreground
```

macOS also supports modifier-only shortcuts like `Ctrl+Command` / `Ctrl+Window` when typed directly:

```bash
wisper shortcut Ctrl+Command
```

For login startup on macOS, use:

```bash
wisper autostart on
```

This installs a LaunchAgent and avoids Terminal-owned listener processes.

## NoteBot — meeting notes

```bash
notebot setup
notebot meeting start
# When the meeting ends:
notebot meeting stop
notebot audio ./meeting.wav
notebot audio https://example.com/meeting.mp3
notebot open
notebot history
notebot tasks
```

`notebot setup` asks for missing keys locally:

- **Sarvam** or **Groq** key for multilingual transcription
- **Groq** key for meeting summaries, decisions, and action items

Meeting notes are stored locally under `~/.notebot/`. Responsibilities are assigned only when explicit in the transcript; otherwise they are marked `suggested` or `unassigned`. `notebot open` launches a local dashboard with Start Meeting, Stop & Generate Notes, meeting history, transcript, decisions, tasks, a Remote URL input, and a Choose Local File button for uploading audio directly from the browser.

## Install without Git

### Windows PowerShell

```powershell
iwr -useb https://raw.githubusercontent.com/Nextbasedev/nextbase-cli/master/install.ps1 | iex
```

The installer also tries to install SoX automatically with `winget` if it is missing.

Then:

```powershell
nextbase
```

### macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/Nextbasedev/nextbase-cli/master/install.sh | bash
```

Then:

```bash
nextbase
```

To update later without redoing setup:

```bash
wisper update
```

The updater installs the latest version, keeps existing API key/shortcut/history, asks only for missing new options, refreshes autostart, and restarts the listener.

The installer downloads the repo, builds it, and links `nextbase`, `wisper`, and `notebot` into your user bin directory.


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
wisper polish shortcut # set selected-text polish shortcut
wisper spell shortcut # set focused-input spelling-fix shortcut
wisper spell shortcut CommandOrControl+Alt+S # set it directly
wisper polish "rough dictated text" # polish text manually
wisper media on 35 # lower system volume to 35% while recording
wisper media test # test ducking/restoring system volume
wisper autostart on # enable startup listener
wisper autostart off # disable startup listener
wisper autoupdate status # check background auto-update setting
wisper autoupdate check # check GitHub for new version
wisper autoupdate check --apply # update now if available
wisper shortcut F15 # set dictation shortcut directly
wisper shortcuts # show supported shortcut keys
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

- CLI entrypoints: `nextbase`, `wisper`, and `notebot`
- Local transcript storage in `~/.wisper-cli/history.json`
- `wisper setup` for simple first-time setup
- `wisper provider` to choose provider from a menu
- `wisper polish on/off` to enable or disable auto-polish before paste
- `wisper polish shortcut` to set the global selected-text polish shortcut
- `wisper spell shortcut` to fix spelling in the entire focused text input without manual selection
- `wisper polish "text"` to rewrite text manually with Groq polish mode
- `wisper media on/off/status/volume/test` to control Windows audio ducking while recording
- `wisper autostart on/off/status` to control startup listener without rerunning setup
- `wisper autoupdate on/off/status/check` to keep the background listener updated automatically
- `wisper shortcut [key]` to set shortcut from a prompt or directly, e.g. `wisper shortcut F15`
- `wisper shortcuts` to show current shortcuts and supported keys
- `wisper mic --auto` to record tiny test samples and pick the working microphone
- Windows listener watches for newly connected/removed microphones and auto-switches to the strongest working input
- `wisper status` to show current setup
- `wisper update` to install latest version while preserving setup
- `wisper listen` background listener target
- automatic startup after `wisper setup`
- optional auto-polish mode powered by Groq chat completions (`llama-3.3-70b-versatile`)
- selected-text polish shortcut: select text anywhere, press `CommandOrControl+Shift+P`, and Wisper replaces it with polished text
- direct F-key setup for terminals that cannot capture F13-F24: `wisper shortcut F15`, `wisper polish shortcut F16`
- focused-input spell fix: focus an editable field and press `CommandOrControl+Alt+S`; Wisper selects all, fixes spelling only, and replaces the field content
- background auto-update: listener checks GitHub periodically, installs new builds silently, and restarts itself
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
