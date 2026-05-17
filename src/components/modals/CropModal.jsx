import { useCallback, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import { useFocusTrap } from "../../hooks/useFocusTrap.js";

export function CropModal({ dataUrl, mimeType, onCrop, onCancel }) {
  const modalRef  = useRef(null);
  useFocusTrap(modalRef);
  const canvasRef = useRef(null);
  const imgRef    = useRef(null);
  const cropRef   = useRef(null);
  const dragRef   = useRef(null);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const img    = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const c = cropRef.current;
    if (!c) return;
    const { x1, y1, x2, y2 } = c;
    const w = x2 - x1, h = y2 - y1;

    ctx.fillStyle = "rgba(0,0,0,0.52)";
    ctx.fillRect(0, 0, canvas.width, y1);
    ctx.fillRect(0, y2, canvas.width, canvas.height - y2);
    ctx.fillRect(0, y1, x1, h);
    ctx.fillRect(x2, y1, canvas.width - x2, h);

    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 2;
    ctx.strokeRect(x1 + 1, y1 + 1, w - 2, h - 2);

    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x1 + w / 3, y1); ctx.lineTo(x1 + w / 3, y2);
    ctx.moveTo(x1 + 2 * w / 3, y1); ctx.lineTo(x1 + 2 * w / 3, y2);
    ctx.moveTo(x1, y1 + h / 3); ctx.lineTo(x2, y1 + h / 3);
    ctx.moveTo(x1, y1 + 2 * h / 3); ctx.lineTo(x2, y1 + 2 * h / 3);
    ctx.stroke();

    const ARM  = Math.min(w, h, 120) * 0.32;
    const TICK = Math.max(2, ARM * 0.11);
    ctx.fillStyle = "#fff";
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur  = 8;
    [
      [x1, y1,  1,  1],
      [x2, y1, -1,  1],
      [x1, y2,  1, -1],
      [x2, y2, -1, -1],
    ].forEach(([cx, cy, sx, sy]) => {
      ctx.fillRect(cx, cy, sx * ARM,  sy * TICK);
      ctx.fillRect(cx, cy, sx * TICK, sy * ARM);
    });

    ctx.shadowBlur = 0;
    ctx.fillStyle  = "#fff";
    [[x1, y1], [x2, y1], [x1, y2], [x2, y2]].forEach(([cx, cy]) => {
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.fill();
    });
  }, []);

  const initCrop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pad = Math.min(canvas.width, canvas.height) * 0.04;
    cropRef.current = { x1: pad, y1: pad, x2: canvas.width - pad, y2: canvas.height - pad };
    redraw();
  }, [redraw]);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const scale = Math.min(1, 1400 / img.naturalWidth, 1400 / img.naturalHeight);
      canvas.width  = Math.round(img.naturalWidth  * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      initCrop();
    };
    img.src = dataUrl;
  }, [dataUrl, initCrop]);

  const toCanvas = (e) => {
    const canvas = canvasRef.current;
    const rect   = canvas.getBoundingClientRect();
    const src    = e.touches ? e.touches[0] : e;
    return {
      x: (src.clientX - rect.left) * (canvas.width  / rect.width),
      y: (src.clientY - rect.top)  * (canvas.height / rect.height),
    };
  };

  const hitTest = (p) => {
    const c = cropRef.current;
    if (!c) return null;
    const canvas = canvasRef.current;
    const rect   = canvas.getBoundingClientRect();
    const R = 28 * (canvas.width / rect.width);
    const { x1, y1, x2, y2 } = c;
    for (const [name, cx, cy] of [
      ["tl", x1, y1], ["tr", x2, y1], ["bl", x1, y2], ["br", x2, y2],
    ]) {
      if ((p.x - cx) ** 2 + (p.y - cy) ** 2 <= R ** 2) return name;
    }
    if (p.x > x1 && p.x < x2 && p.y > y1 && p.y < y2) return "move";
    return null;
  };

  const onDown = (e) => {
    e.preventDefault();
    const p   = toCanvas(e);
    const hit = hitTest(p);
    if (hit) {
      dragRef.current = { type: hit, startX: p.x, startY: p.y, startCrop: { ...cropRef.current } };
    }
  };

  const onMove = (e) => {
    if (!dragRef.current) return;
    e.preventDefault();
    const p  = toCanvas(e);
    const { type, startX, startY, startCrop: sc } = dragRef.current;
    const canvas = canvasRef.current;
    const MIN    = 30;
    const dx = p.x - startX, dy = p.y - startY;
    let { x1, y1, x2, y2 } = sc;

    if (type === "move") {
      const w = x2 - x1, h = y2 - y1;
      x1 = Math.max(0, Math.min(canvas.width  - w, sc.x1 + dx));
      y1 = Math.max(0, Math.min(canvas.height - h, sc.y1 + dy));
      x2 = x1 + w; y2 = y1 + h;
    } else {
      if (type === "tl" || type === "bl") x1 = Math.max(0,             Math.min(sc.x2 - MIN, sc.x1 + dx));
      if (type === "tr" || type === "br") x2 = Math.min(canvas.width,  Math.max(sc.x1 + MIN, sc.x2 + dx));
      if (type === "tl" || type === "tr") y1 = Math.max(0,             Math.min(sc.y2 - MIN, sc.y1 + dy));
      if (type === "bl" || type === "br") y2 = Math.min(canvas.height, Math.max(sc.y1 + MIN, sc.y2 + dy));
    }

    cropRef.current = { x1, y1, x2, y2 };
    redraw();
  };

  const onUp = (e) => {
    e.preventDefault();
    dragRef.current = null;
  };

  const getCroppedCanvas = () => {
    const c      = cropRef.current;
    const img    = imgRef.current;
    const canvas = canvasRef.current;
    if (!img) return null;

    const out    = document.createElement("canvas");
    const ctx    = out.getContext("2d");
    const MAX_PX = 1400;

    if (!c) {
      const scale = Math.min(1, MAX_PX / img.naturalWidth, MAX_PX / img.naturalHeight);
      out.width  = Math.round(img.naturalWidth  * scale);
      out.height = Math.round(img.naturalHeight * scale);
      ctx.drawImage(img, 0, 0, out.width, out.height);
    } else {
      const sx = img.naturalWidth  / canvas.width;
      const sy = img.naturalHeight / canvas.height;
      const { x1, y1, x2, y2 } = c;
      const cropW = (x2 - x1) * sx;
      const cropH = (y2 - y1) * sy;
      const scale = Math.min(1, MAX_PX / cropW, MAX_PX / cropH);
      out.width  = Math.round(cropW * scale);
      out.height = Math.round(cropH * scale);
      ctx.drawImage(img, x1 * sx, y1 * sy, cropW, cropH, 0, 0, out.width, out.height);
    }

    const outMime = mimeType === "image/png" ? "image/png" : "image/jpeg";
    return { out, outMime };
  };

  const handleApply = () => {
    const result = getCroppedCanvas();
    if (!result) return;
    const { out, outMime } = result;
    const dataUrl = out.toDataURL(outMime, outMime === "image/jpeg" ? 0.92 : undefined);
    onCrop(dataUrl.split(",")[1], outMime);
  };

  return (
    <motion.div
      className="crop-overlay"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onClick={onCancel}
    >
      <motion.div
        ref={modalRef}
        className="crop-modal"
        initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 16 }}
        transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="crop-modal-hdr">
          <h2>텍스트 영역 선택 <span>꼭지점·내부 드래그로 조정</span></h2>
          <button type="button" className="crop-close-btn" onClick={onCancel}>
            <X size={14} />
          </button>
        </div>
        <div className="crop-canvas-wrap">
          <canvas
            ref={canvasRef}
            className="crop-canvas"
            onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
            onTouchStart={onDown} onTouchMove={onMove} onTouchEnd={onUp}
          />
        </div>
        <div className="crop-modal-footer">
          <button type="button" className="crop-cancel-btn" onClick={onCancel}>취소</button>
          <button type="button" className="crop-reset-btn" onClick={initCrop}>초기화</button>
          <button type="button" className="crop-save-btn" onClick={async () => {
            const result = getCroppedCanvas();
            if (!result) return;
            const { out, outMime } = result;
            const ext     = outMime === "image/png" ? "png" : "jpg";
            const dataUrl = out.toDataURL(outMime, outMime === "image/jpeg" ? 0.92 : undefined);
            try {
              const blob = await fetch(dataUrl).then(r => r.blob());
              const file = new File([blob], `memo-${Date.now()}.${ext}`, { type: outMime });
              if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
                await navigator.share({ files: [file], title: "메모 이미지" });
              } else {
                const a = document.createElement("a");
                a.href = dataUrl;
                a.download = `memo-${Date.now()}.${ext}`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
              }
            } catch (e) { console.error(e); }
          }}>이미지 저장</button>
          <button type="button" className="crop-apply-btn" onClick={handleApply}>텍스트 추출</button>
        </div>
      </motion.div>
    </motion.div>
  );
}
