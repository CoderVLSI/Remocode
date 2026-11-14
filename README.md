# Remo Code

An AI agent app for your phone, in the spirit of Google Antigravity's mobile app, with:

- **On-device models**: download a GGUF model and chat offline (via `llama.rn`).
- **Bring your own key**: Google Gemini, Anthropic Claude, OpenAI, OpenRouter, or any OpenAI-compatible server (Ollama, LM Studio, vLLM, Groq…).
- **Gemini Live voice**: real two-way conversation. Talk naturally, interrupt any time, and the assistant can call tools while it speaks, including starting coding tasks on your own computer (after you approve each one on screen).
- **Classic voice**: on-device speech recognition with spoken replies, for any model.
- **Email auth**: passwordless one-time code (or password) through Supabase.
- **Projects with resources**: add a **Google Drive** folder or files, **upload** text and code files from your phone, or attach a **GitHub** repo. The model can browse attached folders and repos (read-only, and only inside what you attached) and sees pinned files as context.
- **Connectors**: read-only Google Calendar, Drive, Docs and Sheets as model tools.
- **Remote Control**: send a task from your phone to an agent on your computer and watch its output live.

Built with Expo SDK 58 (React Native 0.88, expo-router, TypeScript).

## Install the APK

Build it yourself (see below), copy `remocode-arm64-release.apk` to your phone, and open it. You may need to allow "install unknown apps" for your file manager. The APK is arm64 (every modern phone) and signed with a debug key, which is fine for personal use but not for the Play Store.

On first launch, enter your **Supabase project URL and anon key** on the sign-in screen (Project Settings → API). No rebuild is needed. The app refuses service-role and secret keys on purpose.

## Quick start

> Native modules (`llama.rn`, `expo-speech-recognition`) mean this app needs a **development build**; Expo Go will not work.

```bash
npm install
cp .env.example .env        # fill in your Supabase URL + anon key
npx expo run:android        # or: npx expo run:ios (macOS)   |  eas build --profile development
npm start                   # dev server for the dev client
```

### Build an APK

