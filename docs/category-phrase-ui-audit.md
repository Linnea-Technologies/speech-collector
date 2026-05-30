# Category Phrase UI Audit And Implementation Plan

Scope: `apps/speech-collector/` only.

This is a planning document. No runtime code was changed as part of this audit.

## 1. Current System Summary

The current collector is a linear prompt recorder. A volunteer starts or resumes an anonymous browser session, completes Turnstile if configured, fills a metadata and consent form, then records one prompt at a time in `task_idx` order. Each successful upload creates or replaces one `recordings` row for the current `(session_id, task_id)` and stores processed WAV audio in local storage or S3-compatible storage.

Important current files:

- `frontend/src/App.tsx`: phase orchestration, session start/resume, metadata, current task, exit and terminal screens.
- `frontend/contexts/SessionProvider.tsx`: localStorage session token under `aina.speechCollector.sessionToken`.
- `frontend/utils/deviceId.ts`: localStorage device ID under `aina.speechCollector.deviceId`.
- `frontend/utils/sessionMetadata.ts`: v1 session metadata builder, including `device_id` and browser technical metadata.
- `frontend/components/InfoForm.tsx`: consent and session metadata form.
- `frontend/components/SoundRecorder.tsx`: recording, auto-stop, playback, literal transcript text input, upload.
- `frontend/components/TurnstileGate.tsx`: Cloudflare Turnstile widget.
- `backend/src/index.js`: Express API, Turnstile verification, upload parsing, trusted recording metadata derivation.
- `backend/src/taskProvider.js`: session allocation, next-task selection, session metadata update, recording insert/upsert, exit and completion.
- `backend/src/fileStorage.js`: upload re-encoding, duration safety check, local/S3 persistence, processed audio metadata.
- `scripts/aina/short_finnish_prompts.json`: current linear prompt seed.
- `scripts/aina/pushPrompts.js`: prompt seeding into `topics` and `tasks`.
- `scripts/aina/exportDataset.js`: normal `dataset.json` and `samples.jsonl` export.
- `scripts/aina/exportDatabuilderDataset.js`: strict databuilder bridge export.

The current DB model is JSONB-friendly for metadata evolution:

- `topics.metadata`
- `tasks.metadata`
- `participant_sessions.metadata`
- `recordings.metadata`

That means fields like `semantic_label`, `phrase_id`, and per-session phrase order can be added without adding ordinary DB columns. Some planned behavior still needs a migration because the current recordings table enforces one recording per task per session.

## 2. Current Flow Diagram

```text
Browser loads App
  -> SessionProvider reads session token from localStorage
  -> if VITE_TURNSTILE_SITE_KEY exists, show TurnstileGate
  -> POST /api/start-session
       backend verifies Turnstile if TURNSTILE_SECRET_KEY exists
       TaskProvider resumes active token or assigns one unused topic copy
  -> if metadata incomplete, show SessionIntro then InfoForm
  -> InfoForm builds v1 session metadata
       getOrCreateDeviceId() writes localStorage device ID
       getBrowserTechnicalMetadata() adds browser info
  -> POST /api/update-session-metadata
  -> POST /api/get-task
       backend returns first unrecorded task by task_idx
  -> TextContainer shows one prompt
  -> SoundRecorder records audio
       frontend auto-stops at VITE_MAX_RECORDING_SECONDS
       user can play back and re-record before upload
       frontend sends only literal_transcript, label_source, and technical capture metadata
  -> POST /api/upload-sound multipart
       multer enforces MAX_UPLOAD_BYTES
       backend validates active session and required session metadata
       backend derives labels from tasks row
       FileStorage re-encodes WAV PCM 16-bit, 16 kHz, mono
       FileStorage rejects duration over MAX_RECORDING_SECONDS + tolerance
       TaskProvider upserts recordings row for (session_id, task_id)
  -> user clicks Next prompt
  -> repeat /api/get-task until no unrecorded tasks
  -> backend marks session completed, or user exits and session becomes abandoned
  -> exporters include completed and abandoned sessions, excluding active sessions
```

