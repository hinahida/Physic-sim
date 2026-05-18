/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as d3 from 'd3';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Play, 
  RotateCcw, 
  Info, 
  ChevronRight, 
  ChevronDown, 
  Activity, 
  Settings2,
  Table as TableIcon,
  TrendingDown,
  Scale
} from 'lucide-react';

// --- Types & Constants ---

interface Point {
  t: number;
  x: number;
  id: string;
}

type PotentialType = 'gravity' | 'free' | 'harmonic';

const GRAVITY = -9.8;
const INITIAL_POINTS_COUNT = 11;
const TIME_END = 3.0;
const X_START = 50;
const X_END = 10;

// --- Physics Logic ---

const calculatePE = (x: number, m: number, type: PotentialType, k: number = 1) => {
  switch (type) {
    case 'gravity':
      return m * Math.abs(GRAVITY) * x;
    case 'free':
      return 0;
    case 'harmonic':
      // Center oscillator at x=30
      return 0.5 * k * Math.pow(x - 30, 2);
    default:
      return 0;
  }
};

const calculateAction = (points: Point[], m: number, type: PotentialType, k: number = 1) => {
  let totalS = 0;
  const segments = [];

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const dt = p2.t - p1.t;
    if (dt <= 0) continue;

    const v = (p2.x - p1.x) / dt;
    const ke = 0.5 * m * v * v;
    
    // Use midpoint for potential energy approximation as per paper Eq (2d)
    const midX = (p1.x + p2.x) / 2;
    const pe = calculatePE(midX, m, type, k);
    
    const lagrangian = ke - pe;
    const ds = lagrangian * dt;
    
    totalS += ds;
    
    segments.push({
      t: (p1.t + p2.t) / 2,
      ke,
      pe,
      ds,
      v,
      accel: 0, // Calculated later
      energy: ke + pe
    });
  }

  // Calculate acceleration as derivative of v
  for (let i = 0; i < segments.length; i++) {
    if (i > 0) {
      const dt = segments[i].t - segments[i - 1].t;
      segments[i].accel = (segments[i].v - segments[i - 1].v) / dt;
    } else {
      segments[i].accel = 0;
    }
  }

  return { totalS, segments };
};

const calculateNewtonianPath = (m: number, type: PotentialType, k: number = 1) => {
  const dtTotal = TIME_END;
  const n = INITIAL_POINTS_COUNT;
  const points: Point[] = [];

  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * dtTotal;
    let x = 0;

    if (type === 'free') {
      // Straight line
      x = X_START + ((X_END - X_START) * t) / TIME_END;
    } else if (type === 'gravity') {
      // x(t) = x0 + v0t + 0.5gt^2
      // v0 = (xn - x0 - 0.5gn^2) / tn
      const g = GRAVITY;
      const v0 = (X_END - X_START - 0.5 * g * Math.pow(TIME_END, 2)) / TIME_END;
      x = X_START + v0 * t + 0.5 * g * t * t;
    } else if (type === 'harmonic') {
      // Basic harmonic motion - simpler approximation for target path
      const center = 30;
      const omega = Math.sqrt(k / m);
      // We need to fit x(0)=X_START and x(T)=X_END
      // x(t) = C + A cos(wt) + B sin(wt)
      const A = X_START - center;
      const B = (X_END - center - A * Math.cos(omega * dtTotal)) / Math.sin(omega * dtTotal);
      x = center + A * Math.cos(omega * t) + B * Math.sin(omega * t);
    }
    
    points.push({ t, x, id: `newt-${i}` });
  }
  return points;
};

// --- Components ---

