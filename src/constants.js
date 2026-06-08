export const TAGS = ["#업무", "#아이디어", "#개인"];

export const TAG_STYLES = {
  "#업무":    { bg: "#ede9fe", color: "#5b21b6", dot: "#7c3aed" },
  "#아이디어": { bg: "#ecfeff", color: "#0e7490", dot: "#06b6d4" },
  "#개인":    { bg: "#fce7f3", color: "#9d174d", dot: "#ec4899" },
};

export const DEFAULT_TAG = TAGS[0];

export const ACTION_FILTERS = [
  { key: "all",    label: "전체" },
  { key: "active", label: "진행 중" },
  { key: "done",   label: "완료" },
];

export const DEFAULT_OPENAI_MODEL = "gpt-5.5";
export const OPENAI_SETTINGS_STORAGE_KEY = "openAiSettings";
export const OPENAI_API_KEY_SESSION_KEY = "openAiApiKey";

export const OPENAI_MODELS = [
  { key: "gpt-5.5", label: "GPT-5.5 추천" },
  { key: "gpt-5.4", label: "GPT-5.4" },
];

export const DEFAULT_OCR_MODEL = "gemini-2.5-flash";
// Legacy storage keys keep existing Gemini OCR settings available after the ChatGPT split.
export const OCR_SETTINGS_STORAGE_KEY = "aiSettings";
export const OCR_API_KEY_SESSION_KEY = "aiApiKey";

export const OCR_MODELS = [
  { key: "gemini-2.5-pro",        label: "Gemini 2.5 Pro" },
  { key: "gemini-2.5-flash",      label: "Gemini 2.5 Flash 추천" },
  { key: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite" },
  { key: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite" },
];

export const AI_CORRECTION_MODES = [
  {
    key:   "typo",
    label: "오타·띄어쓰기",
    group: "typo",
    prompt: (text) =>
      `You proofread Korean 인텔리메모 notes. Return only the fully corrected Korean text. Fix typos and spacing errors only. Preserve every idea, detail, line break, meaning, intent, and tone. Do not summarize, shorten, omit, add explanations, labels, quotation marks, markdown, or alternatives. If already correct, return it unchanged.\n\n오타와 띄어쓰기만 교정해줘. 절대 내용을 바꾸거나 줄이지 마.\n\n${text}`,
  },
  {
    key:   "grammar",
    label: "문법",
    group: "sentence",
    prompt: (text) =>
      `You are a Korean grammar corrector. Fix grammatical errors only: incorrect particles (조사), verb and adjective conjugation errors, tense errors, and awkward sentence structures. Do NOT change vocabulary, style, tone, or content. Return ONLY the corrected Korean text, no explanations.\n\n문법 오류만 교정해줘: 조사, 어미 활용, 시제, 문장 구조. 어휘·문체·내용은 그대로 유지해.\n\n${text}`,
  },
  {
    key:   "style",
    label: "문체",
    group: "sentence",
    prompt: (text) =>
      `You are a Korean writing style editor. Improve the writing to make it clearer, more natural, and more polished. Refine word choice, improve sentence flow, and restructure for readability. Preserve all original ideas, facts, and intent. Return ONLY the improved Korean text, no explanations.\n\n문체를 자연스럽고 읽기 좋게 다듬어줘. 원래 내용과 의도는 모두 유지해.\n\n${text}`,
  },
  {
    key:   "semantic",
    label: "의미·맥락",
    group: "sentence",
    prompt: (text) =>
      `You are a Korean semantic editor. Analyze the meaning, intent, and logical flow of the text. Fix ambiguous expressions, logical gaps, unclear references, and contradictions. Preserve the original ideas but clarify meaning so the text communicates the intended message precisely. Return ONLY the improved Korean text, no explanations.\n\n의미와 맥락을 분석해서 모호한 표현, 논리적 빈틈, 불명확한 지시어를 교정해줘. 원래 의도는 유지하되 전달력을 높여줘.\n\n${text}`,
  },
  {
    key:   "translate",
    label: "번역",
    group: "translate",
    prompt: (text) =>
      `Detect the language of the following text and translate it into natural, fluent Korean. Return ONLY the translated Korean text. No explanations, no source language label, no alternatives.\n\n다음 텍스트의 언어를 자동으로 감지하고 자연스러운 한국어로 번역해줘. 번역문만 반환해.\n\n${text}`,
  },
];

export const AI_CORRECTION_GROUPS = [
  { key: "typo",      label: "오타·띄어쓰기" },
  { key: "sentence",  label: "문장 교정" },
  { key: "translate", label: "번역" },
];

export const DEFAULT_AI_CORRECTION_MODE = "typo";

export const UNDO_DELAY_MS = 3500;