## 3. Proposed New Flow Diagram

```text
Browser loads App
  -> Turnstile/start-session flow remains
  -> metadata and consent flow remains
  -> show category recording intro
  -> POST /api/category-state
       backend ensures per-session phrase order in participant_sessions.metadata
       backend returns fixed category order, shuffled phrase order per category,
       current-session progress, same-device previous progress, and unlock state
  -> category screen
       show category title, helper text, unique recorded / total phrases
       show phrase cards in stored shuffled order
       show recorded this session / recorded before / not recorded
       volunteer selects any visible phrase
  -> SoundRecorder records selected phrase
       playback and re-record remain before upload
       literal transcript confirmation uses Same as shown or typed different form
  -> POST /api/upload-sound
       backend still derives normalized_label, semantic_label, phrase_id, category,
       language, and prompted_word from the trusted task row
       repeat recordings insert new rows instead of replacing prior rows
  -> refresh category state
  -> Next category unlocks after min(3, category total) unique phrases
  -> user may finish/stop anytime via secondary action
  -> if all phrases in a category are recorded, UI may auto-advance
  -> final screen thanks volunteer and summarizes current-session recordings
```

## 4. Direct Answers: Current System Map

1. Current volunteer flow is Turnstile gate, start/resume session, intro, metadata/consent form, linear one-prompt recording, upload, next prompt, automatic completed state or explicit exit.
2. `device_id` is generated in `frontend/utils/deviceId.ts` by `getOrCreateDeviceId()` and stored in localStorage key `aina.speechCollector.deviceId`. It is first called by `buildV1SessionMetadata()` in `frontend/utils/sessionMetadata.ts`, not at initial page load.
3. Session metadata is created in `frontend/utils/sessionMetadata.ts`, posted by `InfoForm.tsx` to `/api/update-session-metadata`, and merged into `participant_sessions.metadata` by `TaskProvider.updateSessionMetadata()`.
4. Prompts are loaded from `scripts/aina/short_finnish_prompts.json`, seeded by `scripts/aina/pushPrompts.js` into `topics` and `tasks`.
5. The backend next-task decision is in `TaskProvider.getTask()`: first task in the session topic with no matching `recordings` row for that session, ordered by `task_idx`.
6. The frontend sends upload metadata in `SoundRecorder.tsx` as multipart JSON field `metadata`, containing `schema_version`, `literal_transcript`, `label_source`, and `technical`.
7. Backend label derivation is in `backend/src/index.js` `buildRecordingMetadata()`:
   - `prompted_word`: `task.text`
   - `normalized_label`: `task.metadata.label`, fallback `task.text`
   - `category`: `task.metadata.category`
   - `language`: `task.metadata.language`
   - `literal_transcript`: frontend value, normalized to string or null
   - `label_source`: frontend value if in allowed set, else `prompt_assumed`
8. Turnstile is in `TurnstileGate.tsx` and `/api/start-session`. Auto-stop is in `SoundRecorder.tsx`. Upload size limit is multer in `backend/src/index.js`. Duration limit is in `backend/src/fileStorage.js` after ffprobe.
9. Processed audio metadata is produced by `getProcessedAudioMetadata()` in `fileStorage.js` and attached to `recordings.metadata.processed_audio` in `/api/upload-sound`.
10. Normal export and databuilder export read joined rows from `recordings`, `participant_sessions`, `tasks`, and `topics`. Both prefer `recordings.metadata` and fall back to task metadata where needed.

## 5. Data Model Impact

### JSONB fields

`semantic_label` and `phrase_id` can be added to `tasks.metadata` without a DB migration because `tasks.metadata` is JSONB. The same is true for copying these fields into `recordings.metadata`.

Recommended task metadata fields:

