import React, { useState, useMemo } from 'react';
import { RotateCw, Target, Trash2, CheckCircle, HelpCircle } from 'lucide-react';

// --- Constants & Helper Functions ---

const UNITS = {
  yellow: { name: 'Yellow Diamond', width: 2, height: 1, color: '#fbbf24', shape: '1x2' },
  blue: { name: 'Blue Rod', width: 3, height: 1, color: '#3b82f6', shape: '1x3' },
  green: { name: 'Green Rod', width: 4, height: 1, color: '#22c55e', shape: '1x4' },
  orange: { name: 'Orange Diamond', width: 2, height: 2, color: '#f97316', shape: '2x2' },
  purple: { name: 'Purple Diamond', width: 2, height: 3, color: '#a855f7', shape: '2x3', vertical: true },
  red: { name: 'Red Decagon', width: 3, height: 3, color: '#ef4444', shape: '3x3' }
};

const getValidEdges = (unit, orientation) => {
  const w = orientation === 'H' ? unit.width : unit.height;
  const h = orientation === 'H' ? unit.height : unit.width;

  // 1x1 
  if (w === 1 && h === 1) return ['middle'];

  // 1D Shapes
  if (h === 1) { // Horizontal 1xN
    if (w === 2) return ['left', 'right'];
    if (w === 3) return ['left', 'middle', 'right'];
    if (w === 4) return ['left', 'middle', 'right']; // Simplified: middle covers both center positions
  }
  if (w === 1) { // Vertical Nx1
    if (h === 2) return ['top', 'bottom'];
    if (h === 3) return ['top', 'middle', 'bottom'];
    if (h === 4) return ['top', 'middle', 'bottom']; // Simplified: middle covers both center positions
  }

  // 2D Shapes
  if (w === 2 && h === 2) {
    return ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
  }
  
  if (w === 3 && h === 3) {
    return [
      'top-left', 'top', 'top-right',
      'left', 'middle', 'right',
      'bottom-left', 'bottom', 'bottom-right'
    ];
  }

  if (w === 2 && h === 3) {
    return [
      'top-left', 'top-right',
      'middle-left', 'middle-right',
      'bottom-left', 'bottom-right'
    ];
  }

  return ['middle'];
};

const getOffsetFromEdge = (edge, w, h) => {
  // Helper to find the Top-Left coordinate relative to the hit cell (dr, dc)
  
  // Handle specific edge cases for 2x3 purple diamond
  if (w === 2 && h === 3) {
    const offsets2x3 = {
      'top-left': { dr: 0, dc: 0 },
      'top-right': { dr: 0, dc: -1 },
      'middle-left': { dr: -1, dc: 0 },
      'middle-right': { dr: -1, dc: -1 },
      'bottom-left': { dr: -2, dc: 0 },
      'bottom-right': { dr: -2, dc: -1 },
    };
    if (offsets2x3[edge]) return offsets2x3[edge];
  }
  
  // For 1x4 and 4x1, 'middle' covers both center positions
  // We need to return MULTIPLE possible offsets for probability calculation
  if (edge === 'middle') {
    if (w === 4 && h === 1) {
      // For 1x4 horizontal, middle could be position 1 or 2
      // Return the first possibility (position 1), we'll handle both in probability calc
      return { dr: 0, dc: -1, alternative: { dr: 0, dc: -2 } };
    }
    if (w === 1 && h === 4) {
      // For 4x1 vertical, middle could be position 1 or 2
      return { dr: -1, dc: 0, alternative: { dr: -2, dc: 0 } };
    }
  }
  
  const offsets = {
    // 2x2 and larger corners
    'top-left': { dr: 0, dc: 0 },
    'top-right': { dr: 0, dc: -(w - 1) },
    'bottom-left': { dr: -(h - 1), dc: 0 },
    'bottom-right': { dr: -(h - 1), dc: -(w - 1) },

    // 3x3 & General edges
    'top': { dr: 0, dc: -Math.floor(w / 2) },
    'bottom': { dr: -(h - 1), dc: -Math.floor(w / 2) },
    'left': { dr: -Math.floor(h / 2), dc: 0 },
    'right': { dr: -Math.floor(h / 2), dc: -(w - 1) },
    'middle': { dr: -Math.floor(h / 2), dc: -Math.floor(w / 2) },
  };

  return offsets[edge] || { dr: 0, dc: 0 };
};

