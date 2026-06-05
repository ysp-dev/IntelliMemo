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

  const getHandleScale = (canvas) => {
    const rect = canvas.getBoundingClientRect();
    return canvas.width / Math.max(rect.width, 1);
  };

  const setCanvasCursor = (type) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cursor = {
      move: "grab",
      tl: "nwse-resize",
      br: "nwse-resize",
      tr: "nesw-resize",
      bl: "nesw-resize",
      top: "ns-resize",
      bottom: "ns-resize",
      left: "ew-resize",
      right: "ew-resize",
      grabbing: "grabbing",
    }[type] ?? "crosshair";
    canvas.style.cursor = cursor;
  };

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
    const scale = getHandleScale(canvas);
    const cornerLen = Math.max(22 * scale, Math.min(w, h, 150 * scale) * 0.2);
    const edgeLen = Math.max(34 * scale, Math.min(w, h, 170 * scale) * 0.18);
    const handleWidth = Math.max(3 * scale, Math.min(7 * scale, Math.min(w, h) * 0.012));
    const dragging = Boolean(dragRef.current);

    ctx.fillStyle = dragging ? "rgba(0,0,0,0.58)" : "rgba(0,0,0,0.48)";
    ctx.fillRect(0, 0, canvas.width, y1);
    ctx.fillRect(0, y2, canvas.width, canvas.height - y2);
    ctx.fillRect(0, y1, x1, h);
    ctx.fillRect(x2, y1, canvas.width - x2, h);

    ctx.strokeStyle = dragging ? "rgba(255,255,255,0.38)" : "rgba(255,255,255,0.18)";
    ctx.lineWidth = Math.max(1, scale);
    ctx.beginPath();
    ctx.moveTo(x1 + w / 3, y1); ctx.lineTo(x1 + w / 3, y2);
    ctx.moveTo(x1 + 2 * w / 3, y1); ctx.lineTo(x1 + 2 * w / 3, y2);
    ctx.moveTo(x1, y1 + h / 3); ctx.lineTo(x2, y1 + h / 3);
    ctx.moveTo(x1, y1 + 2 * h / 3); ctx.lineTo(x2, y1 + 2 * h / 3);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,255,255,0.82)";
    ctx.lineWidth = Math.max(1.2 * scale, handleWidth * 0.42);
    ctx.strokeRect(x1, y1, w, h);

    ctx.save();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = handleWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur  = 10 * scale;
    const drawLine = (xa, ya, xb, yb) => {
      ctx.beginPath();
      ctx.moveTo(xa, ya);
      ctx.lineTo(xb, yb);
      ctx.stroke();
    };
    drawLine(x1, y1, x1 + cornerLen, y1);
    drawLine(x1, y1, x1, y1 + cornerLen);
    drawLine(x2, y1, x2 - cornerLen, y1);
    drawLine(x2, y1, x2, y1 + cornerLen);
    drawLine(x1, y2, x1 + cornerLen, y2);
    drawLine(x1, y2, x1, y2 - cornerLen);
    drawLine(x2, y2, x2 - cornerLen, y2);
    drawLine(x2, y2, x2, y2 - cornerLen);

    const midX = x1 + w / 2;
    const midY = y1 + h / 2;
    drawLine(midX - edgeLen / 2, y1, midX + edgeLen / 2, y1);
    drawLine(midX - edgeLen / 2, y2, midX + edgeLen / 2, y2);
    drawLine(x1, midY - edgeLen / 2, x1, midY + edgeLen / 2);
    drawLine(x2, midY - edgeLen / 2, x2, midY + edgeLen / 2);
    ctx.restore();
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
      x: (src.clientX - rect.left) * (canvas.width  / Math.max(rect.width, 1)),
      y: (src.clientY - rect.top)  * (canvas.height / Math.max(rect.height, 1)),
    };
  };

  const hitTest = (p) => {
    const c = cropRef.current;
    if (!c) return null;
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const R = 30 * getHandleScale(canvas);
    const { x1, y1, x2, y2 } = c;
    for (const [name, cx, cy] of [
      ["tl", x1, y1], ["tr", x2, y1], ["bl", x1, y2], ["br", x2, y2],
    ]) {
      if ((p.x - cx) ** 2 + (p.y - cy) ** 2 <= R ** 2) return name;
    }
    if (p.x >= x1 - R && p.x <= x2 + R && Math.abs(p.y - y1) <= R) return "top";
    if (p.x >= x1 - R && p.x <= x2 + R && Math.abs(p.y - y2) <= R) return "bottom";
    if (p.y >= y1 - R && p.y <= y2 + R && Math.abs(p.x - x1) <= R) return "left";
    if (p.y >= y1 - R && p.y <= y2 + R && Math.abs(p.x - x2) <= R) return "right";
    if (p.x > x1 && p.x < x2 && p.y > y1 && p.y < y2) return "move";
    return null;
  };

  const onDown = (e) => {
    e.preventDefault();
    const p   = toCanvas(e);
    const hit = hitTest(p);
    if (hit) {
      dragRef.current = { type: hit, startX: p.x, startY: p.y, startCrop: { ...cropRef.current } };
      try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch {}
      setCanvasCursor(hit === "move" ? "grabbing" : hit);
      redraw();
    }
  };

  const onMove = (e) => {
    if (!dragRef.current) {
      setCanvasCursor(hitTest(toCanvas(e)));
      return;
    }
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
      if (["tl", "bl", "left"].includes(type)) x1 = Math.max(0, Math.min(sc.x2 - MIN, sc.x1 + dx));
      if (["tr", "br", "right"].includes(type)) x2 = Math.min(canvas.width, Math.max(sc.x1 + MIN, sc.x2 + dx));
      if (["tl", "tr", "top"].includes(type)) y1 = Math.max(0, Math.min(sc.y2 - MIN, sc.y1 + dy));
      if (["bl", "br", "bottom"].includes(type)) y2 = Math.min(canvas.height, Math.max(sc.y1 + MIN, sc.y2 + dy));
    }

    cropRef.current = { x1, y1, x2, y2 };
    redraw();
  };

  const onUp = (e) => {
    e.preventDefault();
    dragRef.current = null;
    try {
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
    setCanvasCursor(hitTest(toCanvas(e)));
    redraw();
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
          <h2>텍스트 영역 선택 <span>모서리·변·내부를 드래그</span></h2>
          <button type="button" className="crop-close-btn" aria-label="닫기" onClick={onCancel}>
            <X size={14} />
          </button>
        </div>
        <div className="crop-canvas-wrap">
          <canvas
            ref={canvasRef}
            className="crop-canvas"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onPointerLeave={() => {
              if (!dragRef.current) setCanvasCursor(null);
            }}
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