```json
{
  "prompt_id": "yes_kyl",
  "phrase_id": "yes_kyl",
  "label": "kyl",
  "semantic_label": "yes",
  "language": "fi",
  "category": "yes",
  "dataset_id": "short_finnish_responses",
  "dataset_version": "v2"
}
```

Recommended top-level prompt seed additions:

```json
{
  "dataset_id": "short_finnish_responses",
  "version": "v2",
  "language": "fi",
  "category_order": ["yes", "no", "maybe", "dont_know", "correct", "number"],
  "categories": [
    { "id": "yes", "title": "Yes", "required_count": 3 },
    { "id": "no", "title": "No", "required_count": 3 },
    { "id": "maybe", "title": "Maybe", "required_count": 3 },
    { "id": "dont_know", "title": "Don't know / Not sure", "required_count": 3 },
    { "id": "correct", "title": "That's correct", "required_count": 3 },
    { "id": "number", "title": "Numbers", "required_count": 3 }
  ],
  "prompts": [
    {
      "id": "yes_kyl",
      "phrase_id": "yes_kyl",
      "label": "kyl",
      "semantic_label": "yes",
      "text": "Kyl",
      "category": "yes"
    }
  ]
}
```

`normalized_label` must remain the phrase-level classifier target. Do not replace it with `semantic_label`.

Examples:

- phrase label `kyl`, semantic label `yes`
- phrase label `ei_oo`, semantic label `no`
- phrase label `kaks`, semantic label `number_2`

### Category values

For newly seeded tasks, use the planned category IDs:

- `yes`
- `no`
- `maybe`
- `dont_know`
- `correct`
- `number`

Keep legacy rows readable. Existing recordings may still have `affirmative`, `negative`, `number`, or `common`. Exporters should not fail on either legacy or new values.

### Recording metadata

At upload time, copy these trusted task fields into `recordings.metadata`:

- `phrase_id`
- `semantic_label`
- `prompted_word`
- `normalized_label`
- `language`
- `category`

The frontend should not send trusted label fields. If it sends them accidentally, backend code should ignore them.

### Export fields

Normal export should add:

- root `phrase_id`
- root `semantic_label`
- `metadata.collection.phrase_id`
- `metadata.collection.semantic_label`

Databuilder sidecar should add:

- root `phrase_id`
- root `semantic_label`
- `collection.phrase_id`
- `collection.semantic_label`

Legacy rows should export `semantic_label: null` and `phrase_id` fallback to `recording_metadata.phrase_id`, then `task_metadata.phrase_id`, then `task_metadata.prompt_id`, then null. Do not silently rewrite old classifier labels.

### Migration impact

Adding JSON metadata alone does not need a migration. Supporting repeat recordings as additional valid samples does need a migration and storage-key change:

- Current unique index: `recordings_session_task_idx ON recordings(session_id, task_id)`.
- Current upload behavior: `ON CONFLICT (session_id, task_id) DO UPDATE`.
- Current audio key: `{session_id}/{task_id}.wav`.

Those three facts mean a repeat recording currently replaces the previous DB row and overwrites the previous audio file. To keep repeats as extra samples, drop or replace the unique index, stop upserting by `(session_id, task_id)`, and generate a unique storage key per recording.

Recommended storage key for repeats:

```text
{session_id}/{recording_id}.wav
```

or:

```text
{session_id}/{task_id}/{recording_id}.wav
```

Generate `recording_id` before saving the file so the DB row and audio path share the same durable ID.

## 6. Required Backend Changes

### New session/category API

Recommended clean API:

```text
POST /api/category-state
```

Request:

```json
{ "sessionToken": "..." }
```

Response:

