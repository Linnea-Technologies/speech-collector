# 2026-05-25 v2 Category UI Foundation And Frontend

## Date

2026-05-25

## Goal

Implement the v2 category phrase recording UI for the volunteer Speech Collector flow.

## Backend Foundation Already Completed

- v2 phrase bank with Finnish phrases grouped by category.
- `phrase_id` stored as a stable phrase identity.
- `semantic_label` stored as extra metadata/future target while `normalized_label` remains the phrase-level classifier label.
- `POST /api/category-state` returns fixed category order, shuffled phrase order, progress, phrase state, and unlock information.
- Repeat recordings insert separate `recordings` rows instead of overwriting earlier samples.
- Audio storage keys include `recording_id`, for example `session_id/task_id/recording_id.wav`.
- Progress logic counts unique phrase IDs and is repeat-safe.
- Normal export and databuilder export include `phrase_id` and `semantic_label`.

## Validation Completed Before Frontend Work

- `corepack pnpm install` passed.
- `corepack pnpm run test:backend` passed.
- `corepack pnpm build` passed.
- `corepack pnpm --filter sound-collector-frontend lint` passed.
- Supabase/S3 experimental flow was tested with 3 fresh recordings.
- Normal export passed.
- Databuilder export passed.
- `python scripts/aina/verify_v2_exports.py --run-exports` passed.

## Known Experimental Path Note

- `.env` has `DATASET_VERSION=v2`.
- Some output/S3 paths still contain `v1`.
- This is accepted for current experimental testing.
- Do not commit `.env`.

## Frontend Design Implemented

- Added the category recording intro shown after session metadata/consent is complete.
- Replaced the linear prompt recording screen with a category recording screen driven by `/api/category-state`.
- Added category progress showing unique recorded phrases over total phrases.
- Added required-count messaging for next-category unlocks.
- Added category stepper/navigation for unlocked categories.
- Added phrase cards in backend-provided shuffled order.
- Added phrase states for not recorded, recorded this session, and recorded before on this browser/device.
- Added selected phrase panel with the existing recorder.
- Updated literal transcript UX with a `Same as shown` option and a separate dialect/different-form input.
- Kept stop/finish session available from intro and recording screens.
- Kept playback and re-record before upload behavior.

## Responsive UI Polish

- Added mobile/tablet/desktop layout polish for the category intro and category recording screens.
- Polished the category intro copy from the earlier category-focused wording to the more volunteer-friendly title `Record Finnish short responses` with a shorter explanation of the grouped phrase recording task.
- The app shell and panels now use constrained viewport widths, smaller mobile padding, and overflow-safe wrapping to avoid expected page-level horizontal scrolling.
- The category stepper uses contained horizontal scrolling on phone widths and switches to a wrapped grid on tablet/desktop widths.
- Phrase cards now use an adaptive grid:
  - narrow phones can fall back to one column when needed
  - typical mobile widths can fit two columns
  - tablet/desktop widths expand to additional columns as space allows
- Phrase card labels and recorded-state text wrap safely and keep comfortable tap targets.
- The selected phrase panel stacks below the phrase grid on smaller screens and moves into a wider two-column workspace on desktop.
- Recorder playback, transcript controls, and action buttons are constrained to their panel and stack on narrow phones.
- The literal transcript input is full-width on small screens.
- Focus-visible outlines were added for primary category and recorder controls.
- Remaining manual smoke test requirement: verify the UI interactively at 360x800, 390x844, 768x1024, and 1366x768, including microphone recording and upload behavior.

## Security Retained

- Cloudflare Turnstile remains the session-start gate.
- Session metadata is still required before category progress/upload.
- Frontend recording auto-stop remains controlled by `VITE_MAX_RECORDING_SECONDS`.
- Backend upload size and duration limits remain authoritative.
- Frontend upload metadata sends only literal transcript, label source, and technical metadata.
- Backend still derives trusted labels and category fields from the task row.
- Backend processed audio behavior remains 16 kHz mono `pcm_s16le`.

## Testing Results

- `corepack pnpm run test:backend`: passed with 57 tests.
- `corepack pnpm build`: passed.
- `corepack pnpm --filter sound-collector-frontend lint`: passed.
- `python scripts/aina/verify_v2_exports.py --run-exports`: passed.
- Normal export produced 3 samples; all include `phrase_id`, `semantic_label`, and valid processed-audio metadata.
- Databuilder export considered 3 recordings, exported 3 recordings, skipped 0 legacy/missing processed-audio rows, and skipped 0 storage mismatches.
- Manual browser/microphone category UI smoke test was not completed in this shell because no interactive browser/microphone automation is available here.
- Extra `tsc --noEmit` check was attempted and found existing project type errors in `InfoForm.tsx` and `deviceId.ts`; the current project validation scripts do not run this command, and Vite build passed.

## Final Validation And Browser Smoke

- `corepack pnpm install`: passed.
- `corepack pnpm run test:backend`: passed with 57 tests.
- `corepack pnpm build`: passed.
- `corepack pnpm --filter sound-collector-frontend lint`: passed.
- `python scripts/aina/verify_v2_exports.py --run-exports`: passed.
- Automated browser smoke used Chrome DevTools Protocol with a temporary local backend/frontend:
  - backend served on port `18000` with Turnstile disabled for the smoke process only
  - frontend served on port `5174` with `VITE_TURNSTILE_SITE_KEY` empty and `VITE_API_URL` pointed to the smoke backend
  - `.env` was not edited
- Browser smoke confirmed:
  - page loaded
  - metadata form completed
  - category intro appeared
  - category recording screen appeared
  - `/api/category-state` was called
  - phrase cards appeared
  - selecting a phrase updated the selected phrase panel
  - recorder UI appeared
  - 5-second recording limit text was visible
  - same-as-shown control and dialect/different-form input were visible
  - next category was locked before enough unique recordings
  - finish/stop action was visible
- Responsive viewport checks passed without horizontal overflow at:
  - 360x800
  - 390x844
  - 768x1024
  - 1366x768
- Fake microphone upload:
  - fake recording was attempted
  - upload succeeded
  - post-upload `/api/category-state` check showed category `yes` with `uniqueRecordedCount = 1` out of 8 and one phrase marked `recordedInCurrentSession`
- Export verification was rerun after the fake upload and passed. The active smoke session was not included in export output; normal export still reported 3 exported samples.

## Remaining TODOs

- Run an interactive browser/microphone smoke test locally:
  - complete Turnstile/local bypass
  - complete metadata
  - verify category intro appears
  - verify category-state loads
  - record at least 3 phrases in the first category
  - verify progress updates and next category unlocks
  - verify same-as-shown uploads `literal_transcript: null` and `label_source: "prompt_assumed"`
  - verify typed transcript uploads the typed value and `label_source: "user_confirmed"`
  - verify stop session still works
- Optionally add focused frontend tests around category selection and recorder metadata payloads if the frontend test setup is expanded.
- Clean up existing full-TypeScript-check issues if the project starts enforcing `tsc --noEmit`.

## Company PR Strategy

- First validate this feature in the personal repo.
- Later create a clean company PR from latest company `main`.
- Include only the necessary code/docs changes.
- Do not include experimental `.env`, exports, audio files, temp files, screenshots, validation artifacts, S3/Supabase credentials, or unrelated audio-classifier changes.
