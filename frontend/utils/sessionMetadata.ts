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
  'Thank you for your response. This session has been closed and no prompts will be shown.';

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

export function buildV1SessionMetadata(values: FormValues) {
  const nativeLanguage = normalizeMetadataValue(values.native_language);
  const dialectRegion = normalizeMetadataValue(values.dialect_region);

  return {
    schema_version: 'v1',
    device_id: getOrCreateDeviceId(),
    consent_response: normalizeMetadataValue(values.consent_response),
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
    technical: getBrowserTechnicalMetadata(),
  };
}