```json
{
  "success": true,
  "session": {},
  "categoryOrder": ["yes", "no", "maybe", "dont_know", "correct", "number"],
  "activeCategoryId": "yes",
  "categories": [
    {
      "id": "yes",
      "title": "Yes",
      "totalPhrases": 8,
      "requiredCount": 3,
      "unlocked": true,
      "complete": false,
      "progress": {
        "currentSessionUniqueCount": 1,
        "previousSameDeviceUniqueCount": 2,
        "uniqueRecordedCount": 3,
        "totalPhrases": 8
      },
      "phrases": [
        {
          "taskId": "short_finnish_responses_v2_0001_yes_kyl",
          "phraseId": "yes_kyl",
          "text": "Kyl",
          "category": "yes",
          "recordedInCurrentSession": false,
          "recordedPreviouslyOnDevice": true,
          "recordingCountCurrentSession": 0
        }
      ]
    }
  ]
}
```

Use `POST`, not `GET`, because the current API already uses JSON bodies for session tokens and putting session tokens in URLs is avoidable.

Keep existing endpoints during migration:

- `POST /api/start-session`: unchanged Turnstile and session allocation behavior.
- `POST /api/get-task`: keep for compatibility until the old linear UI is removed.
- `POST /api/update-session-metadata`: unchanged, but may need to preserve UI ordering metadata when merging.
- `POST /api/upload-sound`: same request shape, expanded trusted metadata and repeat-recording support.
- `POST /api/exit-session`: keep as the anytime stop/finish action.
- `POST /api/complete-session`: either keep all-current-topic-complete semantics or deliberately redefine. Do not change this casually.

### Phrase order storage

Store session-level shuffle in `participant_sessions.metadata`, for example:

```json
{
  "ui": {
    "category_phrase_v1": {
      "category_order": ["yes", "no", "maybe", "dont_know", "correct", "number"],
      "phrase_order_by_category": {
        "yes": ["yes_kyl", "yes_joo", "yes_on"]
      },
      "created_at": "2026-05-25T00:00:00.000Z"
    }
  }
}
```

Backend should create this only when missing. Refreshing an active session must reuse the stored order. If newly seeded phrases exist that are not in the stored order, append them after stored phrases in stable `task_idx` order rather than reshuffling.

### Progress logic

Progress should be authoritative on the backend. Do not rely only on frontend state.

Counts needed per category:

- `currentSessionUniqueCount`: distinct phrase IDs recorded in the current session.
- `previousSameDeviceUniqueCount`: distinct phrase IDs recorded in earlier sessions with the same `participant_sessions.metadata.device_id`.
- `uniqueRecordedCount`: union of current and previous phrase IDs if returning-device progress is enabled.
- `totalPhrases`: number of current-topic phrases in category.
- `requiredCount`: `Math.min(3, totalPhrases)`.

Phrase state:

- `recordedInCurrentSession`
- `recordedPreviouslyOnDevice`
- `recordingCountCurrentSession`

Unlocking:

- First category is always unlocked.
- Category N is unlocked only if all previous categories have `uniqueRecordedCount >= requiredCount`.
- Repeat recordings insert rows but do not increase unique progress for that phrase.

### Recording insert changes

For repeat recordings:

- Drop or stop depending on `recordings_session_task_idx`.
- Insert a new `recordings` row for every upload.
- Add a non-unique index on `(session_id, task_id)` if query speed matters.
- Consider expression indexes:
  - `participant_sessions ((metadata->>'device_id'))`
  - `recordings ((metadata->>'phrase_id'))`

`TaskProvider.getSessionSummaryByToken()` should stop counting raw `COUNT(r.id)` if repeats are allowed. Use distinct current-session task or phrase count for session summary.

`TaskProvider.submitRecording()` should mark a session completed only after all required current-topic phrase IDs are recorded according to the chosen completion policy. Raw row count will be wrong once repeats exist.

### Trusted metadata derivation

Extend `buildRecordingMetadata()` to derive these from `task.metadata`:

- `phrase_id`
- `semantic_label`
- `normalized_label`
- `category`
- `language`

Do not accept these fields from frontend upload metadata as authoritative.

## 7. Required Frontend Changes

### App orchestration

`frontend/src/App.tsx` needs to move from one `currentTask` to category state:

