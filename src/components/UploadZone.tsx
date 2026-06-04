import React, { useState, useRef } from 'react';
import { Upload, FileImage, Sparkles, Check, AlertCircle } from 'lucide-react';
import { motion } from 'motion/react';

interface UploadZoneProps {
  onImageSelected: (base64: string, fileType: string) => void;
  onSampleSelected: (sampleType: 'crane' | 'rtg_rmg') => void;
  isProcessing: boolean;
  statusMessage?: string;
  error?: string | null;
}

export default function UploadZone({
  onImageSelected,
  onSampleSelected,
  isProcessing,
  statusMessage,
  error,
}: UploadZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const processFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file (PNG, JPG, or JPEG)');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        const base64Data = reader.result.split(',')[1];
        onImageSelected(base64Data, file.type);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFile(e.target.files[0]);
    }
  };

  return (
    <div id="upload-zone-container" className="flex flex-col gap-5">
      {/* Drag & Drop Area */}
      <div
        id="drag-drop-box"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !isProcessing && fileInputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-300 min-h-[220px] ${
          isProcessing
            ? 'border-slate-300 bg-slate-50 cursor-not-allowed opacity-80'
            : isDragOver
            ? 'border-[#0284C7] bg-[#F0F9FF] shadow-xs'
            : 'border-slate-300 hover:border-[#0284C7] bg-slate-50/50 hover:bg-slate-50'
        }`}
      >
        <input
          id="file-input-element"
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept="image/*"
          className="hidden"
          disabled={isProcessing}
        />

        {isProcessing ? (
          <div id="processing-state-view" className="flex flex-col items-center gap-4">
            <div className="relative">
              <div className="w-12 h-12 border-4 border-slate-200 border-t-[#0284C7] rounded-full animate-spin"></div>
              <Sparkles className="absolute inset-0 m-auto text-[#0284C7] h-5 w-5 animate-pulse" />
            </div>
            <div className="space-y-1">
              <p className="font-semibold text-slate-800">Analyzing Log Sheet...</p>
              <p className="text-xs text-slate-500 max-w-[280px] animate-pulse">
                {statusMessage || 'Connecting to Gemini OCR Engine'}
              </p>
            </div>
          </div>
        ) : (
          <div id="upload-idle-view" className="flex flex-col items-center gap-3">
            <div className="p-4 bg-white shadow-sm rounded-full border border-slate-100 text-slate-600 transition-transform group-hover:scale-105">
              <Upload className="h-6 w-6 text-slate-400" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-700">
                Drag and drop your paper log image here
              </p>
              <p className="text-xs text-[#94A3B8]">
                Supports PNG, JPG, JPEG up to 20MB
              </p>
            </div>
            <span className="text-xs font-semibold px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-slate-650 shadow-2xs hover:bg-slate-50 mt-1">
              Browse Files
            </span>
          </div>
        )}
      </div>

      {/* Error Display */}
      {error && (
        <div id="upload-error-box" className="p-3.5 bg-red-50 border border-red-150 rounded-xl flex items-start gap-2.5 text-red-800 text-xs text-left">
          <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-bold">Digitization Error:</span>
            <p className="leading-relaxed opacity-90 font-medium">{error}</p>
          </div>
        </div>
      )}

      {/* Try with Sample Cards */}
      <div id="sample-picker-container" className="space-y-3 font-sans">
        <div className="flex items-center gap-2">
          <div className="h-[1px] bg-slate-200 flex-1"></div>
          <span className="text-[10px] font-bold text-slate-400 tracking-wider uppercase">Or Test Instantly with Samples</span>
          <div className="h-[1px] bg-slate-200 flex-1"></div>
        </div>
        
        <div className="grid grid-cols-2 gap-3">
          <button
            id="try-sample-crane-btn"
            type="button"
            onClick={() => onSampleSelected('crane')}
            className="flex flex-col text-left p-3 border border-slate-200 rounded-xl hover:border-[#0284C7] hover:bg-white bg-[#F8FAFC]/55 hover:shadow-xs transition-all pointer-events-auto"
          >
            <div className="flex items-center justify-between gap-1 w-full mb-1.5">
              <span className="text-xs font-bold text-slate-800">Crane Delay Log</span>
              <span className="text-[9px] bg-sky-50 text-[#0284C7] font-semibold px-1.5 py-0.5 rounded-full border border-sky-100">Sample 1</span>
            </div>
            <p className="text-[11px] text-[#64748B] line-clamp-2 leading-snug">
              Frankfurt Express (June 2) • Crane 7 (35m) & Crane 4 (Ignored)
            </p>
          </button>

          <button
            id="try-sample-rtg-rmg-btn"
            type="button"
            onClick={() => onSampleSelected('rtg_rmg')}
            className="flex flex-col text-left p-3 border border-slate-200 rounded-xl hover:border-[#0284C7] hover:bg-white bg-[#F8FAFC]/55 hover:shadow-xs transition-all pointer-events-auto"
          >
            <div className="flex items-center justify-between gap-1 w-full mb-1.5">
              <span className="text-xs font-bold text-slate-800">RTG & RMG Log</span>
              <span className="text-[9px] bg-[#EEF2F6] text-[#475569] font-semibold px-1.5 py-0.5 rounded-full border border-slate-200">Sample 2</span>
            </div>
            <p className="text-[11px] text-[#64748B] line-clamp-2 leading-snug">
              Shift 1 • RTG 5009, RMGs 6001, 6004 & corrected Fault Codes
            </p>
          </button>
        </div>
      </div>
    </div>
  );
}
