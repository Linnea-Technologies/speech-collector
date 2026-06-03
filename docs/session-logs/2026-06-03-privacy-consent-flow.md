# 2026-06-03 Privacy Consent Flow

## Goal

Implement the volunteer-facing privacy, participant information, and consent flow for the Speech Collector app without production deployment, commit, push, or audio-classifier changes.

## Source Document

Used `d:\downloads from chrome\Linnea_tietosuoja_ja_suostumus (1).docx` as the policy source. It contains the privacy notice, informed consent, age restriction notice, and research information.

## Filled Placeholder Values

- Company: Linnea Technologies Oy
- Y-tunnus: 3571288-4
- Corrected address: Kulmalantie 11 as. 2, 28130 Pori, Finland
- Contact person: Ollipekka Kivin
- Contact email: ollipekka@hellolinnea.com
- Policy date: 03.06.2026
- Consent version: 1.0
- Privacy notice version: 1.0
- Purpose wording: AI-based phone service / tekoälypohjainen puhelinpalvelu
- Minimum age: 18+

The contact title and phone placeholders were removed from published UI/content.

## Audit Findings

- Frontend routing is lightweight hash routing in `frontend/src/App.tsx`; `/#/admin` already routes to `AdminValidationApp`.
- The volunteer flow previously bootstrapped `/api/start-session` immediately, then showed intro, metadata, and category recording.
- The metadata form previously included an older consent yes/no field from `infoFormConfig.json`.
- Session metadata is built in `frontend/utils/sessionMetadata.ts` and persisted in `participant_sessions.metadata`.
- Device ID already exists in `frontend/utils/deviceId.ts` as a localStorage UUID.
- Backend upload/category guards already required v1 metadata before recording, but session creation did not require the new consent fields.
- Normal export and databuilder export already preserve session metadata-derived governance-like data without changing classifier label fields.
- Admin validation displays session metadata but does not depend on consent fields.

## Implementation Notes

- Added a main-route consent gate before Turnstile, metadata, or recording.
- Polished the gate into a friendly welcome and consent screen with a short purpose summary, what-to-expect steps, and a short privacy/consent summary.
- Removed the large privacy, participant information, and age detail cards from the main volunteer screen.
- Added one small read-more link from the main consent screen to `/#/privacy`.
- Consolidated the full privacy notice, informed consent, age restriction, and study information under `/#/privacy`.
- Kept `/#/participant-info` as a compatibility route that renders the same full details page as `/#/privacy`, but removed it from the normal volunteer UI.
- Kept `/#/admin` behavior unchanged and outside the volunteer flow.
- Removed the old metadata-form consent field and the under-18 age option.
- Removed the participant code display from the normal metadata step after manual review; the internal `device_id` remains in session metadata.
- Removed persistent volunteer footer policy links after manual review.
- Added version-aware local consent persistence under browser localStorage key `speechCollectorConsent`.
- Returning same-browser volunteers with valid stored consent now skip the welcome/consent screen and continue to the metadata or recording flow.
- Reused stored consent is still sent to `/api/start-session`; backend consent enforcement remains active.
- Malformed, stale, declined, or backend-rejected stored consent is cleared so the volunteer must consent again.
- Added consent metadata fields to session creation.
- Backend rejects direct session starts without valid consent and 18+ confirmation.
- Backend rejects metadata updates that would invalidate consent.
- Normal export and databuilder export include consent under `collection.consent` only.

## Compatibility Notes

- Turnstile remains after consent and before backend session creation when configured.
- Metadata form still stores demographics, environment, and browser technical metadata.
- Metadata form no longer displays the internal participant/device code.
- The current consent and privacy versions remain `1.0`; changing either frontend constant forces returning users to consent again.
- Accepted consent stores only the consent decision and original `consent_accepted_at`; full session metadata is rebuilt with the anonymous `device_id` and current technical metadata when a session starts.
- Normal volunteer screens do not show the internal participant code, save-code instructions, deletion-request instructions, technical identifier explanation, persistent policy footer links, separate privacy/participant route buttons, or multiple legal-looking cards.
- Category phrase UI, phrase IDs, semantic labels, normalized labels, and validation filtering were not changed.
- Admin validation route and behavior were not intentionally changed.
- No database migration was required because consent fields are stored in JSONB metadata.
- Databuilder export does not require consent fields for classifier loading.
- Audio-classifier was not touched.

## Safety

- No production server changes.
- No production deployment.
- No commit.
- No push.
- No generated exports, audio, temp files, screenshots, traces, or browser artifacts intentionally committed.
- `.env` was not modified by this implementation.

## Remaining TODOs

- Run the full command checklist.
- Run browser smoke if browser automation is available; otherwise provide manual steps.
- Avishek manual review before commit/push.
- Legal/content review before production deployment.