- add a post-metadata category intro phase
- load `/api/category-state`
- track selected category and selected phrase
- refresh category state after uploads
- preserve Turnstile, metadata, exit, error, unavailable, and end screens

### Existing components to modify

- `SessionIntro.tsx`: reuse or replace for the category-recording intro.
- `SoundRecorder.tsx`: make it phrase-selected and category-screen friendly. Remove old "Next prompt" responsibility. Keep playback and re-record before upload.
- `InfoForm.tsx`: mostly unchanged, but consent copy should be updated.
- `SessionEndScreen.tsx`: optionally accept current-session and total summary counts.
- `TextContainer.tsx`: likely replace with a selected phrase panel or merge into new category screen.
- `SessionProvider.tsx` and `types/session.ts`: add category state types if context remains central.

### New components recommended

- `CategoryRecordingIntro.tsx`
- `CategoryRecorderScreen.tsx`
- `CategoryProgressBar.tsx`
- `PhraseGrid.tsx`
- `PhraseCard.tsx`
- `SelectedPhrasePanel.tsx`
- `LiteralTranscriptControl.tsx`

### Category recording screen

Required UI state:

- fixed category order: `Yes -> No -> Maybe -> Don't know / Not sure -> That's correct -> Numbers`
- category title and helper text
- progress bar: `unique recorded / total phrases`
- required text: `3 required to continue` or smaller count for small categories
- phrase cards in backend-provided session order
- phrase state labels:
  - `recorded this session`
  - `recorded before`
  - `not recorded yet`
- clickable recorded phrases
- selected phrase text
- recorder with playback, re-record, and upload
- literal transcript confirmation:
  - button/control: `Same as shown`
  - text input: `I said it differently / in my local dialect`
- next category button locked until required unique count is reached
- stop/finish session always available, secondary
- optional auto-advance when all phrases in current category are recorded

The frontend should display label/progress state from backend, but backend must remain the source of truth for recording metadata and unlock eligibility.

## 8. Shuffling Design

Use backend/session-level shuffle, not frontend-only shuffle.

Reason:

- refresh must not reshuffle
- backend can persist the order in `participant_sessions.metadata`
- order is tied to the assigned topic copy and current prompt bank
- frontend-only shuffle would make state recovery and debugging weaker

Behavior:

- On first `/api/category-state`, backend groups current-topic tasks by category and shuffles phrase IDs once per category.
- Store the order in `participant_sessions.metadata.ui.category_phrase_v1`.
- On refresh, return stored order.
- For a returning device in a later session, create a new session-specific shuffle but mark same-device previous recordings.
- Avoid reshuffling by only creating order when the metadata key is absent.

This fits the current code because `participant_sessions.metadata` already exists and is used for extensible JSON session state. It does require careful merge logic so form updates do not overwrite UI ordering metadata.

## 9. Privacy And Consent Impact

Current consent text already says an anonymous browser ID may be stored in this browser to group recordings from the same device. That is a good base, but returning-progress UI makes the browser ID more visible and more clearly used for progress tracking.

Recommended consent wording addition:

```text
An anonymous random browser ID is stored in this browser so we can resume an active session
and show which phrases this browser has already recorded. It is not a hardware serial number
and does not include your name, email, or phone number. Clearing browser storage removes this
ID from this browser, but recordings already submitted remain stored under the previous
anonymous ID.
```

Engineering classification: this is pseudonymous, not directly identifying by itself. It still links recordings from the same browser/device and voice recordings can be sensitive depending on the research/privacy context. Treat it as pseudonymous research data, not truly anonymous data.

Important current behavior to review: `buildV1SessionMetadata()` calls `getOrCreateDeviceId()` even when the user selects consent response `no`, because metadata is built before the decline path closes the session. Consider changing that during implementation so declined-consent sessions do not create or persist a device ID unless that behavior is explicitly approved.

Reference note: GDPR Article 4 defines pseudonymisation as processing where data cannot be attributed to a specific data subject without additional information kept separately and protected by technical/organizational measures. See EUR-Lex Regulation (EU) 2016/679 Article 4.

