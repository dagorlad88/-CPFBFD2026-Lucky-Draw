import React, { useState } from 'react';
import Papa from 'papaparse';
import { collection, writeBatch, doc, serverTimestamp, getDocs } from '../../lib/store';
import { db } from '../../lib/firebase';
import { UploadCloud, CheckCircle, AlertCircle, Loader2, Trash2 } from 'lucide-react';

export function UploadCsv() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<{ type: 'idle'|'success'|'error'; message: string }>({ type: 'idle', message: '' });
  const [uploadSummary, setUploadSummary] = useState<{
    totalRows: number;
    importedRows: number;
    duplicateRows: number;
    invalidRows: number;
  } | null>(null);

  const normalizeHeader = (value: string) =>
    value
      .replace(/^\uFEFF/, '')
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, '');

  const getFieldValue = (row: Record<string, unknown>, expectedHeader: string) => {
    const expected = normalizeHeader(expectedHeader);
    for (const [header, rawValue] of Object.entries(row)) {
      if (normalizeHeader(header) === expected) {
        return String(rawValue ?? '').trim();
      }
    }
    return '';
  };

  const clearEligiblePool = async () => {
    if (!window.confirm("Are you SURE you want to clear the entire participants list? This removes all participants!")) return;
    setUploading(true);
    setStatus({ type: 'idle', message: 'Clearing participants...' });
    
    try {
      const snap = await getDocs(collection(db, 'Eligible_Pool'));
      if (snap.empty) {
        setStatus({ type: 'success', message: 'Eligible pool is already empty.' });
        setUploading(false);
        return;
      }
      
      let batch = writeBatch(db);
      let operationCounter = 0;
      let totalDeleted = 0;
      
      for (const d of snap.docs) {
        batch.delete(doc(db, 'Eligible_Pool', d.id));
        operationCounter++;
        totalDeleted++;
        
        if (operationCounter === 450) {
          await batch.commit();
          batch = writeBatch(db);
          operationCounter = 0;
        }
      }
      
      if (operationCounter > 0) {
         await batch.commit();
      }
      
      setStatus({ type: 'success', message: 'Participants list removed successfully.' });
      setUploadSummary(null);
    } catch (err: any) {
      setStatus({ type: 'error', message: `Failed to clear pool: ${err.message}` });
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files?.[0]) {
      setupFile(e.dataTransfer.files[0]);
    }
  };

  const handleSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      setupFile(e.target.files[0]);
    }
  };

  const setupFile = (f: File) => {
    if (f.type !== 'text/csv' && !f.name.endsWith('.csv')) {
      setStatus({ type: 'error', message: 'Please upload a valid CSV file.' });
      return;
    }
    setFile(f);
    setUploadSummary(null);
    setStatus({ type: 'idle', message: '' });
  };

  const processFile = async () => {
    if (!file) return;
    setUploading(true);
    setUploadSummary(null);
    setStatus({ type: 'idle', message: 'Parsing CSV...' });

    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.replace(/^\uFEFF/, '').trim(),
      complete: async (results) => {
        try {
          setStatus({ type: 'idle', message: `Uploading ${results.data.length} records...` });
          
          let uniqueCount = 0;
          let duplicateCount = 0;
          let invalidRowCount = 0;
          let batch = writeBatch(db);
          let operationCounter = 0;
          const seenNames = new Set<string>();

          // For robust uploading, Firestore batches can process 500 max at a time.
          for (const row of results.data) {
            const name = getFieldValue(row, 'Name');
            const department = getFieldValue(row, 'Department');
            if (!name || !department) {
              invalidRowCount++;
              continue;
            }

            const normalizedName = name.toLowerCase();
            if (seenNames.has(normalizedName)) {
              duplicateCount++;
              continue;
            }

            seenNames.add(normalizedName);
            const uniqueDocId = encodeURIComponent(normalizedName);
            const docRef = doc(db, 'Eligible_Pool', uniqueDocId);
            batch.set(docRef, {
              name,
              department,
              nameKey: normalizedName,
              createdAt: serverTimestamp(),
            });
            
            uniqueCount++;
            operationCounter++;

            if (operationCounter === 450) {
              await batch.commit();
              batch = writeBatch(db);
              operationCounter = 0;
            }
          }

          if (operationCounter > 0) {
            await batch.commit();
          }

          setUploadSummary({
            totalRows: results.data.length,
            importedRows: uniqueCount,
            duplicateRows: duplicateCount,
            invalidRows: invalidRowCount,
          });

          if (uniqueCount === 0) {
            setStatus({
              type: 'error',
              message: "No valid rows found. Ensure your CSV has Name and Department columns with non-empty values.",
            });
            return;
          }

          const duplicateSummary = duplicateCount > 0 ? ` ${duplicateCount} duplicate names skipped.` : '';
          const invalidSummary = invalidRowCount > 0 ? ` ${invalidRowCount} rows missing Name/Department skipped.` : '';
          setStatus({ type: 'success', message: `${uniqueCount} unique records populated to Eligible Pool.${duplicateSummary}${invalidSummary}` });
        } catch (err: any) {
             // Extract detailed message from err if possible.
             let msg = err.message || 'Error occurred';
             if (msg.includes('Missing or insufficient permissions')) {
               // Detailed Error Handling for Firestore
               msg = "Permission Denied. Please ensure you are authenticated correctly and have proper roles.";
               console.error("Firestore Error:", JSON.stringify({
                  error: err.message,
                  operationType: 'create',
               }));
             }
             setStatus({ type: 'error', message: `Failed to populate: ${msg}` });
        } finally {
          setUploading(false);
          setFile(null);
        }
      },
      error: (error) => {
        setStatus({ type: 'error', message: `CSV Parse Error: ${error.message}` });
        setUploading(false);
      }
    });
  };

  return (
    <div>
      <div className="mb-10 flex justify-between items-end gap-4">
        <div>
          <h1 className="font-display text-4xl font-bold text-primary mb-2">Eligible Lucky Draw Participants Setup</h1>
          <p className="font-sans text-on-surface-variant text-lg">Upload the master roster for the upcoming premiere event.</p>
        </div>
        <div className="flex-shrink-0">
          <button 
            onClick={clearEligiblePool}
            disabled={uploading}
            className="flex items-center space-x-2 bg-error text-on-error px-6 py-3 rounded hover:bg-error/80 transition-all shadow-lg hover:shadow-xl group active:scale-95 disabled:opacity-50"
          >
            <Trash2 className="w-5 h-5" />
            <span className="font-mono text-sm font-bold uppercase tracking-wider">Clear Participants List</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-8">
          <div 
            className="glass-panel border-2 border-dashed border-outline-variant hover:border-primary-container transition-colors duration-300 rounded-xl p-1 relative overflow-hidden group cursor-pointer min-h-[400px] flex flex-col items-center justify-center"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => document.getElementById('csvUpload')?.click()}
          >
            <div className="absolute inset-0 bg-primary-container/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500 rounded-xl pointer-events-none"></div>
            
            <input type="file" id="csvUpload" accept=".csv" className="hidden" onChange={handleSelect} />

            <div className="text-center z-10 p-8">
              <div className="w-24 h-24 rounded-full bg-surface-container-high border border-outline/30 flex items-center justify-center mx-auto mb-6 group-hover:scale-110 transition-transform duration-500 hover:outer-glow-yellow">
                <UploadCloud className="text-primary-fixed-dim w-12 h-12" />
              </div>
              <h3 className="font-display text-2xl font-bold text-primary mb-3">
                {file ? file.name : "Drop Roster File Here"}
              </h3>
              <p className="font-sans text-on-surface-variant max-w-md mx-auto mb-6">
                Drag and drop your master .csv file containing exactly 'Name' and 'Department' headers.
              </p>
              <button className="bg-transparent border border-outline hover:border-primary-container text-primary hover:text-primary-container font-mono text-sm font-bold uppercase py-2 px-6 rounded-full transition-all tracking-wider">
                Browse Files
              </button>
            </div>
            <div className="absolute bottom-4 left-0 right-0 text-center">
              <span className="text-xs text-on-surface-variant/60 font-mono font-bold tracking-widest">Maximum file size: 50MB</span>
            </div>
          </div>
          
          {file && (
             <div className="mt-6 flex justify-end">
                <button 
                  onClick={processFile}
                  disabled={uploading}
                  className="bg-primary-container text-on-primary-container font-display font-black uppercase text-lg px-8 py-3 rounded-[24px] shadow-[0_0_15px_rgba(255,213,79,0.3)] hover:shadow-[0_0_25px_rgba(255,213,79,0.5)] transition-all flex items-center gap-2 disabled:opacity-50"
                >
                  {uploading && <Loader2 className="animate-spin w-5 h-5" />}
                  {uploading ? 'Processing & Uploading...' : 'Upload & Populate Participants List'}
                </button>
             </div>
          )}

          {status.type !== 'idle' && (
             <div className={`mt-6 p-4 rounded-lg flex items-start gap-3 border ${status.type === 'success' ? 'bg-[#10B981]/10 border-[#10B981]/50 text-[#10B981]' : 'bg-error/10 border-error/50 text-error'}`}>
               {status.type === 'success' ? <CheckCircle className="w-5 h-5 mt-0.5" /> : <AlertCircle className="w-5 h-5 mt-0.5" />}
               <div>
                  <h4 className="font-bold font-sans">
                    {status.type === 'success' 
                      ? (status.message.toLowerCase().includes('remov') || status.message.toLowerCase().includes('clear') || status.message.toLowerCase().includes('empty') ? 'Clear Successful' : 'Upload Successful') 
                      : (status.message.toLowerCase().includes('remov') || status.message.toLowerCase().includes('clear') ? 'Clear Failed' : 'Upload Failed')}
                  </h4>
                  <p className="text-sm font-sans opacity-90">{status.message}</p>
               </div>
             </div>
          )}

          {uploadSummary && (
            <div className="mt-6 rounded-xl border border-outline/30 bg-surface-container-high p-5">
              <h4 className="font-mono text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-4">Last Upload Summary</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-lg border border-outline/20 bg-surface-container px-3 py-2">
                  <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-on-surface-variant">Rows Read</p>
                  <p className="text-xl font-display font-black text-on-surface">{uploadSummary.totalRows}</p>
                </div>
                <div className="rounded-lg border border-[#10B981]/30 bg-[#10B981]/10 px-3 py-2">
                  <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#10B981]">Imported</p>
                  <p className="text-xl font-display font-black text-[#10B981]">{uploadSummary.importedRows}</p>
                </div>
                <div className="rounded-lg border border-outline/20 bg-surface-container px-3 py-2">
                  <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-on-surface-variant">Duplicates Skipped</p>
                  <p className="text-xl font-display font-black text-on-surface">{uploadSummary.duplicateRows}</p>
                </div>
                <div className="rounded-lg border border-error/30 bg-error/10 px-3 py-2">
                  <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-error">Invalid Skipped</p>
                  <p className="text-xl font-display font-black text-error">{uploadSummary.invalidRows}</p>
                </div>
              </div>
            </div>
          )}

        </div>

        <div className="lg:col-span-4 flex flex-col gap-6">
          <div className="bg-surface-container-highest border border-outline/20 rounded-xl p-6 flex gap-4 items-start shadow-xl">
            <AlertCircle className="text-primary-container w-6 h-6 flex-shrink-0" />
            <div>
              <h4 className="font-mono text-sm font-bold uppercase text-primary mb-2">Format Requirements</h4>
              <p className="text-sm text-on-surface-variant font-sans leading-relaxed mb-4">
                Ensure your CSV contains strictly <strong>Name</strong> and <strong>Department</strong> headers. Extra columns are ignored.
              </p>
              <div className="bg-surface-container overflow-hidden rounded border border-outline/30">
                <table className="w-full text-xs text-left">
                   <thead>
                      <tr className="bg-surface-container-low border-b border-outline/30">
                         <th className="px-3 py-2 text-on-surface font-bold">Name</th>
                         <th className="px-3 py-2 text-on-surface font-bold">Department</th>
                      </tr>
                   </thead>
                   <tbody>
                      <tr>
                         <td className="px-3 py-2 text-on-surface-variant">John Doe</td>
                         <td className="px-3 py-2 text-on-surface-variant">Engineering</td>
                      </tr>
                      <tr className="bg-surface-container-low/50">
                         <td className="px-3 py-2 text-on-surface-variant">Jane Smith</td>
                         <td className="px-3 py-2 text-on-surface-variant">Marketing</td>
                      </tr>
                   </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
