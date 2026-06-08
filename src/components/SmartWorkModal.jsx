import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

const TOTAL_SECONDS = 60;
const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const SCHEDULES = [
  { hour: 9,  minute: 30, label: "09:30 ~ 11:30" },
  { hour: 15, minute: 0,  label: "15:00 ~ 17:00" },
];

export function SmartWorkModal() {
  const [visible, setVisible] = useState(false);
  const [timeLabel, setTimeLabel] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(TOTAL_SECONDS);
  // 각 스케줄별 "날짜_키"를 기록해 하루 1회만 표시
  const shownKeysRef = useRef(new Set());
  const dismissTimerRef = useRef(null);

  const show = (label) => {
    clearTimeout(dismissTimerRef.current);
    setTimeLabel(label);
    setVisible(true);
    setSecondsLeft(TOTAL_SECONDS);
    dismissTimerRef.current = setTimeout(() => setVisible(false), TOTAL_SECONDS * 1000);
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const forceIdx = params.get("swt"); // ?swt=0 or ?swt=1 (schedule index)

    const tryShow = () => {
      const now = new Date();
      const today = now.toDateString();

      // 강제 표시 (테스트용): ?swt=0 → 첫 번째, ?swt=1 → 두 번째 스케줄
      if (forceIdx !== null) {
        const idx = Number(forceIdx) || 0;
        const sched = SCHEDULES[idx] ?? SCHEDULES[0];
        const key = `${today}_force_${idx}`;
        if (!shownKeysRef.current.has(key)) {
          shownKeysRef.current.add(key);
          show(sched.label);
        }
        return;
      }

      // 한국 평일(월~금)에만 표시
      const day = now.getDay(); // 0=일, 6=토
      if (day === 0 || day === 6) return;

      // 정시 체크
      for (const sched of SCHEDULES) {
        if (now.getHours() === sched.hour && now.getMinutes() === sched.minute) {
          const key = `${today}_${sched.hour}:${sched.minute}`;
          if (!shownKeysRef.current.has(key)) {
            shownKeysRef.current.add(key);
            show(sched.label);
          }
        }
      }
    };

    tryShow();
    const interval = setInterval(tryShow, 10_000);
    return () => {
      clearInterval(interval);
      clearTimeout(dismissTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    const t = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [visible]);

  const dashOffset = CIRCUMFERENCE * (1 - secondsLeft / TOTAL_SECONDS);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="swt-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.45 }}
          onClick={() => setVisible(false)}
        >
          <motion.div
            className="swt-modal"
            initial={{ scale: 0.78, opacity: 0, y: 48 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.88, opacity: 0, y: 24 }}
            transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="swt-aurora" />
            <div className="swt-glow-center" />

            <svg width="0" height="0" style={{ position: "absolute" }}>
              <defs>
                <linearGradient id="swt-ring-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#fff4cc" />
                  <stop offset="50%" stopColor="#FFD338" />
                  <stop offset="100%" stopColor="#FFBC00" />
                </linearGradient>
              </defs>
            </svg>

            <div className="swt-inner">
              <motion.div
                className="swt-badge"
                initial={{ opacity: 0, y: -12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25, duration: 0.4 }}
              >
                ✦ FOCUS TIME ✦
              </motion.div>

              <motion.h1
                className="swt-title"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.32, duration: 0.5 }}
              >
                스마트 워크 타임
              </motion.h1>

              <motion.p
                className="swt-time"
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.42, duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
              >
                {timeLabel}
              </motion.p>

              <motion.p
                className="swt-sub"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.58, duration: 0.4 }}
              >
                집중 근무 시간이 시작되었습니다
              </motion.p>

              <motion.div
                className="swt-ring-wrap"
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.65, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              >
                <svg className="swt-ring" viewBox="0 0 120 120">
                  <circle cx="60" cy="60" r={RADIUS} className="swt-ring-track" />
                  <circle
                    cx="60" cy="60" r={RADIUS}
                    className="swt-ring-fill"
                    style={{
                      strokeDasharray: CIRCUMFERENCE,
                      strokeDashoffset: dashOffset,
                    }}
                  />
                </svg>
                <span className="swt-ring-count">{secondsLeft}</span>
              </motion.div>

              <motion.button
                className="swt-dismiss"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.8, duration: 0.4 }}
                onClick={() => setVisible(false)}
              >
                닫기
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
