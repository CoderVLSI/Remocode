# Remocode

An AI agent app for your phone, in the spirit of Google Antigravity's mobile app, with:

- **On-device models**: download a GGUF model and chat offline (via `llama.rn`).
- **Bring your own key**: Google Gemini, Anthropic Claude, OpenAI, OpenRouter, or any OpenAI-compatible server (Ollama, LM Studio, vLLM, Groq…).
- **Voice mode**: hands-free talk. On-device speech recognition when supported, replies spoken sentence by sentence as they stream.
- **Email auth**: passwordless one-time code (or password) through Supabase.
- **Projects + GitHub**: attach a repo (the model can list, read and search it) and pin files as context.
- **Connectors**: read-only Google Calendar, Drive, Docs and Sheets as model tools.
- **Remote Control**: send a task from your phone to an agent on your computer and watch its output live.

Built with Expo SDK 58 (React Native 0.88, expo-router, TypeScript).

## Quick start

> Native modules (`llama.rn`, `expo-speech-recognition`) mean this app needs a **development build**; Expo Go will not work.

```bash
npm install
cp .env.example .env        # fill in your Supabase URL + anon key
npx expo run:android        # or: npx expo run:ios (macOS)   |  eas build --profile development
npm start                   # dev server for the dev client
```

### Supabase setup (one time)

1. Create a project at supabase.com and copy the **URL** and **anon key** into `.env`.
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
- Voice mode uses the OS speech recognizer + text-to-speech, not a streaming speech model.
- On-device models do not support tools or images.
- Not yet run on a physical device. The app bundles and `expo prebuild` succeeds, and the pure logic is unit-tested, but the native flows (on-device inference, speech, OAuth) need a device pass.
