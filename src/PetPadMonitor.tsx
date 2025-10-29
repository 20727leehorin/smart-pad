import React, { useState, useEffect, useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

function formatLocalYYYYMMDD(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ===== Error Boundary =====
class ErrorBoundary extends React.Component<any, { hasError: boolean; msg: string }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, msg: "" };
  }
  static getDerivedStateFromError(err: any) {
    return { hasError: true, msg: String(err?.message || err) };
  }
  componentDidCatch(err: any, info: any) {
    console.error(err, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-3 bg-red-50 text-red-700 rounded">
          런타임 오류가 감지되었어요: {this.state.msg}
        </div>
      );
    }
    return this.props.children;
  }
}

// ===== Constants =====
const STORAGE_KEYS = { HISTORY: "petpad-history", INPUTS: "petpad-inputs" } as const;
const LEVEL_LABELS = ["정상", "주의", "의심", "위험"] as const;
const CELL_BG_CLASSES = [
  "bg-blue-400",
  "bg-green-400",
  "bg-yellow-300",
  "bg-red-400",
] as const;

const WEIGHTS = {
  nightTime: 1.2,
  lateNight: 1.1,
  afterMeal: 1.2,
  waterPer500ml: 1 / 500,
  elapsedPerMin: 1 / 60,
} as const;

const ANALYZE_OPTIONS = {
  roiRatio: 0.5,
  minLuma: 15,
  maxLuma: 245,
  useBlueRatio: true,
} as const;

// ===== Utils =====
function upsertHistoryEntry(list: any[], payload: any) {
  const idx = list.findIndex((e: any) => e.date === payload.date);
  if (idx >= 0) list[idx] = { ...list[idx], ...payload };
  else list.push(payload);
  return [...list].sort(
    (a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
}
function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}
function getPastNDatesISO(n = 30) {
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  base.setDate(base.getDate() - (n - 1));
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    return formatLocalYYYYMMDD(d);
  });
}
function toKoMD(dateISO: string) {
  return new Date(dateISO).toLocaleDateString("ko-KR", {
    month: "numeric",
    day: "numeric",
  });
}
function applyContextFactors(
  b: number,
  {
    hour,
    afterMealMin,
    waterMl,
    elapsedMin,
  }: { hour: number; afterMealMin: number; waterMl: number; elapsedMin: number }
) {
  const isNight = hour >= 0 && hour <= 6;
  const isLate = hour >= 22;
  const timeFactor = isNight ? WEIGHTS.nightTime : isLate ? WEIGHTS.lateNight : 1;
  const mealFactor = afterMealMin < 60 ? WEIGHTS.afterMeal : 1;
  const dilutionFactor =
    1 + waterMl * WEIGHTS.waterPer500ml + elapsedMin * WEIGHTS.elapsedPerMin;
  return clamp(Math.round(b * timeFactor * mealFactor * dilutionFactor), 0, 255);
}
function rgbToHsvDeg(R: number, G: number, B: number) {
  const r = R / 255,
    g = G / 255,
    b = B / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h, s: s * 100, v: v * 100 };
}

// ===== Classification =====
function classifyByHSV(h: number, v: number) {
  if (h >= 160) return 0;
  if (h >= 60 && h <= 140) return v >= 75 ? 1 : 2;
  if (h < 60) return 3;
  return 2;
}
function classifyPHByHSV(h: number, s: number, v: number) {
  if (v < 25) return { ph: null, label: "조도가 너무 낮아 측정 불가" };
  if (s < 8) return { ph: null, label: "채도가 너무 낮아 측정 불가" };
  if (h >= 20 && h < 45) return { ph: 5, label: "pH 5 (오렌지)" };
  if (h >= 45 && h < 58) return { ph: 6, label: "pH 6 (노랑)" };
  if (h >= 58 && h < 80) return { ph: 7, label: "pH 7 (황록)" };
  if (h >= 80 && h < 150) return { ph: 8, label: "pH 8 (녹색)" };
  if (h >= 150 && h <= 190) return { ph: 9, label: "pH 9 (청록)" };
  if (h < 20) return { ph: 5, label: "pH 5 (추정)" };
  return { ph: 9, label: "pH 9 (추정)" };
}
function diagnosisText(level: number) {
  switch (level) {
    case 0:
      return "🟦 깨끗해요!";
    case 1:
      return "🟩 포도당이 평소보다 조금 더 검출 되었어요";
    case 2:
      return "🟨 주기적인 검진이 필요해요!";
    default:
      return "🟥 포도당이 너무 많아요, 위험해요!";
  }
}

