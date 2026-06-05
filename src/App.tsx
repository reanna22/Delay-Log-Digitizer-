import React, { useState, useEffect } from 'react';
import { 
  Anchor, 
  FileText, 
  Ship, 
  Calendar, 
  Users, 
  HelpCircle,
  Clock, 
  Layers, 
  Clipboard, 
  Save, 
  RefreshCw, 
  Eye, 
  EyeOff, 
  Search,
  CheckCircle,
  Database
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import UploadZone from './components/UploadZone';
import DataTable from './components/DataTable';
import HistoryPanel from './components/HistoryPanel';
import { CRANE_SAMPLE_DATA, RTG_RMG_SAMPLE_DATA } from './data';
import { DigitizedRow, SavedLogSession, EquipmentType, DigitizeResponse } from './types';

// Simple unique ID generator
const generateId = () => Math.random().toString(36).substring(2, 9);

export default function App() {
  // Navigation & View Tabs
  const [selectedTab, setSelectedTab] = useState<EquipmentType>('CRANE');
  const [showDocPreview, setShowDocPreview] = useState(true);

  // Active Logging Session Metadata
  const [vessel, setVessel] = useState('');
  const [date, setDate] = useState('2-Jun'); // Current date default
  const [shift, setShift] = useState('1');
  const [foreman, setForeman] = useState('');
  const [electrician, setElectrician] = useState('');
  const [equipmentList, setEquipmentList] = useState('');

  // Active digitized rows
  const [rows, setRows] = useState<DigitizedRow[]>([]);
  const [activeFileName, setActiveFileName] = useState<string>('Empty Session');
  const [currentPreviewUrl, setCurrentPreviewUrl] = useState<string | null>(null);

  // Scanning State
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [scanError, setScanError] = useState<string | null>(null);

  // History Sessions
  const [savedSessions, setSavedSessions] = useState<SavedLogSession[]>([]);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Load history on mount
  useEffect(() => {
    try {
      const cached = localStorage.getItem('dock_digitizer_history');
      if (cached) {
        setSavedSessions(JSON.parse(cached));
      }
    } catch (e) {
      console.error('Failed to load history sessions:', e);
    }
  }, []);

  // Sync history to localStorage
  const saveHistoryToStorage = (updatedSessions: SavedLogSession[]) => {
    setSavedSessions(updatedSessions);
    try {
      localStorage.setItem('dock_digitizer_history', JSON.stringify(updatedSessions));
    } catch (e) {
      console.error('Failed to save sessions to localStorage:', e);
    }
  };

  // Triggers visual OCR digitization on the backend for one or more files in parallel
  const handleImagesDigitize = async (images: { base64: string; fileType: string; name?: string }[]) => {
    if (images.length === 0) return;

    setIsProcessing(true);
    setScanError(null);
    setStatusMessage(`Processing 1 of ${images.length} images...`);

    // Save thumbnail preview (using first image in the batch)
    setCurrentPreviewUrl(`data:${images[0].fileType};base64,${images[0].base64}`);
    
    const names = images.map(img => img.name || 'document_img').join(', ');
    setActiveFileName(images.length > 1 ? `Batch (${images.length} files): ${names}` : (images[0].name || 'Uploaded log'));

    const steps = [
      'Reading handwritten headers...',
      'Identifying log types (Crane vs RTG/RMG)...',
      'Scanning green circles & Ops/Maint categories...',
      'Converting equipment codes...',
      'Calculating delay durations & details...',
      'Merging independent results into database...'
    ];

    let currentStep = 0;
    setStatusMessage(steps[0]);
    const interval = setInterval(() => {
      if (currentStep < steps.length - 1) {
        currentStep++;
        setStatusMessage(steps[currentStep]);
      }
    }, 2005);

    try {
      // Process all images in parallel for maximum speed
      const results = await Promise.all(
        images.map(async (img, idx) => {
          console.log(`[App] Dispatching digitize request for image ${idx + 1}/${images.length}`);
          const response = await fetch('/api/digitize', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ image: img.base64, mimeType: img.fileType }),
          });

          const result = await response.json();
          if (!response.ok || !result.success) {
            throw new Error(result.error || `Failed digitizing image #${idx + 1}`);
          }
          return result.data as DigitizeResponse;
        })
      );

      clearInterval(interval);
      loadMergedServerResults(results);

    } catch (err: any) {
      clearInterval(interval);
      console.error('Batch parsing failed:', err);
      setScanError(
        err.message || 
        'Batch scan failed. Make sure your internet connection is active, and ensure your GEMINI_API_KEY is configured in Settings > Secrets.'
      );
      setIsProcessing(false);
    }
  };

  // Helper to load parsed object into active fields for single-item backwards compatibility
  const loadServerResult = (data: DigitizeResponse) => {
    loadMergedServerResults([data]);
  };

  // Helper to load and merge multiple parsed objects into active fields
  const loadMergedServerResults = (results: DigitizeResponse[]) => {
    if (results.length === 0) {
      setIsProcessing(false);
      return;
    }

    // Capture the first valid metadata fields
    const firstWithVessel = results.find(r => r.vessel);
    if (firstWithVessel && !vessel) {
      setVessel(firstWithVessel.vessel || '');
    }

    const firstWithDate = results.find(r => r.date);
    if (firstWithDate && (!date || date === '2-Jun')) {
      setDate(firstWithDate.date || '2-Jun');
    }

    const firstWithShift = results.find(r => r.shift);
    if (firstWithShift) {
      setShift(firstWithShift.shift || '1');
    }

    const firstWithForeman = results.find(r => r.foreman);
    if (firstWithForeman && !foreman) {
      setForeman(firstWithForeman.foreman || '');
    }

    const firstWithElectrician = results.find(r => r.electrician);
    if (firstWithElectrician && !electrician) {
      setElectrician(firstWithElectrician.electrician || '');
    }

    // Combine equipmentList from all files
    const allEqCodes = results.map(r => r.equipmentList || '').filter(Boolean);
    if (allEqCodes.length > 0) {
      setEquipmentList(prev => {
        const combined = Array.from(new Set([
          ...prev.split(/[\s,]+/),
          ...allEqCodes.flatMap(codeStr => codeStr.split(/[\s,]+/))
        ])).filter(Boolean).join(' ');
        return combined;
      });
    }

    // Map rows of all sheets
    const newRows: DigitizedRow[] = [];
    results.forEach((data) => {
      const sheetDate = data.date || date || '2-Jun';
      const mappedRows: DigitizedRow[] = (data.rows || []).map((r) => {
        const opsOrMaint = r.opsOrMaint || '';
        const hasOOrM = opsOrMaint === 'O' || opsOrMaint === 'M';
        const isIgnored = r.isIgnored || !hasOOrM;
        const ignoreReason = r.isIgnored 
          ? (r.ignoreReason || '') 
          : (!hasOOrM ? 'No O or M indicator' : '');
        return {
          ...r,
          id: generateId(),
          rawEquipmentCode: r.rawEquipmentCode || '',
          equipmentCode: r.equipmentCode || '',
          reportedProblem: r.reportedProblem || '',
          resolution: r.resolution || '',
          opsOrMaint,
          faultCode: r.faultCode || '',
          startTime: r.startTime || '',
          endTime: r.endTime || '',
          delayMinutes: r.delayMinutes || 0,
          details: r.details || '',
          isIgnored,
          ignoreReason,
          date: sheetDate, // Assign form-specific date to row!
        };
      });
      newRows.push(...mappedRows);
    });

    setRows(prev => [...prev, ...newRows]);

    // Auto-switch to appropriate tab based on newly extracted values
    if (newRows.length > 0) {
      setSelectedTab(newRows[0].equipmentType);
    }

    setIsProcessing(false);
    setScanError(null);
  };

  // Loads preloaded mock sample data immediately (instant demo)
  const handleLoadSample = (sampleType: 'crane' | 'rtg_rmg') => {
    setIsProcessing(true);
    setScanError(null);
    setStatusMessage('Loading high-definition sample details...');

    setTimeout(() => {
      if (sampleType === 'crane') {
        loadServerResult(CRANE_SAMPLE_DATA);
        setActiveFileName('crane_delay_log_2-Jun-26.jpg');
        setCurrentPreviewUrl('CRANE_SAMPLE');
      } else {
        loadServerResult(RTG_RMG_SAMPLE_DATA);
        setActiveFileName('rtg_rmg_delay_log_2-Jun-26.jpg');
        setCurrentPreviewUrl('RTG_RMG_SAMPLE');
      }
      setIsProcessing(false);
    }, 900);
  };

  // Manage row editing
  const handleUpdateRow = (id: string, updatedFields: Partial<DigitizedRow>) => {
    setRows(prev => prev.map(row => row.id === id ? { ...row, ...updatedFields } : row));
  };

  const handleDeleteRow = (id: string) => {
    setRows(prev => prev.filter(row => row.id !== id));
  };

  const handleAddRow = () => {
    // Generate code standard prefix
    let padPrefix = '40';
    if (selectedTab === 'RTG') padPrefix = '50';
    if (selectedTab === 'RMG') padPrefix = '60';

    const newRow: DigitizedRow = {
      id: generateId(),
      equipmentType: selectedTab,
      rawEquipmentCode: '',
      equipmentCode: '',
      reportedProblem: '',
      resolution: '',
      opsOrMaint: '',
      faultCode: '',
      startTime: '',
      endTime: '',
      delayMinutes: 0,
      details: '',
      isIgnored: false,
    };
    setRows(prev => [...prev, newRow]);
  };

  const handleClearActiveTabRows = () => {
    if (confirm(`Are you sure you want to clear all data in the ${selectedTab} tab?`)) {
      setRows(prev => prev.filter(row => row.equipmentType !== selectedTab));
    }
  };

  // History session triggers
  const handleSaveSession = () => {
    if (rows.length === 0) {
      alert('Cannot save empty session. Scan a document or add rows first.');
      return;
    }

    const session: SavedLogSession = {
      id: generateId(),
      timestamp: new Date().toISOString(),
      vessel,
      date,
      shift,
      foreman,
      electrician,
      fileName: activeFileName,
      previewUrl: currentPreviewUrl || undefined,
      rows,
    };

    const updated = [session, ...savedSessions];
    saveHistoryToStorage(updated);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  const handleLoadSession = (session: SavedLogSession) => {
    setVessel(session.vessel);
    setDate(session.date);
    setShift(session.shift);
    setForeman(session.foreman);
    setElectrician(session.electrician);
    setRows(session.rows);
    setActiveFileName(session.fileName);
    setCurrentPreviewUrl(session.previewUrl || null);
    
    if (session.rows.length > 0) {
      setSelectedTab(session.rows[0].equipmentType);
    }
  };

  const handleDeleteSession = (id: string) => {
    const updated = savedSessions.filter(s => s.id !== id);
    saveHistoryToStorage(updated);
  };

  const handleClearAllHistory = () => {
    if (confirm('Are you sure you want to permanently clear all saved session history?')) {
      saveHistoryToStorage([]);
    }
  };

  return (
    <div id="app-root-container" className="min-h-screen bg-[#F1F5F9] text-slate-800 font-sans selection:bg-sky-100 selection:text-sky-900 pb-12">
      
      {/* Decorative top branding line */}
      <div id="top-branding-accent" className="h-[4px] bg-[#0284C7]"></div>

      {/* Main Container */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
        
        {/* Navigation / Header matching Sleek theme top-nav */}
        <header id="main-navigation-header" className="bg-white border border-slate-200/95 rounded-2xl px-6 py-4 mb-6 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 shadow-xs">
          <div className="flex items-center gap-3 select-none">
            <div className="bg-[#0284C7] text-white w-9 h-9 rounded-xl flex items-center justify-center font-black text-lg shadow-sm">
              L
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
                LogSync Pro <span className="text-[#64748B] font-normal text-xs bg-slate-100 px-1.5 py-0.5 rounded-md font-mono">v2.4</span>
              </h1>
              <p className="text-xs text-[#64748B] font-medium leading-none mt-1">
                Visual AI OCR handwriting converter formatted for primary spreadsheets
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between sm:justify-end gap-4 border-t sm:border-t-0 border-slate-100 pt-3 sm:pt-0">
            <div className="text-right">
              <p className="text-xs text-[#64748B] font-medium">Last scanned: <span className="font-semibold text-slate-800 font-mono">{date ? `${date} - Shift ${shift}` : 'None yet'}</span></p>
              <p className="text-[10px] text-[#10B981] font-bold uppercase tracking-wider flex items-center justify-end gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse inline-block"></span>
                OCR ACTIVE
              </p>
            </div>
            <div className="w-10 h-10 rounded-full bg-[#0284C7]/10 border border-[#0284C7]/20 flex items-center justify-center font-bold text-[#0284C7] text-sm">
              {foreman ? foreman.substring(0, 2).toUpperCase() : 'LS'}
            </div>
          </div>
        </header>

        {/* Workspace Layout */}
        <div id="workspace-grid" className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* Left panel (Image upload & schema helper) - 4 columns */}
          <section id="sidebar-panel" className="lg:col-span-4 space-y-6">
            
            {/* Upload Zone Card matching card header of Sleek theme */}
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
              <div className="px-5 py-3.5 border-b border-slate-150 bg-slate-50/70 flex items-center justify-between">
                <h3 className="text-xs font-bold text-[#475569] tracking-wider uppercase flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5 text-slate-450" />
                  SOURCE LOG SCAN
                </h3>
                {currentPreviewUrl ? (
                  <button
                    id="btn-remove-preview"
                    onClick={() => {
                      setCurrentPreviewUrl(null);
                      setActiveFileName('Empty Session');
                      setRows([]);
                    }}
                    className="text-[10px] text-[#0284C7] hover:text-[#0369a1] hover:underline font-bold transition-all cursor-pointer"
                  >
                    Clear Doc
                  </button>
                ) : (
                  <span className="text-[10px] font-bold text-[#10B981] uppercase flex items-center gap-1 shadow-3xs bg-emerald-50/80 px-2 py-0.5 rounded-md">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    Ready
                  </span>
                )}
              </div>
              
              <div className="p-5">
                <UploadZone
                  onImagesSelected={handleImagesDigitize}
                  onSampleSelected={handleLoadSample}
                  isProcessing={isProcessing}
                  statusMessage={statusMessage}
                  error={scanError}
                />
              </div>
            </div>

            {/* Stylized Paper Schematic Map for loaded values */}
            {currentPreviewUrl && (
              <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs relative overflow-hidden transition-all animate-fade-in text-left">
                <div className="flex items-center justify-between mb-3.5">
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                    <Eye className="h-4 w-4 text-slate-400" />
                    Document Layout Map
                  </h3>
                  <span className="text-[10px] font-mono font-medium text-slate-400 truncate max-w-[150px]">
                    {activeFileName}
                  </span>
                </div>

                {/* Simulated Paper schematic with circles and crosses to guide the user visually */}
                <div className="border border-amber-200/60 bg-amber-50/20 rounded-xl p-4 space-y-3 font-mono text-[10px] select-none text-slate-600 relative">
                  
                  {/* Vessel date headers mapping */}
                  <div className="border-b border-dashed border-slate-200 pb-2.5 grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-[9px] text-slate-400 uppercase font-sans">VESSEL:</span>
                      <p className="font-bold text-slate-800 truncate">{vessel || 'N/A'}</p>
                    </div>
                    <div>
                      <span className="text-[9px] text-slate-400 uppercase font-sans">DATE:</span>
                      <p className="font-bold text-slate-800">{date || 'N/A'}</p>
                    </div>
                    <div>
                      <span className="text-[9px] text-slate-400 uppercase font-sans">SHIFT:</span>
                      <p className="font-bold text-slate-800">Shift {shift || 'N/A'}</p>
                    </div>
                    <div>
                      <span className="text-[9px] text-slate-400 uppercase font-sans">FM / EL:</span>
                      <p className="font-bold text-slate-800 truncate">{foreman || 'N/A'} / {electrician || 'N/A'}</p>
                    </div>
                  </div>

                  {/* Highlights section explaining what the app parsed */}
                  <div className="space-y-2">
                    <span className="text-[9px] text-slate-400 uppercase font-sans font-bold">Extracted Incidents:</span>
                    
                    {rows.length === 0 ? (
                      <p className="italic text-slate-400 py-2 font-sans text-xs">No entries loaded.</p>
                    ) : (
                      <div className="space-y-1.5 max-h-[140px] overflow-y-auto pr-0.5">
                        {rows.map((row) => (
                          <div 
                            key={row.id}
                            className={`flex items-center justify-between p-1.5 rounded-sm border ${
                              row.isIgnored 
                                ? 'bg-red-50/50 border-red-150 text-slate-400/80 line-through' 
                                : row.equipmentType === selectedTab
                                ? 'bg-amber-50 border-amber-200 text-amber-900 font-bold'
                                : 'bg-slate-50 border-slate-100 text-slate-500'
                            }`}
                          >
                            <span className="font-bold shrink-0">{row.equipmentCode || '??'}</span>
                            <span className="truncate max-w-[120px] px-1">{row.details || row.reportedProblem || '...'}</span>
                            
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="font-bold text-[9px] tabular-nums text-slate-700 font-sans">{row.delayMinutes}m</span>
                              {row.isIgnored ? (
                                <span className="text-[8px] bg-red-100 text-red-800 font-extrabold px-1 rounded-sm uppercase font-sans">IGNORED</span>
                              ) : (
                                <span className={`text-[8px] px-1 rounded-sm font-extrabold font-sans ${
                                  row.faultCode === 'OPD' ? 'bg-sky-100 text-sky-800' : 'bg-slate-200 text-slate-850'
                                }`}>
                                  {row.faultCode}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Schema rules reference */}
                  <div className="pt-2 border-t border-dashed border-slate-200 text-[9px] leading-relaxed font-sans text-slate-400 space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full border border-emerald-500 bg-emerald-50 shrink-0"></span>
                      <span><strong>Green Circle</strong> matches categories: O (OPD), M (ENG).</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="h-2 w-2 relative shrink-0">
                        <span className="absolute inset-0 bg-red-500 h-[1.5px] rotate-45 top-1"></span>
                      </span>
                      <span><strong>Red Crossout Rule</strong> ignores the entire row.</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono bg-slate-100 px-1 py-0.2 rounded font-bold text-slate-600 text-[8px]">40.. | 50.. | 60..</span>
                      <span>Auto-prefixes Cranes (40), RTGs (50), RMGs (60).</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Local History Logging Block */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
              <HistoryPanel
                sessions={savedSessions}
                onLoadSession={handleLoadSession}
                onDeleteSession={handleDeleteSession}
                onClearAllSessions={handleClearAllHistory}
              />
            </div>

          </section>

          {/* Right Panel (Sheet metadata, selection tabs, editing grid) - 8 columns */}
          <main id="editor-panel" className="lg:col-span-8 space-y-6">
            
            {/* Session Global Metadata inputs */}
            <div id="metadata-header-card" className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
              <div className="px-5 py-3.5 border-b border-slate-150 bg-slate-50/70">
                <h3 className="text-xs font-bold text-[#475569] uppercase tracking-wider flex items-center gap-2">
                  <Layers className="h-3.5 w-3.5 text-slate-400" />
                  SHEET METADATA HEADERS
                </h3>
              </div>
              
              <div className="p-5 grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs font-medium text-slate-650">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="input-date" className="text-[11px] font-bold text-slate-500 flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5 text-slate-400" />
                    Log Date
                  </label>
                  <input
                    id="input-date"
                    type="text"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    placeholder="2-Jun"
                    className="w-full bg-slate-50 border border-slate-250 focus:border-amber-500 focus:bg-white px-3 py-2 rounded-xl text-slate-800 outline-hidden transition-all font-mono font-medium"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label htmlFor="input-vessel" className="text-[11px] font-bold text-slate-500 flex items-center gap-1">
                    <Ship className="h-3.5 w-3.5 text-slate-400" />
                    Vessel Name
                  </label>
                  <input
                    id="input-vessel"
                    type="text"
                    value={vessel}
                    onChange={(e) => setVessel(e.target.value)}
                    placeholder="Vessel name..."
                    className="w-full bg-slate-50 border border-slate-250 focus:border-amber-500 focus:bg-white px-3 py-2 rounded-xl text-slate-800 outline-hidden transition-all"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label htmlFor="input-shift" className="text-[11px] font-bold text-slate-500 flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5 text-slate-400" />
                    Shift
                  </label>
                  <input
                    id="input-shift"
                    type="text"
                    value={shift}
                    onChange={(e) => setShift(e.target.value)}
                    placeholder="1, 2, or 3"
                    className="w-full bg-slate-50 border border-slate-250 focus:border-amber-500 focus:bg-white px-3 py-2 rounded-xl text-slate-800 outline-hidden transition-all"
                  />
                </div>

                <div className="flex flex-col gap-1.5 col-span-1">
                  <label htmlFor="input-foreman" className="text-[11px] font-bold text-slate-500 flex items-center gap-1">
                    <Users className="h-3.5 w-3.5 text-slate-400" />
                    Foreman (F/M)
                  </label>
                  <input
                    id="input-foreman"
                    type="text"
                    value={foreman}
                    onChange={(e) => setForeman(e.target.value)}
                    placeholder="Foreman name"
                    className="w-full bg-slate-50 border border-slate-250 focus:border-amber-500 focus:bg-white px-3 py-2 rounded-xl text-slate-800 outline-hidden transition-all"
                  />
                </div>

                <div className="flex flex-col gap-1.5 col-span-1">
                  <label htmlFor="input-electrician" className="text-[11px] font-bold text-slate-500 flex items-center gap-1">
                    <Users className="h-3.5 w-3.5 text-slate-400" />
                    Electrician (Elect)
                  </label>
                  <input
                    id="input-electrician"
                    type="text"
                    value={electrician}
                    onChange={(e) => setElectrician(e.target.value)}
                    placeholder="Electrician name"
                    className="w-full bg-slate-50 border border-slate-250 focus:border-amber-500 focus:bg-white px-3 py-2 rounded-xl text-slate-800 outline-hidden transition-all"
                  />
                </div>

                <div className="flex flex-col gap-1.5 col-span-2 sm:col-span-1">
                  <label htmlFor="input-equipment-list" className="text-[11px] font-bold text-slate-500 flex items-center gap-1">
                    <Database className="h-3.5 w-3.5 text-slate-400" />
                    Equipment Working
                  </label>
                  <input
                    id="input-equipment-list"
                    type="text"
                    value={equipmentList}
                    onChange={(e) => setEquipmentList(e.target.value)}
                    placeholder="E.g. 4 6 7 or 1 2 3"
                    className="w-full bg-slate-50 border border-slate-250 focus:border-amber-500 focus:bg-white px-3 py-2 rounded-xl text-slate-800 outline-hidden transition-all font-mono"
                  />
                </div>
              </div>
            </div>

            {/* Interactive digitizing results card matching transformed data output of Sleek theme */}
            <div id="interactive-editor" className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
              <div className="px-5 py-4 border-b border-slate-150 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-left">
                <div>
                  <h2 className="text-xs font-bold text-[#475569] uppercase tracking-wider">TRANSFORMED DATA OUTPUT</h2>
                  <p className="text-[11px] text-[#94A3B8] font-medium leading-none mt-1">Formatted for Excel primary logs</p>
                </div>
                
                {/* Save & Clear block on top header bar */}
                <div className="flex items-center gap-2 self-start sm:self-auto">
                  {rows.length > 0 && (
                    <>
                      <button
                        id="btn-save-session"
                        onClick={handleSaveSession}
                        className={`flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1.5 rounded-lg border transition-all cursor-pointer ${
                          saveSuccess 
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-700' 
                            : 'bg-white hover:bg-slate-50 border-slate-200 text-[#64748B]'
                        }`}
                      >
                        <Save className="h-3.5 w-3.5" />
                        {saveSuccess ? 'Saved!' : 'Save'}
                      </button>
                      <button
                        id="btn-clear-editor"
                        onClick={() => {
                          if (confirm('Clear ALL rows across Crane, RTG, and RMG?')) {
                            setRows([]);
                            setCurrentPreviewUrl(null);
                            setActiveFileName('Empty Session');
                          }
                        }}
                        className="text-[11px] font-semibold text-slate-400 hover:text-red-500 transition-colors px-2 py-1.5 cursor-pointer"
                      >
                        Clear Editor
                      </button>
                    </>
                  )}
                </div>
              </div>
              
              <div className="p-5 space-y-4">
                {/* Tab select bar styled similar to tab-bar active tab style from template layout */}
                <div id="segment-controller" className="flex bg-[#F1F5F9] p-1 rounded-lg gap-1 border border-slate-200/60 max-w-fit mb-2">
                  {(['CRANE', 'RTG', 'RMG'] as EquipmentType[]).map((tab) => {
                    const count = rows.filter(r => r.equipmentType === tab && !r.isIgnored).length;
                    const active = selectedTab === tab;
                    return (
                      <button
                        id={`btn-tab-${tab}`}
                        key={tab}
                        onClick={() => setSelectedTab(tab)}
                        className={`px-4 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-all duration-150 ${
                          active
                            ? 'bg-white text-[#0284C7] shadow-xs font-bold'
                            : 'text-[#64748B] hover:text-slate-800'
                        }`}
                      >
                        {tab === 'CRANE' ? 'Cranes (4000)' : tab === 'RTG' ? 'RTG (5000)' : 'RMG (6000)'}
                        {count > 0 && (
                          <span className={`ml-1.5 text-[10px] px-1.5 py-0.2 rounded-full font-sans ${
                            active ? 'bg-sky-50 text-[#0284C7]' : 'bg-slate-200 text-slate-500'
                          }`}>
                            {count}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Connected Active Datatable Grid */}
                <AnimatePresence mode="wait">
                  <motion.div
                    key={selectedTab}
                    initial={{ opacity: 0, y: 3 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -3 }}
                    transition={{ duration: 0.15 }}
                  >
                    <DataTable
                      rows={rows}
                      globalDate={date}
                      equipmentType={selectedTab}
                      onUpdateRow={handleUpdateRow}
                      onDeleteRow={handleDeleteRow}
                      onAddRow={handleAddRow}
                      onClearRows={handleClearActiveTabRows}
                    />
                  </motion.div>
                </AnimatePresence>

              </div>
            </div>

            {/* Quick documentation guidance footer */}
            <div id="dock-quick-tips" className="bg-slate-50 border border-slate-200/50 rounded-2xl p-5 text-xs text-left text-slate-500 text-slate-650 flex gap-4">
              <HelpCircle className="h-5 w-5 text-slate-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h4 className="font-bold text-slate-700 text-xs">How to use:</h4>
                <ul className="list-disc pl-4 space-y-1 text-slate-500">
                  <li>Upload a clear photo of your handwritten paper log, or click on a sample log to test immediately.</li>
                  <li>Gemini parses all handwritten logs, extracts checkbox circles, ignored lines, and handles equipment numerical prefixes: <strong>Cranes (40..), RTGs (50..), RMGs (60..)</strong>.</li>
                  <li>Verify the OCR results. You can modify equipment digits, change categories, correct start/end times, adjust calculated delay durations, and rewrite fault details directly inside the interactive grid!</li>
                  <li>Press <strong>Copy for Excel</strong>, click on the starting date block in your primary Excel spreadsheet, and hit <strong>CTRL+V</strong>. It populates all rows in seconds!</li>
                </ul>
              </div>
            </div>

          </main>
        </div>
      </div>
    </div>
  );
}
