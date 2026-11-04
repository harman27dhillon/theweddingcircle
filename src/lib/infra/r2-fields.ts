import { createElement, type PointerEvent } from "react";

export const SAVED_SECRET_PLACEHOLDER = "Saved — enter a new value to replace";

export type R2FieldView = {
  key: string;
  label: string;
  input: string;
  present: boolean;
  locked: boolean;
  value: string;
  mask: string;
  hint: string;
};

/** What an R2 credential input is allowed to do. Secrets are never prefilled. */
export function r2CredentialControl(field: Pick<R2FieldView, "input" | "present" | "mask" | "value">) {
  const secret = field.input === "password" || field.input === "json";
  const saved = field.present || Boolean(field.mask);
  return {
    disabled: false as const,
    readOnly: false as const,
    secret,
    initial: secret ? "" : field.value,
    placeholder: secret && saved ? SAVED_SECRET_PLACEHOLDER : "",
  };
}

export function r2DraftSeed(fields: Pick<R2FieldView, "key" | "input" | "value">[]) {
  return Object.fromEntries(fields.map((field) => [field.key, field.input === "password" || field.input === "json" ? "" : field.value]));
}

function focusField(event: PointerEvent<HTMLInputElement>) {
  event.stopPropagation();
  const input = event.currentTarget;
  input.disabled = false;
  input.readOnly = false;
}

export function R2CredentialFields({
  fields,
  draft,
  shown,
  onChange,
  onToggle,
}: {
  fields: R2FieldView[];
  draft: Record<string, string>;
  shown: Record<string, boolean>;
  onChange: (key: string, value: string) => void;
  onToggle: (key: string) => void;
}) {
  return createElement(
    "div",
    { className: "grid gap-3" },
    fields.map((field) => {
      const control = r2CredentialControl(field);
      const value = draft[field.key] ?? control.initial;
      const id = `infra-${field.key}`;
      return createElement(
        "div",
        { key: field.key, className: "block text-sm" },
        createElement(
          "span",
          { className: "flex flex-wrap items-center justify-between gap-2" },
          createElement("label", { htmlFor: id }, field.label),
          createElement(
            "span",
            { className: "text-xs text-gold" },
            field.locked ? "Set on the server" : field.present ? "Saved" : "Missing",
          ),
        ),
        createElement(
          "span",
          { className: "mt-2 flex gap-2" },
          createElement("input", {
            id,
            name: id,
            className: "min-h-11 w-full rounded-2xl border border-on-photo/20 bg-ink px-3 py-3 text-base outline-none",
            style: { fontSize: 16 },
            type: control.secret && !shown[field.key] ? "password" : "text",
            value,
            disabled: control.disabled,
            readOnly: control.readOnly,
            autoComplete: control.secret ? "new-password" : "off",
            autoCapitalize: "none",
            autoCorrect: "off",
            spellCheck: false,
            inputMode: "text",
            enterKeyHint: "done",
            tabIndex: 0,
            placeholder: control.placeholder,
            "data-1p-ignore": "true",
            "data-lpignore": "true",
            onPointerDown: focusField,
            onChange: (event: { target: { value: string } }) => onChange(field.key, event.target.value),
          }),
          control.secret
            ? createElement(
                "button",
                {
                  type: "button",
                  className: "min-h-11 shrink-0 rounded-full border border-on-photo/20 px-3 text-xs",
                  onClick: () => onToggle(field.key),
                  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => event.stopPropagation(),
                },
                shown[field.key] ? "Hide" : "Show",
              )
            : null,
        ),
        control.placeholder ? createElement("span", { className: "mt-1 block text-xs text-on-photo/60" }, control.placeholder) : null,
        field.locked
          ? createElement(
              "span",
              { className: "mt-1 block text-xs text-on-photo/60" },
              "A server value is in use. Type a replacement and save. Leave a secret blank to keep it.",
            )
          : null,
        field.hint ? createElement("span", { className: "mt-1 block text-xs text-on-photo/60" }, field.hint) : null,
      );
    }),
  );
}