Source: https://eur-lex.europa.eu/legal-content/EN-ES/TXT/?uri=CELEX%3A32016R0679

Current returning-user support check: the backend can identify same-device history only after v1 session metadata exists, because `device_id` is stored inside `participant_sessions.metadata` and is not sent to `/api/start-session`. There is no current API for previous same-device progress and no dedicated `device_id` column or index. The new backend should query JSONB metadata, and add an expression index if the dataset grows.

## 10. Required Prompt And Schema Changes

Replace the current seed with the category phrase bank using a new dataset version, for example `v2`, unless you intentionally reset all seeded dev data.

Do not update the existing seed in-place against a populated database without a reset or seeder cleanup. Current `pushPrompts.js` upserts tasks by `id` and the database also has a unique `(topic_id, task_idx)` index. Changing prompt IDs/order can either leave old tasks behind or fail on task index conflicts.

Safest options:

1. Dev/local reset before reseeding:
   - delete `recordings`
   - delete `participant_sessions`
   - delete `tasks`
   - delete `topics`
2. Production-like strategy:
   - use a new dataset version/topic namespace such as `short_finnish_responses_v2`
   - keep old recordings/export compatibility
   - seed new topic copies separately

Recommended normalized labels:

- Use ASCII, phrase-level labels with underscores for spaces.
- Keep Finnish display text in `text`.
- Use `semantic_label` for broad/future targets.
- Use `category` only for UI grouping.

Examples:

- `label: "kylla"`, `semantic_label: "yes"`, `category: "yes"`
- `label: "ei_oo"`, `semantic_label: "no"`, `category: "no"`
- `label: "en_tieda"`, `semantic_label: "dont_know"`, `category: "dont_know"`
- `label: "kaks"`, `semantic_label: "number_2"`, `category: "number"`

## 11. Required Export Changes

Normal export in `scripts/aina/exportDataset.js`:

- Include `phrase_id` and `semantic_label` at the sample root.
- Include both under `metadata.collection`.
- Preserve `normalized_label` and `label` as phrase-level classifier targets.
- For legacy rows, return null instead of throwing when `semantic_label` is absent.
- Consider adding `semantic_labels` or a `semantic_label_vocabulary` list to `dataset.json` only if downstream tooling needs it. Do not replace `labels`.

Databuilder export in `scripts/aina/exportDatabuilderDataset.js`:

- Include root-level `phrase_id` and `semantic_label` in each sidecar JSON.
- Include both under `collection`.
- Preserve strict `processed_audio` filtering.
- Keep `normalized_label` as the classifier target.
- Missing `semantic_label` should not make legacy rows invalid.

Expected test impact:

- Existing export tests will need assertions for new fields.
- Existing databuilder tests should not break merely because extra fields exist, but tests should verify them.
- Repeat-recording support will affect storage key tests, task progress tests, and any test assuming one row per task.

## 12. Testing Plan

Backend tests:

- seed parser accepts new phrase schema
- `pushPrompts.js` stores `phrase_id`, `semantic_label`, category metadata, and category order
- upload copies `phrase_id` and `semantic_label` from task metadata into recording metadata
- upload ignores frontend-provided label, category, semantic label, and phrase ID
- progress counts distinct phrase IDs
- previous same-device recordings can be included in progress
- repeated same phrase inserts another row but does not increase unique progress twice
- phrase order is stable within a session
- phrase order differs across new sessions
- next-category eligibility uses `min(3, totalPhrases)`
- categories with fewer than 3 phrases unlock after all available phrases
- legacy tasks without `semantic_label` do not crash
- `getSessionSummaryByToken()` does not count repeat rows as linear progress
- `complete-session` behavior matches the final chosen completion policy
- Turnstile failure still blocks session start
- `MAX_UPLOAD_BYTES` still rejects oversized uploads before storage
- duration limit still rejects too-long recordings before DB submit
- processed audio metadata remains WAV PCM 16-bit, 16 kHz, mono

