# Remo Code

An AI agent app for your phone, in the spirit of Google Antigravity's mobile app, with:

- **On-device models**: download a GGUF model and chat offline (via `llama.rn`).
- **Bring your own key**: Google Gemini, Anthropic Claude, OpenAI, OpenRouter, or any OpenAI-compatible server (Ollama, LM Studio, vLLM, Groq…).
- **Gemini Live voice**: real two-way conversation. Talk naturally, interrupt any time, and the assistant can call tools while it speaks, including starting coding tasks on your own computer (after you approve each one on screen).
- **Classic voice**: on-device speech recognition with spoken replies, for any model.
- **Accounts on Convex**: email + password, with optional emailed one-time codes (Convex Auth). You own the backend; it is plain TypeScript in `convex/`.
- **Projects with resources**: add a **Google Drive** folder or files, **upload** text and code files from your phone, or attach a **GitHub** repo. The model can browse attached folders and repos (read-only, and only inside what you attached) and sees pinned files as context.
- **Connectors**: read-only Google Calendar, Drive, Docs and Sheets as model tools.
- **Remote Control**: send a task from your phone to an agent on your computer and watch its output live.

Built with Expo SDK 58 (React Native 0.88, expo-router, TypeScript).

## Install the APK

Build it yourself (see below), copy `remocode-arm64-release.apk` to your phone, and open it. You may need to allow "install unknown apps" for your file manager. The APK is arm64 (every modern phone) and signed with a debug key, which is fine for personal use but not for the Play Store.

On first launch, paste your **Convex deployment URL** (ends in `.convex.cloud`) on the sign-in screen. No rebuild is needed. The app refuses service-role and secret keys on purpose.

## Quick start

> Native modules (`llama.rn`, `expo-speech-recognition`) mean this app needs a **development build**; Expo Go will not work.

```bash
npm install
cp .env.example .env        # optional: bake in your Convex URL (otherwise the app asks)
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

### Backend setup (Convex, one time)

The backend is the `convex/` folder: accounts, paired computers, and Remote Control tasks. You deploy it to your own free Convex project.

```bash
npm install
npx convex dev              # log in, create a project, push the functions; prints your .convex.cloud URL. Leave it running, or stop it after the first push.
npm run convex:setup        # creates the auth signing keys on your deployment (run once)
npm run selftest -- https://YOUR-DEPLOYMENT.convex.cloud   # optional: checks sign-in, pairing and a task end to end
```

Then paste the URL into the app (or put it in `.env` as `EXPO_PUBLIC_CONVEX_URL`). For production, deploy with `npx convex deploy` and run `npm run convex:setup -- --prod`.

**No computer? Do it all from Termux on your phone.** The backend only needs Node; it does not need the React Native tools. `scripts/backend-only.sh` makes a small copy (about 100 MB instead of 1 GB+):

```bash
pkg update && pkg install -y nodejs git
git clone https://github.com/CoderVLSI/Remocode.git && cd Remocode
git checkout ccr-e333e571-3t51sf
./scripts/backend-only.sh ~/remocode-backend
cd ~/remocode-backend && npm install && (cd companion && npm install)
npx convex login --no-open --login-flow poll   # prints a link: open it in your phone's browser and approve
npx convex dev --once --configure new --dev-deployment cloud   # pick a team, name the project; deploys once and prints the URL
npm run convex:setup
npm run selftest -- https://YOUR-DEPLOYMENT.convex.cloud
```

Choose a **cloud** deployment (not local) so the app can reach it. The self-test pairs a pretend computer, so it works on a phone too. A real companion on Termux would only drive the phone itself, so for Remote Control use your actual computer.

- **Passwords work immediately.** Sign up and sign in with email + password need nothing else.
- **Emailed codes (optional).** Convex has no built-in email sender. Create a free [Resend](https://resend.com) key and run `npx convex env set AUTH_RESEND_KEY re_xxx`. Then new accounts must confirm their email with a 6-digit code, and the "Email code" tab works. Resend's shared sender only delivers to your own Resend account address until you verify a domain and set `npx convex env set AUTH_EMAIL_FROM "Remo Code <auth@yourdomain.com>"`.
- Production Convex deployments hide server error text, so the app words sign-in failures from context ("wrong email or password") instead of showing raw messages.

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

The phone and a small companion on your computer talk through your Convex backend. You add a computer with a one-time code, so there is no password or email code to type in a terminal.

```bash
cd companion
npm install                 # once
node index.mjs pair         # asks for your Convex URL and the code from the app
node index.mjs run          # keep this running; the computer shows as online in the app
```

In the app: **Remote Control → Pair a computer** shows an 8-character code (valid 10 minutes, one use). The companion keeps a live connection, so a task you send starts immediately and a cancel from your phone stops the process immediately, with no polling. `node index.mjs status` checks the pairing and `node index.mjs logout` removes the computer.

Configuration (environment or `.env`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `REMOCODE_AGENT_CMD` | `claude` | Executable to run |
| `REMOCODE_AGENT_ARGS` | `["-p","--output-format","text","--","{prompt}"]` | JSON argv; must contain `{prompt}` |
| `REMOCODE_WORKDIR` | current directory | Where tasks run |
| `REMOCODE_TIMEOUT_MIN` | `30` | Kill a task after this long |
| `REMOCODE_DEVICE_NAME` | hostname | Name shown in the app |

**Security model.** Anyone who can sign in to your Remo Code account can run tasks on your computer, so protect that account. Pairing codes are one-use, expire in 10 minutes, and wrong guesses are throttled. The companion's device token is stored only as a hash on the backend and in a private file (`~/.remocode/device.json`) on your computer; removing the computer in the app, or `logout`, makes it stop working at once. The companion never uses a shell (the prompt is a single argv element), neutralises prompts that start with `-`, runs one task at a time, enforces a timeout and output cap, and honours cancel from the phone. What the agent itself may do (edit files, run commands) is governed by that agent's own permission settings: configure them before exposing a machine.

## Development

```bash
npm test                 # unit tests (Jest)
npm run test:companion   # companion tests (node:test)
npm run test:convex      # backend tests (convex-test, Vitest)
npm run typecheck        # tsc --noEmit
npx eslint src           # lint
```

Layout: `src/app` screens (expo-router) · `src/lib/llm` providers, agent loop, local models · `src/lib/connectors` GitHub/Google · `src/lib/remote` · `src/lib/voice` · `src/store` zustand stores · `convex/` backend (schema, auth, functions) · `convex-tests/` backend tests · `companion/` desktop daemon.

## Known limitations (v1)

- Conversations are stored on-device (AsyncStorage); only Remote Control data lives in Convex. (Syncing chats across devices through Convex is a natural next step.)
- Connector tools are read-only; nothing writes to GitHub or Google.
- Classic voice uses the OS speech recognizer and text-to-speech. Gemini Live is the full two-way option.
- Gemini Live and the on-device models are untested on hardware (see below). The Live protocol, tool round trips, reconnection and audio resampling are unit-tested against a fake server, but real-world latency and echo handling need a device pass.
- PDFs and images cannot be uploaded as resources yet (text and code only).
- On-device models do not support tools or images.
- Not yet run on a physical device. The app bundles and `expo prebuild` succeeds, and the pure logic is unit-tested, but the native flows (on-device inference, speech, OAuth) need a device pass.
