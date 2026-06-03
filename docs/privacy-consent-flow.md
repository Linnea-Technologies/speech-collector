# Privacy Consent Flow

Date: 03.06.2026

## Goal

The volunteer-facing Speech Collector app shows a simple, friendly welcome and consent screen before any collection session is created unless the same browser already has valid stored consent for the current policy versions. The main screen explains the project, what the volunteer will do, a short privacy/consent summary, and one small read-more link to the full details page at `/#/privacy`.

## Source Content

Source document: `Linnea_tietosuoja_ja_suostumus (1).docx`.

The full `/#/privacy` page consolidates the document sections:

- `Tietosuojaseloste`
- `Tietoon perustuva suostumus`
- `Ikärajahuomio - alle 18-vuotiaat`
- `Tutkimustiedote`

The Finnish text is the official volunteer-facing content. English text in the app is helper translation for review and non-Finnish team members.

## Filled Values

- Company: Linnea Technologies Oy
- Y-tunnus: 3571288-4
- Address: Kulmalantie 11 as. 2, 28130 Pori, Finland
- Contact: Ollipekka Kivin
- Contact email: ollipekka@hellolinnea.com
- Policy date: 03.06.2026
- Consent version: 1.0
- Privacy notice version: 1.0
- Minimum age: 18+
- English purpose wording: AI-based phone service
- Finnish purpose wording: tekoälypohjainen puhelinpalvelu

The contact title and phone placeholders from the source document are not published in the UI.

## Volunteer Flow

1. Main route opens at `/#/`.
2. If valid same-browser consent is stored and the consent/privacy versions match, the app skips the welcome and consent screen.
3. If no valid stored consent exists, the simple welcome and consent screen appears first.
4. The main screen shows the welcome title, short project purpose, what-volunteers-will-do steps, and a short privacy/consent summary.
5. One small read-more link points to `/#/privacy`: `Lue tietosuoja- ja suostumustiedot kokonaan / Read full privacy and consent details`.
6. Continue stays disabled until both required checkboxes are checked.
7. Decline shows the bilingual blocked message, clears any stored accepted consent, and does not start a backend session.
8. Accepted consent is stored in browser localStorage and proceeds to Turnstile if configured.
9. `/api/start-session` receives consent metadata, including reused stored consent when available, and creates or resumes the session.
10. Metadata form appears without exposing the internal participant/device code.
11. Category phrase recording starts only after metadata is complete.

The normal volunteer flow does not show participant code, deletion-request instructions, technical identifier explanation, persistent footer policy links, or multiple legal-looking cards.

## Routes

- `/#/privacy`: full privacy, consent, age restriction, and study information page.
- `/#/participant-info`: compatibility route that renders the same full details page as `/#/privacy`.
- `/#/admin`: unchanged internal admin validation route.

The normal UI links only to `/#/privacy` through the single small read-more link on the main consent screen. `/#/participant-info` is kept for compatibility but is not shown as a normal volunteer-flow link.

## Session Metadata

The consent gate sends these fields when a session is created. Returning same-browser volunteers reuse the original `consent_accepted_at` timestamp from browser storage when the stored versions still match.

```json
{
  "consent_response": "yes",
  "consent_version": "1.0",
  "privacy_notice_version": "1.0",
  "consent_accepted_at": "ISO timestamp",
  "age_confirmed_18_or_over": true
}
```

The same metadata also includes `schema_version`, browser technical metadata, and the anonymous internal `device_id`. The metadata form preserves these consent fields when it saves demographics and recording-environment metadata, but the normal volunteer flow does not display the identifier.

## Browser Consent Storage

Accepted consent is stored locally in `localStorage` under `speechCollectorConsent`:

```json
{
  "consent_response": "yes",
  "consent_version": "1.0",
  "privacy_notice_version": "1.0",
  "consent_accepted_at": "ISO timestamp",
  "age_confirmed_18_or_over": true
}
```

Stored consent is valid only when:

- `consent_response` is `yes`
- `age_confirmed_18_or_over` is `true`
- `consent_version` matches `CONSENT_VERSION`
- `privacy_notice_version` matches `PRIVACY_NOTICE_VERSION`
- `consent_accepted_at` is a valid timestamp

If `CONSENT_VERSION` or `PRIVACY_NOTICE_VERSION` changes in code, the stored consent no longer matches and the volunteer is asked to consent again. Malformed or stale stored consent is removed locally and the welcome/consent screen is shown again.

Only the consent decision is stored in this key. When starting a backend session, the frontend rebuilds the full session metadata with the stored consent timestamp, the current anonymous browser `device_id`, and current browser technical metadata.

## Backend Enforcement

`POST /api/start-session` rejects missing or invalid consent metadata with `consent_required` before calling the provider. `TaskProvider.startSession()` also validates consent before allocating a topic copy or inserting `participant_sessions`.

`TaskProvider.updateSessionMetadata()` rejects updates that would remove or invalidate required consent fields. Upload and category-state guards still require complete v1 session metadata before recording.

Backend consent enforcement remains active even when consent is reused from browser storage. If the backend rejects reused consent, the frontend clears the stored browser consent and shows the consent screen again.

## Export Compatibility

Normal export and databuilder export include consent only as governance metadata under `collection.consent`.

Consent metadata does not change:

- `normalized_label`
- `semantic_label`
- `phrase_id`
- `category`
- admin validation status
- validation filtering
- classifier label behavior

The audio-classifier package is not changed.

## Remaining TODOs

- Manual browser smoke test should be run before push or PR.
- Confirm final legal wording with Linnea before production deployment.
- No production deployment has been performed for this implementation.
