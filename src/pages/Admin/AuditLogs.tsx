import { useEffect, useState } from 'react';
import { collection, query, orderBy, onSnapshot, writeBatch, doc } from '../../lib/store';
import { db } from '../../lib/firebase';
import { Download, Filter, CheckCircle2, XCircle, Info as InfoIcon, Trash2 } from 'lucide-react';
import Papa from 'papaparse';

export function AuditLogs() {
  const [logs, setLogs] = useState<any[]>([]);
  const [filterDept, setFilterDept] = useState('All Departments');
  const [filterStatus, setFilterStatus] = useState('All Statuses');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  // ...

  const clearAuditLogs = async () => {
    if (!window.confirm("Are you SURE you want to clear the entire audit log? This is irreversible and resets draw history!")) return;
    try {
      const batch = writeBatch(db);
      logs.forEach(log => {
        batch.delete(doc(db, 'Audit_Log', log.id));
      });
      await batch.commit();
      alert("Audit Logs successfully cleared.");
    } catch (err: any) {
      alert(`Error clearing logs: ${err.message}`);
    }
  };

  useEffect(() => {
    const q = query(collection(db, 'Audit_Log'), orderBy('timestamp', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      setLogs(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => unsub();
  }, []);

  const departments = ['All Departments', ...Array.from(new Set(logs.map(L => L.department)))];

  const filteredLogs = logs.filter(log => {
    if (filterDept !== 'All Departments' && log.department !== filterDept) return false;
    if (filterStatus !== 'All Statuses' && filterStatus === 'Won' && log.status !== 'Won') return false;
    if (filterStatus !== 'All Statuses' && filterStatus === 'Voided' && log.status !== 'Voided') return false;
    return true;
  });

  // Calculate pagination
  const totalPages = Math.ceil(filteredLogs.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedLogs = filteredLogs.slice(startIndex, startIndex + itemsPerPage);

  useEffect(() => {
    setCurrentPage(1);
  }, [filterDept, filterStatus, itemsPerPage]);

  const exportCSV = () => {
    const csvData = filteredLogs.map(log => ({
      Timestamp: log.timestamp?.toDate().toISOString(),
      Name: log.name,
      Department: log.department,
      PrizeNumber: log.prizeNumber,
      PrizeName: log.prize,
      Status: log.status
    }));
    
    const csv = Papa.unparse(csvData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `audit_log_${new Date().toISOString()}.csv`;
    link.click();
  };

  return (
    <div>
      <div className="flex flex-col md:flex-row md:items-end justify-between mb-8 gap-4">
        <div>
          <h1 className="font-display text-4xl font-bold text-on-surface mb-2 tracking-tight">Event Audit Trail</h1>
          <p className="font-sans text-on-surface-variant text-lg max-w-2xl">
            A comprehensive, immutable record of all draw activities and verification actions.
          </p>
        </div>
        <div className="flex-shrink-0 flex gap-4">
          <button 
            onClick={clearAuditLogs}
            className="flex items-center space-x-2 bg-error text-on-error px-6 py-3 rounded hover:bg-error/80 transition-all shadow-lg hover:shadow-xl group active:scale-95"
          >
            <Trash2 className="w-5 h-5" />
            <span className="font-mono text-sm font-bold uppercase tracking-wider">Clear Logs</span>
          </button>
          
          <button 
            onClick={exportCSV}
            className="flex items-center space-x-2 bg-primary-container text-on-primary-container px-6 py-3 rounded hover:bg-primary-fixed transition-all shadow-[0_0_15px_rgba(255,225,53,0.15)] hover:shadow-[0_0_25px_rgba(255,225,53,0.3)] group active:scale-95"
          >
            <Download className="w-5 h-5" />
            <span className="font-mono text-sm font-bold uppercase tracking-wider">Export CSV</span>
          </button>
        </div>
      </div>

      <div className="mb-6 p-4 rounded-xl bg-surface-container/60 backdrop-blur-md border border-outline-variant/50 flex flex-wrap gap-4 items-center shadow-lg">
        <div className="flex items-center space-x-2 text-on-surface-variant font-sans">
          <Filter className="w-5 h-5" />
          <span className="font-medium">Filter by:</span>
        </div>
        
        <select 
          value={filterDept} 
          onChange={e => setFilterDept(e.target.value)}
          className="bg-surface-container-highest border border-outline-variant text-on-surface text-sm rounded px-3 py-2 focus:ring-1 focus:ring-primary-container focus:outline-none focus:border-primary-container"
        >
          {departments.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        
        <select 
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="bg-surface-container-highest border border-outline-variant text-on-surface text-sm rounded px-3 py-2 focus:ring-1 focus:ring-primary-container focus:outline-none focus:border-primary-container"
        >
          <option>All Statuses</option>
          <option value="Won">Won</option>
          <option value="Voided">Voided</option>
        </select>

        <div className="flex-grow"></div>

        <div className="flex items-center space-x-2 text-on-surface-variant font-sans ml-auto">
          <span className="text-sm font-medium">Show:</span>
          <select 
            value={itemsPerPage} 
            onChange={e => setItemsPerPage(parseInt(e.target.value))}
            className="bg-surface-container-highest border border-outline-variant text-on-surface text-sm rounded px-3 py-2 focus:ring-1 focus:ring-primary-container focus:outline-none focus:border-primary-container"
          >
            {[10, 25, 50, 100].map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
      </div>

      <div className="rounded-xl border border-outline-variant/60 bg-surface-container/80 backdrop-blur-xl shadow-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-highest border-b border-outline-variant/60">
                <th className="py-4 px-6 font-mono text-xs font-bold text-on-surface-variant uppercase tracking-wider whitespace-nowrap">Timestamp (SGT)</th>
                <th className="py-4 px-6 font-mono text-xs font-bold text-on-surface-variant uppercase tracking-wider">Participant Name</th>
                <th className="py-4 px-6 font-mono text-xs font-bold text-on-surface-variant uppercase tracking-wider">Department</th>
                <th className="py-4 px-6 font-mono text-xs font-bold text-on-surface-variant uppercase tracking-wider">Prize Drawn</th>
                <th className="py-4 px-6 font-mono text-xs font-bold text-on-surface-variant uppercase tracking-wider text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/30">
              {paginatedLogs.map((log) => {
                const isWon = log.status === 'Won';
                return (
                  <tr key={log.id} className={`hover:bg-surface-container-highest/40 transition-colors group ${!isWon ? 'opacity-70' : ''}`}>
                    <td className={`py-4 px-6 font-mono text-sm text-on-surface-variant ${!isWon ? 'line-through' : ''}`}>
                       {log.timestamp?.toDate().toLocaleString('en-GB', {
                         timeZone: 'Asia/Singapore',
                         day: '2-digit',
                         month: '2-digit',
                         year: 'numeric',
                         hour: '2-digit',
                         minute: '2-digit',
                         second: '2-digit',
                         hour12: true
                       }).toUpperCase()}
                    </td>
                    <td className="py-4 px-6">
                      <div className={`font-sans text-base font-semibold transition-colors ${isWon ? 'text-on-surface group-hover:text-primary-fixed-dim' : 'text-outline line-through'}`}>
                        {log.name}
                      </div>
                    </td>
                    <td className="py-4 px-6 font-sans text-base text-on-surface-variant">
                      {log.department}
                    </td>
                    <td className="py-4 px-6 font-sans text-base text-outline font-medium flex flex-col">
                       <span className={isWon ? "text-primary-fixed" : "line-through text-outline-variant"}>{log.prizeNumber}</span>
                       <span className={isWon ? "text-on-surface-variant" : "line-through text-outline-variant"}>{log.prize}</span>
                    </td>
                    <td className="py-4 px-6 text-center">
                       {isWon ? (
                          <span className="inline-flex items-center gap-1 justify-center px-3 py-1 rounded-full border border-primary-container text-primary-container bg-primary-container/10 text-xs font-bold uppercase tracking-wide">
                             <CheckCircle2 className="w-3 h-3" /> Won
                          </span>
                       ) : (
                          <span className="inline-flex items-center gap-1 justify-center px-3 py-1 rounded-full border border-error text-error bg-error/10 text-xs font-bold uppercase tracking-wide">
                             <XCircle className="w-3 h-3" /> Voided
                          </span>
                       )}
                    </td>
                  </tr>
                );
              })}
              {filteredLogs.length === 0 && (
                 <tr>
                    <td colSpan={5} className="py-12 text-center text-on-surface-variant font-sans">
                       No audit logs found.
                    </td>
                 </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="mt-8 flex items-center justify-between">
          <div className="text-sm text-on-surface-variant font-sans">
            Showing <span className="font-bold text-on-surface">{startIndex + 1}</span> to <span className="font-bold text-on-surface">{Math.min(startIndex + itemsPerPage, filteredLogs.length)}</span> of <span className="font-bold text-on-surface">{filteredLogs.length}</span> results
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-4 py-2 text-sm font-bold bg-surface-container border border-outline-variant rounded hover:bg-surface-container-highest transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-on-surface"
            >
              Previous
            </button>
            <div className="flex items-center space-x-1">
              {/* Pagination Logic: Show current page, edges, and nearby pages */}
              {Array.from({ length: totalPages }).map((_, i) => {
                const pageNum = i + 1;
                const isNearCurrent = Math.abs(pageNum - currentPage) <= 1;
                const isEdge = pageNum === 1 || pageNum === totalPages;
                
                if (!isNearCurrent && !isEdge) {
                  // Show ellipsis if we are between edge and near current
                  if (pageNum === 2 && currentPage > 3) return <span key="l-els" className="px-2 text-on-surface-variant">...</span>;
                  if (pageNum === totalPages - 1 && currentPage < totalPages - 2) return <span key="r-els" className="px-2 text-on-surface-variant">...</span>;
                  return null;
                }

                return (
                  <button
                    key={pageNum}
                    onClick={() => setCurrentPage(pageNum)}
                    className={`w-10 h-10 flex items-center justify-center text-sm font-bold rounded transition-all ${
                      currentPage === pageNum 
                        ? 'bg-primary-container text-on-primary-container shadow-md scale-110' 
                        : 'bg-surface-container text-on-surface hover:bg-surface-container-highest border border-outline-variant'
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-4 py-2 text-sm font-bold bg-surface-container border border-outline-variant rounded hover:bg-surface-container-highest transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-on-surface"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