// ===== Calendar =====
function CalendarPage({
  history,
  onBack,
}: {
  history: any[];
  onBack: () => void;
}) {
  const byDate = useMemo(() => {
    const m = new Map<string, any>();
    [...history]
      .sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      )
      .forEach((e) => m.set(e.date, { ...m.get(e.date), ...e }));
    return m;
  }, [history]);
  const dates = useMemo(() => getPastNDatesISO(30), []);
  return (
    <div className="w-full max-w-xl bg-white rounded-xl p-4 shadow-md mb-4">
      <button onClick={onBack} className="mb-2 text-sm text-blue-600 underline">
        ← 뒤로가기
      </button>
      <h2 className="text-xl font-semibold mb-4">
        🗓 측정 기록 캘린더(최근 30일)
      </h2>
      <div className="flex items-center gap-3 text-sm mb-2">
        {LEVEL_LABELS.map((label, i) => (
          <div key={label} className="flex items-center gap-1">
            <span
              className={`inline-block w-3 h-3 rounded ${CELL_BG_CLASSES[i]}`}
            ></span>
            <span>{label}</span>
          </div>
        ))}
        <div className="flex items-center gap-1 text-gray-400">
          <span className="inline-block w-3 h-3 rounded bg-gray-200"></span>
          <span>기록 없음</span>
        </div>
        <div className="flex items-center gap-1 text-gray-600">
          <span className="inline-block w-5 h-5 rounded bg-white border"></span>
          <span>타일 하단에 pH 표시</span>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-2">
        {dates.map((d) => {
          const ent = byDate.get(d);
          const lv = ent?.level;
          const ph = ent?.ph;
          return (
            <div
              key={d}
              title={`${d}${lv != null ? ` — ${LEVEL_LABELS[lv]}` : " — 기록 없음"}${
                ph != null ? ` / pH ${ph}` : ""
              }`}
              className={`relative w-12 h-12 flex items-center justify-center rounded text-sm text-white text-center ${
                lv != null ? CELL_BG_CLASSES[lv] : "bg-gray-200 text-gray-700"
              }`}
            >
              {new Date(d).getDate()}
              {ph != null && (
                <span className="absolute bottom-0.5 left-0.5 right-0.5 mx-auto text-[10px] leading-3 px-1 py-0.5 rounded bg-white/90 text-gray-800">
                  pH {ph}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ===== Stats =====
function StatsPage({
  history,
  onBack,
}: {
  history: any[];
  onBack: () => void;
}) {
  const summary = useMemo(
    () =>
      history.reduce((acc: any, it: any) => {
        acc[it.level] = (acc[it.level] || 0) + 1;
        return acc;
      }, {}),
    [history]
  );
  const lineData = useMemo(() => {
    const m = new Map<string, any>();
    [...history]
      .sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      )
      .forEach((e) => m.set(e.date, { ...m.get(e.date), ...e }));
    return Array.from(m.values())
      .sort((a: any, b: any) => a.date.localeCompare(b.date))
      .map((e: any) => ({
        date: e.date,
        displayDate: toKoMD(e.date),
        level: e.level != null ? e.level + 1 : null,
        ph: e.ph ?? null,
      }));
  }, [history]);
  const hasPH = useMemo(() => lineData.some((d) => d.ph != null), [lineData]);
  const tickInterval = useMemo(
    () => (lineData.length <= 10 ? 0 : Math.ceil(lineData.length / 8)),
    [lineData]
  );
  return (
    <div className="w-full max-w-xl bg-white rounded-xl p-4 shadow-md mb-4">
      <button onClick={onBack} className="mb-2 text-sm text-blue-600 underline">
        ← 뒤로가기
      </button>
      <h2 className="text-xl font-semibold mb-2">📊 통계 그래프</h2>
      <ul className="list-disc list-inside text-base mb-4">
        <li>🟦 정상: {summary[0] || 0}회</li>
        <li>🟩 주의: {summary[1] || 0}회</li>
        <li>🟨 의심: {summary[2] || 0}회</li>
        <li>🟥 위험: {summary[3] || 0}회</li>
      </ul>
      <ResponsiveContainer width="100%" height={340}>
        <LineChart data={lineData} margin={{ top: 5, right: 24, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="displayDate" tick={{ fontSize: 10 }} interval={tickInterval as any} />
          <YAxis
            yAxisId="level"
            type="number"
            domain={[1, 4]}
            ticks={[1, 2, 3, 4]}
            tickFormatter={(v: number) =>
              v >= 1 && v <= 4 ? LEVEL_LABELS[v - 1] : String(v)
            }
          />
          {hasPH && (
            <YAxis
              yAxisId="ph"
              orientation="right"
              type="number"
              domain={[5, 9]}
              ticks={[5, 6, 7, 8, 9]}
            />
          )}
          <ReferenceLine y={1} yAxisId="level" stroke="#e5e7eb" />
          <ReferenceLine y={2} yAxisId="level" stroke="#e5e7eb" />
          <ReferenceLine y={3} yAxisId="level" stroke="#e5e7eb" />
          <Tooltip
            formatter={(value: any, name: any) => {
              if (name === "포도당 단계") {
                return [
                  ["정상", "주의", "의심", "위험"][value - 1] || value,
                  name,
                ];
              }
              if (name === "pH") {
                return [value, "pH"];
              }
              return [value, name];
            }}
          />
          <Legend />
          <Line
            yAxisId="level"
            type="monotone"
            dataKey="level"
            stroke="#6366f1"
            name="포도당 단계"
            dot
            connectNulls
          />
          {hasPH && (
            <Line
              yAxisId="ph"
              type="monotone"
              dataKey="ph"
              stroke="#10b981"
              name="pH"
              dot
              connectNulls
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ===== Main =====
export default function PetPadMonitor() {
  const [page, setPage] = useState("main");
  const [image, setImage] = useState<string | null>(null);
  const [result, setResult] = useState("");
  const [phResult, setPhResult] = useState("");
  const [pending, setPending] = useState<any | null>(null);
  const [pendingPH, setPendingPH] = useState<any | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showTreatment, setShowTreatment] = useState(false);
  const [currentLevel, setCurrentLevel] = useState<number | null>(null);

  const [waterIntake, setWaterIntake] = useState<number>(0);
  const [elapsedTime, setElapsedTime] = useState<number>(0);
  const [afterMealTime, setAfterMealTime] = useState<number>(0);
  const [inputTime, setInputTime] = useState<string>("");

  const [history, setHistory] = useState<any[]>([]);
  const [confirmClear, setConfirmClear] = useState(false);
  const [exportText, setExportText] = useState("");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.HISTORY);
      if (stored) setHistory(JSON.parse(stored));
    } catch {}
    try {
      const inputs = localStorage.getItem(STORAGE_KEYS.INPUTS);
      if (inputs) {
        const obj = JSON.parse(inputs);
        if (typeof obj.waterIntake === "number") setWaterIntake(obj.waterIntake);
        if (typeof obj.elapsedTime === "number") setElapsedTime(obj.elapsedTime);
        if (typeof obj.afterMealTime === "number") setAfterMealTime(obj.afterMealTime);
        if (typeof obj.inputTime === "string") setInputTime(obj.inputTime);
      }
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(history));
    } catch {}
  }, [history]);
  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEYS.INPUTS,
        JSON.stringify({ waterIntake, elapsedTime, afterMealTime, inputTime })
      );
    } catch {}
  }, [waterIntake, elapsedTime, afterMealTime, inputTime]);

  async function handleImage(file: File | undefined | null) {
    if (!file) {
      setResult("파일을 선택해 주세요.");
      return;
    }
    const name = (file.name || "").toLowerCase();
    if (name.endsWith(".heic") || name.endsWith(".heif")) {
      setResult(
        "⚠️ HEIC/HEIF 형식은 브라우저에서 분석이 어려워요. JPG/PNG로 변환해주세요."
      );
      return;
    }
    setIsAnalyzing(true);
    setPending(null);
    setPendingPH(null);
    setResult("");
    setPhResult("");
    setShowTreatment(false);
    const reader = new FileReader();
    reader.onload = async (ev: any) => {
      try {
        const dataUrl = ev.target?.result as string;
        if (!dataUrl || typeof dataUrl !== "string") throw new Error("이미지 로드 실패");
        setImage(dataUrl);
        const { h, s, v, b } = await analyzeImageForHSV(dataUrl);
        let hour = new Date().getHours();
        if (inputTime) {
          const [hIn] = inputTime.split(":").map(Number);
          if (!Number.isNaN(hIn)) hour = hIn as any;
        }
        const adjustedB = applyContextFactors(b, {
          hour,
          afterMealMin: Number(afterMealTime) || 0,
          waterMl: Number(waterIntake) || 0,
          elapsedMin: Number(elapsedTime) || 0,
        });
        const level = classifyByHSV(h, v);
        const diagnosis = diagnosisText(level);
        const now = new Date();
        const timestamp = now.toISOString();           // 로그/정렬용은 ISO 유지 OK
        const date = formatLocalYYYYMMDD(now);         // ✅ 캘린더 키는 로컬 날짜로

        const metrics = `(참고: H ${Math.round(h)}°, S ${Math.round(
          s
        )}%, V ${Math.round(v)}%, Blue(채널) 보정전 ${Math.round(
          b
        )}, 보정후 ${adjustedB})`;
        setPending({
          diagnosis,
          level,
          timestamp,
          date,
          hsv: { h, s, v },
          metrics,
        });
        const ph = classifyPHByHSV(h, s, v);
        const phMetrics = `(pH 추정용: H ${Math.round(h)}°, S ${Math.round(
          s
        )}%, V ${Math.round(v)}%)`;
        setPendingPH({ ...ph, metrics: phMetrics, date, timestamp });
      } catch (err: any) {
        console.error(err);
        setResult(`❌ 분석 중 오류: ${err?.message || err}`);
      } finally {
        setIsAnalyzing(false);
      }
    };
    reader.onerror = () => {
      setIsAnalyzing(false);
      setResult("❌ 파일을 읽지 못했어요. 다른 이미지로 시도해 주세요.");
    };
    reader.readAsDataURL(file);
  }

  function confirmPendingResult() {
    if (!pending) return;
    setCurrentLevel(pending.level);
    setResult(`${pending.diagnosis}\n${pending.metrics}`);
    setShowTreatment(true);
    setHistory((prev) =>
      upsertHistoryEntry([...prev], {
        timestamp: pending.timestamp,
        date: pending.date,
        diagnosis: pending.diagnosis,
        level: pending.level,
      })
    );
    setPending(null);
  }
  function confirmPHResult() {
    if (!pendingPH) return;
    const { ph, label, metrics, date, timestamp } = pendingPH;
    if (ph == null)
      setPhResult(`📏 pH 측정 불가 — ${label}`);
    else
      setPhResult(`📏 추정 pH: ${ph}\n${label}\n${metrics}`);
    setHistory((prev) =>
      upsertHistoryEntry([...prev], {
        timestamp: timestamp || new Date().toISOString(),
        date: date || new Date().toISOString().split("T")[0],
        ph,
      })
    );
  }

  function handleExport() {
    const json = JSON.stringify(history, null, 2);
    setExportText("");
    try {
      const blob = new Blob([json], { type: "application/json" });
      const url = (window as any).URL?.createObjectURL?.(blob);
      if (!url) throw new Error("createObjectURL 불가");
      const a = document.createElement("a");
      a.href = url;
      a.download = `petpad-history-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        try {
          document.body.removeChild(a);
          (window as any).URL?.revokeObjectURL?.(url);
        } catch {}
      }, 0);
    } catch {
      try {
        (navigator as any).clipboard?.writeText?.(json);
        alert("다운로드 제한으로 JSON을 클립보드에 복사했어요. 메모장 등에 붙여넣기 하세요.");
      } catch {
        setExportText(json);
      }
    }
  }

  if (page === "calendar")
    return <CalendarPage history={history} onBack={() => setPage("main")} />;
  if (page === "stats")
    return <StatsPage history={history} onBack={() => setPage("main")} />;

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-100 p-4 flex flex-col items-center">
        <h1 className="text-2xl font-bold mb-4">📅 스마트 포도당 + pH 감지기</h1>
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setPage("calendar")}
            className="bg-gray-800 text-white px-4 py-2 rounded"
          >
            기록 보기
          </button>
          <button
            onClick={() => setPage("stats")}
            className="bg-indigo-600 text-white px-4 py-2 rounded"
          >
            통계 그래프
          </button>
        </div>

        <div className="bg-white rounded-xl p-4 shadow-md w-full max-w-xl">
          <label className="block text-sm font-medium mb-1">
            📸 배변 패드 사진 업로드
          </label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => handleImage(e.target.files?.[0] || null)}
            className="mb-4"
          />

          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-sm font-medium">💧 수분 섭취량 (ml)</label>
              <input
                type="number"
                value={waterIntake}
                onChange={(e) => setWaterIntake(Number((e.target as any).value) || 0)}
                className="p-2 border rounded w-full"
              />
            </div>
            <div>
              <label className="text-sm font-medium">⏱️ 경과 시간 (분)</label>
              <input
                type="number"
                value={elapsedTime}
                onChange={(e) => setElapsedTime(Number((e.target as any).value) || 0)}
                className="p-2 border rounded w-full"
              />
            </div>
            <div>
              <label className="text-sm font-medium">🍽️ 식후 경과 시간 (분)</label>
              <input
                type="number"
                value={afterMealTime}
                onChange={(e) => setAfterMealTime(Number((e.target as any).value) || 0)}
                className="p-2 border rounded w-full"
              />
            </div>
            <div>
              <label className="text-sm font-medium">🕒 측정 시각</label>
              <input
                type="time"
                value={inputTime}
                onChange={(e) => setInputTime((e.target as any).value)}
                className="p-2 border rounded w-full"
              />
            </div>
          </div>

          {isAnalyzing && (
            <div className="mb-3 text-sm text-gray-600">
              🔄 이미지를 분석 중입니다...
            </div>
          )}
          {!isAnalyzing && (pending || pendingPH) && (!result || !phResult) && (
            <div className="mb-3 flex gap-2 flex-wrap">
              {!result && pending && (
                <button
                  onClick={confirmPendingResult}
                  className="px-4 py-2 rounded bg-emerald-600 text-white font-medium"
                >
                  포도당 결과확인하기
                </button>
              )}
              {!phResult && pendingPH && (
                <button
                  onClick={confirmPHResult}
                  className="px-4 py-2 rounded bg-sky-600 text-white font-medium"
                >
                  pH 결과확인하기
                </button>
              )}
              <p className="basis-full mt-1 text-xs text-gray-500">
                버튼을 눌러야 기록·캘린더·그래프에 반영됩니다.
              </p>
            </div>
          )}

          {image && (
            <img src={image} alt="분석 이미지" className="w-full h-auto mb-2 rounded" />
          )}

          {(result || phResult) && (
            <div className="mb-2 space-y-3">
              {result && (
                <div>
                  <p className="text-lg font-semibold whitespace-pre-wrap">
                    🔍 결과: {result}
                  </p>
                  <button
                    onClick={() => setShowTreatment((v) => !v)}
                    className="mt-2 text-blue-600 underline"
                  >
                    {showTreatment ? "치료 가이드 숨기기" : "치료 가이드 보기"}
                  </button>
                  {showTreatment && currentLevel != null && (
                    <p className="mt-2 text-sm whitespace-pre-wrap">
                      {
                        [
                          "🟦 1. 깨끗해요! (정상 범위): 기존 사료 유지, 고탄수화물 간식은 주 1회 이하로 제한. 하루 20~30분 산책 권장. 체중 1kg당 50~70ml 수분 섭취.",
                          "🟩 2. 포도당이 조금 검출되었어요 (주의): 저탄수화물 사료로 변경, 단백질 중심 간식 제공. 하루 30분 이상 활동. 체중 1kg당 70~90ml 수분 섭취.",
                          "🟨 3. 주기적인 검진이 필요해요! (의심 단계): 수의사 상담 권장. 저탄고단 사료 제공. 체중 1kg당 80~100ml 물 섭취. 실내 장난감 놀이 강화.",
                          "🟥 4. 포도당이 너무 많아요. 위험해요! (심각): 즉시 수의사 진료. 전용 당뇨식 사료로 교체. 체중 1kg당 100ml 이상 물 공급. 활동량 조절.",
                        ][currentLevel]
                      }
                    </p>
                  )}
                </div>
              )}
              {phResult && (
                <div>
                  <p className="text-lg font-semibold whitespace-pre-wrap">
                    🧪 pH 결과: {phResult}
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col gap-3 mt-3">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleExport}
                className="text-sm px-3 py-2 bg-gray-100 border rounded"
              >
                기록 내보내기
              </button>
              {!confirmClear ? (
                <button
                  type="button"
                  onClick={() => setConfirmClear(true)}
                  className="text-sm px-3 py-2 bg-red-50 text-red-700 border border-red-200 rounded"
                >
                  기록 초기화
                </button>
              ) : (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setHistory([]);
                      setConfirmClear(false);
                    }}
                    className="text-sm px-3 py-2 bg-red-600 text-white rounded"
                  >
                    정말 삭제
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClear(false)}
                    className="text-sm px-3 py-2 bg-gray-200 rounded"
                  >
                    취소
                  </button>
                </div>
              )}
            </div>
            {exportText && (
              <div className="mt-2">
                <p className="text-xs text-gray-600 mb-1">
                  브라우저 보안 정책으로 다운로드가 차단되어 JSON을 아래에 표시했어요.
                  전체 선택(Ctrl/Cmd+A) 후 복사해서 저장하세요.
                </p>
                <textarea
                  readOnly
                  value={exportText}
                  className="w-full h-40 p-2 border rounded font-mono text-xs"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}

// === Image Analyze helper ===
async function analyzeImageForHSV(
  dataUrl: string,
  options = ANALYZE_OPTIONS
) {
  const img = new Image();
  img.src = dataUrl;
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error("Image load error"));
  });
  const W = 300,
    H = 300;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, W, H);
  const { data } = ctx.getImageData(0, 0, W, H);
  const roiW = Math.floor(W * options.roiRatio),
    roiH = Math.floor(H * options.roiRatio);
  const offX = Math.floor((W - roiW) / 2),
    offY = Math.floor((H - roiH) / 2);
  let rSum = 0,
    gSum = 0,
    bSum = 0,
    n = 0;
  for (let y = offY; y < offY + roiH; y++) {
    for (let x = offX; x < offX + roiW; x++) {
      const i = (y * W + x) * 4;
      const r = data[i],
        g = data[i + 1],
        b = data[i + 2];
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (luma < options.minLuma || luma > options.maxLuma) continue;
      rSum += r;
      gSum += g;
      bSum += b;
      n++;
    }
  }
  if (n < 50) {
    rSum = gSum = bSum = n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i],
        g = data[i + 1],
        b = data[i + 2];
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (luma < 10 || luma > 245) continue;
      rSum += r;
      gSum += g;
      bSum += b;
      n++;
    }
  }
  const R = n ? Math.round(rSum / n) : 0;
  const G = n ? Math.round(gSum / n) : 0;
  const B = n ? Math.round(bSum / n) : 0;
  const { h, s, v } = rgbToHsvDeg(R, G, B);
  return { h, s, v, b: B };
}
