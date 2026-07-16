import React, { useState, useRef, useEffect } from 'react';
import { collection, getDocs, doc, writeBatch, serverTimestamp, onSnapshot } from '../../lib/store';
import { db } from '../../lib/firebase';
import { ArrowRight } from 'lucide-react';
import { cn } from '../../lib/utils';
import Confetti from 'react-confetti';
import { useWindowSize } from 'react-use';
import { mergeWithDefaultTop10 } from '../../lib/prizeDefaults';

const normalizeParticipantName = (value: unknown) => String(value ?? '').trim().toLowerCase();
const normalizeDocIdName = (value: unknown) => {
  const raw = String(value ?? '');
  try {
    return normalizeParticipantName(decodeURIComponent(raw));
  } catch {
    return normalizeParticipantName(raw);
  }
};

export function LiveDraw() {
  const [prizes, setPrizes] = useState<any[]>([]);
  const [drawnPrizeIds, setDrawnPrizeIds] = useState<string[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [currentPrizeIndex, setCurrentPrizeIndex] = useState(0);
  
  const [drawing, setDrawing] = useState(false);
  const [winner, setWinner] = useState<{ name: string; department: string } | null>(null);
  const [revealed, setRevealed] = useState(false); // Used to show next button
  
  // Audio Refs
  const drumrollRef = useRef<HTMLAudioElement>(null);
  const victoryRef = useRef<HTMLAudioElement>(null);
  const { width, height } = useWindowSize();

  // Load prizes configuration
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'Config_Prizes'), (snap) => {
      const incoming: Record<number, any> = {};
      snap.forEach(d => {
        incoming[parseInt(d.id, 10)] = d.data();
      });
      const merged = mergeWithDefaultTop10(incoming);
      const pmap: any[] = Object.entries(merged).map(([slot, data]) => ({
        _id: parseInt(slot, 10),
        originalId: slot,
        ...data,
      }));
      // Filter to only include the Top 10 prizes, then sort by id descending (10 down to 1)
      const top10Prizes = pmap.filter((p: any) => p._id >= 1 && p._id <= 10);
      top10Prizes.sort((a: any, b: any) => b._id - a._id);
      setPrizes(top10Prizes);
    });
    return () => unsub();
  }, []);

  // Track Drawn Prizes from Audit Log
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'Audit_Log'), (snap) => {
      const drawn: string[] = [];
      const logs: any[] = [];
      snap.forEach(d => {
        const data = d.data();
        // Keep track of any prize that has already recorded a 'Won' status
        // Only track exact prizeNumber matches (e.g. "Prize #05"), ignore "Bulk Draw #5"
        if (data.status === 'Won' && data.prizeNumber) {
           drawn.push(String(data.prizeNumber));
           logs.push(data);
        }
      });
      
      logs.sort((a,b) => {
          const aMatch = String(a.prizeNumber).match(/\d+/);
          const bMatch = String(b.prizeNumber).match(/\d+/);
          const aId = aMatch ? parseInt(aMatch[0], 10) : 0;
          const bId = bMatch ? parseInt(bMatch[0], 10) : 0;
          // Sort such that 1 is first, 10 is last if we want top to bottom, 
          // or 1 is at top. Let's do aId - bId (ascending) 
          return aId - bId;
      });

      setDrawnPrizeIds(drawn);
      setAuditLogs(logs);
    });
    return () => unsub();
  }, []);

  // Check if Prize #1 has been drawn
  const isPrize1Drawn = drawnPrizeIds.some(id => {
    const match = String(id).match(/\d+/);
    return match && parseInt(match[0], 10) === 1;
  });

  // Compute the current available prize
  // Find the first prize in the sorted array that does NOT have an exact match in drawnPrizeIds
  const activeUnDrawnPrizeIndex = isPrize1Drawn ? -1 : prizes.findIndex(p => !drawnPrizeIds.includes(String(p.prizeNumber)));
  
  // Update the lock index only when we are NOT in the middle of a draw/reveal 
  useEffect(() => {
     if (!winner && !drawing) {
        setCurrentPrizeIndex(activeUnDrawnPrizeIndex);
     }
  }, [activeUnDrawnPrizeIndex, winner, drawing]);

  const handleDraw = async () => {
    if (!prizes[currentPrizeIndex]) return;
    
    // Start drumroll sound using web audio API
    if (drumrollRef.current) {
       drumrollRef.current.currentTime = 0;
       drumrollRef.current.play().catch(console.error);
    }
    // "Unlock" the victory audio on first interaction so it can play asynchronously later
    if (victoryRef.current) {
       victoryRef.current.play().then(() => {
          if (victoryRef.current) {
             victoryRef.current.pause();
             victoryRef.current.currentTime = 0;
          }
       }).catch(() => {}); // ignore errors for this silent unlock
    }

    setDrawing(true);

    try {
      // 1. Pick a random winner
      const snap = await getDocs(collection(db, 'Eligible_Pool'));
      const allDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const winnerRegistrySnap = await getDocs(collection(db, 'Winner_Registry'));
      const winnerRegistrySet = new Set(
        winnerRegistrySnap.docs.map(d => normalizeDocIdName(d.id))
      );
      const wonNameSet = new Set(
        auditLogs
          .filter(log => log.status === 'Won' && log.name)
          .map(log => normalizeParticipantName(log.name))
      );
      const poolCandidates = allDocs.filter((participant: any) => {
        const normalizedName = normalizeParticipantName(participant.name);
        return normalizedName && !wonNameSet.has(normalizedName);
      });
      let eligibleDocs = poolCandidates.filter((participant: any) => {
        const normalizedName = normalizeParticipantName(participant.name);
        return !winnerRegistrySet.has(normalizedName);
      });

      // Fallback for fresh-event uploads: stale winner registry should not block
      // a non-empty eligible pool when current audit history has no conflict.
      if (eligibleDocs.length === 0 && poolCandidates.length > 0) {
        eligibleDocs = poolCandidates;
      }
      
      if (eligibleDocs.length === 0) {
        alert("No eligible participants left in the pool.");
        if (drumrollRef.current) drumrollRef.current.pause();
        setDrawing(false);
        return;
      }
      
      const randomIdx = Math.floor(Math.random() * eligibleDocs.length);
      const selected = eligibleDocs[randomIdx] as any;
      const selectedNormalizedName = normalizeParticipantName(selected.name);
      
      const batch = writeBatch(db);

      // 2. Eradicate all instances of this name in pool
      allDocs.forEach((entry: any) => {
        if (normalizeParticipantName(entry.name) === selectedNormalizedName) {
          batch.delete(doc(db, 'Eligible_Pool', entry.id));
        }
      });

      // 3. Log into Audit_Log
      const prizeObj = prizes[currentPrizeIndex];
      const auditRef = doc(collection(db, 'Audit_Log'));
      batch.set(auditRef, {
        name: selected.name,
        department: selected.department,
        nameKey: selectedNormalizedName,
        prize: prizeObj.prizeName,
        prizeNumber: prizeObj.prizeNumber,
        status: 'Won',
        timestamp: serverTimestamp()
      });

      const winnerRegistryRef = doc(db, 'Winner_Registry', selectedNormalizedName);
      batch.set(winnerRegistryRef, {
        name: selected.name,
        nameKey: selectedNormalizedName,
        wonAt: serverTimestamp(),
        source: 'LiveDraw'
      }, { merge: true });

      await batch.commit();

      setWinner({ name: selected.name, department: selected.department });
      
    } catch (err: any) {
      if (drumrollRef.current) drumrollRef.current.pause();
      alert(`Draw Error: ${err.message}`);
    } finally {
      setDrawing(false);
    }
  };

  const nextPrize = () => {
    setWinner(null);
    setRevealed(false);
    
    // Stop all audio on next
    if (drumrollRef.current) {
       drumrollRef.current.pause();
       drumrollRef.current.currentTime = 0;
    }
  };

  const handleReveal = () => {
     setRevealed(true);
     if (drumrollRef.current) {
        drumrollRef.current.pause();
     }
     if (victoryRef.current) {
        victoryRef.current.currentTime = 0;
        victoryRef.current.play().catch(console.error);
     }
  };

  const currentPrize = prizes[currentPrizeIndex];

  return (
    <div className="relative h-screen overflow-hidden flex flex-col font-sans text-on-surface bg-background select-none">
      
      {/* Background with Stars */}
      <div className="absolute inset-0 z-0 bg-background star-bg opacity-60"></div>
      
      {/* Twinkling Stars */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        {Array.from({ length: 40 }).map((_, i) => (
          <div
            key={`twinkle-${i}`}
            className="twinkling-star"
            style={{
              top: `${Math.random() * 100}%`,
              left: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 3}s`,
              transform: `scale(${Math.random() * 0.8 + 0.4})`
            }}
          ></div>
        ))}
      </div>

      {/* Shooting Stars */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="shooting-star" style={{ top: '10%', right: '-10%', animationDuration: '4s', animationDelay: '0s' }}></div>
        <div className="shooting-star" style={{ top: '30%', right: '-5%', animationDuration: '5s', animationDelay: '1.5s' }}></div>
        <div className="shooting-star" style={{ top: '60%', right: '-20%', animationDuration: '3.5s', animationDelay: '3s' }}></div>
        <div className="shooting-star" style={{ top: '20%', right: '10%', animationDuration: '4.5s', animationDelay: '2s' }}></div>
        <div className="shooting-star" style={{ top: '80%', right: '-15%', animationDuration: '6s', animationDelay: '0.5s' }}></div>
      </div>
      
      <audio ref={drumrollRef} src="https://assets.mixkit.co/sfx/preview/mixkit-drum-roll-566.mp3" preload="auto" loop></audio>
      <audio ref={victoryRef} src="https://assets.mixkit.co/sfx/preview/mixkit-winning-chimes-2015.mp3" preload="auto"></audio>

      {/* Deep denim blue atmospheric lighting */}
      <div className="absolute inset-0 z-0 pointer-events-none" style={{ background: 'linear-gradient(180deg, rgba(255, 225, 53, 0.05) 0%, transparent 100%)' }}></div>

      {revealed && <Confetti width={width} height={height} recycle={false} numberOfPieces={800} colors={['#ffe135', '#b6c4ff', '#fffdff', '#28418e']} gravity={0.2} />}

      <main className="relative z-10 flex-grow flex flex-col items-center justify-center pt-4 pb-[8vh] px-8 w-full h-full gap-[1.5vh]">
        
        {/* Top Header */}
        <div className="text-center w-full shrink-0 z-10">
          {currentPrize && !winner ? (
            <h1 className="font-display font-black text-primary-container text-glow-sm uppercase leading-tight tracking-wide" style={{ fontSize: 'clamp(4rem, 8vw, 8rem)' }}>
              {currentPrize._id === 1 ? 'GRAND PRIZE' : `PRIZE #${String(currentPrize._id).padStart(2, '0')}`}
            </h1>
          ) : winner ? (
             <h1 className="font-display font-bold text-primary drop-shadow-md leading-tight tracking-wide" style={{ fontSize: 'clamp(2rem, 3vw, 3.5rem)' }}>
               CPFB FAMILY DAY 2026 LUCKY DRAW:
               <br />
               <span className="text-primary-container text-glow-sm">EXCLUSIVE EVENING @ USS</span>
             </h1>
          ) : (
            <div className="animate-in fade-in slide-in-from-top-4 duration-1000 delay-100">
              <p className="font-sans text-inverse-surface leading-relaxed max-w-6xl mx-auto drop-shadow-md" style={{ fontSize: 'clamp(1.2rem, 1.8vw, 2.2rem)' }}>
                Congratulations to the top 10 winners! For the rest, you still have a chance to win something, watch out for our next announcement in Colby! Please enjoy the rides and starry night with your family!
                <br/>
                <span className="text-primary-container mt-2 inline-block font-bold tracking-wide drop-shadow-lg" style={{ fontSize: 'clamp(1.8rem, 2.5vw, 3rem)' }}>With love, your #CPFBFD2026 Committee ❤️</span>
              </p>
            </div>
          )}
        </div>

        {/* Center Canvas / Prize Area */}
        {!winner ? (
           <>
            {currentPrize ? (
              <div className="flex flex-col items-center justify-center w-full flex-grow gap-[2vh] z-10">
                <div 
                  className="relative rounded-[24px] overflow-hidden bg-black/40 border-[4px] border-primary-container transition-shadow duration-300 mx-auto z-10 flex-shrink-0"
                  style={{ height: '40vh', width: 'auto', aspectRatio: '16/9', maxWidth: '100%', boxShadow: '0 0 60px rgba(255, 213, 79, 0.5), inset 0 0 20px rgba(255, 213, 79, 0.2)' }}
                >
                  <img 
                    src={currentPrize.imageUrl} 
                    alt={currentPrize.prizeName} 
                    className="w-full h-full object-cover object-center opacity-100 drop-shadow-2xl" 
                  />
                  <div className="absolute inset-0 rounded-[20px] bg-gradient-to-t from-[rgba(17,20,23,0.4)] via-transparent to-transparent pointer-events-none"></div>
                </div>
                
                <div className="flex flex-col items-center text-center mt-[1vh] z-10">
                    <span className="font-display font-black tracking-wide text-primary-container uppercase px-4 leading-none" style={{ fontSize: 'clamp(3rem, 5vw, 6rem)', textShadow: '0 4px 20px rgba(0,0,0,0.8), 0 0 10px rgba(255,213,79,0.3)' }}>
                      {currentPrize.prizeName || 'Prize'}
                    </span>
                    {currentPrize.prizeDescription && (
                      <span className="font-sans font-bold tracking-widest text-primary uppercase mt-2 px-8" style={{ fontSize: 'clamp(1.2rem, 2vw, 2.5rem)', textShadow: '0 2px 10px rgba(0,0,0,0.8)' }}>
                        {currentPrize.prizeDescription}
                      </span>
                    )}
                </div>
              </div>
            ) : (
              <div className="w-[85vw] max-w-[1400px] flex-grow bg-surface-container/80 backdrop-blur-md rounded-xl border border-outline/30 p-6 flex flex-col mx-auto animate-breathing-glow shadow-[0_0_40px_rgba(255,213,79,0.2)] flex-shrink-0 mt-2 mb-2 min-h-0 z-10">
                {auditLogs.length > 0 ? (
                  <>
                    <div className="overflow-visible w-full h-full grid grid-cols-2 grid-rows-5 grid-flow-col gap-4 items-center">
                      {auditLogs.map((log, i) => {
                        return (
                          <div key={i} className="bg-surface-container-highest/60 backdrop-blur-md border border-outline-variant/50 rounded-lg py-2 px-6 flex flex-col items-center justify-center text-center shadow-lg hover:border-primary-container/50 hover:shadow-[0_0_20px_rgba(255,213,79,0.3)] transition-all hover:scale-[1.02] h-full justify-between">
                            <span className="font-mono text-primary-fixed uppercase tracking-widest font-bold text-sm bg-primary-container/10 border border-primary-container/30 px-4 py-0.5 rounded-full mb-1 shadow-inner">
                              {log.prizeNumber}
                            </span>
                            <h3 className="font-display font-black tracking-wide text-primary-container uppercase leading-tight text-glow-sm truncate w-full flex-grow flex items-center justify-center" style={{ fontSize: 'clamp(1.4rem, 2.2vw, 2.8rem)' }}>
                              {log.name}
                            </h3>
                            <p className="text-on-surface-variant font-sans font-bold tracking-wide truncate w-full mt-1 uppercase" style={{ fontSize: 'clamp(0.9rem, 1.1vw, 1.3rem)' }}>
                              {log.department}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div className="flex-grow flex items-center justify-center font-display text-primary-container" style={{ fontSize: 'clamp(1.5rem, 4vw, 3.5rem)' }}>
                    All Prizes Configuration missing or completed!
                  </div>
                )}
              </div>
            )}

            {/* Bottom: Draw Winner Button */}
            {currentPrize && (
               <div className="mt-8 shrink-0 animate-in zoom-in duration-500 z-10">
                 <button 
                   onClick={handleDraw}
                   disabled={drawing}
                   className="bg-primary-container text-on-primary-container font-display font-black uppercase rounded-[24px] transition-all duration-300 hover:-translate-y-2 hover:scale-105 active:scale-95 border-[4px] border-surface shadow-[0_0_40px_rgba(255,213,79,0.6)] hover:shadow-[0_0_80px_rgba(255,213,79,0.9)] disabled:opacity-50 disabled:hover:scale-100 disabled:hover:translate-y-0 disabled:hover:shadow-[0_0_40px_rgba(255,213,79,0.6)] tracking-wide group"
                   style={{ fontSize: 'clamp(2rem, 4vw, 3.5rem)', padding: '12px 64px' }}
                 >
                   <span className="inline-block transition-transform duration-300 group-hover:scale-110">{drawing ? 'SHUFFLING...' : 'DRAW WINNER!'}</span>
                 </button>
               </div>
            )}
          </>
        ) : (
          <div className="w-full flex flex-col items-center gap-[3vh] mx-auto z-10" style={{ maxWidth: '1400px' }}>
             {/* Scratch Card Area */}
             <div className="relative">
                 {/* Decorative elements around the scratch card could be placed here if needed */}
                 <div 
                   className="relative w-[80vw] rounded-[16px] overflow-hidden bg-surface border-[4px] border-primary-container flex-shrink-0"
                   style={{ maxWidth: '1000px', aspectRatio: '16/9', maxHeight: '50vh', boxShadow: '0 0 60px rgba(255, 213, 79, 0.4), inset 0 0 20px rgba(255, 213, 79, 0.2)' }}
                 >
                    {/* Revealed State */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center p-[4vw] text-center bg-surface-container-low" style={{ background: 'radial-gradient(circle at center, #1a2851 0%, #011039 100%)' }}>
                       <span className="font-mono text-primary-fixed uppercase tracking-widest font-bold mb-2 animate-in zoom-in duration-500" style={{ fontSize: '1.2vw' }}>
                          WINNER
                       </span>
                       <h2 className="font-display font-black text-primary-container text-glow leading-tight tracking-wide animate-in zoom-in duration-700 uppercase" style={{ fontSize: 'clamp(3rem, 5vw, 6rem)', textShadow: '0 4px 15px rgba(0,0,0,0.8), 0 0 25px rgba(255,213,79,0.5)' }}>
                          {winner.name}
                       </h2>
                       <p className="font-sans text-on-surface mt-[1.5vh] font-bold tracking-widest uppercase animate-in fade-in slide-in-from-bottom-4 duration-1000 delay-300" style={{ fontSize: 'clamp(1.2rem, 2vw, 2.2rem)', textShadow: '0 2px 8px rgba(0,0,0,0.8)' }}>
                          {winner.department}
                       </p>
                    </div>
                    
                    {/* Scratch Canvas */}
                    <ScratchCardCanvas onReveal={handleReveal} />
                 </div>
             </div>

             {/* Next Prize Action */}
             {revealed && (
                 <div className="animate-in fade-in slide-in-from-bottom-4 duration-1000 z-20 mt-[2vh]">
                    <button 
                       onClick={nextPrize}
                       className="bg-primary-container text-on-primary-container font-display font-bold uppercase rounded-[24px] transition-all duration-300 hover:-translate-y-2 hover:scale-105 active:scale-95 shadow-[0_0_30px_rgba(255,213,79,0.3)] hover:shadow-[0_0_60px_rgba(255,213,79,0.6)] flex items-center justify-center tracking-wide"
                       style={{ fontSize: 'clamp(1.5rem, 2.5vw, 2.5rem)', padding: '16px 48px' }}
                    >
                       NEXT DRAW
                    </button>
                 </div>
             )}
          </div>
        )}

      </main>

      {/* Footer */}
      <div className="absolute bottom-2 left-0 w-full text-center z-10 pointer-events-none opacity-50">
         <p className="font-sans text-on-surface text-xs tracking-wider">© 2026 CPFB FAMILY DAY. All rights reserved. #CPFBFamilyDay2026</p>
      </div>
    </div>
  );
}

// Separate component for the HTML5 Canvas Scratch Logic
function ScratchCardCanvas({ onReveal }: { onReveal: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [lastPos, setLastPos] = useState<{x: number, y: number} | null>(null);
  const strokeCountRef = useRef(0);
  const STROKES_TO_REVEAL = 2;

  const revealCard = () => {
    if (cleared) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.style.transition = 'opacity 0.5s ease-out';
    canvas.style.opacity = '0';
    setCleared(true);
    setTimeout(() => {
      onReveal();
    }, 500);
  };
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // High DPI Canvas setup
    const rect = canvas.parentElement!.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    // Fill with metallic silver gradient
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, '#A0A0A0');
    gradient.addColorStop(0.3, '#E8E8E8');
    gradient.addColorStop(0.5, '#C0C0C0');
    gradient.addColorStop(0.7, '#E8E8E8');
    gradient.addColorStop(1, '#A0A0A0');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Add noise texture for realistic scratch card look
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    for (let i = 0; i < 3000; i++) {
       ctx.fillRect(Math.random() * canvas.width, Math.random() * canvas.height, 2, 2);
    }
    ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
    for (let i = 0; i < 3000; i++) {
       ctx.fillRect(Math.random() * canvas.width, Math.random() * canvas.height, 3, 3);
    }
    
    // Add text on top of foil.
    const revealText = "SCRATCH TO REVEAL!";
    // Start from a height-based size, then shrink it so the full text fits the
    // card width (prevents clipping on narrower screens like iPad Mini).
    let fontSize = rect.height * 0.18;
    ctx.font = `900 ${fontSize}px "Spline Sans", sans-serif`;
    const maxTextWidth = canvas.width * 0.85;
    const measuredWidth = ctx.measureText(revealText).width;
    if (measuredWidth > maxTextWidth) {
      fontSize = fontSize * (maxTextWidth / measuredWidth);
      ctx.font = `900 ${fontSize}px "Spline Sans", sans-serif`;
    }
    ctx.fillStyle = '#FFD54F'; // primary-container

    // Add a black outline/shadow to make it pop and look like the mockup
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 15;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 4;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(revealText, canvas.width / 2, canvas.height / 2);
    
    // Reset shadow for further operations just in case
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    ctx.globalCompositeOperation = 'destination-out';
  }, []);

  const getPointerPos = (e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;

    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = (e as React.MouseEvent).clientX;
      clientY = (e as React.MouseEvent).clientY;
    }

    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height)
    };
  };

  const handlePointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    if (cleared) return;
    setIsDrawing(true);
    const canvas = canvasRef.current;
    if (!canvas) return;

    strokeCountRef.current += 1;
    if (strokeCountRef.current >= STROKES_TO_REVEAL) {
      revealCard();
      return;
    }

    const pos = getPointerPos(e, canvas);
    setLastPos(pos);
    scratch(pos, pos);
  };

  const handlePointerMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pos = getPointerPos(e, canvas);
    if (lastPos) {
      scratch(lastPos, pos);
    }
    setLastPos(pos);
  };

  const handlePointerUp = () => {
    setIsDrawing(false);
    setLastPos(null);
    checkReveal();
  };

  const scratch = (from: {x: number, y: number}, to: {x: number, y: number}) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = 100; // Size of the "coin" scratching
    
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  };

  const checkReveal = () => {
    if (cleared) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let transparentPixels = 0;
    
    // Check alpha channel for transparency
    for (let i = 3; i < imageData.data.length; i += 4) {
      if (imageData.data[i] === 0) {
        transparentPixels++;
      }
    }
    
    const totalPixels = imageData.data.length / 4;
    const percentCleared = (transparentPixels / totalPixels) * 100;

    if (percentCleared > 50) {
      // Auto clear the rest
      revealCard();
    }
  };

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 w-full h-full touch-none ${cleared ? 'pointer-events-none' : 'cursor-crosshair'}`}
      onMouseDown={handlePointerDown}
      onMouseMove={handlePointerMove}
      onMouseUp={handlePointerUp}
      onMouseLeave={handlePointerUp}
      onTouchStart={handlePointerDown}
      onTouchMove={handlePointerMove}
      onTouchEnd={handlePointerUp}
    />
  );
}