Frontend tests:

- build and lint
- category progress renders `unique recorded / total phrases`
- next category button locks/unlocks correctly
- phrase card states render current-session, previous-device, and not-recorded states
- recorded phrases remain clickable
- selecting a phrase updates recorder prompt
- same-as-shown transcript sends `literal_transcript: null` and `label_source: "prompt_assumed"`
- typed transcript sends trimmed value and `label_source: "user_confirmed"`
- re-record before upload still replaces the pending local blob only
- upload refreshes category state
- stop/finish session remains available
- final screen summarizes current-session recordings

Export tests:

- normal export includes `phrase_id` and `semantic_label` when available
- normal export keeps legacy rows with null semantic metadata
- databuilder sidecar includes `phrase_id` and `semantic_label` when available
- databuilder sidecar keeps missing semantic metadata as null
- strict processed audio filtering still works

## 13. Risks And Recommendations

### Risks

- DB migration risk: repeat recordings require removing or replacing the unique `(session_id, task_id)` upsert model.
- Storage overwrite risk: current `{session_id}/{task_id}.wav` path cannot preserve repeat recordings.
- Seeder risk: changing prompt IDs/order against existing topics can conflict with `(topic_id, task_idx)` or leave obsolete tasks.
- Existing sessions risk: active sessions created before the prompt update may not have category metadata or shuffled order.
- Legacy recordings risk: older rows do not have `semantic_label` or `phrase_id`.
- Label compatibility risk: changing number labels from digits to phrase-level labels changes classifier vocabulary.
- Consent risk: returning-progress behavior makes browser ID usage more explicit and should be stated clearly.
- Declined-consent risk: current code creates/stores `device_id` even for consent `no`.
- UX risk: category unlocking can make volunteers think only 3 recordings matter unless progress clearly shows all phrases remain useful.
- Trust boundary risk: category progress must be calculated by backend, not only frontend state.

### Recommendations

- Use a new dataset version for the new phrase bank.
- Add `semantic_label` as metadata only. Keep `normalized_label` as phrase-level training target.
- Implement backend category/progress API before frontend redesign.
- Persist shuffle in `participant_sessions.metadata`, not local frontend state.
- Decide repeat-recording schema first because it changes DB and storage behavior.
- Keep old linear endpoints until the new UI is verified locally.
- Keep legacy export behavior tolerant.
- Add tests before connecting the new frontend.

## 14. Recommended Staged Implementation Order

### Stage 1: Prompt schema and trusted metadata

- Update prompt seed schema with `phrase_id`, `semantic_label`, new categories, and category order.
- Update `pushPrompts.js` to store new metadata and handle prompt-set changes safely.
- Update backend recording metadata derivation to copy `phrase_id` and `semantic_label` from task rows.
- Update normal and databuilder exports to include new fields.
- Add backend/export tests.

### Stage 2: Repeat recording storage and category progress backend

- Add migration for repeat recordings:
  - remove or replace unique `(session_id, task_id)` behavior
  - add non-unique indexes needed for progress
  - change storage keys to include recording ID
- Add provider methods for category state, phrase order creation, progress, previous same-device status, and unlock eligibility.
- Add `POST /api/category-state`.
- Update `/api/upload-sound` to insert repeat rows and return/refetch category progress.
- Add backend tests for progress, shuffle stability, repeats, and legacy rows.

### Stage 3: Category frontend

- Add category intro screen.
- Add category recorder screen, phrase grid, progress UI, selected phrase panel, and literal transcript control.
- Refactor `SoundRecorder.tsx` to work as a reusable selected-phrase recorder.
- Update app phase orchestration and session context/types.
- Keep Turnstile, metadata form, auto-stop, playback, re-record, upload safety, and exit behavior.
- Run frontend build/lint and focused UI tests if available.

### Stage 4: Docs and end-to-end validation

