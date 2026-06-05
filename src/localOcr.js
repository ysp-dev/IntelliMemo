import { createWorker, PSM } from "tesseract.js";

let localWorkerPromise = null;

const LOCAL_OCR_LANGS = ["kor", "eng"];

const cleanOcrText = (text) =>
  (text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const getLocalOcrWorker = () => {
  if (!localWorkerPromise) {
    localWorkerPromise = createWorker(LOCAL_OCR_LANGS, 1, {
      cachePath: "intelli-memo-ocr",
    }).then(async (worker) => {
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.AUTO,
        preserve_interword_spaces: "1",
        user_defined_dpi: "300",
      });
      return worker;
    }).catch((err) => {
      localWorkerPromise = null;
      throw err;
    });
  }
  return localWorkerPromise;
};

export const extractTextWithLocalOcr = async ({ image }) => {
  const worker = await getLocalOcrWorker();
  const result = await worker.recognize(image, {
    rotateAuto: true,
  });
  return cleanOcrText(result.data?.text);
};
