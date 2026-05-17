import { AI_CORRECTION_MODES, DEFAULT_AI_CORRECTION_MODE } from "./constants.js";
import { extractText, parseRetryAfter, detectRateLimitType, apiError } from "./utils.js";

export const callGeminiApi = async ({ apiKey, model, body }) => {
  let res;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
      },
    );
  } catch (e) {
    throw new Error(e instanceof TypeError ? "네트워크 연결을 확인하세요." : "API 호출 실패");
  }

  if (!res.ok) {
    const rawBody = await res.text();
    let rawMsg = rawBody;
    try { const p = JSON.parse(rawBody); rawMsg = p?.error?.message || rawBody; } catch {}
    const ra  = res.headers.get("Retry-After");
    const err = new Error(apiError(res.status, rawBody));
    err.status = res.status;
    const retryAfterSec = parseRetryAfter(ra);
    if (retryAfterSec) err.retryAfter = retryAfterSec;
    if (res.status === 429) err.limitType = detectRateLimitType(rawMsg, ra);
    throw err;
  }

  return res.json();
};

export const correctKorean = async ({ apiKey, model, text, mode = DEFAULT_AI_CORRECTION_MODE }) => {
  const modeConfig = AI_CORRECTION_MODES.find((m) => m.key === mode) ?? AI_CORRECTION_MODES[0];
  const data = await callGeminiApi({
    apiKey, model,
    body: {
      contents: [{ role: "user", parts: [{ text: modeConfig.prompt(text) }] }],
      generationConfig: { maxOutputTokens: 1024, temperature: 0.2 },
    },
  });
  if ((data.candidates ?? []).some((c) => c.finishReason === "MAX_TOKENS"))
    throw new Error("결과가 너무 길어 중단됐습니다. 텍스트를 나눠서 교정하세요.");
  const corrected = extractText(data);
  if (!corrected) throw new Error("교정 결과가 비어 있습니다.");
  return corrected;
};

export const extractTextFromImage = async ({ apiKey, model, base64, mimeType = "image/jpeg" }) => {
  const data = await callGeminiApi({
    apiKey, model,
    body: {
      contents: [{
        parts: [
          { text: "이미지에서 텍스트를 모두 추출해줘. 레이아웃과 줄바꿈을 최대한 보존하고 텍스트만 반환해. 텍스트가 없으면 빈 문자열을 반환해." },
          { inline_data: { mime_type: mimeType, data: base64 } },
        ],
      }],
      generationConfig: { maxOutputTokens: 2048, temperature: 0.1 },
    },
  });
  return extractText(data) ?? "";
};
