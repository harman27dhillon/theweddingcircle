const DEFAULT_MODEL = "gpt-6-astra";

type ChatMessage = { role: "system" | "user"; content: string };

type OutputPart = { type?: string; text?: string };
type OutputItem = { content?: OutputPart[] };
type OpenAIBody = {
  output_text?: string;
  status?: string;
  incomplete_details?: { reason?: string } | null;
  error?: { message?: string; code?: string; type?: string } | null;
  output?: OutputItem[];
};

export function openaiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function openaiModel() {
  return process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;
}

function publicError(text: string) {
  const key = process.env.OPENAI_API_KEY?.trim() || "";
  let out = text;
  if (key.length > 8) out = out.split(key).join("[redacted]");
  out = out.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted]");
  out = out.replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
  return out.replace(/\s+/g, " ").trim().slice(0, 240);
}

function sentence(message: string) {
  if (!message) return "";
  return /[.!?]$/.test(message) ? message : `${message}.`;
}

function readError(raw: string) {
  try {
    const body = JSON.parse(raw) as { error?: { message?: string; code?: string; type?: string } };
    return {
      code: body.error?.code || body.error?.type || "",
      message: publicError(body.error?.message || ""),
    };
  } catch {
    return { code: "", message: "" };
  }
}

export function openaiFailure(status: number, raw: string) {
  const { code, message } = readError(raw);
  const model = openaiModel();
  if (status === 401 || code === "invalid_api_key") {
    return "OpenAI rejected the API key. Check the server variable OPENAI_API_KEY. No files were changed.";
  }
  if (status === 403) {
    return message
      ? `OpenAI refused the request. ${sentence(message)} No files were changed.`
      : "OpenAI refused the request. This key may lack permission, or the region is not supported. No files were changed.";
  }
  if (status === 429 || code === "insufficient_quota" || code === "rate_limit_exceeded") {
    return message
      ? `OpenAI limit reached. ${sentence(message)} No files were changed.`
      : "OpenAI limit reached. The account is out of credits or is being rate limited. No files were changed.";
  }
  if (status === 404 || code === "model_not_found") {
    return `The OpenAI model “${model}” is not available for this key. Set the server variable OPENAI_MODEL to a model the account can use. No files were changed.`;
  }
  if (message) return `OpenAI could not complete the request (${status}). ${sentence(message)} No files were changed.`;
  return `OpenAI could not complete the request (${status}). No files were changed.`;
}

function outputText(body: OpenAIBody) {
  if (typeof body.output_text === "string" && body.output_text.trim()) return body.output_text;
  const parts: string[] = [];
  for (const item of body.output || []) {
    for (const part of item.content || []) {
      if (part.type === "output_text" && part.text) parts.push(part.text);
    }
  }
  return parts.join("\n");
}

export async function openaiComplete(messages: ChatMessage[], maxTokens: number) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false as const,
      error: "OpenAI is not configured. Set the server variable OPENAI_API_KEY. No files were changed.",
    };
  }
  const instructions = messages
    .filter((item) => item.role === "system")
    .map((item) => item.content)
    .join("\n\n");
  const input = messages
    .filter((item) => item.role === "user")
    .map((item) => ({ role: "user" as const, content: item.content }));
  const cap = Math.min(Math.max(maxTokens, 2000), 6000);
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: openaiModel(),
        instructions: instructions || undefined,
        input,
        max_output_tokens: cap,
      }),
      signal: AbortSignal.timeout(50000),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return {
      ok: false as const,
      error: timedOut
        ? "OpenAI did not answer in time. No files were changed."
        : "OpenAI could not be reached. No files were changed.",
    };
  }
  const raw = await response.text();
  if (!response.ok) return { ok: false as const, error: openaiFailure(response.status, raw) };
  let body: OpenAIBody;
  try {
    body = JSON.parse(raw) as OpenAIBody;
  } catch {
    return { ok: false as const, error: "OpenAI returned a response that could not be read. No files were changed." };
  }
  if (body.error?.message) {
    return { ok: false as const, error: `OpenAI could not complete the request. ${sentence(publicError(body.error.message))} No files were changed.` };
  }
  const text = outputText(body);
  if (!text.trim()) {
    if (body.incomplete_details?.reason === "max_output_tokens" || body.status === "incomplete") {
      return { ok: false as const, error: "OpenAI stopped before it finished the answer. No files were changed." };
    }
    return { ok: false as const, error: "OpenAI returned an empty answer. No files were changed." };
  }
  return { ok: true as const, text };
}
