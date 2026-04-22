import { useContext, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import ReactMarkdown from "react-markdown";
import * as Yup from "yup";

import SessionContext from "../contexts/SessionProvider";
import type { SessionState } from "../types/session";
import {
  infoFormConfig,
  isConsentMarkdownYesNoField,
  type InfoFormField,
} from "../utils/infoFormConfig";
import "./InfoForm.css";

interface InfoFormProps {
  message: string;
  canCancel?: boolean;
  onCancel?: () => void;
  onSaved: (session: SessionState) => Promise<void> | void;
}

type FormValues = Record<string, string | number | null | undefined>;

const localFormConfig: InfoFormField[] = infoFormConfig;

const validationSchema = Yup.object().shape(
  localFormConfig.reduce((schema, field) => {
    let baseSchema: Yup.AnySchema;

    switch (field.type) {
      case "consent_markdown_yes_no":
        baseSchema = Yup.string().oneOf(
          field.options.map((option) => option.value),
          "Choose Yes or No"
        );
        break;
      case "email":
        baseSchema = Yup.string().email("Enter a valid value");
        break;
      case "date":
        baseSchema = Yup.date().typeError("Enter a valid value");
        break;
      case "integer":
        baseSchema = Yup.number().integer("Enter a whole number").typeError("Enter a valid value");
        break;
      case "float":
        baseSchema = Yup.number().typeError("Enter a valid value");
        break;
      case "url":
        baseSchema = Yup.string().url("Enter a valid value");
        break;
      default:
        baseSchema = Yup.string().nullable().notRequired();
        break;
    }

    baseSchema = baseSchema.transform((value, originalValue) => (originalValue === "" ? null : value));
    schema[field.id] = field.required
      ? baseSchema.required("This field is required")
      : baseSchema.nullable().notRequired();

    return schema;
  }, {} as Record<string, Yup.AnySchema>)
);

const InfoForm = ({ message, canCancel = false, onCancel, onSaved }: InfoFormProps) => {
  const { sessionToken, participantMetadata, setParticipantMetadata } = useContext(SessionContext);
  const [formMessage, setFormMessage] = useState<string>("");
  const apiUrl = import.meta.env.VITE_API_URL;

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting, isSubmitted },
    setValue,
  } = useForm<FormValues>({
    resolver: yupResolver(validationSchema),
  });

  const watchedValues = watch();
  const isDecliningConsent = localFormConfig.some(
    (field) =>
      isConsentMarkdownYesNoField(field) &&
      typeof watchedValues[field.id] === "string" &&
      watchedValues[field.id] === "no"
  );

  useEffect(() => {
    localFormConfig.forEach((field) => {
      setValue(field.id, (participantMetadata?.[field.id] as string | undefined) ?? "");
    });
  }, [participantMetadata, setValue]);

  const onSubmit = async (data: FormValues) => {
    if (!sessionToken) {
      setFormMessage("A session is required before saving details.");
      return;
    }

    try {
      setFormMessage("");
      const response = await fetch(`${apiUrl}/api/update-session-metadata`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionToken, metadata: data }),
      });

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.message || "Could not save session details.");
      }

      setParticipantMetadata(result.session.metadata || {});
      setFormMessage("Saved.");
      await onSaved(result.session as SessionState);
    } catch (error) {
      setFormMessage(error instanceof Error ? error.message : "Could not save session details.");
    }
  };

  return (
    <section className="app-panel app-panel--wide">
      <span className="app-eyebrow">Session details</span>
      <h1 className="app-title">Recording conditions</h1>
      <p className="app-copy">{message}</p>

      <form className="info-form" onSubmit={handleSubmit(onSubmit)}>
        <div className="info-form__grid">
          {localFormConfig.map((field) => {
            if (isConsentMarkdownYesNoField(field)) {
              const selectedValue =
                typeof watchedValues[field.id] === "string" ? watchedValues[field.id] : "";

              return (
                <fieldset key={field.id} className="info-form__fieldset">
                  <legend id={`${field.id}-legend`} className="info-form__legend">
                    {field.label}
                    {field.required ? " *" : ""}
                  </legend>
                  <div className="info-form__markdown-box">
                    <ReactMarkdown>{field.markdown}</ReactMarkdown>
                  </div>
                  <div
                    className="info-form__radio-group"
                    role="radiogroup"
                    aria-labelledby={`${field.id}-legend`}
                  >
                    {field.options.map((option) => (
                      <label key={option.value} className="info-form__radio-option">
                        <input
                          type="radio"
                          value={option.value}
                          {...register(field.id)}
                          className="info-form__radio-input"
                        />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </div>
                  {selectedValue === "no" && (
                    <p className="info-form__hint">
                      {field.declineMessage ||
                        "Choosing No will save your response and close this session before any prompts are shown."}
                    </p>
                  )}
                  {isSubmitted && errors[field.id] && (
                    <span className="info-form__error">{errors[field.id]?.message as string}</span>
                  )}
                </fieldset>
              );
            }

            return (
              <label key={field.id} className="info-form__field" htmlFor={field.id}>
                <span>
                  {field.label}
                  {field.required ? " *" : ""}
                </span>
                <input
                  id={field.id}
                  type={field.type === "integer" || field.type === "float" ? "number" : field.type}
                  {...register(field.id)}
                  className={
                    errors[field.id] && isSubmitted
                      ? "info-form__input info-form__input--error"
                      : "info-form__input"
                  }
                />
                {isSubmitted && errors[field.id] && (
                  <span className="info-form__error">{errors[field.id]?.message as string}</span>
                )}
              </label>
            );
          })}
        </div>

        <div className="info-form__actions">
          {canCancel && onCancel && (
            <button type="button" className="app-secondary-button" onClick={onCancel} disabled={isSubmitting}>
              Cancel
            </button>
          )}
          <button type="submit" className="app-primary-button" disabled={isSubmitting}>
            {isDecliningConsent
              ? "Save and exit"
              : canCancel
                ? "Save changes"
                : "Save and continue"}
          </button>
        </div>

        {formMessage && <p className="app-inline-message">{formMessage}</p>}
      </form>
    </section>
  );
};

export default InfoForm;
