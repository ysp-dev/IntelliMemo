import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import { useFocusTrap } from "../../hooks/useFocusTrap.js";

export function CropModal({ dataUrl, mimeType, onCrop, onCancel, onError }) {
  const modalRef  = useRef(null);
  useFocusTrap(modalRef);
  const canvasRef = useRef(null);
  const imgRef    = useRef(null);
  const cropRef   = useRef(null);
  const imageViewRef = useRef({ scale: 1, offsetX: 0, offsetY: 0 });
  const onCancelRef = useRef(onCancel);
  const onErrorRef = useRef(onError);
  const dragRef   = useRef(null);
  const pinchRef  = useRef(null);
  const lastDragEndTimeRef = useRef(0);
  const pointersRef = useRef(new Map());
  const redrawFrameRef = useRef(null);
  const saveTimerRef = useRef(null);
  const [savePreview, setSavePreview] = useState(null);

  const MAX_IMAGE_SCALE = 5;
  const PREVIEW_MAX_PX = 1100;
  const OUTPUT_MAX_PX = 1400;
  const MIN_CROP_CSS_PX = 36;

  const getHandleScale = (canvas) => {
    const rect = canvas.getBoundingClientRect();
    return canvas.width / Math.max(rect.width, 1);
  };

  const setCanvasCursor = (type) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cursor = {
      image: "grab",
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

  const clampImageView = useCallback((view = imageViewRef.current, crop = cropRef.current) => {
    const canvas = canvasRef.current;
    if (!canvas || !crop) return view;
    const scale = Math.max(1, Math.min(MAX_IMAGE_SCALE, view.scale || 1));
    const imageW = canvas.width * scale;
    const imageH = canvas.height * scale;
    const minX = crop.x2 - imageW;
    const maxX = crop.x1;
    const minY = crop.y2 - imageH;
    const maxY = crop.y1;
    const next = {
      scale,
      offsetX: Math.max(minX, Math.min(maxX, view.offsetX)),
      offsetY: Math.max(minY, Math.min(maxY, view.offsetY)),
    };
    imageViewRef.current = next;
    return next;
  }, []);

  const redrawNow = useCallback(() => {
    const canvas = canvasRef.current;
    const img    = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const view = imageViewRef.current;
    const imageW = canvas.width * view.scale;
    const imageH = canvas.height * view.scale;
    ctx.drawImage(img, view.offsetX, view.offsetY, imageW, imageH);

    const c = cropRef.current;
    if (!c) return;
    const { x1, y1, x2, y2 } = c;
    const w = x2 - x1, h = y2 - y1;
    const scale = getHandleScale(canvas);
    const cornerLen = Math.max(8 * scale, Math.min(w, h, 150 * scale) * 0.2);
    const edgeLen = Math.max(10 * scale, Math.min(w, h, 170 * scale) * 0.18);
    const handleWidth = Math.max(2 * scale, Math.min(6 * scale, Math.min(w, h) * 0.012));
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

  const redraw = useCallback(() => {
    if (redrawFrameRef.current) return;
    redrawFrameRef.current = requestAnimationFrame(() => {
      redrawFrameRef.current = null;
      redrawNow();
    });
  }, [redrawNow]);

  const zoomImageAtCanvasPoint = useCallback((point, nextScale) => {
    const current = imageViewRef.current;
    const scale = Math.max(1, Math.min(MAX_IMAGE_SCALE, nextScale || 1));
    const imagePointX = (point.x - current.offsetX) / current.scale;
    const imagePointY = (point.y - current.offsetY) / current.scale;
    clampImageView({
      scale,
      offsetX: point.x - imagePointX * scale,
      offsetY: point.y - imagePointY * scale,
    });
    redraw();
  }, [clampImageView, redraw]);

  const initCrop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pad = Math.min(canvas.width, canvas.height) * 0.04;
    cropRef.current = { x1: pad, y1: pad, x2: canvas.width - pad, y2: canvas.height - pad };
    imageViewRef.current = { scale: 1, offsetX: 0, offsetY: 0 };
    clampImageView();
    redraw();
  }, [clampImageView, redraw]);

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const scale = Math.min(1, PREVIEW_MAX_PX / img.naturalWidth, PREVIEW_MAX_PX / img.naturalHeight);
      canvas.width  = Math.round(img.naturalWidth  * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      initCrop();
    };
    img.onerror = () => {
      onErrorRef.current?.("이미지를 불러오지 못했습니다.");
      onCancelRef.current();
    };
    img.src = dataUrl;
  }, [dataUrl, initCrop]);

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (redrawFrameRef.current) cancelAnimationFrame(redrawFrameRef.current);
  }, []);

  const toCanvas = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect   = canvas.getBoundingClientRect();
    const src    = e.touches ? e.touches[0] : e;
    return {
      x: (src.clientX - rect.left) * (canvas.width  / Math.max(rect.width, 1)),
      y: (src.clientY - rect.top)  * (canvas.height / Math.max(rect.height, 1)),
    };
  };

  const onWheel = useCallback((e) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const p = toCanvas(e);
    const modeMultiplier = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
    const delta = e.deltaY * modeMultiplier;
    const zoomFactor = Math.exp(-delta * 0.002);
    zoomImageAtCanvasPoint(p, imageViewRef.current.scale * zoomFactor);
  }, [zoomImageAtCanvasPoint]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [onWheel]);

  const getPointerPair = () => [...pointersRef.current.values()].slice(0, 2);
  const getDistance = ([a, b]) => Math.hypot(b.x - a.x, b.y - a.y);
  const getCenter = ([a, b]) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  const startPinch = () => {
    const pair = getPointerPair();
    if (pair.length < 2) return;
    const distance = getDistance(pair);
    if (distance <= 0) return;
    pinchRef.current = {
      startDistance: distance,
      startCenter: getCenter(pair),
      startImageView: { ...imageViewRef.current },
    };
    dragRef.current = null;
    setCanvasCursor("grabbing");
    redraw();
  };

  const hitTest = (p) => {
    const c = cropRef.current;
    if (!c) return null;
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const { x1, y1, x2, y2 } = c;
    const scale = getHandleScale(canvas);
    const cropSize = Math.min(x2 - x1, y2 - y1);
    const R = Math.min(30 * scale, Math.max(14 * scale, cropSize * 0.35));
    for (const [name, cx, cy] of [
      ["tl", x1, y1], ["tr", x2, y1], ["bl", x1, y2], ["br", x2, y2],
    ]) {
      if ((p.x - cx) ** 2 + (p.y - cy) ** 2 <= R ** 2) return name;
    }
    if (p.x >= x1 - R && p.x <= x2 + R && Math.abs(p.y - y1) <= R) return "top";
    if (p.x >= x1 - R && p.x <= x2 + R && Math.abs(p.y - y2) <= R) return "bottom";
    if (p.y >= y1 - R && p.y <= y2 + R && Math.abs(p.x - x1) <= R) return "left";
    if (p.y >= y1 - R && p.y <= y2 + R && Math.abs(p.x - x2) <= R) return "right";
    if (p.x >= 0 && p.x <= canvas.width && p.y >= 0 && p.y <= canvas.height) return "image";
    return null;
  };

  const onDown = (e) => {
    e.preventDefault();
    const p   = toCanvas(e);
    pointersRef.current.set(e.pointerId, p);
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch {}

    if (pointersRef.current.size >= 2) {
      startPinch();
      return;
    }

    const hit = hitTest(p);
    if (hit) {
      dragRef.current = {
        type: hit,
        startX: p.x,
        startY: p.y,
        startCrop: { ...cropRef.current },
        startImageView: { ...imageViewRef.current },
      };
      setCanvasCursor(hit === "image" ? "grabbing" : hit);
      redraw();
    }
  };

  const onMove = (e) => {
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, toCanvas(e));
    }

    if (pinchRef.current && pointersRef.current.size >= 2) {
      e.preventDefault();
      const pair = getPointerPair();
      const distance = getDistance(pair);
      const center = getCenter(pair);
      const { startDistance, startCenter, startImageView } = pinchRef.current;
      const nextScale = startImageView.scale * (distance / startDistance);
      const imagePointX = (startCenter.x - startImageView.offsetX) / startImageView.scale;
      const imagePointY = (startCenter.y - startImageView.offsetY) / startImageView.scale;
      const scale = Math.max(1, Math.min(MAX_IMAGE_SCALE, nextScale || 1));
      clampImageView({
        scale,
        offsetX: center.x - imagePointX * scale,
        offsetY: center.y - imagePointY * scale,
      });
      redraw();
      return;
    }

    if (!dragRef.current) {
      setCanvasCursor(hitTest(toCanvas(e)));
      return;
    }
    e.preventDefault();
    const p  = toCanvas(e);
    const { type, startX, startY, startCrop: sc, startImageView } = dragRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const MIN    = Math.max(30, MIN_CROP_CSS_PX * getHandleScale(canvas));
    const dx = p.x - startX, dy = p.y - startY;
    let { x1, y1, x2, y2 } = sc;

    if (type === "image") {
      clampImageView({
        ...startImageView,
        offsetX: startImageView.offsetX + dx,
        offsetY: startImageView.offsetY + dy,
      });
    } else {
      if (["tl", "bl", "left"].includes(type)) x1 = Math.max(0, Math.min(sc.x2 - MIN, sc.x1 + dx));
      if (["tr", "br", "right"].includes(type)) x2 = Math.min(canvas.width, Math.max(sc.x1 + MIN, sc.x2 + dx));
      if (["tl", "tr", "top"].includes(type)) y1 = Math.max(0, Math.min(sc.y2 - MIN, sc.y1 + dy));
      if (["bl", "br", "bottom"].includes(type)) y2 = Math.min(canvas.height, Math.max(sc.y1 + MIN, sc.y2 + dy));
      cropRef.current = { x1, y1, x2, y2 };
      clampImageView();
    }
    redraw();
  };

  const onUp = (e) => {
    e.preventDefault();
    lastDragEndTimeRef.current = Date.now();
    pointersRef.current.delete(e.pointerId);
    dragRef.current = null;
    if (pointersRef.current.size < 2) pinchRef.current = null;
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
    if (!img || !canvas) return null;

    const out    = document.createElement("canvas");
    const ctx    = out.getContext("2d");
    if (!ctx) return null;

    if (!c) {
      const scale = Math.min(1, OUTPUT_MAX_PX / img.naturalWidth, OUTPUT_MAX_PX / img.naturalHeight);
      out.width  = Math.max(1, Math.round(img.naturalWidth  * scale));
      out.height = Math.max(1, Math.round(img.naturalHeight * scale));
      ctx.drawImage(img, 0, 0, out.width, out.height);
    } else {
      const view = imageViewRef.current;
      const sx = img.naturalWidth  / (canvas.width * view.scale);
      const sy = img.naturalHeight / (canvas.height * view.scale);
      const { x1, y1, x2, y2 } = c;
      const srcX = Math.max(0, (x1 - view.offsetX) * sx);
      const srcY = Math.max(0, (y1 - view.offsetY) * sy);
      const cropW = Math.min(img.naturalWidth - srcX, (x2 - x1) * sx);
      const cropH = Math.min(img.naturalHeight - srcY, (y2 - y1) * sy);
      if (![srcX, srcY, cropW, cropH].every(Number.isFinite) || cropW < 1 || cropH < 1) {
        onErrorRef.current?.("선택 영역이 너무 작습니다. 가이드박스를 조금 키워주세요.");
        return null;
      }
      const scale = Math.min(1, OUTPUT_MAX_PX / cropW, OUTPUT_MAX_PX / cropH);
      out.width  = Math.max(1, Math.round(cropW * scale));
      out.height = Math.max(1, Math.round(cropH * scale));
      ctx.drawImage(img, srcX, srcY, cropW, cropH, 0, 0, out.width, out.height);
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

  const handleSaveImage = async () => {
    const result = getCroppedCanvas();
    if (!result) return;
    const { out, outMime } = result;
    const ext = outMime === "image/png" ? "png" : "jpg";
    const savedAt = Date.now();
    const dataUrl = out.toDataURL(outMime, outMime === "image/jpeg" ? 0.92 : undefined);

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSavePreview({ dataUrl, status: "saving", message: "저장 준비 중" });

    try {
      const blob = await fetch(dataUrl).then((r) => r.blob());
      const file = new File([blob], `memo-${savedAt}.${ext}`, { type: outMime });
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "메모 이미지" });
      } else {
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = `memo-${savedAt}.${ext}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
      setSavePreview({ dataUrl, status: "saved", message: "저장 완료" });
    } catch (e) {
      console.error(e);
      setSavePreview({ dataUrl, status: "error", message: "저장 실패" });
    }

    saveTimerRef.current = setTimeout(() => setSavePreview(null), 1800);
  };

  return (
    <motion.div
      className="crop-overlay"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
      onTouchEnd={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseMove={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
      onClick={() => {
        if (Date.now() - lastDragEndTimeRef.current < 400) return;
        onCancel();
      }}
    >
      <motion.div
        ref={modalRef}
        className="crop-modal"
        initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 16 }}
        transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
        onClickCapture={(e) => {
          if (Date.now() - lastDragEndTimeRef.current < 200) e.stopPropagation();
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="crop-modal-hdr">
          <h2>텍스트 영역 선택 <span>모서리·변 조절, 드래그·핀치·휠로 사진 맞춤</span></h2>
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
          {savePreview && (
            <div className={`crop-save-preview ${savePreview.status}`}>
              <img src={savePreview.dataUrl} alt="크롭 저장 미리보기" />
              <span>{savePreview.message}</span>
            </div>
          )}
        </div>
        <div className="crop-modal-footer">
          <button type="button" className="crop-cancel-btn" onClick={onCancel}>취소</button>
          <button type="button" className="crop-reset-btn" onClick={initCrop}>초기화</button>
          <button type="button" className="crop-save-btn" onClick={handleSaveImage}>이미지 저장</button>
          <button type="button" className="crop-apply-btn" onClick={handleApply}>텍스트 추출</button>
        </div>
      </motion.div>
    </motion.div>
  );
}
