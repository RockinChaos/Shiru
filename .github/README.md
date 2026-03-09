<p align="center">
	<a href="https://github.com/RockinChaos/Shiru">
		<img src="../.github/docs/assets/logo_filled.svg" width="400" alt="Shiru">
	</a>
</p>
<h4 align="center"><b>A personal anime library manager for watching and tracking your collection in real time. Lightweight, powerful, and paws-itively fast. No waiting required!</b></h4>

https://github.com/user-attachments/assets/3ff100f0-e008-4ff5-88f5-ad4290863f96

<p align="center">
  <a href="https://github.com/RockinChaos/Shiru/wiki/">📚 Wiki</a> •
  <a href="https://github.com/RockinChaos/Shiru/wiki/features/">✨ Features</a> •
  <a href="https://github.com/RockinChaos/Shiru/wiki/faq/">❓ FAQ</a> •
  <a href="#-building--development">🔧 Building & Development</a> •
  <a href="https://github.com/RockinChaos/Shiru/releases/latest/">⬇️ Download</a>
</p>
<p align="center">
  <a href="https://github.com/RockinChaos/Shiru/releases/latest/"><img alt="Downloads" src="https://img.shields.io/github/downloads/RockinChaos/Shiru/total?style=flat-square"></a>
  <a href="https://github.com/RockinChaos/Shiru/releases/latest/"><img alt="Latest Release" src="https://img.shields.io/github/v/release/RockinChaos/Shiru?style=flat-square"></a>
  <a href="https://github.com/RockinChaos/Shiru/commits"><img alt="Last Commit" src="https://img.shields.io/github/last-commit/RockinChaos/Shiru?style=flat-square"></a>
  <a href="https://github.com/RockinChaos/Shiru/stargazers"><img alt="Stargazers" src="https://img.shields.io/github/stars/RockinChaos/Shiru?style=flat-square"></a>
  <a href="../LICENSE"><img alt="License: GPLv3" src="https://img.shields.io/github/license/RockinChaos/Shiru?style=flat-square"></a>
</p>

## 📃 **About**

**Shiru** is a feature-rich anime library manager built around speed, control, and a seamless viewing experience, with full mobile support. Your files play directly for near-instant playback, giving you full native video performance with no transcoding and no compression.


## 💻 Supported Platforms
- 🪟 Windows
- 🐧 Linux
- 🍎 macOS (Apple Silicon & Intel)
- 📱 Android 7.0+ (Nougat)
- 📺 Android TV 7.0+ *(remote navigation is a work in progress; mouse, keyboard, or touch recommended)*

## ✨ Key Features:
- 🪄 **AniList & MyAnimeList Integration** - manage your lists, auto-track progress, rate and score anime, and explore related series, all without leaving the app
- 🎤 **Dub-first support** - Shiru tracks both dub and sub release schedules independently, with a Prefer Dubs setting that hides series from continue watching until the next dubbed episode is available
- 🔔 **Real-time release notifications** - instant alerts for new sub, dub, and hentai episode releases, including delayed and batch announcements
- 💬 **Full subtitle support** - softcoded and external subtitles (VTT, SSA, ASS, SUB, TXT) with per-series subtitle memory, CJK glyph fallback, and in-player track cycling
- 🌐 **Extension support** - optionally bring your own content sources, such as a personal media server, directly into the app
- 📱 **Full mobile support** - a complete Android experience with landscape/portrait support, immersive full-screen, external player integration, and progress tracking
- 🎮 **Fully customizable keybindings** - drag-and-drop keybind editor with extensive default shortcuts for playback, subtitles, navigation, and more
- 📡 **Offline support** - your library, watch history, and previously loaded media are fully accessible offline, with local file playback and media resolving working entirely without an internet connection
- 🎭 **Multiple profiles** - separate libraries, settings, and watch lists per profile, with optional cross-profile sync as you watch
- 🖥️ **Discord Rich Presence** - shows what you're watching, your current progress, and paused/browsing states

## 🎥 Anime Features:

### 🪄 AniList & MyAnimeList Integration
- Filter by name, genres, tags, season, year, format, and status
- Manage your watching and planning lists with a built-in list editor
- Automatically mark episodes as completed after watching
- Watch trailers and previews directly in the app
- Rate, score, and explore related anime and recommendations
- Image search to find and identify anime by picture
- Fully customizable home page with user-built sections based on custom genres, tags, and search queries
- *Sequels You Missed* and *Stories You Missed* home sections to catch up on related entries

### 🎤 Dub & Sub Tracking
Shiru has one of the most thorough dub tracking systems available. Each series independently tracks its sub and dub release schedules, with per-episode audio labels showing exactly what is available and when.

- **Prefer Dubs** - a setting that hides series from continue watching if your progress matches the latest aired dub
- **Dubbed Audio filter** - filters the search page to only show dubbed series, and toggles the airing schedule to show dub air times instead of sub air times for currently airing dubbed series
- **Dub, Sub, and Hentai release feeds** - live feeds sorted by newest release so you never miss a drop
- **Dub and Sub notifications** - separate scheduling and tracking for both, including delayed, indefinitely delayed, and batch release announcements
- Audio labels on cards, episode lists, and the banner showing Dub, Sub, or Dual Audio status

### 🌐 Extension-Based Content Fetching *(Optional)*
Out of the box, Shiru plays files you already have locally. Extensions unlock additional content fetching for **legally owned** media, such as accessing your own personal media server remotely.

