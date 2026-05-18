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

/// --- Components ---

export default function App() {
  const [mass, setMass] = useState(1);
  const [potential, setPotential] = useState<PotentialType>('gravity');
  const [kSpring, setKSpring] = useState(10);
  
  // Initialize points directly in state to avoid flash of empty
  const [points, setPoints] = useState<Point[]>(() => {
    const initial = [];
    for (let i = 0; i < INITIAL_POINTS_COUNT; i++) {
      const t = (i / (INITIAL_POINTS_COUNT - 1)) * TIME_END;
      const x = X_START + ((X_END - X_START) * t) / TIME_END;
      initial.push({ t, x, id: `point-${i}` });
    }
    return initial;
  });

  const [showTable, setShowTable] = useState(false);
  const [showNewtonian, setShowNewtonian] = useState(true);

  const svgRef = useRef<SVGSVGElement>(null);

  const { totalS, segments } = useMemo(() => calculateAction(points, mass, potential, kSpring), [points, mass, potential, kSpring]);
  const newtonianPoints = useMemo(() => calculateNewtonianPath(mass, potential, kSpring), [mass, potential, kSpring]);
  const { totalS: idealS } = useMemo(() => calculateAction(newtonianPoints, mass, potential, kSpring), [newtonianPoints, mass, potential, kSpring]);

  // --- D3 Constants ---
  const width = 600;
  const height = 400;
  const margin = { top: 40, right: 30, bottom: 60, left: 60 };

  const xScale = d3.scaleLinear()
    .domain([0, TIME_END])
    .range([margin.left, width - margin.right]);

  const yScale = d3.scaleLinear()
    .domain([-10, 80])
    .range([height - margin.bottom, margin.top]);

  // --- D3 Drag Handling ---
  useEffect(() => {
    if (!svgRef.current) return;
    
    const svg = d3.select(svgRef.current);
    
    const dragHandler = d3.drag<SVGCircleElement, Point>()
      .on('drag', (event, d) => {
        const newX = yScale.invert(event.y);
        const clampedX = Math.max(-10, Math.min(80, newX));
        
        setPoints(prev => {
          const idx = prev.findIndex(p => p.id === d.id);
          if (idx <= 0 || idx >= prev.length - 1) return prev;
          const next = [...prev];
          next[idx] = { ...next[idx], x: clampedX };
          return next;
        });
      });

    // Re-bind components on every points change
    svg.selectAll('.draggable-point')
      .data(points)
      .call(dragHandler as any);

  }, [points, yScale]);

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

  const lineGen = d3.line<Point>()
    .x(d => xScale(d.t))
    .y(d => yScale(d.x))
    .curve(d3.curveLinear);

  const targetLineGen = d3.line<Point>()
    .x(d => xScale(d.t))
    .y(d => yScale(d.x))
    .curve(d3.curveCatmullRom);

  return (
    <div className="min-h-screen bg-[#fafafa] text-slate-900 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-100">
              <Activity className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-lg font-bold tracking-tight">최소 작용의 원리 실험실</h1>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setShowTable(!showTable)}
              className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-indigo-600 border border-slate-200 rounded-lg transition-all flex items-center gap-2"
            >
              <TableIcon className="w-4 h-4" />
              {showTable ? '데이터 숨기기' : '데이터 보기'}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
          
          {/* Main Chart */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Wordline (t-x) Diagram</span>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 text-xs font-semibold text-slate-500 cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={showNewtonian} 
                      onChange={e => setShowNewtonian(e.target.checked)}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    이상적 경로 표시
                  </label>
                  <button 
                    onClick={setToClassical}
                    className="text-xs font-bold text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-lg hover:bg-indigo-100 transition-colors"
                  >
                    자동 최적화
                  </button>
                </div>
              </div>

              <div className="p-10 flex justify-center bg-[#fdfdfd]">
                <div className="relative p-4 bg-white rounded-xl ring-1 ring-slate-100 shadow-2xl shadow-slate-200/50">
                  <svg 
                    ref={svgRef} 
                    width={width} 
                    height={height} 
                    className="overflow-visible select-none"
                    viewBox={`0 0 ${width} ${height}`}
                  >
                    {/* Simplified Grid */}
                    <g className="text-slate-100">
                      {xScale.ticks(6).map(t => (
                        <line key={t} x1={xScale(t)} x2={xScale(t)} y1={margin.top} y2={height - margin.bottom} stroke="currentColor" strokeWidth="1" />
                      ))}
                      {yScale.ticks(6).map(x => (
                        <line key={x} x1={margin.left} x2={width - margin.right} y1={yScale(x)} y2={yScale(x)} stroke="currentColor" strokeWidth="1" />
                      ))}
                    </g>

                    {/* Axes */}
                    <g transform={`translate(0, ${height - margin.bottom})`}>
                      <line x1={margin.left} x2={width - margin.right} stroke="#cbd5e1" strokeWidth="2" />
                      <text x={width - margin.right} y="25" textAnchor="end" className="text-[10px] font-bold fill-slate-400 uppercase tracking-widest">시간 (s)</text>
                    </g>
                    <g transform={`translate(${margin.left}, 0)`}>
                      <line y1={margin.top} y2={height - margin.bottom} stroke="#cbd5e1" strokeWidth="2" />
                      <text y={margin.top - 15} textAnchor="middle" className="text-[10px] font-bold fill-slate-400 uppercase tracking-widest">위치 (m)</text>
                    </g>

                    {/* Path Lines */}
                    {showNewtonian && (
                      <path 
                        d={targetLineGen(newtonianPoints) || ''} 
                        fill="none" stroke="#10b981" strokeWidth="3" 
                        strokeDasharray="8,8" opacity="0.3"
                      />
                    )}
                    <path 
                      d={lineGen(points) || ''} 
                      fill="none" stroke="#6366f1" strokeWidth="4" 
                      strokeLinecap="round" strokeLinejoin="round"
                    />

                    {/* Interactive Points */}
                    {points.map((p, i) => (
                      <circle
                        key={p.id}
                        cx={xScale(p.t)}
                        cy={yScale(p.x)}
                        r={i === 0 || i === points.length - 1 ? 8 : 6}
                        fill={i === 0 || i === points.length - 1 ? '#1e293b' : '#6366f1'}
                        className={`draggable-point transition-all duration-75 outline-none ${i === 0 || i === points.length - 1 ? 'cursor-not-allowed' : 'cursor-ns-resize hover:r-8'}`}
                      />
                    ))}
                  </svg>

                  {/* Summary Overlay */}
                  <div className="absolute top-8 right-8 pointer-events-none">
                    <div className="bg-white/95 border border-slate-100 rounded-2xl p-5 shadow-2xl backdrop-blur min-w-[180px]">
                      <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Total Action S</span>
                      <div className="text-3xl font-mono font-bold text-slate-900 mt-1 tabular-nums">
                        {totalS.toFixed(4)}
                      </div>
                      <div className="mt-4 pt-4 border-t border-slate-50 space-y-2">
                        <div className="flex justify-between text-[10px] font-bold">
                          <div className="text-slate-400 uppercase">최소 작용량</div>
                          <div className="text-emerald-600 font-mono">{idealS.toFixed(2)}</div>
                        </div>
                        <div className="flex justify-between text-[10px] font-bold">
                          <div className="text-slate-400 uppercase">에러 델타</div>
                          <div className="text-indigo-600 font-mono">{(totalS - idealS).toFixed(3)}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-slate-50/80 px-6 py-4 border-t border-slate-100 text-center">
                <span className="text-xs font-medium text-slate-500 italic">파란 점들을 수직으로 드래그하여 작용량 S가 줄어드는 경로를 찾아보세요.</span>
              </div>
            </div>

            {/* Table Detail */}
            <AnimatePresence>
              {showTable && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"
                >
                  <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-indigo-500" />
                      <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Physics Analytics Table</span>
                    </div>
                  </div>
                  <div className="overflow-x-auto max-h-[300px]">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50/50 text-[10px] uppercase font-bold text-slate-400 border-b border-slate-100 italic">
                          <th className="px-6 py-3 font-medium">구간</th>
                          <th className="px-6 py-3 font-medium">시간 (t)</th>
                          <th className="px-6 py-3 font-medium">위치 (x)</th>
                          <th className="px-6 py-3 font-medium">속도 (v)</th>
                          <th className="px-6 py-3 font-medium">운동E (K)</th>
                          <th className="px-6 py-3 font-medium">위치E (V)</th>
                          <th className="px-6 py-3 font-medium">에너지 (E)</th>
                        </tr>
                      </thead>
                      <tbody className="text-xs font-mono text-slate-600">
                        {points.map((p, i) => {
                          const seg = segments[i - 1];
                          return (
                            <tr key={p.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                              <td className="px-6 py-3 text-slate-300">{i}</td>
                              <td className="px-6 py-3">{p.t.toFixed(2)}</td>
                              <td className="px-6 py-3 font-bold text-slate-900">{p.x.toFixed(2)}</td>
                              <td className="px-6 py-3 text-indigo-600">{seg?.v.toFixed(2) ?? '-'}</td>
                              <td className="px-6 py-3">{seg?.ke.toFixed(2) ?? '-'}</td>
                              <td className="px-6 py-3 text-red-500">{seg?.pe.toFixed(2) ?? '-'}</td>
                              <td className="px-6 py-3 font-bold text-slate-900">{seg?.energy.toFixed(2) ?? '-'}</td>
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

          {/* Controls Sidebar */}
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-8">
              <div className="flex items-center gap-2 pb-2 border-b border-slate-50">
                <Settings2 className="w-4 h-4 text-slate-400" />
                <h2 className="text-sm font-bold uppercase tracking-widest text-slate-500">실험 환경 설정</h2>
              </div>

              {/* Potential Selection */}
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-2">
                  {[
                    { id: 'free', label: '자유 입자', sub: '등속 운동 (V=0)' },
                    { id: 'gravity', label: '지표 중력', sub: '등가속도 운동 (V=mgh)' },
                    { id: 'harmonic', label: '조화 진동', sub: '복원력 (V=½kx²)' },
                  ].map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setPotential(p.id as PotentialType);
                        resetPoints();
                      }}
                      className={`flex flex-col p-4 rounded-xl border text-left transition-all ${
                        potential === p.id 
                        ? 'border-indigo-600 bg-indigo-50/50 text-indigo-700 ring-1 ring-indigo-600/20 shadow-sm' 
                        : 'border-slate-100 hover:border-slate-200 hover:bg-slate-50 text-slate-500'
                      }`}
                    >
                      <span className="text-sm font-bold">{p.label}</span>
                      <span className="text-[10px] opacity-60 mt-0.5">{p.sub}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Sliders */}
              <div className="space-y-6">
                <div className="space-y-3">
                  <div className="flex justify-between items-center px-1">
                    <span className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-400">입자 질량 (m)</span>
                    <span className="text-xs font-mono font-bold text-indigo-600">{mass} kg</span>
                  </div>
                  <input 
                    type="range" min="0.1" max="5" step="0.1" value={mass}
                    onChange={e => setMass(parseFloat(e.target.value))}
                    className="w-full h-1.5 bg-slate-100 rounded-full appearance-none cursor-pointer accent-indigo-600"
                  />
                </div>

                {potential === 'harmonic' && (
                  <div className="space-y-3">
                  <div className="flex justify-between items-center px-1">
                    <span className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-400">강성 (k)</span>
                    <span className="text-xs font-mono font-bold text-red-500">{kSpring} N/m</span>
                  </div>
                  <input 
                    type="range" min="1" max="100" step="1" value={kSpring}
                    onChange={e => setKSpring(parseFloat(e.target.value))}
                    className="w-full h-1.5 bg-slate-100 rounded-full appearance-none cursor-pointer accent-red-500"
                  />
                </div>
                )}
              </div>

              <button 
                onClick={resetPoints}
                className="w-full py-4 bg-slate-900 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-black transition-all active:scale-95 shadow-lg shadow-slate-200"
              >
                Reset Lab State
              </button>
            </div>

            <div className="bg-indigo-600 rounded-2xl p-6 text-white shadow-xl shadow-indigo-100">
              <h3 className="font-bold flex items-center gap-2 mb-3">
                <Info className="w-4 h-4 opacity-70" />
                Principle of Least Action
              </h3>
              <p className="text-[11px] leading-relaxed opacity-80 mb-4 font-medium">
                하밀턴의 원리에 따르면, 입자는 작용량 S를 정적으로 만드는 경로(대부분 최소값)를 따라 이동합니다. 위 시뮬레이션에서 점들을 움직여 S값을 최소로 만들어 보세요. 그것이 바로 뉴턴의 운동 법칙이 유도되는 지점입니다.
              </p>
              <div className="bg-white/10 rounded-xl p-3 border border-white/10">
                <div className="text-[9px] uppercase font-black tracking-widest opacity-60 mb-1 text-center">Action Formula</div>
                <div className="text-xl font-mono text-center">S = ∫ (K - V) dt</div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="mt-12 border-t border-slate-100 py-10">
        <div className="max-w-6xl mx-auto px-6 text-center text-slate-400">
          <p className="text-[10px] font-black uppercase tracking-[0.3em]">Theoretical Physics Laboratory</p>
          <p className="text-[9px] mt-2 opacity-60">Source: American Journal of Physics 71, 386–391 (2003)</p>
        </div>
      </footer>
    </div>
  );
}

