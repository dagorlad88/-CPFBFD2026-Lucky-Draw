import React, { useState, useEffect } from 'react';
import { collection, doc, setDoc, onSnapshot, serverTimestamp, ref, uploadBytesResumable, getDownloadURL } from '../../lib/store';
import { db, storage } from '../../lib/firebase';
import { CloudUpload, Info, Edit2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { mergeWithDefaultTop10 } from '../../lib/prizeDefaults';

export function PrizeSetup() {
  const [selectedSlot, setSelectedSlot] = useState<number>(1);
  const [prizes, setPrizes] = useState<Record<number, any>>({});
  
  // Form state
  const [prizeName, setPrizeName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [saving, setSaving] = useState(false);

  // Load configured prizes
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'Config_Prizes'), (snap) => {
      const pmap: Record<number, any> = {};
      snap.forEach(doc => {
        pmap[parseInt(doc.id)] = doc.data();
      });
      setPrizes(mergeWithDefaultTop10(pmap));
    });
    return () => unsub();
  }, []);

  // Update form when slot changes or data loads
  useEffect(() => {
    if (prizes[selectedSlot]) {
      setPrizeName(prizes[selectedSlot].prizeName);
      setFile(null); // we have an existing image, don't show file unless they upload new
    } else {
      setPrizeName('');
      setFile(null);
    }
    setUploadProgress(0);
  }, [selectedSlot, prizes]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prizeName.trim()) return;
    
    setSaving(true);
    try {
      let imageUrl = prizes[selectedSlot]?.imageUrl || '';

      if (file) {
        const storageRef = ref(storage, `prizes/slot_${selectedSlot}_${Date.now()}`);
        const uploadTask = uploadBytesResumable(storageRef, file);
        
        await new Promise<void>((resolve, reject) => {
          uploadTask.on(
            'state_changed',
            (snap) => {
              const progress = (snap.bytesTransferred / snap.totalBytes) * 100;
              setUploadProgress(progress);
            },
            (err) => reject(err),
            async () => {
              imageUrl = await getDownloadURL(uploadTask.snapshot.ref);
              resolve();
            }
          );
        });
      }

      if (!imageUrl) {
        throw new Error("An image is required for the prize.");
      }

      const prizeDoc = {
        prizeNumber: `Prize #${selectedSlot.toString().padStart(2, '0')}`,
        prizeName,
        imageUrl,
        updatedAt: serverTimestamp()
      };

      await setDoc(doc(db, 'Config_Prizes', selectedSlot.toString()), prizeDoc);
      alert('Prize configuration saved successfully!');
    } catch (err: any) {
      if (err.code === 'storage/unauthorized' || (err.message && err.message.toLowerCase().includes('storage') && err.message.toLowerCase().includes('permission'))) {
        alert(
          "Storage Error: Firebase Storage is blocking the image upload.\n\n" +
          "To fix this:\n" +
          "1. Go to your Firebase Console: https://console.firebase.google.com/\n" +
          "2. Click on 'Storage' in the left menu.\n" +
          "3. Go to the 'Rules' tab.\n" +
          "4. Update the rules to:\n\n" +
          "rules_version = '2';\n" +
          "service firebase.storage {\n" +
          "  match /b/{bucket}/o {\n" +
          "    match /{allPaths=**} {\n" +
          "      allow read, write: if request.auth != null;\n" +
          "    }\n" +
          "  }\n" +
          "}"
        );
      } else {
        alert(`Error: ${err.message}`);
      }
      
      if (err.message && err.message.includes('Missing or insufficient permissions')) {
          console.error("Firestore Error:", JSON.stringify({
            error: err.message,
            operationType: 'update',
            path: 'Config_Prizes/' + selectedSlot
          }));
      }
    } finally {
      setSaving(false);
      setUploadProgress(0);
    }
  };

  const handleClear = () => {
    setPrizeName('');
    setFile(null);
  };

  const currentPrize = prizes[selectedSlot];
  const configuredCount = Object.keys(prizes).length;

  return (
    <div>
      <div className="mb-10">
        <h1 className="font-display text-4xl font-bold text-on-surface mb-2">Prize Inventory Setup</h1>
        <p className="font-sans text-on-surface-variant text-lg max-w-2xl">
          Configure the cinematic rewards. Select a slot to assign an image and designation.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
        {/* Active Configuration Box */}
        <div className="xl:col-span-4 flex flex-col gap-6">
          <div className="bg-surface-container-highest/40 backdrop-blur-md rounded-xl p-6 border border-outline/30 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary-container/80 to-transparent"></div>
            
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-display text-2xl font-bold text-primary-container">
                Configure Slot <span className="text-on-surface">#{selectedSlot.toString().padStart(2, '0')}</span>
              </h3>
              {currentPrize && (
                <span className="px-3 py-1 bg-primary-container/10 border border-primary-container/30 text-primary-container rounded-full font-mono text-[10px] tracking-wider uppercase font-bold">
                  Editing
                </span>
              )}
            </div>

            <form onSubmit={handleSave} className="space-y-6">
              <div>
                <label className="block font-mono text-sm font-bold text-on-surface-variant mb-2">Prize Rank</label>
                <div className="w-full bg-surface-container-lowest border border-outline/50 rounded-lg px-4 py-3 text-on-surface font-sans opacity-70 cursor-not-allowed">
                  Rank {selectedSlot.toString().padStart(2, '0')} {selectedSlot === 1 ? '- Grand Prize' : ''}
                </div>
              </div>

              <div>
                <label className="block font-mono text-sm font-bold text-on-surface-variant mb-2">Designation / Title</label>
                <input 
                  type="text" 
                  value={prizeName}
                  onChange={e => setPrizeName(e.target.value)}
                  className="w-full bg-surface-container-lowest border border-outline/50 rounded-lg px-4 py-3 text-on-surface font-sans focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container/50 transition-all placeholder:text-on-surface-variant/50" 
                  placeholder="e.g. MacBook Pro 16&quot;" 
                  required
                />
              </div>

              <div>
                <label className="block font-mono text-sm font-bold text-on-surface-variant mb-2">Prize Visual Artifact</label>
                <div 
                  className="border-2 border-dashed border-outline/50 hover:border-primary-container/80 rounded-xl bg-surface-container-lowest/50 hover:bg-surface-container/30 transition-all group cursor-pointer relative overflow-hidden h-48 flex flex-col items-center justify-center"
                  onClick={() => document.getElementById('prizeImageInput')?.click()}
                >
                  <input 
                     type="file" 
                     id="prizeImageInput" 
                     accept="image/jpeg,image/png,image/webp" 
                     className="hidden" 
                     onChange={(e) => {
                       if (e.target.files?.[0]) {
                          setFile(e.target.files[0]);
                       }
                     }}
                  />
                  {(file || currentPrize?.imageUrl) ? (
                    <img 
                       src={file ? URL.createObjectURL(file) : currentPrize.imageUrl} 
                       alt="Preview" 
                       className="absolute inset-0 w-full h-full object-cover opacity-60 group-hover:opacity-20 transition-opacity duration-300"
                    />
                  ) : null}
                  
                  <div className="relative z-10 flex flex-col items-center justify-center text-center p-4">
                    <div className="w-12 h-12 rounded-full bg-surface-container/80 backdrop-blur-sm border border-outline/30 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform shadow-[0_0_15px_rgba(255,225,53,0.1)]">
                      <CloudUpload className="text-primary-container w-6 h-6" />
                    </div>
                    {file ? (
                        <p className="font-sans text-sm text-on-surface font-bold drop-shadow-md">{file.name}</p>
                    ) : (
                        <>
                          <p className="font-sans text-sm text-on-surface font-medium drop-shadow-md">Select new visual</p>
                          <p className="font-sans text-xs text-on-surface-variant drop-shadow-md mt-1">JPEG/PNG 16:9 ratio</p>
                        </>
                    )}
                  </div>
                </div>
              </div>

              {uploadProgress > 0 && uploadProgress < 100 && (
                <div className="w-full bg-surface-container rounded-full h-2">
                  <div className="bg-primary-container h-2 rounded-full transition-all duration-300" style={{ width: `${uploadProgress}%` }}></div>
                </div>
              )}

              <div className="pt-4 flex gap-4">
                <button 
                  type="button" 
                  onClick={handleClear}
                  className="flex-1 py-3 px-4 rounded-lg border border-outline/50 text-on-surface font-mono font-bold text-sm tracking-widest uppercase hover:bg-surface-container transition-colors"
                >
                  Clear Entry
                </button>
                <button 
                  type="submit" 
                  disabled={saving || (!file && !currentPrize?.imageUrl)}
                  className="flex-1 py-3 px-4 rounded-lg bg-primary-container text-on-primary-container font-mono font-bold text-sm tracking-widest uppercase shadow-[0_0_15px_rgba(255,225,53,0.2)] hover:shadow-[0_0_25px_rgba(255,225,53,0.4)] transition-all disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Lock Config'}
                </button>
              </div>
            </form>
          </div>

          <div className="bg-surface-container-high/50 rounded-xl p-5 border border-outline/20">
            <div className="flex gap-3">
              <Info className="text-secondary-container mt-0.5 w-6 h-6 flex-shrink-0" />
              <div>
                <h4 className="font-mono text-sm font-bold text-on-surface mb-1 uppercase tracking-wide">Cinematic Formatting</h4>
                <p className="font-sans text-sm text-on-surface-variant leading-relaxed">
                  For the best presentation during the draw, utilize high-resolution images with a 16:9 aspect ratio and dark cinematic backgrounds.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* The 15 Slot Grid */}
        <div className="xl:col-span-8">
          <div className="flex justify-between items-center mb-6">
            <h2 className="font-display font-semibold text-2xl text-on-surface">Prize Roster Status</h2>
            <div className="flex items-center gap-4 text-sm font-mono font-bold uppercase tracking-wider">
               <span className="flex items-center gap-2 text-on-surface-variant">
                 <span className="w-3 h-3 rounded-full bg-primary-container inline-block shadow-[0_0_8px_rgba(255,225,53,0.8)]"></span>
                 Configured ({configuredCount})
               </span>
               <span className="flex items-center gap-2 text-on-surface-variant opacity-60">
                 <span className="w-3 h-3 rounded-full border border-outline border-dashed inline-block"></span>
                 Empty ({10 - configuredCount})
               </span>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {Array.from({ length: 10 }, (_, i) => i + 1).map(slotId => {
              const prize = prizes[slotId];
              const isSelected = selectedSlot === slotId;
              
              if (prize) {
                 return (
                    <div 
                      key={slotId}
                      onClick={() => setSelectedSlot(slotId)}
                      className={cn(
                        "group relative rounded-xl overflow-hidden cursor-pointer border transform transition-all duration-300 hover:-translate-y-1",
                        isSelected ? "border-2 border-primary-container shadow-[0_0_20px_rgba(255,225,53,0.2)] scale-[1.02]" : "border-outline/30 bg-surface-container hover:shadow-lg"
                      )}
                    >
                      {isSelected && (
                         <div className="absolute top-0 right-0 w-8 h-8 bg-primary-container rounded-bl-xl z-20 flex items-center justify-center">
                           <Edit2 className="w-4 h-4 text-on-primary-container" />
                         </div>
                      )}
                      
                      <div className="aspect-square relative">
                        <img 
                          src={prize.imageUrl} 
                          alt={prize.prizeName} 
                          className={cn("w-full h-full object-cover transition-opacity duration-300", isSelected ? "opacity-100" : "opacity-80 group-hover:opacity-100")} 
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-surface-container-lowest via-surface-container-lowest/60 to-transparent"></div>
                      </div>
                      
                      <div className="absolute bottom-0 left-0 right-0 p-3 z-20">
                        <div className={cn("font-display text-2xl font-black leading-none mb-1 opacity-90 drop-shadow-md", isSelected ? "text-primary-container" : "text-tertiary-fixed")}>
                           {slotId.toString().padStart(2, '0')}
                        </div>
                        <div className="font-mono text-xs font-bold text-on-surface uppercase tracking-wider truncate">
                           {prize.prizeName}
                        </div>
                      </div>
                    </div>
                 );
              }

              // Empty Slot
              return (
                 <div 
                   key={slotId}
                   onClick={() => setSelectedSlot(slotId)}
                   className={cn(
                     "aspect-square rounded-xl border border-dashed flex flex-col items-center justify-center cursor-pointer transition-all group relative",
                     isSelected ? "border-primary-container bg-surface-container/80 shadow-[0_0_15px_rgba(255,225,53,0.1)] scale-[1.02]" : "border-outline/40 bg-surface-container-lowest/50 hover:bg-surface-container/50 hover:border-outline"
                   )}
                 >
                    <div className="absolute top-3 left-3 font-display text-base font-bold text-on-surface-variant opacity-40">
                      {slotId.toString().padStart(2, '0')}
                    </div>
                    <div className={cn(
                       "w-10 h-10 rounded-full flex items-center justify-center mb-2 transition-colors",
                       isSelected ? "bg-primary-container/20 text-primary-container" : "bg-surface-container text-outline group-hover:text-on-surface group-hover:bg-surface-container-high"
                    )}>
                      <span className="text-2xl leading-none">+</span>
                    </div>
                    <span className={cn(
                       "font-mono text-[10px] font-bold uppercase tracking-wider",
                       isSelected ? "text-primary-container" : "text-on-surface-variant group-hover:text-on-surface"
                    )}>
                       {isSelected ? "Configure" : "Empty Slot"}
                    </span>
                 </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