- Automatic series and episode detection from file names
- Support for custom RSS feeds and resolution preferences
- Adjustable network speeds
- Dynamic extension loading, with results appearing as each extension completes rather than waiting for all to finish
- Design and use custom [extensions](https://github.com/RockinChaos/Shiru/wiki/Extensions) to connect your own content sources

### 🔔 Notifications
- Real-time alerts for new sub, dub, and hentai episodes
- Delayed and indefinitely delayed episode notifications
- Series announcement notifications for upcoming anime
- In-app notification tray that tracks all alerts regardless of system notification settings
- Notifications are auto-marked as read when the relevant episode is watched
- Notification filtering by list status, so you only get alerted for what you care about
- Optional prefer dubs setting that ensures you are only notified when a dubbed episode is available, falling back to sub only if no dub exists for the series

## 🎬 Video Playback Features

### 💬 Subtitle Support
- Softcoded and external subtitles: VTT, SSA, ASS, SUB, TXT
- Per-series subtitle memory, with your preferred track saved per source, so your choice carries over automatically
- CJK glyph fallback using Noto Sans for missing characters
- Subtitle file selector directly in the player
- Cycle through subtitle tracks with a single key

### 📺 Playback
- Near-instant local file playback with no transcoding or compression
- Automatic thumbnail generation as files buffer, making timeline scrubbing easy even without chapters
- Chapter-aware seekbar with progress indicators and skippable sections (OP, ED, recap, filler)
- Filler and recap detection with a prompt to skip or continue
- Autoplay next episode with fast episode transitions
- Multi-audio track support with descriptive labels
- Picture-in-Picture (PiP) mode
- Miniplayer with drag, resize, and auto-hide on pause
- Volume boost beyond 100% (desktop)
- Discord Rich Presence showing title, episode, and playback progress
- External player support on both Android and desktop
- Built-in file manager for viewing all files, with the ability to manually correct misidentified series names and episode numbers

### 🎮 Keybindings

All keybinds are fully customizable via drag-and-drop in the keybinds UI (`` ` ``).

| Key | Action                             |
|-----|------------------------------------|
| `S` | Skip opening (seek forward 90s)    |
| `R` | Seek backwards 90s                 |
| `→` / `←` | Seek forward / backward 2 seconds  |
| `↑` / `↓` | Increase / decrease volume         |
| `M` | Mute                               |
| `C` | Cycle subtitle tracks              |
| `F` | Toggle fullscreen                  |
| `P` | Toggle Picture-in-Picture          |
| `N` / `B` | Next / previous episode or file    |
| `O` | View anime details                 |
| `V` | Toggle volume limit boost          |
| `[` / `]` | Increase / decrease playback speed |
| `\` | Reset playback speed               |
| `I` | Show video stats                   |
| `H` | Open file manager                  |
| `` ` `` | Open keybinds editor               |

## ⚙️ **Installation**

### 🐧 **Linux Installation**:

#### Arch:
```bash
paru -S shiru
```

Or if you use yay:

```bash
yay -S shiru
```

#### Debian/Ubuntu:
1. 🔗 Download the `linux-Shiru-version.deb` from the [releases page](https://github.com/RockinChaos/Shiru/releases/latest).
2. 📦 Install using the package manager:

    ```bash
    apt install linux-Shiru-*.deb
    ```

---

### 🖥️ Windows Installation:
#### Option 1: 💨 Install via Winget
For Windows 10 **1809** or later, or Windows 11:
```bash
winget install shiru
```

#### Option 2: 🔄 Installer or Portable Version
1. 🔗 Download from the [releases page](https://github.com/RockinChaos/Shiru/releases/latest):
   - **Installer:** `win-Shiru-vx.x.x-installer.exe`
   - **Portable:** `win-Shiru-vx.x.x-portable.exe` *(No installation required, just run it)*

## 🔧 Building & Development

Credit to [NoCrypt](https://github.com/NoCrypt) for doing the legwork on this.

### 📋 Requirements:
- PNPM (or any package manager)
- NodeJS 22.21.1
- Visual Studio 2022 (if on Windows)
- Docker (with WSL on Windows)
- ADB & Android Studio (SDK 34)
- Java 21 (JDK)

###  💻 Building for PC (Electron):
1. Navigate to the Electron directory:
   ```bash
   cd electron
   ```
2. Install dependencies:
   ```bash
   pnpm install
   ```
3. Start development:
   ```bash
   pnpm start
   ```
4. Build for release:
   ```bash
   pnpm build
   ```

---

### 📱 Building for Android (Capacitor):
1. Navigate to the Capacitor directory:
   ```bash
   cd capacitor
   ```
2. Install dependencies:
   ```bash
   pnpm install
   ```
3. Run the doctor to check for missing dependencies:
   ```bash
   pnpm exec cap doctor
   ```
4. (First time only) Build native code:
   - Windows:
     ```bash
     pnpm build:native-win
     ```
   - Linux:
     ```bash
     pnpm build:native
     ```
5. (Optional) Generate assets:
   ```bash
   pnpm build:assets
   ```
6. Open the Android project:
   ```bash
   pnpm exec cap open android
   ```
7. Connect your device with ADB and start development:
   ```bash
   pnpm dev:start
   ```
8. Build the app for release (APK will not be [signed](https://github.com/NoCrypt/sign-android)):
   ```bash
   pnpm build:app
   ```

---

## 📜 License

This project follows the [GPLv3 License](../LICENSE).