export default function VaultSolver() {
  const [gameState, setGameState] = useState('setup'); // setup, playing
  const [boardHeight, setBoardHeight] = useState(6);
  const [boardWidth, setBoardWidth] = useState(4);
  const [units, setUnits] = useState([]);
  
  // Board State
  const [board, setBoard] = useState([]);
  const [hits, setHits] = useState([]); // List of {r, c, color, edge}
  
  const [selectedCell, setSelectedCell] = useState(null);
  const [hitCount, setHitCount] = useState(0);

  // --- Setup Actions ---

  const addUnit = (color) => {
    // Purple is always vertical 3x2 (2x3 shape), we keep it in fixed orientation "H"
    const orientation = color === 'purple' ? 'H' : 'H';
    setUnits([...units, { id: Date.now(), color, orientation }]);
  };

  const removeUnit = (id) => {
    setUnits(units.filter(u => u.id !== id));
  };

  const toggleOrientation = (id) => {
    setUnits(units.map(u => {
      // Don't allow toggling purple - it's always vertical
      if (u.color === 'purple') return u;
      return u.id === id ? { ...u, orientation: u.orientation === 'H' ? 'V' : 'H' } : u;
    }));
  };

  const startGame = () => {
    if (units.length === 0) return;
    const newBoard = Array(boardHeight).fill(null).map(() => 
      Array(boardWidth).fill(null).map(() => ({ revealed: false, isHit: false, color: null, edge: null }))
    );
    setBoard(newBoard);
    setHits([]);
    setHitCount(0);
    setGameState('playing');
    setSelectedCell(null);
  };

  const resetGame = () => {
    setGameState('setup');
    setUnits([]);
    setBoard([]);
    setHits([]);
    setHitCount(0);
  };

  // --- Solver Logic ---

  // Identify units that are 100% found on the board
  const discoveredUnits = useMemo(() => {
    if (gameState !== 'playing') return [];
    
    const discovered = [];
    const usedHits = new Set(); 
    
    const remainingUnits = [...units];

    // 1. Edge-based Discovery (Strong)
    hits.forEach(hit => {
      if (usedHits.has(`${hit.r},${hit.c}`)) return;
      if (!hit.edge) return; 

      const unitIndex = remainingUnits.findIndex(u => u.color === hit.color);
      if (unitIndex === -1) return;
      const unit = remainingUnits[unitIndex];

      const unitDef = UNITS[unit.color];
      const w = unit.orientation === 'H' ? unitDef.width : unitDef.height;
      const h = unit.orientation === 'H' ? unitDef.height : unitDef.width;

      const offset = getOffsetFromEdge(hit.edge, w, h);

      const applyDiscovery = (topLeftR, topLeftC, requireAllHits = true) => {
        let matches = true;
        const unitHitKeys: string[] = [];

        for (let r = 0; r < h; r++) {
          for (let c = 0; c < w; c++) {
            const checkR = topLeftR + r;
            const checkC = topLeftC + c;

            if (checkR < 0 || checkR >= boardHeight || checkC < 0 || checkC >= boardWidth) {
              matches = false; break;
            }

            const cell = board[checkR][checkC];

            if (cell.revealed) {
              if (!cell.isHit || cell.color !== unit.color) {
                matches = false; break;
              }
              unitHitKeys.push(`${checkR},${checkC}`);
            } else if (requireAllHits) {
              // For normal units we require every tile to already be a hit
              matches = false; break;
            }
          }
          if (!matches) break;
        }

        if (!matches) return null;

        discovered.push({ ...unit, discovered: true, location: { r: topLeftR, c: topLeftC } });
        unitHitKeys.forEach(k => usedHits.add(k));
        remainingUnits.splice(unitIndex, 1);
        return true;
      };

      // Default behaviour: require full block of hits for discovery
      const topLeftR = hit.r + offset.dr;
      const topLeftC = hit.c + offset.dc;
      const ok = applyDiscovery(topLeftR, topLeftC, true);
      if (ok) return;
    });

    // 2. Simple Block Discovery (Weak/Fill)
    for (let i = 0; i < remainingUnits.length; i++) {
      const unit = remainingUnits[i];
      const unitDef = UNITS[unit.color];
      const w = unit.orientation === 'H' ? unitDef.width : unitDef.height;
      const h = unit.orientation === 'H' ? unitDef.height : unitDef.width;
      
      for(let r=0; r <= boardHeight - h; r++) {
        for(let c=0; c <= boardWidth - w; c++) {
          let allHits = true;
          const currentKeys = [];
          for(let dr=0; dr<h; dr++) {
            for(let dc=0; dc<w; dc++) {
              const k = `${r+dr},${c+dc}`;
              const cell = board[r+dr][c+dc];
              if (usedHits.has(k) || !cell.revealed || !cell.isHit || cell.color !== unit.color) {
                allHits = false; break;
              }
              currentKeys.push(k);
            }
            if(!allHits) break;
          }

          if(allHits) {
            discovered.push({ ...unit, discovered: true, location: { r, c } });
            currentKeys.forEach(k => usedHits.add(k));
            remainingUnits.splice(i, 1);
            i--; 
            break; 
          }
        }
      }
    }

    return discovered;
  }, [board, hits, units, gameState, boardHeight, boardWidth]);

  const probabilities = useMemo(() => {
    if (gameState !== 'playing') return null;

    const probs = Array(boardHeight).fill(0).map(() => Array(boardWidth).fill(0));

    // Create occupied mask (Discovered Units)
    const occupiedMask = new Set();
    discoveredUnits.forEach(u => {
      const unitDef = UNITS[u.color];
      const w = u.orientation === 'H' ? unitDef.width : unitDef.height;
      const h = u.orientation === 'H' ? unitDef.height : unitDef.width;
      for(let r=0; r<h; r++) {
        for(let c=0; c<w; c++) {
          occupiedMask.add(`${u.location.r + r},${u.location.c + c}`);
        }
      }
    });

    const discoveredIds = new Set(discoveredUnits.map(u => u.id));
    const remainingUnits = units.filter(u => !discoveredIds.has(u.id));
    const activeHits = hits.filter(h => !occupiedMask.has(`${h.r},${h.c}`));

    remainingUnits.forEach(unit => {
      const unitDef = UNITS[unit.color];
      const w = unit.orientation === 'H' ? unitDef.width : unitDef.height;
      const h = unit.orientation === 'H' ? unitDef.height : unitDef.width;

      for (let r = 0; r <= boardHeight - h; r++) {
        for (let c = 0; c <= boardWidth - w; c++) {
          
          let valid = true;
          let hitScore = 0; 
          let edgeMatchScore = 0; 

          for (let dr = 0; dr < h; dr++) {
            for (let dc = 0; dc < w; dc++) {
              const cellR = r + dr;
              const cellC = c + dc;
              const cellKey = `${cellR},${cellC}`;
              const cell = board[cellR][cellC];

              // Cannot overlap discovered units
              if (occupiedMask.has(cellKey)) {
                valid = false; break;
              }

              // Cannot overlap known MISSES
              if (cell.revealed && !cell.isHit) {
                valid = false; break;
              }

              // Cannot overlap hits of WRONG color
              if (cell.revealed && cell.isHit && cell.color !== null && cell.color !== unit.color) {
                valid = false; break;
              }

              // Overlaps valid hit of SAME color
              if (cell.revealed && cell.isHit && cell.color === unit.color) {
                hitScore += 1;
                
                // EDGE CONSISTENCY CHECK
                if (cell.edge) {
                  const offset = getOffsetFromEdge(cell.edge, w, h);
                  const expectedTopLeftR = cellR + offset.dr;
                  const expectedTopLeftC = cellC + offset.dc;
                  
                  let matches = false;
                  
                  // Check primary offset
                  if (expectedTopLeftR === r && expectedTopLeftC === c) {
                    matches = true;
                  }
                  
                  // For 1x4/4x1 with 'middle' edge, check alternative offset
                   if (!matches && offset.alternative && cell.edge === 'middle') {
                     const altR = cellR + offset.alternative.dr;
                     const altC = cellC + offset.alternative.dc;
                     if (altR === r && altC === c) {
                       matches = true;
                     }
                   }
                  
                  if (matches) {
                    edgeMatchScore += 1000; // Strong edge match
                  } else {
                    valid = false; // Edge constraint violation
                    break;
                  }
                }
              }
            }
            if (!valid) break;
          }

          if (valid) {
            let probabilityValue = 1;
            if (hitScore > 0) probabilityValue += (hitScore * 100);
            if (edgeMatchScore > 0) probabilityValue += edgeMatchScore;
            
            for (let dr = 0; dr < h; dr++) {
              for (let dc = 0; dc < w; dc++) {
                if (!board[r + dr][c + dc].revealed) {
                  probs[r + dr][c + dc] += probabilityValue;
                }
              }
            }
          }
        }
      }
    });

    return probs;
  }, [board, hits, units, discoveredUnits, boardHeight, boardWidth]);

  // --- Interaction ---

  const bestMove = useMemo(() => {
    if (!probabilities) return null;
    let max = -1;
    let best = null;
    for(let r=0; r<boardHeight; r++){
      for(let c=0; c<boardWidth; c++){
        if(!board[r][c].revealed && probabilities[r][c] > max){
          max = probabilities[r][c];
          best = {r,c};
        }
      }
    }
    return best;
  }, [probabilities, board]);

  const recordResult = (isHit, color = null, edge = null) => {
    if (!selectedCell) return;
    const { r, c } = selectedCell;
    
    const newBoard = board.map(row => row.map(cell => ({ ...cell })));
    newBoard[r][c] = { revealed: true, isHit, color, edge };
    
    setBoard(newBoard);
    setHitCount(c => c + 1);
    
    if (isHit) {
      setHits([...hits, { r, c, color, edge }]);
    }
    setSelectedCell(null);
  };

  const handleCellClick = (r, c) => {
    if (board[r][c].revealed) return;
    setSelectedCell({ r, c });
  };

  const activeColors = useMemo(() => [...new Set(units.map(u => u.color))], [units]);

  const getMaxProbability = () => {
    if (!probabilities) return 1;
    let max = 0;
    probabilities.forEach(row => row.forEach(val => { if(val > max) max = val; }));
    return max || 1;
  };
  const maxProb = getMaxProbability();

  const getHeatColor = (val) => {
    if (val === 0) return 'rgb(243, 244, 246)'; 
    const ratio = Math.min(val / (maxProb * 0.8), 1); 
    const r = 255;
    const g = Math.floor(255 * (1 - ratio));
    const b = Math.floor(255 * (1 - ratio));
    return `rgb(${r},${g},${b})`;
  };

  if (gameState === 'setup') {
    return (
      <div className="p-6 max-w-2xl mx-auto bg-white rounded-xl shadow-md font-sans">
        <h1 className="text-2xl font-bold mb-6 text-center text-gray-800">Solver Setup</h1>
        
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Height</label>
            <input type="number" min="4" max="15" value={boardHeight} onChange={e => setBoardHeight(Number(e.target.value))} 
              className="w-full border rounded p-2" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Width</label>
            <input type="number" min="4" max="15" value={boardWidth} onChange={e => setBoardWidth(Number(e.target.value))} 
              className="w-full border rounded p-2" />
          </div>
        </div>

        <div className="mb-6">
          <p className="text-sm font-semibold text-gray-700 mb-2">Add Units</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(UNITS).map(([k, u]) => (
              <button key={k} onClick={() => addUnit(k)} 
                className="px-3 py-2 rounded text-white text-sm font-medium shadow-sm hover:opacity-90 transition-opacity"
                style={{ backgroundColor: u.color }}>
                + {u.name}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-8">
          <p className="text-sm font-semibold text-gray-700 mb-2">Active Units ({units.length})</p>
          {units.length === 0 ? <p className="text-gray-400 text-sm italic">No units added</p> : 
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {units.map(u => (
              <div key={u.id} className="flex items-center justify-between bg-gray-50 p-2 rounded border">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded-full" style={{ backgroundColor: UNITS[u.color].color }}></div>
                  <span className="text-sm font-medium text-gray-700">{UNITS[u.color].name}</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => toggleOrientation(u.id)} 
                    disabled={u.color === 'purple'}
                    className="flex items-center gap-1 text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded hover:bg-blue-200 disabled:opacity-50 disabled:cursor-not-allowed">
                    <RotateCw size={12} /> {u.orientation}
                  </button>
                  <button onClick={() => removeUnit(u.id)} 
                    className="text-red-500 hover:text-red-700 p-1">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          }
        </div>

        <button onClick={startGame} disabled={units.length === 0}
          className="w-full bg-indigo-600 text-white py-3 rounded-lg font-bold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed">
          Start Solving
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-6xl mx-auto font-sans">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Vault Solver</h1>
          <p className="text-sm text-gray-500">
            {discoveredUnits.length} / {units.length} units found • {hitCount} attempts
          </p>
          {discoveredUnits.length === units.length && units.length > 0 && (
            <p className="text-sm font-semibold text-green-600 mt-1">
              🎉 All units found in {hitCount} attempts!
            </p>
          )}
        </div>
        <button onClick={resetGame} className="flex items-center gap-2 text-red-600 hover:bg-red-50 px-3 py-2 rounded transition-colors">
          <Trash2 size={18} /> Reset
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
        {/* Board Section */}
        <div className="md:col-span-7 lg:col-span-8 flex flex-col items-center">
          <div className="bg-white p-4 rounded-xl shadow-sm border inline-block">
            {board.map((row, r) => (
              <div key={r} className="flex">
                {row.map((cell, c) => {
                  const prob = probabilities ? probabilities[r][c] : 0;
                  const isSelected = selectedCell?.r === r && selectedCell?.c === c;
                  const isSuggested = bestMove?.r === r && bestMove?.c === c;
                  
                  return (
                    <div key={c} onClick={() => handleCellClick(r, c)}
                      className={`
                        w-12 h-12 md:w-14 md:h-14 border border-gray-200 relative cursor-pointer
                        transition-all duration-200
                        ${isSelected ? 'ring-2 ring-indigo-500 z-10' : 'hover:brightness-95'}
                      `}
                      style={{ 
                        backgroundColor: cell.revealed 
                          ? (cell.isHit ? (cell.color ? UNITS[cell.color].color : '#4b5563') : '#f3f4f6')
                          : getHeatColor(prob)
                      }}
                    >
                      {cell.revealed && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          {cell.isHit ? (
                            <div className="w-3 h-3 bg-white rounded-full shadow-sm" />
                          ) : (
                            <span className="text-gray-400 font-light text-xl">×</span>
                          )}
                        </div>
                      )}
                      
                      {!cell.revealed && isSuggested && (
                        <div className="absolute inset-0 flex items-center justify-center animate-pulse">
                          <Target className="text-indigo-600 drop-shadow-md" size={32} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          
          {bestMove && (
            <div className="mt-4 flex items-center gap-2 text-indigo-700 bg-indigo-50 px-4 py-2 rounded-full font-medium animate-bounce">
              <Target size={18} />
              Suggestion: Row {bestMove.r + 1}, Col {bestMove.c + 1}
            </div>
          )}
        </div>

        {/* Controls Section */}
        <div className="md:col-span-5 lg:col-span-4 space-y-4">
          
          {/* Action Card */}
          {selectedCell ? (
            <div className="bg-white rounded-xl shadow-lg border border-indigo-100 overflow-hidden">
              <div className="bg-indigo-50 p-3 border-b border-indigo-100 flex justify-between items-center">
                <span className="font-semibold text-indigo-900">Cell ({selectedCell.r + 1}, {selectedCell.c + 1})</span>
                <button onClick={() => setSelectedCell(null)} className="text-gray-400 hover:text-gray-600">✕</button>
              </div>
              <div className="p-4 space-y-3">
                <button onClick={() => recordResult(false)}
                  className="w-full py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-lg transition-colors">
                  Miss / Empty
                </button>
                <div className="relative">
                  <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200"></div></div>
                  <div className="relative flex justify-center text-xs uppercase"><span className="bg-white px-2 text-gray-400">or hit</span></div>
                </div>
                
                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                  {activeColors.map(color => {
                    const unitDef = UNITS[color];
                    const relevantUnits = units.filter(u => u.color === color);
                    const orientations = [...new Set(relevantUnits.map(u => u.orientation))];

                    return (
                      <div key={color} className="border rounded-lg overflow-hidden">
                        <div className="bg-gray-50 px-3 py-2 text-sm font-semibold flex items-center gap-2"
                             style={{borderLeft: `4px solid ${unitDef.color}`}}>
                           {unitDef.name}
                        </div>
                        <div className="p-2 space-y-2">
                           {orientations.map(orient => {
                             const edges = getValidEdges(unitDef, orient);
                             return (
                               <div key={orient}>
                                 <div className="text-xs text-gray-500 mb-1 ml-1">{orient === 'H' ? 'Horizontal' : 'Vertical'} Options</div>
                                 <div className="grid grid-cols-3 gap-1">
                                   {edges.map(edge => (
                                     <button key={edge} onClick={() => recordResult(true, color, edge)}
                                      className="px-1 py-1.5 text-xs bg-white border hover:bg-blue-50 hover:border-blue-200 text-gray-700 rounded transition-colors capitalize truncate"
                                      title={edge}>
                                       {edge.replace('middle-', 'mid-')}
                                     </button>
                                   ))}
                                 </div>
                               </div>
                             );
                           })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border p-6 text-center text-gray-500">
              <Target size={48} className="mx-auto mb-3 text-gray-300" />
              <p>Click a cell on the board<br/>to record a hit or miss</p>
            </div>
          )}

          {/* Unit Status */}
          <div className="bg-white rounded-xl shadow-sm border p-4">
            <h3 className="font-semibold text-gray-800 mb-3 text-sm uppercase tracking-wider">Remaining Targets</h3>
            <div className="space-y-2">
              {units.map((unit) => {
                const isFound = discoveredUnits.some(d => d.id === unit.id);
                return (
                  <div key={unit.id} className={`flex items-center gap-3 p-2 rounded ${isFound ? 'bg-green-50' : 'bg-gray-50'}`}>
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: UNITS[unit.color].color }}></div>
                    <div className="flex-1 text-sm">
                      <span className={`font-medium ${isFound ? 'text-green-700 line-through' : 'text-gray-700'}`}>
                        {UNITS[unit.color].name}
                      </span>
                      <span className="text-xs text-gray-500 ml-2">({unit.orientation})</span>
                    </div>
                    {isFound && <CheckCircle size={16} className="text-green-600" />}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}