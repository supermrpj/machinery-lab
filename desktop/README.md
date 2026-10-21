# Desktop and tablet packaging — planned

The apps already run as single offline HTML files on Windows and macOS, and in
Safari on iPad when hosted. Native packages will be added with
[Tauri](https://tauri.app) (MIT / Apache-2.0), which wraps the built page:

| Target | Output | Engine |
|---|---|---|
| Windows | `LinkLab-setup.exe` (~10 MB) | WebView2 (built into Windows 10/11) |
| macOS | `LinkLab.dmg` | WebKit |
| iPad (optional) | App Store app (Tauri 2 mobile) | WebKit |

See `docs/ARCHITECTURE.md` §2–3 for the plan. In short:

1. Install Rust (`rustup`) and the Tauri CLI on the build machine.
2. Create a Tauri project here that loads `../dist/LinkLab.html`.
3. Provide a native version of the platform seam
   (`packages/ui-kit/src/files.js`) for Save/Open dialogs.
4. Add Tauri's licence notices to `THIRD_PARTY_NOTICES.md`.