export default function App() {
  const [mass, setMass] = useState(1);
  const [potential, setPotential] = useState<PotentialType>('gravity');
  const [kSpring, setKSpring] = useState(10);
  const [points, setPoints] = useState<Point[]>([]);
  const [showTable, setShowTable] = useState(false);
  const [showNewtonian, setShowNewtonian] = useState(true);

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Initialize points
  useEffect(() => {
    const initial = [];
    for (let i = 0; i < INITIAL_POINTS_COUNT; i++) {
      const t = (i / (INITIAL_POINTS_COUNT - 1)) * TIME_END;
      // Linear initial guess
      const x = X_START + ((X_END - X_START) * t) / TIME_END;
      initial.push({ t, x, id: `point-${i}` });
    }
    setPoints(initial);
  }, []);

  const { totalS, segments } = useMemo(() => calculateAction(points, mass, potential, kSpring), [points, mass, potential, kSpring]);
  const newtonianPoints = useMemo(() => calculateNewtonianPath(mass, potential, kSpring), [mass, potential, kSpring]);
  const { totalS: idealS } = useMemo(() => calculateAction(newtonianPoints, mass, potential, kSpring), [newtonianPoints, mass, potential, kSpring]);

  // --- D3 Interactive Render ---
  const width = 600;
  const height = 400;
  const margin = { top: 30, right: 30, bottom: 50, left: 60 };

  const xScale = d3.scaleLinear()
    .domain([0, TIME_END])
    .range([margin.left, width - margin.right]);

  const yScale = d3.scaleLinear()
    .domain([-10, 80])
    .range([height - margin.bottom, margin.top]);

  const pointsRef = useRef<Point[]>([]);
  useEffect(() => {
    pointsRef.current = points;
  }, [points]);

  const lineGen = d3.line<Point>()
    .x(d => xScale(d.t))
    .y(d => yScale(d.x))
    .curve(d3.curveLinear);

  const targetLineGen = d3.line<Point>()
    .x(d => xScale(d.t))
    .y(d => yScale(d.x))
    .curve(d3.curveCatmullRom);

  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    const drag = d3.drag<SVGCircleElement, Point>()
      .on('drag', (event, d) => {
        const currentPoints = pointsRef.current;
        const idx = currentPoints.findIndex(p => p.id === d.id);
        if (idx === 0 || idx === currentPoints.length - 1) return;
        const newX = yScale.invert(event.y);
        const clampedX = Math.max(-10, Math.min(80, newX));
        setPoints(p => {
          const next = [...p];
          next[idx] = { ...next[idx], x: clampedX };
          return next;
        });
      });

    svg.selectAll('.draggable-dot')
      .data(points)
      .call(drag as any);
  });

  const resetPoints = () => {
    const initial = [];
    for (let i = 0; i < INITIAL_POINTS_COUNT; i++) {
      const t = (i / (INITIAL_POINTS_COUNT - 1)) * TIME_END;
      const x = X_START + ((X_END - X_START) * t) / TIME_END;
      initial.push({ t, x, id: `point-${i}` });
    }
    setPoints(initial);
  };

  const setToClassical = () => {
    setPoints(newtonianPoints);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-lg">
              <Activity className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold text-gray-900 font-display">
              최소 작용의 원리 실험실
            </h1>
          </div>
          
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setShowTable(!showTable)}
              className="px-4 py-2 text-sm font-semibold text-gray-600 hover:text-blue-600 border border-gray-200 rounded-xl hover:border-blue-200 transition-all bg-white"
            >
              {showTable ? '데이터 숨기기' : '데이터 보기'}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto px-6 py-8 w-full">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Main Simulation Area */}
          <div className="lg:col-span-8 space-y-6">
            <div className="bg-white rounded-3xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse" />
                  <span className="text-xs font-bold uppercase tracking-widest text-gray-400">시뮬레이션 가상 공간</span>
                </div>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 text-xs font-bold text-gray-500 cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={showNewtonian} 
                      onChange={e => setShowNewtonian(e.target.checked)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    이상적 경로(뉴턴) 표시
                  </label>
                  <button 
                    onClick={setToClassical}
                    className="px-3 py-1.5 text-xs font-bold text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
                  >
                    이상적 경로로 맞추기
                  </button>
                </div>
              </div>

              <div className="p-10 flex justify-center bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:20px_20px] relative">
                <div className="relative bg-white rounded-2xl shadow-2xl p-4 border border-gray-100">
                  <svg 
                    ref={svgRef} 
                    width={width} 
                    height={height} 
                    viewBox={`0 0 ${width} ${height}`}
                    className="overflow-visible select-none"
                  >
                    {/* Grid lines */}
                    <g className="grid text-gray-100">
                      {xScale.ticks(10).map(t => (
                        <line key={`x-${t}`} x1={xScale(t)} x2={xScale(t)} y1={margin.top} y2={height - margin.bottom} stroke="currentColor" strokeWidth="1" />
                      ))}
                      {yScale.ticks(10).map(x => (
                        <line key={`y-${x}`} x1={margin.left} x2={width - margin.right} y1={yScale(x)} y2={yScale(x)} stroke="currentColor" strokeWidth="1" />
                      ))}
                    </g>

                    {/* Axes */}
                    <g transform={`translate(0, ${height - margin.bottom})`}>
                      <line x1={margin.left} x2={width - margin.right} y1="0" y2="0" stroke="#cbd5e1" strokeWidth="2" />
                      {xScale.ticks(10).map(t => (
                        <g key={t} transform={`translate(${xScale(t)}, 0)`}>
                          <line y2="8" stroke="#cbd5e1" strokeWidth="2" />
                          <text y="24" textAnchor="middle" className="text-[10px] fill-gray-400 font-mono font-medium">{t}</text>
                        </g>
                      ))}
                      <text x={width - margin.right} y="44" textAnchor="end" className="text-[11px] font-bold fill-gray-500 uppercase tracking-widest">시간 (seconds)</text>
                    </g>
                    <g transform={`translate(${margin.left}, 0)`}>
                      <line y1={margin.top} y2={height - margin.bottom} x1="0" x2="0" stroke="#cbd5e1" strokeWidth="2" />
                      {yScale.ticks(12).map(x => (
                        <g key={x} transform={`translate(0, ${yScale(x)})`}>
                          <line x2="-8" stroke="#cbd5e1" strokeWidth="2" />
                          <text x="-16" dy="4" textAnchor="end" className="text-[10px] fill-gray-400 font-mono font-medium">{x}</text>
                        </g>
                      ))}
                      <text y={margin.top - 16} x="0" textAnchor="middle" className="text-[11px] font-bold fill-gray-500 uppercase tracking-widest">위치 (meters)</text>
                    </g>

                    {/* Newtonian Path */}
                    {showNewtonian && (
                      <path 
                        d={targetLineGen(newtonianPoints) || ''} 
                        fill="none" 
                        stroke="#10b981" 
                        strokeWidth="3" 
                        strokeDasharray="8,8" 
                        opacity="0.4"
                      />
                    )}

                    {/* Interactive Path */}
                    <path 
                      d={lineGen(points) || ''} 
                      fill="none" 
                      stroke="#3b82f6" 
                      strokeWidth="4" 
                      strokeLinecap="round"
                    />

                    {/* Draggable Points */}
                    {points.map((p, i) => (
                      <circle
                        key={p.id}
                        cx={xScale(p.t)}
                        cy={yScale(p.x)}
                        r={i === 0 || i === points.length - 1 ? 8 : 6}
                        fill={i === 0 || i === points.length - 1 ? '#0f172a' : '#3b82f6'}
                        className={`draggable-dot transition-all duration-150 ${i === 0 || i === points.length - 1 ? 'cursor-not-allowed' : 'cursor-ns-resize hover:scale-125'}`}
                      />
                    ))}
                  </svg>
                  
                  {/* Action Value Badge */}
                  <div className="absolute top-6 right-6 pointer-events-none">
                    <div className="bg-white/90 border border-gray-100 rounded-2xl p-4 shadow-2xl backdrop-blur-md min-w-[200px] ring-1 ring-black/5">
                      <div className="text-[10px] uppercase font-black text-gray-400 mb-1 tracking-[0.2em]">전체 작용량 S</div>
                      <div className="text-4xl font-mono font-bold text-gray-900 tabular-nums">
                        {totalS.toFixed(3)}
                      </div>
                      <div className="mt-3 flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-[10px] text-emerald-600 font-bold bg-emerald-50 px-2 py-1 rounded-full">
                          <TrendingDown className="w-3 h-3" />
                          최솟값: {idealS.toFixed(2)}
                        </div>
                        <div className={`text-[10px] font-bold px-2 py-1 rounded-full ${Math.abs(totalS - idealS) < 0.1 ? 'bg-green-100 text-green-700' : 'bg-blue-50 text-blue-600'}`}>
                          차이 {(totalS - idealS).toFixed(2)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-4 bg-gray-50 border-t border-gray-100 flex items-center justify-center gap-3">
                <kbd className="px-2 py-1 bg-white border border-gray-200 rounded text-[10px] font-bold text-gray-500 shadow-sm">드래그</kbd>
                <span className="text-xs font-medium text-gray-500">파란색 점을 움직여 작용량 S를 최소로 만들어 보세요.</span>
              </div>
            </div>

            {/* Kinetics Table */}
            <AnimatePresence>
              {showTable && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="bg-white rounded-3xl border border-gray-200 shadow-sm overflow-hidden"
                >
                  <div className="p-4 border-b border-gray-100 flex items-center gap-2 bg-gray-50/50">
                    <TableIcon className="w-4 h-4 text-gray-400" />
                    <span className="text-xs font-bold uppercase tracking-widest text-gray-400">정밀 동역학 분석 표</span>
                  </div>
                  <div className="overflow-x-auto max-h-[400px]">
                    <table className="w-full text-left border-collapse">
                      <thead className="sticky top-0 bg-white z-10">
                        <tr className="bg-gray-50 text-[10px] uppercase font-bold text-gray-400 border-b border-gray-100">
                          <th className="px-6 py-4">구간</th>
                          <th className="px-6 py-4">시간 (t)</th>
                          <th className="px-6 py-4">위치 (x)</th>
                          <th className="px-6 py-4">속도 (v)</th>
                          <th className="px-6 py-4">운동E (KE)</th>
                          <th className="px-6 py-4">퍼텐셜E (PE)</th>
                          <th className="px-6 py-4">총 에너지 (E)</th>
                        </tr>
                      </thead>
                      <tbody className="text-xs font-mono">
                        {points.map((p, i) => {
                          const seg = segments[i - 1];
                          return (
                            <tr key={p.id} className="border-b border-gray-50 hover:bg-blue-50/50 transition-colors">
                              <td className="px-6 py-3 text-gray-400">{i}</td>
                              <td className="px-6 py-3 tabular-nums">{p.t.toFixed(2)}</td>
                              <td className="px-6 py-3 tabular-nums font-bold text-gray-900">{p.x.toFixed(2)}</td>
                              <td className="px-6 py-3 tabular-nums text-blue-600">{seg?.v.toFixed(2) ?? '-'}</td>
                              <td className="px-6 py-3 tabular-nums text-gray-700">{seg?.ke.toFixed(2) ?? '-'}</td>
                              <td className="px-6 py-3 tabular-nums text-red-600">{seg?.pe.toFixed(2) ?? '-'}</td>
                              <td className="px-6 py-3 tabular-nums font-bold text-indigo-600">{seg?.energy.toFixed(2) ?? '-'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Sidebar Controls */}
          <div className="lg:col-span-4 space-y-6">
            <div className="bg-white rounded-3xl border border-gray-200 shadow-sm p-8 space-y-8">
              <div className="flex items-center gap-3">
                <Settings2 className="w-5 h-5 text-blue-600" />
                <h2 className="text-xl font-bold font-display">변수 제어</h2>
              </div>

              {/* Potential Selection */}
              <div className="space-y-4">
                <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">환경 선택</h3>
                <div className="grid grid-cols-1 gap-3">
                  {[
                    { id: 'free', label: '자유 입자 거동', icon: RotateCcw, sub: '힘이 없는 진공 상태' },
                    { id: 'gravity', label: '중력 가속 운동', icon: Scale, sub: '지표면 중력 적용' },
                    { id: 'harmonic', label: '조화 진동 운동', icon: Activity, sub: '용수철 복원력 적용' },
                  ].map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setPotential(p.id as PotentialType);
                        resetPoints();
                      }}
                      className={`flex flex-col p-4 rounded-2xl border text-left transition-all ${
                        potential === p.id 
                        ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-sm ring-1 ring-blue-600 ring-opacity-20' 
                        : 'border-gray-100 hover:border-gray-300 hover:bg-gray-50 text-gray-500'
                      }`}
                    >
                      <div className="flex items-center justify-between w-full mb-1">
                        <span className="text-sm font-bold flex items-center gap-2">
                          <p.icon className="w-4 h-4" />
                          {p.label}
                        </span>
                        {potential === p.id && <div className="w-2 h-2 rounded-full bg-blue-600 shadow-[0_0_8px_rgba(37,99,235,0.5)]" />}
                      </div>
                      <span className="text-[10px] opacity-60 ml-6">{p.sub}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Mass Slider */}
              <div className="space-y-5">
                <div className="flex justify-between items-center">
                  <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">입자 질량 (m)</h3>
                  <span className="text-sm font-mono font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-lg">{mass} kg</span>
                </div>
                <input 
                  type="range" 
                  min="0.1" 
                  max="5" 
                  step="0.1" 
                  value={mass}
                  onChange={e => setMass(parseFloat(e.target.value))}
                  className="w-full h-2 bg-gray-100 rounded-full appearance-none cursor-pointer accent-blue-600"
                />
              </div>

              {potential === 'harmonic' && (
                <div className="space-y-5">
                  <div className="flex justify-between items-center">
                    <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">탄성 계수 (k)</h3>
                    <span className="text-sm font-mono font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-lg">{kSpring} N/m</span>
                  </div>
                  <input 
                    type="range" 
                    min="1" 
                    max="100" 
                    step="1" 
                    value={kSpring}
                    onChange={e => setKSpring(parseFloat(e.target.value))}
                    className="w-full h-2 bg-gray-100 rounded-full appearance-none cursor-pointer accent-red-600"
                  />
                </div>
              )}

              <div className="pt-4 flex flex-col gap-3">
                <button 
                  onClick={resetPoints}
                  className="w-full py-4 bg-gray-900 text-white rounded-2xl text-sm font-bold hover:bg-black transition-all shadow-xl active:scale-95"
                >
                  실험 초기화
                </button>
              </div>
            </div>

            <div className="bg-gradient-to-br from-blue-700 to-indigo-900 rounded-3xl p-8 text-white shadow-2xl relative overflow-hidden ring-1 ring-white/20">
              <div className="absolute -right-4 -top-4 w-24 h-24 bg-white/10 rounded-full blur-3xl" />
              <h3 className="font-bold font-display text-lg flex items-center gap-2 mb-4">
                <Info className="w-5 h-5 opacity-80" />
                물리학 노트
              </h3>
              <p className="text-sm text-blue-100 leading-relaxed mb-6 opacity-90">
                <b>최소 작용의 원리</b>는 입자가 물리적으로 가능한 수많은 가상 경로 중, '작용량'을 최소화하는 단 하나의 실제 경로를 선택한다는 놀라운 원리입니다.
              </p>
              <div className="bg-white/10 rounded-2xl p-5 mb-6 border border-white/10 backdrop-blur-sm">
                <div className="text-[10px] uppercase font-black text-blue-300 mb-2 tracking-widest text-center">작용량 S 공식</div>
                <div className="text-2xl font-mono text-center">
                  S = ∫ (K - V) dt
                </div>
              </div>
              <p className="text-[11px] text-blue-200/80 leading-relaxed italic">
                * K = 운동 에너지, V = 퍼텐셜 에너지 (위치 에너지)
                <br />* 위 실험에서 S가 가장 작을 때의 경로를 찾아보세요.
              </p>
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-gray-200 py-10 bg-white">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-4 text-gray-400">
          <p className="text-xs font-medium">© 2026 Least Action Laboratory</p>
          <p className="text-[10px] uppercase tracking-widest font-bold">Based on American Journal of Physics 71, 386–391 (2003)</p>
        </div>
      </footer>
    </div>
  );
}

