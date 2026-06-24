import { useState, useEffect } from 'react';
import { collection, query, where, getDocs, doc, writeBatch, orderBy, limit, addDoc, serverTimestamp } from '../../lib/store';
import { db } from '../../lib/firebase';
import { Users, AlertTriangle, PlayCircle, Loader2 } from 'lucide-react';
import Papa from 'papaparse';

export function BulkDraw() {
  const [prizes, setPrizes] = useState<Record<string, any>>({});
  const [bulkCount, setBulkCount] = useState<string>('');
  const [bulkStartPrizeNumber, setBulkStartPrizeNumber] = useState<string>('11');
  const [selectedPrizeForRedraw, setSelectedPrizeForRedraw] = useState<string>('');
  const [confirmRedraw, setConfirmRedraw] = useState(false);
  const [runningBulk, setRunningBulk] = useState(false);
  const [runningRedraw, setRunningRedraw] = useState(false);
  const [poolSize, setPoolSize] = useState(0);

  // Load prizes and pool size
  useEffect(() => {
    const fetchInitialData = async () => {
      const pSnap = await getDocs(collection(db, 'Config_Prizes'));
      const pmap: Record<string, any> = {};
      pSnap.forEach(d => pmap[d.id] = d.data());
      setPrizes(pmap);

      // Note: Getting full count via getDocs might be slow for huge pools, 
      // but fine for <100k records if we just need length. 
      // Firestore count() is better but not exposed simply in this SDK version without aggregation queries, we'll use getDocs for now.
      const poolSnap = await getDocs(collection(db, 'Eligible_Pool'));
      setPoolSize(poolSnap.size);
    };
    fetchInitialData();
  }, []);

  const getRandomWinners = async (count: number) => {
    // In a real production setup with millions of rows, we'd use a different random approach.
    // Here we fetch all and pick randomly, which is fine for typical company events (thousands of rows).
    const snap = await getDocs(collection(db, 'Eligible_Pool'));
    const allDocs = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
    
    if (allDocs.length === 0) throw new Error("Pool is empty!");
    
    // We need unique names for winners
    // Shuffle allDocs
    for (let i = allDocs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allDocs[i], allDocs[j]] = [allDocs[j], allDocs[i]];
    }

    const uniqueWinners = [];
    const usedNames = new Set();
    
    for (const doc of allDocs) {
      if (!usedNames.has(doc.name)) {
        uniqueWinners.push(doc);
        usedNames.add(doc.name);
        if (uniqueWinners.length === count) break;
      }
    }

    if (uniqueWinners.length < count) {
       console.warn("Could only find", uniqueWinners.length, "unique winners");
    }
    
    return uniqueWinners;
  };

  const removeAllEntriesByName = async (batch: any, name: string) => {
    // According to requirements: App MUST query the 'Eligible_Pool' and delete ALL documents matching that exact 'Name'.
    const q = query(collection(db, 'Eligible_Pool'), where('name', '==', name));
    const snap = await getDocs(q);
    snap.forEach(d => {
      batch.delete(doc(db, 'Eligible_Pool', d.id));
    });
  };

  const runBulkDraw = async () => {
    const count = parseInt(bulkCount);
    if (!count || count <= 0) return alert("Please enter a valid number");
    if (count > poolSize) return alert("Requested more winners than pool size.");
    
    setRunningBulk(true);
    try {
      const winners = await getRandomWinners(count);
      
      const batch = writeBatch(db);
      const csvData = [];
      const csvTimestamp = new Date();

      for (let i = 0; i < winners.length; i++) {
        const w = winners[i];
        
        // Use user's starting number, eg 16, resulting in "Prize #16"
        const winnerNumber = parseInt(bulkStartPrizeNumber) + i;
        const prizeLabel = `Prize #${winnerNumber.toString().padStart(2, '0')}`;
        
        // Queue removal of all documents for this name
        await removeAllEntriesByName(batch, w.name);
        
        // Add Audit Log
        const auditRef = doc(collection(db, 'Audit_Log'));
        batch.set(auditRef, {
          name: w.name,
          department: w.department,
          prize: 'Bulk Entry',
          prizeNumber: prizeLabel,
          status: 'Won',
          timestamp: serverTimestamp()
        });

        csvData.push({
           Name: w.name,
           Department: w.department,
           Prize: 'Bulk Entry',
           PrizeNumber: prizeLabel
        });
      }

      await batch.commit();

      // Download CSV
      const csv = Papa.unparse(csvData);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `bulk_draw_winners_${csvTimestamp.toISOString()}.csv`;
      link.click();

      setPoolSize(prev => prev - winners.length); // optimistic update
      alert(`Successfully drew ${winners.length} winners.`);
      setBulkCount('');
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setRunningBulk(false);
    }
  };

  const runEmergencyRedraw = async () => {
    if (!selectedPrizeForRedraw) return alert("Please select a prize.");
    if (!confirmRedraw) return alert("Please confirm the redraw authorization.");

    setRunningRedraw(true);
    try {
      const prizeIdStr = selectedPrizeForRedraw;
      const prizeObj = prizes[prizeIdStr];
      const prizeNumStr = `Prize #${prizeIdStr.padStart(2, '0')}`;

      // 1. Find previous winner in Audit Log to void them
      const qAudit = query(
        collection(db, 'Audit_Log'), 
        where('prizeNumber', '==', prizeNumStr),
        where('status', '==', 'Won'),
        limit(1)
      );
      const prevAuditSnap = await getDocs(qAudit);
      
      const batch = writeBatch(db);
      
      if (!prevAuditSnap.empty) {
        const prevDoc = prevAuditSnap.docs[0];
        batch.update(doc(db, 'Audit_Log', prevDoc.id), { status: 'Voided' });
      }

      // 2. Select new winner
      const winners = await getRandomWinners(1);
      if (winners.length === 0) throw new Error("No eligible participants found.");
      const newWinner = winners[0];

      // 3. Remove new winner from pool
      await removeAllEntriesByName(batch, newWinner.name);

      // 4. Log new winner
      const newAuditRef = doc(collection(db, 'Audit_Log'));
      batch.set(newAuditRef, {
        name: newWinner.name,
        department: newWinner.department,
        prize: prizeObj?.prizeName || 'Unknown Prize',
        prizeNumber: prizeNumStr,
        status: 'Won',
        timestamp: serverTimestamp()
      });

      await batch.commit();

      alert(`Redraw successful! New winner: ${newWinner.name}`);
      setConfirmRedraw(false);
      setSelectedPrizeForRedraw('');
      setPoolSize((prev) => prev - 1);
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setRunningRedraw(false);
    }
  };

  return (
    <div>
      <div className="mb-12">
        <h1 className="font-display text-4xl font-bold text-primary-container mb-2">Operations</h1>
        <p className="font-sans text-on-surface-variant text-lg">Manage mass allocations and critical overrides.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Bulk Draw Section */}
        <div className="lg:col-span-7 flex flex-col space-y-6">
          <div className="glass-panel rounded-xl p-8 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-b from-primary-container/5 to-transparent pointer-events-none"></div>
            
            <div className="flex items-center gap-3 mb-6 relative z-10">
              <div className="w-10 h-10 rounded-full bg-surface-container-highest flex items-center justify-center border border-primary-container/30">
                <Users className="text-primary-container w-5 h-5" />
              </div>
              <h3 className="font-display text-2xl font-bold text-primary">Bulk Draw Tool</h3>
            </div>
            
            <p className="font-sans text-on-surface-variant mb-8 relative z-10 leading-relaxed">
              Execute a randomized selection for multiple winners simultaneously across the active participant pool.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 items-end relative z-10 w-full">
              <div className="w-full sm:w-1/3">
                <label className="block font-mono text-[10px] sm:text-xs font-bold text-on-surface mb-2 uppercase tracking-wide">Starting Number</label>
                <div className="relative">
                   <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <span className="text-on-surface-variant font-mono text-sm">Prize #</span>
                   </div>
                   <input 
                     type="number" 
                     min="1"
                     value={bulkStartPrizeNumber}
                     onChange={e => setBulkStartPrizeNumber(e.target.value)}
                     className="w-full bg-surface-container border border-outline/30 rounded-lg py-3 pl-[4.5rem] pr-4 font-sans text-lg text-primary focus:outline-none focus:border-primary-container focus:shadow-[0_0_15px_rgba(255,213,79,0.3)] transition-all placeholder:text-on-surface-variant/50" 
                   />
                </div>
              </div>
              <div className="w-full sm:w-1/3">
                <label className="block font-mono text-[10px] sm:text-xs font-bold text-on-surface mb-2 uppercase tracking-wide">Number of Winners</label>
                <input 
                  type="number" 
                  min="1"
                  value={bulkCount}
                  onChange={e => setBulkCount(e.target.value)}
                  className="w-full bg-surface-container border border-outline/30 rounded-lg py-3 px-4 font-sans text-lg text-primary focus:outline-none focus:border-primary-container focus:shadow-[0_0_15px_rgba(255,213,79,0.3)] transition-all placeholder:text-on-surface-variant/50" 
                  placeholder="e.g., 25" 
                />
              </div>
              <button 
                onClick={runBulkDraw}
                disabled={runningBulk}
                className="w-full sm:w-1/3 py-3 px-4 bg-primary-container text-on-primary-container font-mono font-bold rounded-[24px] outer-glow-yellow transition-all duration-300 flex items-center justify-center gap-2 whitespace-nowrap disabled:opacity-50"
              >
                {runningBulk ? <Loader2 className="animate-spin w-5 h-5" /> : <PlayCircle className="w-5 h-5" />}
                Run Bulk Draw
              </button>
            </div>
          </div>

          <div className="glass-panel border-outline/10 rounded-xl p-6 flex items-center justify-between">
            <div className="flex items-center gap-4 text-on-surface-variant">
              <span className="font-sans">Eligible Pool: <strong className="text-primary font-display ml-1">{poolSize}</strong> participants</span>
            </div>
            <span className="px-3 py-1 bg-surface-container-highest rounded-full font-mono text-[12px] font-bold text-outline uppercase tracking-wider border border-outline/20">
               Ready
            </span>
          </div>
        </div>

        {/* Emergency Redraw Section */}
        <div className="lg:col-span-5 flex flex-col space-y-6">
          <div className="glass-panel border-error/30 rounded-xl p-8 relative overflow-hidden h-full flex flex-col shadow-[0_0_30px_rgba(255,180,171,0.05)]">
            <div className="absolute -right-20 -bottom-20 w-64 h-64 bg-error/10 rounded-full blur-[80px] pointer-events-none"></div>
            
            <div className="flex items-center gap-3 mb-6 relative z-10">
              <div className="w-10 h-10 rounded-full bg-error-container/30 flex items-center justify-center border border-error/30">
                <AlertTriangle className="text-error w-5 h-5" />
              </div>
              <h3 className="font-display text-2xl font-bold text-error">Emergency Redraw</h3>
            </div>
            
            <p className="font-sans text-on-surface-variant mb-8 relative z-10 flex-grow leading-relaxed">
              Invalidate a previous selection and immediately draw a replacement winner for a specific prize tier.
            </p>
            
            <div className="space-y-6 relative z-10">
              <div>
                <label className="block font-mono text-sm font-bold text-on-surface mb-2 uppercase tracking-wide">Select Prize Tier</label>
                <select 
                  value={selectedPrizeForRedraw}
                  onChange={e => setSelectedPrizeForRedraw(e.target.value)}
                  className="w-full bg-surface-container border border-error/20 rounded-lg py-3 px-4 font-sans text-lg text-primary appearance-none focus:outline-none focus:border-error focus:shadow-[0_0_15px_rgba(255,180,171,0.2)] transition-all cursor-pointer"
                >
                  <option value="" disabled>Select Prize...</option>
                  {Array.from({ length: 10 }, (_, i) => i + 1).map(num => (
                    <option key={num} value={num.toString()}>
                      Prize #{num.toString().padStart(2, '0')} {prizes[num] ? `- ${prizes[num].prizeName}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              
              <div className="flex items-start gap-3 bg-error/5 p-4 rounded-lg border border-error/10">
                <div className="flex items-center h-6">
                  <input 
                    type="checkbox" 
                    id="confirm-redraw" 
                    checked={confirmRedraw}
                    onChange={(e) => setConfirmRedraw(e.target.checked)}
                    className="w-5 h-5 bg-surface-container border-error/50 rounded text-error focus:ring-error focus:ring-offset-background cursor-pointer"
                  />
                </div>
                <label htmlFor="confirm-redraw" className="font-sans text-sm text-on-surface-variant cursor-pointer leading-tight">
                  I confirm that the previous winner is invalid and authorize an immediate replacement draw. This action will void the previous entry logically.
                </label>
              </div>
              
              <button 
                onClick={runEmergencyRedraw}
                disabled={runningRedraw || !confirmRedraw || !selectedPrizeForRedraw}
                className="w-full py-4 px-6 bg-transparent border-2 border-error text-error font-mono font-bold rounded-lg hover:bg-error/10 hover:shadow-[0_0_20px_rgba(255,180,171,0.2)] transition-all duration-300 flex items-center justify-center gap-2 uppercase tracking-wider disabled:opacity-50"
              >
                {runningRedraw ? <Loader2 className="animate-spin w-5 h-5" /> : null}
                Authorize Redraw
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