- Update `README.md`, `docs/aina-data-contract.md`, `docs/databuilder-export.md`, `docs/database-structure.md`, and consent wording in `infoFormConfig.json`.
- Validate local storage flow.
- Validate Supabase/PostgreSQL and S3 flow.
- Verify normal export.
- Verify databuilder export.
- Smoke-test downstream classifier loading separately only when explicitly in scope.

## 15. Exact Files Likely To Change

Backend:

- `apps/speech-collector/backend/src/index.js`
- `apps/speech-collector/backend/src/taskProvider.js`
- `apps/speech-collector/backend/src/fileStorage.js`
- `apps/speech-collector/backend/src/index.test.js`
- `apps/speech-collector/backend/src/taskProvider.test.js`
- `apps/speech-collector/backend/src/fileStorage.test.js`

Database and seed:

- `apps/speech-collector/scripts/aina/migration.sql`
- `apps/speech-collector/scripts/aina/short_finnish_prompts.json`
- `apps/speech-collector/scripts/aina/pushPrompts.js`

Exports:

- `apps/speech-collector/scripts/aina/exportDataset.js`
- `apps/speech-collector/scripts/aina/exportDataset.test.js`
- `apps/speech-collector/scripts/aina/exportDatabuilderDataset.js`
- `apps/speech-collector/scripts/aina/exportDatabuilderDataset.test.js`

Frontend:

- `apps/speech-collector/frontend/src/App.tsx`
- `apps/speech-collector/frontend/src/App.css`
- `apps/speech-collector/frontend/types/session.ts`
- `apps/speech-collector/frontend/contexts/SessionProvider.tsx`
- `apps/speech-collector/frontend/components/SoundRecorder.tsx`
- `apps/speech-collector/frontend/components/SoundRecorder.css`
- `apps/speech-collector/frontend/components/TextContainer.tsx`
- `apps/speech-collector/frontend/components/TextContainer.css`
- new category UI components and CSS files
- `apps/speech-collector/frontend/utils/sessionMetadata.ts`
- `apps/speech-collector/frontend/utils/deviceId.ts` only if declined-consent behavior is adjusted

Docs/config:

- `apps/speech-collector/infoFormConfig.json`
- `apps/speech-collector/README.md`
- `apps/speech-collector/docs/aina-data-contract.md`
- `apps/speech-collector/docs/databuilder-export.md`
- `apps/speech-collector/docs/database-structure.md`
- `apps/speech-collector/docs/aina-s3-integration.md`

## 16. Questions To Answer Before Coding

1. Should repeat recordings definitely be stored as separate samples? If yes, approve the DB/storage migration.
2. Should previous same-device recordings count toward category unlocks, or only display as recorded before?
3. If previous same-device recordings count toward unlocks, should they also count toward session completion?
4. Should `complete-session` keep its current meaning, or should early user finish continue to use `exit-session`/`abandoned`?
5. Should the new phrase bank use `DATASET_VERSION=v2` to avoid mixing old and new task schemas?
6. Should old seeded topics be reset in local/dev, or should `pushPrompts.js` learn to delete obsolete tasks safely?
7. What exact normalized labels should be used for phrase variants with Finnish characters and spaces?
8. Should `phrase_id` equal prompt `id`, or should both be stored separately for future prompt display changes?
9. Should same-device previous progress include recordings from active sessions in another tab, or only completed/abandoned sessions?
10. Should declined-consent sessions avoid generating/storing `device_id`?
11. Should frontend show `semantic_label` anywhere, or keep it entirely hidden metadata?
12. Should the category screen allow jumping back to earlier unlocked categories, or only next/previous sequential navigation?
13. Should auto-advance trigger at all phrases recorded, or only after upload when no pending playback exists?
14. Should all categories be required for a `completed` session, or is early finish expected to be the normal valid final state?
15. Should top-level `dataset.json` include semantic-label vocabulary, or only per-sample semantic metadata?
