import { getOrCreateDeviceId } from './deviceId';
import {
  infoFormConfig,
  isConsentMarkdownYesNoField,
  isSelectInfoFormField,
  shouldShowInfoFormField,
  type InfoFormField,
} from './infoFormConfig';
import { getBrowserTechnicalMetadata } from './technicalMetadata';

const DEFAULT_CONSENT_DECLINE_MESSAGE =
  'Et voi jatkaa osallistumista ilman suostumusta. Voit sulkea tämän sivun. You cannot continue without consent. You may close this page.';

export const CONSENT_VERSION = '1.0';
export const PRIVACY_NOTICE_VERSION = '1.0';
export const CONSENT_STORAGE_KEY = 'speechCollectorConsent';

type FormValues = Record<string, string | number | null | undefined>;
type MetadataObject = Record<string, unknown>;

function asRecord(value: unknown): MetadataObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as MetadataObject)
    : {};
}

function normalizeMetadataValue(value: unknown) {
  if (typeof value === 'number') {
    return String(value);
  }

  return typeof value === 'string' ? value.trim() : '';
}

function optionalText(value: unknown) {
  const normalized = normalizeMetadataValue(value);
  return normalized || null;
}

function getLocalStorage() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isValidIsoTimestamp(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function hasValidStoredConsent(metadata: MetadataObject) {
  return (
    metadata.consent_response === 'yes' &&
    metadata.consent_version === CONSENT_VERSION &&
    metadata.privacy_notice_version === PRIVACY_NOTICE_VERSION &&
    metadata.age_confirmed_18_or_over === true &&
    isValidIsoTimestamp(metadata.consent_accepted_at)
  );
}

export function flattenSessionMetadata(
  metadata: Record<string, unknown> | null | undefined
): Record<string, string> {
  const root = asRecord(metadata);
  const demographics = asRecord(root.demographics);
  const environment = asRecord(root.environment);

  return {
    age_group: normalizeMetadataValue(demographics.age_group ?? root.age_group),
    gender: normalizeMetadataValue(demographics.gender ?? root.gender),
    native_language: normalizeMetadataValue(
      demographics.native_language ?? root.native_language ?? root.primary_language
    ),
    native_language_other: normalizeMetadataValue(
      demographics.native_language_other ?? root.native_language_other
    ),
    dialect_region: normalizeMetadataValue(demographics.dialect_region ?? root.dialect_region),
    dialect_region_other: normalizeMetadataValue(
      demographics.dialect_region_other ?? root.dialect_region_other
    ),
    noise_level: normalizeMetadataValue(environment.noise_level ?? root.noise_level),
    audio_hardware: normalizeMetadataValue(environment.audio_hardware ?? root.audio_hardware),
    consent_response: normalizeMetadataValue(root.consent_response),
  };
}

export function buildConsentSessionMetadata(acceptedAt = new Date().toISOString()) {
  return {
    schema_version: 'v1',
    device_id: getOrCreateDeviceId(),
    consent_response: 'yes',
    consent_version: CONSENT_VERSION,
    privacy_notice_version: PRIVACY_NOTICE_VERSION,
    consent_accepted_at: acceptedAt,
    age_confirmed_18_or_over: true,
    technical: getBrowserTechnicalMetadata(),
  };
}

export function getStoredConsentSessionMetadata() {
  const storage = getLocalStorage();
  if (!storage) {
    return null;
  }

  const storedValue = storage.getItem(CONSENT_STORAGE_KEY);
  if (!storedValue) {
    return null;
  }

  try {
    const storedConsent = asRecord(JSON.parse(storedValue));
    if (!hasValidStoredConsent(storedConsent)) {
      storage.removeItem(CONSENT_STORAGE_KEY);
      return null;
    }

    return buildConsentSessionMetadata(String(storedConsent.consent_accepted_at));
  } catch {
    storage.removeItem(CONSENT_STORAGE_KEY);
    return null;
  }
}

export function storeConsentSessionMetadata(metadata: Record<string, unknown>) {
  const storage = getLocalStorage();
  const consentMetadata = asRecord(metadata);

  if (!storage || !hasValidStoredConsent(consentMetadata)) {
    return;
  }

  storage.setItem(
    CONSENT_STORAGE_KEY,
    JSON.stringify({
      consent_response: 'yes',
      consent_version: CONSENT_VERSION,
      privacy_notice_version: PRIVACY_NOTICE_VERSION,
      consent_accepted_at: consentMetadata.consent_accepted_at,
      age_confirmed_18_or_over: true,
    })
  );
}

export function clearStoredConsentSessionMetadata() {
  getLocalStorage()?.removeItem(CONSENT_STORAGE_KEY);
}

function isAllowedSelectValue(field: InfoFormField, value: unknown) {
  if (!isSelectInfoFormField(field) && !isConsentMarkdownYesNoField(field)) {
    return true;
  }

  const normalizedValue = normalizeMetadataValue(value);
  return field.options.some((option) => option.value === normalizedValue);
}

function isRequiredFieldComplete(field: InfoFormField, values: Record<string, unknown>) {
  if (!shouldShowInfoFormField(field, values)) {
    return true;
  }

  const normalizedValue = normalizeMetadataValue(values[field.id]);
  if (!normalizedValue) {
    return false;
  }

  return isAllowedSelectValue(field, normalizedValue);
}

export function getRequiredMetadataFields() {
  return infoFormConfig.filter((field) => field.required).map((field) => field.id);
}

export function isMetadataComplete(metadata: Record<string, unknown> | null | undefined) {
  if (!metadata) {
    return false;
  }

  const values = flattenSessionMetadata(metadata);

  return infoFormConfig
    .filter((field) => field.required)
    .every((field) => isRequiredFieldComplete(field, values));
}

export function hasDeclinedConsent(metadata: Record<string, unknown> | null | undefined) {
  if (!metadata) {
    return false;
  }

  const root = asRecord(metadata);
  if (root.consent_response === 'no') {
    return true;
  }

  const values = flattenSessionMetadata(metadata);

  return infoFormConfig.some(
    (field) => isConsentMarkdownYesNoField(field) && values[field.id] === 'no'
  );
}

export function getConsentDeclineMessage(metadata: Record<string, unknown> | null | undefined) {
  if (!metadata) {
    return DEFAULT_CONSENT_DECLINE_MESSAGE;
  }

  const values = flattenSessionMetadata(metadata);
  const consentField = infoFormConfig.find(
    (field) => isConsentMarkdownYesNoField(field) && values[field.id] === 'no'
  );

  return consentField && isConsentMarkdownYesNoField(consentField) && consentField.declineMessage
    ? consentField.declineMessage
    : DEFAULT_CONSENT_DECLINE_MESSAGE;
}

export function buildV1SessionMetadata(
  values: FormValues,
  existingMetadata: Record<string, unknown> | null | undefined = {}
) {
  const existing = asRecord(existingMetadata);
  const nativeLanguage = normalizeMetadataValue(values.native_language);
  const dialectRegion = normalizeMetadataValue(values.dialect_region);
  const consentResponse =
    normalizeMetadataValue(existing.consent_response) ||
    normalizeMetadataValue(values.consent_response);
  const deviceId =
    normalizeMetadataValue(existing.device_id) ||
    (consentResponse === 'yes' ? getOrCreateDeviceId() : '');
  const existingTechnical = asRecord(existing.technical);

  return {
    schema_version: 'v1',
    device_id: deviceId || null,
    consent_response: consentResponse,
    consent_version: normalizeMetadataValue(existing.consent_version) || CONSENT_VERSION,
    privacy_notice_version:
      normalizeMetadataValue(existing.privacy_notice_version) || PRIVACY_NOTICE_VERSION,
    consent_accepted_at: normalizeMetadataValue(existing.consent_accepted_at) || null,
    age_confirmed_18_or_over: existing.age_confirmed_18_or_over === true,
    demographics: {
      age_group: normalizeMetadataValue(values.age_group),
      gender: normalizeMetadataValue(values.gender),
      native_language: nativeLanguage,
      native_language_other:
        nativeLanguage === 'other' ? optionalText(values.native_language_other) : null,
      dialect_region: dialectRegion,
      dialect_region_other:
        dialectRegion === 'other' ? optionalText(values.dialect_region_other) : null,
    },
    environment: {
      noise_level: normalizeMetadataValue(values.noise_level),
      audio_hardware: normalizeMetadataValue(values.audio_hardware),
    },
    technical: {
      ...existingTechnical,
      ...getBrowserTechnicalMetadata(),
    },
  };
}
