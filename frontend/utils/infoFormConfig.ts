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
}

export interface StandardInfoFormField extends BaseInfoFormField {
  type: string;
}

export interface ConsentMarkdownYesNoField extends BaseInfoFormField {
  type: "consent_markdown_yes_no";
  markdown: string;
  options: InfoFormOption[];
  declineMessage?: string;
}

export type InfoFormField = StandardInfoFormField | ConsentMarkdownYesNoField;

export const infoFormConfig: InfoFormField[] = rawFormConfig as InfoFormField[];

export function isConsentMarkdownYesNoField(
  field: InfoFormField
): field is ConsentMarkdownYesNoField {
  return field.type === "consent_markdown_yes_no";
}

