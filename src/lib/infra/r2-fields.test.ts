import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { R2CredentialFields, SAVED_SECRET_PLACEHOLDER, r2CredentialControl, r2DraftSeed } from "./r2-fields.ts";

const SECRET = "super-secret-r2-value-should-never-leak";

const fields = [
  { key: "R2_ACCOUNT_ID", label: "R2_ACCOUNT_ID", input: "text", present: true, locked: true, value: "a".repeat(32), mask: "", hint: "" },
  { key: "R2_BUCKET", label: "R2_BUCKET", input: "text", present: true, locked: true, value: "wedding-media", mask: "", hint: "" },
  { key: "R2_ACCESS_KEY_ID", label: "R2_ACCESS_KEY_ID", input: "password", present: true, locked: true, value: "", mask: "Saved on the server", hint: "" },
  { key: "R2_SECRET_ACCESS_KEY", label: "R2_SECRET_ACCESS_KEY", input: "password", present: true, locked: true, value: "", mask: "Saved on the server", hint: "" },
];

test("R2 credential inputs stay editable and never receive the saved secret", () => {
  for (const field of fields) {
    const control = r2CredentialControl(field);
    assert.equal(control.disabled, false);
    assert.equal(control.readOnly, false);
  }
  const draft = r2DraftSeed(fields);
  assert.equal(draft.R2_ACCOUNT_ID, "a".repeat(32));
  assert.equal(draft.R2_BUCKET, "wedding-media");
  assert.equal(draft.R2_ACCESS_KEY_ID, "");
  assert.equal(draft.R2_SECRET_ACCESS_KEY, "");
  assert.equal(JSON.stringify(draft).includes(SECRET), false);
  const html = renderToStaticMarkup(createElement(R2CredentialFields, {
    fields,
    draft,
    shown: {},
    onChange: () => undefined,
    onToggle: () => undefined,
  }));
  assert.equal(html.includes("disabled"), false);
  assert.equal(html.includes("readonly"), false);
  assert.equal(html.includes(SAVED_SECRET_PLACEHOLDER), true);
  assert.equal(html.includes("wedding-media"), true);
  assert.equal(html.includes(SECRET), false);
  assert.equal(html.includes("value=\"\""), true);
});