You need **JDK 17** (React Native's Gradle plugin requires exactly 17; newer JDKs fail) and the Android SDK (platform 37, build-tools 37.0.0, NDK 27.1.12297006, CMake 3.22.1). The first build downloads a lot and takes 10 to 15 minutes.

```bash
npm install
export ANDROID_HOME=/path/to/android-sdk
./scripts/build-android.sh          # arm64 only; ARCHS="arm64-v8a,x86_64" to include emulators
# -> dist/remo-code-release.apk
```

The script runs `expo prebuild`, points Gradle at your SDK and JDK 17, and builds. If a build behind a restrictive proxy fails with 403 on `repo.reactnative.dev`, allow that host: Maven Central redirects the React Native Android library there.

Or in the cloud: `npx eas-cli build --platform android --profile preview` (needs an Expo account).

### Supabase setup (one time)

1. Create a project at supabase.com. Copy the **URL** and **anon key** into `.env` for development, or simply type them into the app's sign-in screen (needed for a prebuilt APK).
2. **Email codes.** Authentication → Emails → edit the **Magic Link** *and* **Confirm signup** templates so the email contains the code, for example:
   `Your Remocode code is {{ .Token }}`
   Without `{{ .Token }}` Supabase only sends a link, and the app's code screen has nothing to enter.
   The code length is under Authentication → Providers → Email; if you change it from 6, set `EXPO_PUBLIC_OTP_LENGTH` to match.
3. Run `supabase/migrations/0001_remote_control.sql` in the SQL editor (needed only for Remote Control).
4. Supabase's built-in email sender is rate limited; configure custom SMTP before real users.

## Models

**Settings → Models** (or the model chip in any chat):

| Source | Setup |
| --- | --- |
| Gemini | Key from aistudio.google.com/apikey. The model list is fetched live. |
| Claude / OpenAI / OpenRouter | Paste a key. Lists are fetched live (OpenRouter: add model names by hand). |
| Custom | Base URL such as `http://192.168.1.20:11434/v1`; key optional. |
| On-device | Download from the catalog or paste a direct `.gguf` link. |

Keys live in the OS keystore (`expo-secure-store`) and are only sent to the provider you chose. Tools (GitHub, Google) are offered only to cloud models; on-device models chat without them.

> **Unverified:** the on-device catalog URLs (Hugging Face) could not be checked from the build sandbox. Run `node scripts/check-model-urls.mjs` before releasing, and adjust `src/lib/llm/localCatalog.ts` if any have moved. A 3B model needs a recent phone with 6 GB+ RAM.

## Gemini Live voice

Open Voice mode and tap the orb. Audio streams to Gemini over a WebSocket in both directions, so you can interrupt mid-sentence, and the model can use your tools while talking:

- your connected Drive, GitHub and Google Workspace (read-only);
- **Remote Control tools**: `run_on_computer` starts a coding task through the companion on your computer, `check_task` follows it and summarizes the result out loud, `cancel_task` stops it. **Every `run_on_computer` call shows an on-screen Allow/Deny prompt**, and an unanswered prompt counts as Deny, so text the model read somewhere can never start commands on your machine by itself.

Requirements and behaviour:

- A **Gemini API key** (Settings → Models → Gemini). Tap "Update & refresh models" so the app can discover which of your models support Live. It picks the newest by default; override under Settings → Voice.
- Use headphones if you can. The native module applies echo cancellation, but speaker-phone echo is the main thing to test on your device.
- The screen stays on during a conversation. If you leave the app the conversation ends (background audio is not enabled).
- Sessions use context-window compression and resumption handles, so a go-away or a network blip reconnects instead of dropping the conversation.
- The transcript is saved to the conversation as normal chat messages.
- The API key travels in the WebSocket URL, which is how Google's Live endpoint authenticates direct client connections. It is your own key on your own device. For a shared app, mint short-lived ephemeral tokens on a server instead.

## Project resources

Create a project (Home → folder icon) and tap **Add resource**:

| Source | What happens |
| --- | --- |
| **Google Drive** | Browse Drive. *Attach folder*: the model can list and read files inside it (verified to be inside the folder, read-only). *Tap a file*: its text (Docs/Slides as text, Sheets as CSV, text and code files) is pinned as context. |
| **Upload files** | Pick text or code files from your phone (max 500 KB each; binaries are rejected). Pinned as context. |
| **GitHub** | Attach a repo (browsable by the model) and pin individual files. |

Pinned text shares a context budget (about 24k characters); anything beyond it is marked as omitted rather than silently cut. On-device models see only pinned text, because they cannot call tools.

## Connectors

- **GitHub:** paste a fine-grained personal access token with read-only *Contents* and *Metadata*. The model can only read the repository attached to the current project.
- **Google (optional):** create OAuth clients of type *Android* and/or *iOS* in Google Cloud Console, enable the Calendar, Drive, Docs and Sheets APIs, and set `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` / `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`. On iOS also add the reversed client ID (`com.googleusercontent.apps.<id>`) to `scheme` in `app.json`. Scopes are read-only.

## Remote Control

The phone writes tasks to Supabase (row-level security: your account only); a small companion on your computer picks them up, runs your agent CLI, and streams output back.

```bash
cd companion
npm install
node index.mjs login   # same email as the app; enter the emailed code
node index.mjs run     # keep this running; the computer appears in the app
```

Configuration (environment or `.env`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `REMOCODE_AGENT_CMD` | `claude` | Executable to run |
| `REMOCODE_AGENT_ARGS` | `["-p","--output-format","text","--","{prompt}"]` | JSON argv; must contain `{prompt}` |
| `REMOCODE_WORKDIR` | current directory | Where tasks run |
| `REMOCODE_TIMEOUT_MIN` | `30` | Kill a task after this long |
| `REMOCODE_DEVICE_NAME` | hostname | Name shown in the app |

**Security model.** Anyone who can sign in to your Remocode account can run tasks on your computer, so protect that account. The companion never uses a shell (the prompt is a single argv element), neutralises prompts that start with `-`, runs one task at a time, enforces a timeout and output cap, and honours cancel from the phone. What the agent itself may do (edit files, run commands) is governed by that agent's own permission settings: configure them before exposing a machine.

## Development

```bash
npm test                 # unit tests (Jest)
npm run test:companion   # companion tests (node:test)
npm run typecheck        # tsc --noEmit
npx eslint src           # lint
```

Layout: `src/app` screens (expo-router) · `src/lib/llm` providers, agent loop, local models · `src/lib/connectors` GitHub/Google · `src/lib/remote` · `src/lib/voice` · `src/store` zustand stores · `supabase/` SQL · `companion/` desktop daemon.

## Known limitations (v1)

- Conversations are stored on-device (AsyncStorage); only Remote Control data syncs through Supabase.
- Connector tools are read-only; nothing writes to GitHub or Google.
- Classic voice uses the OS speech recognizer and text-to-speech. Gemini Live is the full two-way option.
- Gemini Live and the on-device models are untested on hardware (see below). The Live protocol, tool round trips, reconnection and audio resampling are unit-tested against a fake server, but real-world latency and echo handling need a device pass.
- PDFs and images cannot be uploaded as resources yet (text and code only).
- On-device models do not support tools or images.
- Not yet run on a physical device. The app bundles and `expo prebuild` succeeds, and the pure logic is unit-tested, but the native flows (on-device inference, speech, OAuth) need a device pass.
