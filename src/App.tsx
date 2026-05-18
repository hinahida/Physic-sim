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

  const lineGen = d3.line<Point>()
    .x(d => xScale(d.t))
    .y(d => yScale(d.x))
    .curve(d3.curveLinear);

  const targetLineGen = d3.line<Point>()
    .x(d => xScale(d.t))
    .y(d => yScale(d.x))
    .curve(d3.curveCatmullRom);

  useEffect(() => {
    if (!svgRef.current || points.length === 0) return;
    
    const svg = d3.select(svgRef.current);
    const drag = d3.drag<SVGCircleElement, Point>()
      .on('drag', (event, d) => {
        const idx = points.findIndex(p => p.id === d.id);
        if (idx === 0 || idx === points.length - 1) return;
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

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b border-gray-100 bg-white/80 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-lg">
              <Activity className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-indigo-600">
              Least Action Lab
            </h1>
          </div>
          
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setShowTable(!showTable)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 hover:text-blue-600 transition-colors"
            >
              <TableIcon className="w-4 h-4" />
              {showTable ? 'Hide Data' : 'Show Data'}
            </button>
            <div className="h-4 w-px bg-gray-200" />
            <a 
              href="https://doi.org/10.1119/1.1528915" 
              target="_blank" 
              rel="noreferrer"
              className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
              title="Read the Paper"
            >
              <Info className="w-5 h-5" />
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Main Simulation Area */}
          <div className="lg:col-span-8 space-y-6">
            <motion.div 
              layout
              className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden"
            >
              <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                  <span className="text-sm font-semibold uppercase tracking-wider text-gray-500">Worldline Visualization</span>
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-xs font-medium text-gray-500 cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={showNewtonian} 
                      onChange={e => setShowNewtonian(e.target.checked)}
                      className="rounded border-gray-300 text-emerald-500 focus:ring-emerald-500"
                    />
                    Show Newtonian Path
                  </label>
                  <button 
                    onClick={setToClassical}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 rounded-full hover:bg-emerald-100 transition-colors"
                  >
                    Snap to Ideal
                  </button>
                </div>
              </div>

              <div className="p-8 flex justify-center bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] bg-opacity-5 relative min-h-[460px]">
                <div ref={containerRef} className="relative bg-white/50 backdrop-blur-sm rounded-xl">
                  <svg 
                    ref={svgRef} 
                    width={width} 
                    height={height} 
                    className="overflow-visible"
                  >
                    {/* Grid lines */}
                    <g className="grid text-gray-200">
                      {xScale.ticks(10).map(t => (
                        <line key={`x-${t}`} x1={xScale(t)} x2={xScale(t)} y1={margin.top} y2={height - margin.bottom} stroke="currentColor" strokeOpacity="0.1" />
                      ))}
                      {yScale.ticks(10).map(x => (
                        <line key={`y-${x}`} x1={margin.left} x2={width - margin.right} y1={yScale(x)} y2={yScale(x)} stroke="currentColor" strokeOpacity="0.1" />
                      ))}
                    </g>

                    {/* Axes */}
                    <g transform={`translate(0, ${height - margin.bottom})`}>
                      <line x1={margin.left} x2={width - margin.right} y1="0" y2="0" stroke="#94a3b8" />
                      {xScale.ticks(10).map(t => (
                        <g key={t} transform={`translate(${xScale(t)}, 0)`}>
                          <line y2="6" stroke="#94a3b8" />
                          <text y="20" textAnchor="middle" className="text-[10px] fill-gray-400 font-mono">{t}</text>
                        </g>
                      ))}
                    </g>
                    <g transform={`translate(${margin.left}, 0)`}>
                      <line y1={margin.top} y2={height - margin.bottom} x1="0" x2="0" stroke="#94a3b8" />
                      {yScale.ticks(12).map(x => (
                        <g key={x} transform={`translate(0, ${yScale(x)})`}>
                          <line x2="-6" stroke="#94a3b8" />
                          <text x="-12" dy="4" textAnchor="end" className="text-[10px] fill-gray-400 font-mono">{x}</text>
                        </g>
                      ))}
                    </g>

                    {/* Newtonian Path */}
                    {showNewtonian && (
                      <path 
                        d={targetLineGen(newtonianPoints) || ''} 
                        fill="none" 
                        stroke="#10b981" 
                        strokeWidth="2" 
                        strokeDasharray="5,5" 
                        opacity="0.6"
                      />
                    )}

                    {/* Interactive Path */}
                    <path 
                      d={lineGen(points) || ''} 
                      fill="none" 
                      stroke="#3b82f6" 
                      strokeWidth="3" 
                    />

                    {/* Draggable Points */}
                    {points.map((p, i) => (
                      <circle
                        key={p.id}
                        cx={xScale(p.t)}
                        cy={yScale(p.x)}
                        r={i === 0 || i === points.length - 1 ? 6 : 4}
                        fill={i === 0 || i === points.length - 1 ? '#1e293b' : '#3b82f6'}
                        className={`draggable-dot ${i === 0 || i === points.length - 1 ? 'cursor-not-allowed' : 'cursor-ns-resize hover:r-6 transition-all'}`}
                      />
                    ))}
                  </svg>
                  
                  {/* Overlay Action Value */}
                  <div className="absolute top-4 right-4 flex flex-col items-end">
                    <div className="bg-white/90 border border-blue-100 rounded-lg p-3 shadow-lg backdrop-blur">
                      <div className="text-[10px] uppercase font-bold text-gray-400 mb-1">Total Action S</div>
                      <div className="text-3xl font-mono font-bold text-blue-600 tabular-nums">
                        {totalS.toFixed(2)}
                        <span className="text-sm font-sans ml-1 text-blue-400">J·s</span>
                      </div>
                      <div className="mt-2 flex items-center gap-1 text-[10px] text-emerald-600 font-medium bg-emerald-50 px-2 py-0.5 rounded">
                        <TrendingDown className="w-3 h-3" />
                        Ideal Action: {idealS.toFixed(2)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-4 bg-gray-50 border-t border-gray-100 text-xs text-gray-500 italic flex items-center gap-2">
                <Info className="w-3 h-3" />
                파란색 점들을 위아래로 드래그하여 경로를 변경하세요. 우주는 작용량 S가 최소(또는 정상 상태)가 되는 경로를 따릅니다.
              </div>
            </motion.div>

            {/* Kinetics Table */}
            <AnimatePresence>
              {showTable && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 20 }}
                  className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden"
                >
                  <div className="p-4 border-b border-gray-100 flex items-center gap-2 bg-gray-50/50">
                    <TableIcon className="w-4 h-4 text-gray-400" />
                    <span className="text-sm font-semibold uppercase tracking-wider text-gray-500">Path Dynamics</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-gray-50 text-[10px] uppercase font-bold text-gray-400 border-b border-gray-100">
                          <th className="px-4 py-3">Point</th>
                          <th className="px-4 py-3">Time (t)</th>
                          <th className="px-4 py-3">Pos (x)</th>
                          <th className="px-4 py-3">Vel (v)</th>
                          <th className="px-4 py-3">Accel (a)</th>
                          <th className="px-4 py-3">KE</th>
                          <th className="px-4 py-3">PE</th>
                          <th className="px-4 py-3">Total E</th>
                        </tr>
                      </thead>
                      <tbody className="text-xs font-mono">
                        {points.map((p, i) => {
                          const seg = segments[i - 1]; // Segment leading to this point
                          return (
                            <tr key={p.id} className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors">
                              <td className="px-4 py-2 text-gray-400 border-r border-gray-50">{i}</td>
                              <td className="px-4 py-2 tabular-nums">{p.t.toFixed(2)}</td>
                              <td className="px-4 py-2 tabular-nums font-bold">{p.x.toFixed(2)}</td>
                              <td className="px-4 py-2 tabular-nums text-blue-600">{seg?.v.toFixed(2) ?? '-'}</td>
                              <td className="px-4 py-2 tabular-nums text-amber-600">{seg?.accel.toFixed(2) ?? '-'}</td>
                              <td className="px-4 py-2 tabular-nums">{seg?.ke.toFixed(2) ?? '-'}</td>
                              <td className="px-4 py-2 tabular-nums text-red-600">{seg?.pe.toFixed(2) ?? '-'}</td>
                              <td className="px-4 py-2 tabular-nums font-bold text-gray-700">{seg?.energy.toFixed(2) ?? '-'}</td>
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
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-6">
              <div className="flex items-center gap-2 mb-2">
                <Settings2 className="w-5 h-5 text-blue-600" />
                <h2 className="text-lg font-bold">Experiment Params</h2>
              </div>

              {/* Potential Selection */}
              <div className="space-y-3">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                  <ChevronRight className="w-3 h-3" />
                  Potential Field
                </label>
                <div className="grid grid-cols-1 gap-2">
                  {[
                    { id: 'free', label: 'Free Particle (PE = 0)', icon: RotateCcw },
                    { id: 'gravity', label: 'Gravity (PE = mgh)', icon: Scale },
                    { id: 'harmonic', label: 'Harmonic (PE = ½kx²)', icon: Activity },
                  ].map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setPotential(p.id as PotentialType)}
                      className={`flex items-center justify-between p-3 rounded-xl border text-sm font-medium transition-all ${
                        potential === p.id 
                        ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-sm' 
                        : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50 text-gray-600'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <p.icon className={`w-4 h-4 ${potential === p.id ? 'text-blue-600' : 'text-gray-400'}`} />
                        {p.label}
                      </div>
                      {potential === p.id && <motion.div layoutId="check" className="w-1.5 h-1.5 rounded-full bg-blue-600" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* Mass Slider */}
              <div className="space-y-4">
                <div className="flex justify-between items-end">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                    <ChevronRight className="w-3 h-3" />
                    Particle Mass (m)
                  </label>
                  <span className="text-sm font-mono font-bold text-blue-600">{mass} kg</span>
                </div>
                <input 
                  type="range" 
                  min="0.1" 
                  max="5" 
                  step="0.1" 
                  value={mass}
                  onChange={e => setMass(parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-gray-100 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
              </div>

              {potential === 'harmonic' && (
                <div className="space-y-4">
                  <div className="flex justify-between items-end">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                      <ChevronRight className="w-3 h-3" />
                      Spring Constant (k)
                    </label>
                    <span className="text-sm font-mono font-bold text-red-600">{kSpring} N/m</span>
                  </div>
                  <input 
                    type="range" 
                    min="1" 
                    max="100" 
                    step="1" 
                    value={kSpring}
                    onChange={e => setKSpring(parseFloat(e.target.value))}
                    className="w-full h-1.5 bg-gray-100 rounded-lg appearance-none cursor-pointer accent-red-600"
                  />
                </div>
              )}

              <hr className="border-gray-100" />

              <div className="grid grid-cols-2 gap-3">
                <button 
                  onClick={resetPoints}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-900 text-white rounded-xl text-sm font-bold hover:bg-gray-800 transition-all shadow-md active:scale-95"
                >
                  <RotateCcw className="w-4 h-4" />
                  Reset Path
                </button>
                <div className="bg-blue-50 rounded-xl p-2 flex flex-col items-center justify-center text-center border border-blue-100">
                  <span className="text-[10px] text-blue-400 font-bold uppercase tracking-tight">Delta S</span>
                  <span className={`text-sm font-mono font-bold ${Math.abs(totalS - idealS) < 0.1 ? 'text-emerald-600' : 'text-blue-600'}`}>
                    {(totalS - idealS).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>

            {/* Educational Note snippet */}
            <div className="bg-gradient-to-br from-indigo-600 to-blue-700 rounded-2xl p-6 text-white shadow-xl shadow-blue-200/50">
              <h3 className="font-bold flex items-center gap-2 mb-3">
                <Info className="w-5 h-5" />
                What is Action?
              </h3>
              <p className="text-sm text-blue-50 leading-relaxed mb-4">
                In physics, the <b>Action (S)</b> is defined as the integral over time of the Lagrangian (L = KE - PE).
              </p>
              <div className="bg-white/10 rounded-lg p-3 font-mono text-center text-lg mb-4">
                S = ∫ (KE - PE) dt
              </div>
              <p className="text-xs text-blue-100 leading-relaxed">
                Hamilton's Principle states that the "true worldline" of a particle is the one where the Action is at a stationary value (usually a minimum).
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="mt-20 border-t border-gray-100 py-12 bg-gray-50/50">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <p className="text-sm text-gray-500 mb-2">Based on American Journal of Physics Vol. 71, No. 4, April 2003</p>
          <p className="text-xs text-gray-400">Jozef Hanc, Slavomir Tuleja, Martina Hancova</p>
        </div>
      </footer>
    </div>
  );
}

