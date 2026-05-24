import rawFormConfig from "../../infoFormConfig.json";

export interface InfoFormOption {
  value: string;
  label: string;
}

interface BaseInfoFormField {
  id: string;
  label: string;
  type: string;
  required?: boolean;
  helperText?: string;
  showWhen?: {
    field: string;
    equals: string;
  };
}

export interface StandardInfoFormField extends BaseInfoFormField {
  type: string;
}

export interface SelectInfoFormField extends BaseInfoFormField {
  type: "select";
  options: InfoFormOption[];
}

export interface ConsentMarkdownYesNoField extends BaseInfoFormField {
  type: "consent_markdown_yes_no";
  markdown: string;
  options: InfoFormOption[];
  declineMessage?: string;
}

export type InfoFormField = StandardInfoFormField | SelectInfoFormField | ConsentMarkdownYesNoField;

export const infoFormConfig: InfoFormField[] = rawFormConfig as InfoFormField[];

export function isConsentMarkdownYesNoField(
  field: InfoFormField
): field is ConsentMarkdownYesNoField {
  return field.type === "consent_markdown_yes_no";
}

export function isSelectInfoFormField(field: InfoFormField): field is SelectInfoFormField {
  return field.type === "select";
}

export function shouldShowInfoFormField(
  field: InfoFormField,
  values: Record<string, unknown>
) {
  if (!field.showWhen) {
    return true;
  }

  return values[field.showWhen.field] === field.showWhen.equals;
}

