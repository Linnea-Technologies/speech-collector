import {
  infoFormConfig,
  isConsentMarkdownYesNoField,
  type InfoFormField,
} from './infoFormConfig';

const DEFAULT_CONSENT_DECLINE_MESSAGE =
  'Thank you for your response. This session has been closed and no prompts will be shown.';

function normalizeMetadataValue(value: unknown) {
  if (typeof value === 'number') {
    return String(value);
  }

  return typeof value === 'string' ? value.trim() : '';
}

function isRequiredFieldComplete(field: InfoFormField, value: unknown) {
  const normalizedValue = normalizeMetadataValue(value);
  if (!normalizedValue) {
    return false;
  }

  if (isConsentMarkdownYesNoField(field)) {
    return field.options.some((option) => option.value === normalizedValue);
  }

  return true;
}

export function getRequiredMetadataFields() {
  return infoFormConfig.filter((field) => field.required).map((field) => field.id);
}

export function isMetadataComplete(metadata: Record<string, unknown> | null | undefined) {
  if (!metadata) {
    return false;
  }

  return infoFormConfig
    .filter((field) => field.required)
    .every((field) => isRequiredFieldComplete(field, metadata[field.id]));
}

export function hasDeclinedConsent(metadata: Record<string, unknown> | null | undefined) {
  if (!metadata) {
    return false;
  }

  return infoFormConfig.some(
    (field) =>
      isConsentMarkdownYesNoField(field) && normalizeMetadataValue(metadata[field.id]) === 'no'
  );
}

export function getConsentDeclineMessage(metadata: Record<string, unknown> | null | undefined) {
  if (!metadata) {
    return DEFAULT_CONSENT_DECLINE_MESSAGE;
  }

  const consentField = infoFormConfig.find(
    (field) =>
      isConsentMarkdownYesNoField(field) && normalizeMetadataValue(metadata[field.id]) === 'no'
  );

  return consentField && isConsentMarkdownYesNoField(consentField) && consentField.declineMessage
    ? consentField.declineMessage
    : DEFAULT_CONSENT_DECLINE_MESSAGE;
}
