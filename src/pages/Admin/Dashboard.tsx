import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where, getDocs } from '../../lib/store';
import { db } from '../../lib/firebase';
import { Users, Trophy, ClipboardCheck } from 'lucide-react';
import { Link } from 'react-router-dom';

export function Dashboard() {
  const [stats, setStats] = useState({
    poolSize: 0,
    prizesConfigured: 0,
    winnersDrawn: 0,
  });

  useEffect(() => {
    // Listen to Eligible_Pool
    const unsubPool = onSnapshot(collection(db, 'Eligible_Pool'), (snap) => {
      setStats(s => ({ ...s, poolSize: snap.size }));
    });

    // Listen to Config_Prizes
    const unsubPrizes = onSnapshot(collection(db, 'Config_Prizes'), (snap) => {
      setStats(s => ({ ...s, prizesConfigured: snap.size }));
    });

    // Listen to Audit_Log for Won status
    const qWin = query(collection(db, 'Audit_Log'), where('status', '==', 'Won'));
    const unsubAudit = onSnapshot(qWin, (snap) => {
      setStats(s => ({ ...s, winnersDrawn: snap.size }));
    });

    return () => {
      unsubPool();
      unsubPrizes();
      unsubAudit();
    };
  }, []);

  return (
    <div>
      <div className="mb-10">
        <h1 className="font-display text-4xl font-black text-on-surface mb-2 uppercase">System Overview</h1>
        <p className="font-sans text-on-surface-variant text-lg">Real-time status of the Lucky Draw event.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
        <div className="bg-surface-container/80 backdrop-blur-md rounded-[16px] border border-outline/30 shadow-lg p-6 relative overflow-hidden transition-all hover:border-primary/30">
          <div className="flex justify-between items-start mb-4 relative z-10">
            <div>
              <p className="text-on-surface-variant font-mono uppercase text-sm font-bold tracking-widest mb-1">Eligible Pool</p>
              <h3 className="text-4xl font-display font-black text-primary">{stats.poolSize}</h3>
            </div>
            <div className="w-12 h-12 rounded-full bg-primary-container/20 flex items-center justify-center border border-primary-container/30">
              <Users className="text-primary-container w-6 h-6" />
            </div>
          </div>
          <Link to="/admin/upload" className="text-primary-container text-sm font-bold hover:underline relative z-10">Manage Upload →</Link>
        </div>

        <div className="bg-surface-container/80 backdrop-blur-md rounded-[16px] border border-outline/30 shadow-lg p-6 relative overflow-hidden transition-all hover:border-primary/30">
          <div className="flex justify-between items-start mb-4 relative z-10">
            <div>
              <p className="text-on-surface-variant font-mono uppercase text-sm font-bold tracking-widest mb-1">Prizes Configured</p>
              <h3 className="text-4xl font-display font-black text-primary">{stats.prizesConfigured} <span className="text-xl text-on-surface-variant">/ 10</span></h3>
            </div>
            <div className="w-12 h-12 rounded-full bg-secondary-container/50 flex items-center justify-center border border-secondary/30">
              <Trophy className="text-secondary w-6 h-6" />
            </div>
          </div>
          <Link to="/admin/prizes" className="text-primary-container text-sm font-bold hover:underline relative z-10">Setup Prizes →</Link>
        </div>

        <div className="bg-surface-container/80 backdrop-blur-md rounded-[16px] border border-outline/30 shadow-lg p-6 relative overflow-hidden transition-all hover:border-primary/30">
          <div className="flex justify-between items-start mb-4 relative z-10">
            <div>
              <p className="text-on-surface-variant font-mono uppercase text-sm font-bold tracking-widest mb-1">Winners Drawn</p>
              <h3 className="text-4xl font-display font-black text-primary">{stats.winnersDrawn}</h3>
            </div>
            <div className="w-12 h-12 rounded-full bg-[#10B981]/20 flex items-center justify-center border border-[#10B981]/30">
              <ClipboardCheck className="text-[#10B981] w-6 h-6" />
            </div>
          </div>
          <Link to="/admin/audit" className="text-primary-container text-sm font-bold hover:underline relative z-10">View Audit Log →</Link>
        </div>
      </div>
    </div>
  );
}
