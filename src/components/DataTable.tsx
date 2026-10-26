import React, { useState } from 'react';
import { DigitizedRow, EquipmentType } from '../types';
import { calculateMinutesDiff, parseDateToComparable } from './utils';
import { 
  Clipboard, 
  Download, 
  Trash2, 
  Plus, 
  AlertTriangle, 
  Check, 
  Undo,
  Ban,
  Clock,
  ExternalLink,
  Edit2,
  Wrench
} from 'lucide-react';

interface DataTableProps {
  rows: DigitizedRow[];
  globalDate: string;
  equipmentType: EquipmentType;
  onUpdateRow: (id: string, updatedFields: Partial<DigitizedRow>) => void;
  onDeleteRow: (id: string) => void;
  onAddRow: () => void;
  onClearRows: () => void;
}

export default function DataTable({
  rows,
  globalDate,
  equipmentType,
  onUpdateRow,
  onDeleteRow,
  onAddRow,
  onClearRows,
}: DataTableProps) {
  const [copying, setCopying] = useState(false);
  const [copiedText, setCopiedText] = useState(false);

  // Filter rows for this specific equipment tab
  const activeUnsortedRows = rows.filter(r => r.equipmentType === equipmentType);

  // Sort rows chronologically by date first, preserving original page order for rows on the same day
  const activeRows = [...activeUnsortedRows].sort((a, b) => {
    const valA = parseDateToComparable(a.date || '', globalDate);
    const valB = parseDateToComparable(b.date || '', globalDate);
    return valA - valB;
  });

  // Time calculations and total sums for the active tab (separated by Ops and Maint)
  const activeValidRows = activeRows.filter(r => !r.isIgnored);
  const totalDelays = activeValidRows.reduce((sum, r) => sum + (r.delayMinutes || 0), 0);
  const maintDelays = activeValidRows
    .filter(r => r.opsOrMaint === 'M' || r.faultCode === 'ENG')
    .reduce((sum, r) => sum + (r.delayMinutes || 0), 0);
  const opsDelays = activeValidRows
    .filter(r => r.opsOrMaint === 'O' || r.faultCode === 'OPD')
    .reduce((sum, r) => sum + (r.delayMinutes || 0), 0);
  const activeCount = activeValidRows.length;
  const ignoredCount = activeRows.length - activeCount;

  // Handles dropdown changes for Ops/Maint => Updates fault code
  const handleOpsMaintChange = (id: string, val: 'O' | 'M' | '') => {
    const faultCode = val === 'O' ? 'OPD' : val === 'M' ? 'ENG' : '';
    onUpdateRow(id, { opsOrMaint: val, faultCode });
  };

  // Handles start or end time change => Updates delayMinutes
  const handleTimeChange = (id: string, field: 'startTime' | 'endTime', value: string, sisterValue: string) => {
    onUpdateRow(id, { [field]: value });
    
    const start = field === 'startTime' ? value : sisterValue;
    const end = field === 'endTime' ? value : sisterValue;
    
    if (start && end) {
      const minutes = calculateMinutesDiff(start, end);
      onUpdateRow(id, { delayMinutes: minutes });
    }
  };

  // Re-computes full Equipment Code on raw number changes
  const handleRawCodeChange = (id: string, rawCode: string) => {
    let prefix = '40';
    if (equipmentType === 'RTG') prefix = '50';
    if (equipmentType === 'RMG') prefix = '60';

    // Pad core value to 2-digit unless it's empty
    let cleanVal = rawCode.trim();
    let computedFull = cleanVal;
    if (cleanVal) {
      const numeric = parseInt(cleanVal, 10);
      if (!isNaN(numeric)) {
        computedFull = prefix + String(numeric).padStart(2, '0');
      } else {
        computedFull = prefix + cleanVal; // fallback
      }
    } else {
      computedFull = '';
    }

    onUpdateRow(id, {
      rawEquipmentCode: cleanVal,
      equipmentCode: computedFull
    });
  };

  // Prepares the clipboard copy data in TSV (Tab-Separated Values) format for Excel
  const handleCopyToClipboard = () => {
    if (activeValidRows.length === 0) return;
    setCopying(true);

    // Columns format: Date | Equipment Code | Fault Code | Delay (min)
    const tsvContent = activeValidRows
      .map(row => {
        const dateStr = row.date || globalDate || '2-Jun';
        const code = row.equipmentCode || '';
        const fault = row.faultCode || '';
        const delay = row.delayMinutes !== undefined ? row.delayMinutes : '';
        return `${dateStr}\t${code}\t${fault}\t${delay}`;
      })
      .join('\n');

    navigator.clipboard.writeText(tsvContent).then(() => {
      setCopiedText(true);
      setTimeout(() => {
        setCopiedText(false);
      }, 2500);
      setCopying(false);
    }).catch(err => {
      console.error('Clipboard copy failed:', err);
      setCopying(false);
    });
  };

  // Generates and triggers download of a clean CSV file
  const handleDownloadCSV = () => {
    if (activeValidRows.length === 0) return;

    const headers = ['Date', 'Equipment Code', 'Fault Code', 'Delay (min)'];
    const rowsList = activeValidRows.map(row => [
      row.date || globalDate || '2-Jun',
      row.equipmentCode || '',
      row.faultCode || '',
      row.delayMinutes !== undefined ? String(row.delayMinutes) : ''
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' 
      + [headers.join(','), ...rowsList.map(r => r.join(','))].join('\n');
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `${equipmentType.toLowerCase()}_delays_${globalDate.replace(/\s+/g, '_') || 'log'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div id={`table-container-${equipmentType}`} className="space-y-4">
      
      {/* Stats Summary Panel */}
      <div id="stats-banner" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 bg-[#F8FAFC] border border-slate-200/80 p-3.5 rounded-xl">
        <div id="stat-incidents" className="flex flex-col">
          <span className="text-[10px] font-semibold text-[#64748B] uppercase tracking-wider">Valid Incidents</span>
          <span className="text-xl font-bold text-[#1E293B] tabular-nums mt-0.5">
            {activeCount} <span className="text-xs font-normal text-slate-400">active</span>
          </span>
        </div>

        <div id="stat-maint-delay" className="flex flex-col sm:border-l sm:border-slate-200/80 sm:pl-3">
          <span className="text-[10px] font-semibold text-amber-700 uppercase tracking-wider flex items-center gap-1">
            Total Maint Delay
          </span>
          <span className="text-xl font-bold text-amber-600 tabular-nums flex items-center gap-1.5 mt-0.5">
            <Wrench className="h-4 w-4 shrink-0 text-amber-600" />
            {maintDelays} <span className="text-xs font-normal text-slate-500">mins</span>
            <span className="ml-1 text-[9px] font-bold bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-mono">ENG</span>
          </span>
        </div>

        <div id="stat-ops-delay" className="flex flex-col sm:border-l sm:border-slate-200/80 sm:pl-3">
          <span className="text-[10px] font-semibold text-sky-700 uppercase tracking-wider flex items-center gap-1">
            Total Ops Delay
          </span>
          <span className="text-xl font-bold text-sky-600 tabular-nums flex items-center gap-1.5 mt-0.5">
            <Clock className="h-4 w-4 shrink-0 text-sky-600" />
            {opsDelays} <span className="text-xs font-normal text-slate-500">mins</span>
            <span className="ml-1 text-[9px] font-bold bg-sky-100 text-sky-800 px-1.5 py-0.5 rounded font-mono">OPD</span>
          </span>
        </div>

        <div id="stat-total-delay" className="flex flex-col lg:border-l lg:border-slate-200/80 lg:pl-3">
          <span className="text-[10px] font-semibold text-[#64748B] uppercase tracking-wider">Total Delay Time</span>
          <span className="text-xl font-bold text-[#0284C7] tabular-nums flex items-center gap-1.5 mt-0.5">
            <Clock className="h-4 w-4 shrink-0 text-[#0284C7]" />
            {totalDelays} <span className="text-xs font-normal text-slate-500">mins</span>
          </span>
        </div>

        <div id="stat-ignored" className="flex flex-col sm:border-l sm:border-slate-200/80 sm:pl-3">
          <span className="text-[10px] font-semibold text-[#64748B] uppercase tracking-wider">Ignored Rows</span>
          <span className="text-xl font-bold text-slate-400 tabular-nums mt-0.5">
            {ignoredCount} <span className="text-xs font-normal text-slate-300">filtered</span>
          </span>
        </div>
      </div>

      {/* Table grid scrolling wrapper */}
      <div id="table-scroll-wrapper" className="overflow-x-auto border border-slate-200/85 rounded-xl bg-white shadow-xs">
        <table id={`table-element-${equipmentType}`} className="w-full min-w-[500px] border-collapse text-left text-sm font-sans">
          <thead>
            <tr className="bg-slate-50/70 border-b border-slate-200 text-[#475569] text-[11px] font-bold uppercase tracking-wider">
              <th className="py-3 px-3.5 w-24">Date</th>
              <th className="py-3 px-3 w-32">Equipment Code</th>
              <th className="py-3 px-3 w-32">Fault Code</th>
              <th className="py-3 px-3 w-28">Delay (min)</th>
              <th className="py-3 px-3.5 w-24 text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-150">
            {activeRows.length === 0 ? (
              <tr id="empty-table-prompt">
                <td colSpan={5} className="py-10 text-center text-slate-400 text-xs">
                  <div className="flex flex-col items-center gap-2 max-w-[280px] mx-auto">
                    <AlertTriangle className="h-5 w-5 text-slate-300" />
                    <p className="font-semibold text-slate-600 font-sans">No logs extracted yet</p>
                    <p className="text-[11px] text-[#94A3B8]">
                      Upload a handwritten paper log image above or click "Add Row" below to start manually.
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              activeRows.map((row) => (
                <tr
                  id={`row-item-${row.id}`}
                  key={row.id}
                  className={`transition-all duration-200 ${
                    row.isIgnored 
                      ? 'bg-slate-50 text-slate-400 line-through opacity-60 decoration-red-400 decoration-1' 
                      : 'hover:bg-slate-50/50'
                  }`}
                >
                  {/* Date Column */}
                  <td className="py-2.5 px-3.5">
                    <input
                      id={`input-row-date-${row.id}`}
                      type="text"
                      value={row.date || globalDate || '2-Jun'}
                      onChange={(e) => onUpdateRow(row.id, { date: e.target.value })}
                      placeholder="2-Jun"
                      className="w-16 bg-transparent border-b border-slate-200 focus:border-[#0284C7] font-mono px-0.5 py-0.5 text-xs outline-hidden text-[#475569] shrink-0"
                    />
                  </td>

                  {/* Equipment Code Column */}
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-1 max-w-[120px]">
                      <span className="text-[11px] text-slate-400 select-none font-bold">
                        {equipmentType === 'CRANE' ? '40' : equipmentType === 'RTG' ? '50' : '60'}
                      </span>
                      <input
                        id={`input-raw-code-${row.id}`}
                        type="text"
                        value={row.rawEquipmentCode}
                        onChange={(e) => handleRawCodeChange(row.id, e.target.value)}
                        placeholder="00"
                        className="w-12 text-center bg-transparent border-b border-slate-200 focus:border-[#0284C7] font-mono font-semibold px-0.5 py-0.5 text-xs outline-hidden focus:outline-hidden text-slate-800"
                      />
                      <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono text-center shrink-0 border border-slate-200/50">
                        {row.equipmentCode || '----'}
                      </span>
                    </div>
                  </td>

                  {/* Fault Code Column */}
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-2">
                      <select
                        id={`select-ops-maint-${row.id}`}
                        value={row.opsOrMaint}
                        onChange={(e) => handleOpsMaintChange(row.id, e.target.value as any)}
                        className="bg-[#F8FAFC] border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-700 font-medium outline-hidden select-none cursor-pointer focus:border-[#0284C7]"
                      >
                        <option value="">--</option>
                        <option value="O">O (Ops)</option>
                        <option value="M">M (Maint)</option>
                      </select>
                      {row.faultCode && (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded text-center shrink-0 ${
                          row.faultCode === 'OPD' 
                            ? 'bg-sky-50 text-[#0284C7] border border-sky-100' 
                            : 'bg-amber-50 text-amber-700 border border-amber-100'
                        }`}>
                          {row.faultCode}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Delay column with Time Picker and Manual Durations */}
                  <td className="py-2.5 px-3 font-mono text-xs tabular-nums text-slate-700">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-1">
                        <input
                          id={`input-start-time-${row.id}`}
                          type="text"
                          placeholder="Start"
                          value={row.startTime}
                          onChange={(e) => handleTimeChange(row.id, 'startTime', e.target.value, row.endTime)}
                          className="w-11 text-center bg-transparent border-b border-slate-200 focus:border-[#0284C7] px-0.5 py-0.5 text-xs outline-hidden shrink-0"
                        />
                        <span className="text-slate-300">-</span>
                        <input
                          id={`input-end-time-${row.id}`}
                          type="text"
                          placeholder="Finish"
                          value={row.endTime}
                          onChange={(e) => handleTimeChange(row.id, 'endTime', e.target.value, row.startTime)}
                          className="w-11 text-center bg-transparent border-b border-slate-200 focus:border-[#0284C7] px-0.5 py-0.5 text-xs outline-hidden shrink-0"
                        />
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <input
                          id={`input-delay-mints-${row.id}`}
                          type="number"
                          value={row.delayMinutes || ''}
                          onChange={(e) => onUpdateRow(row.id, { delayMinutes: parseInt(e.target.value, 10) || 0 })}
                          placeholder="0"
                          className="w-10 text-center bg-transparent border-b border-slate-200 focus:border-[#0284C7] font-semibold px-0.5 py-0.5 text-xs text-[#0284C7] outline-hidden focus:outline-hidden"
                        />
                        <span className="text-[10px] text-slate-400 select-none">mins</span>
                      </div>
                    </div>
                  </td>

                  {/* Action/Ignore Column */}
                  <td className="py-2.5 px-3.5">
                    <div className="flex items-center justify-center gap-1">
                      {/* Toggle Ignore */}
                      <button
                        id={`btn-toggle-ignore-${row.id}`}
                        type="button"
                        onClick={() => onUpdateRow(row.id, { isIgnored: !row.isIgnored })}
                        title={row.isIgnored ? "Make active" : "Ignore row"}
                        className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                          row.isIgnored
                            ? 'bg-red-50 border-red-200 text-red-600 hover:bg-red-100'
                            : 'bg-slate-50 border-slate-200 text-slate-400 hover:text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        {row.isIgnored ? <Undo className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
                      </button>

                      {/* Delete */}
                      <button
                        id={`btn-delete-${row.id}`}
                        type="button"
                        onClick={() => onDeleteRow(row.id)}
                        title="Delete entry"
                        className="p-1.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-400 hover:text-red-500 hover:border-red-200 hover:bg-red-50 transition-all cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {activeValidRows.length > 0 && (
            <tfoot className="bg-slate-50/90 border-t-2 border-slate-200 font-medium text-xs text-slate-700">
              <tr>
                <td colSpan={2} className="py-2.5 px-3.5 font-bold text-slate-500 uppercase text-[10px] tracking-wider">
                  Summary Totals ({activeCount} active)
                </td>
                <td className="py-2.5 px-3 text-[11px]">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-amber-800 font-semibold flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                      Maint (ENG):
                    </span>
                    <span className="text-sky-800 font-semibold flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-sky-500"></span>
                      Ops (OPD):
                    </span>
                  </div>
                </td>
                <td className="py-2.5 px-3 font-mono font-bold">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-amber-700">{maintDelays} mins</span>
                    <span className="text-sky-700">{opsDelays} mins</span>
                  </div>
                </td>
                <td className="py-2.5 px-3.5 text-center text-[10px] text-slate-500 font-mono">
                  All: <span className="font-bold text-[#0284C7]">{totalDelays}m</span>
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Grid Bottom Action bar */}
      <div id="table-footer-actions" className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 font-sans">
        {/* Left add & clear triggers */}
        <div className="flex items-center gap-2">
          <button
            id={`btn-add-incident-${equipmentType}`}
            onClick={onAddRow}
            className="flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-bold bg-[#1E293B] text-white rounded-xl hover:bg-slate-800 transition-all cursor-pointer shadow-2xs"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Row
          </button>
          
          {activeRows.length > 0 && (
            <button
              id={`btn-clear-${equipmentType}`}
              onClick={onClearRows}
              className="px-3.5 py-2 text-xs font-semibold border border-slate-200 text-[#475569] rounded-xl hover:bg-slate-50 hover:text-slate-900 transition-all cursor-pointer"
            >
              Clear Tab Data
            </button>
          )}
        </div>

        {/* Right download & copy triggers */}
        {activeValidRows.length > 0 && (
          <div className="flex flex-col sm:flex-row gap-2">
            {/* Download as CSV */}
            <button
              id={`btn-download-csv-${equipmentType}`}
              onClick={handleDownloadCSV}
              className="flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-white border border-slate-200 hover:border-slate-300 text-[#475569] rounded-xl hover:shadow-2xs transition-all cursor-pointer"
            >
              <Download className="h-3.5 w-3.5 text-slate-500" />
              Download CSV
            </button>

            {/* Copy for Excel */}
            <button
              id={`btn-copy-tsv-${equipmentType}`}
              onClick={handleCopyToClipboard}
              disabled={copying}
              className={`flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer select-none ${
                copiedText 
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white' 
                  : 'bg-[#0284C7] hover:bg-[#0369A1] text-white'
              }`}
            >
              <Clipboard className="h-3.5 w-3.5 shrink-0" />
              {copiedText ? 'Copied to Excel!' : 'Copy for Excel (CTRL+V)'}
            </button>
          </div>
        )}
      </div>

      {copiedText && (
        <div id="copy-clipboard-tip" className="p-4 bg-emerald-50 border border-emerald-150 text-emerald-800 text-[11px] font-medium rounded-xl shadow-2xs text-left animate-slide-up flex gap-2.5 items-center">
          <Check className="h-4 w-4 text-emerald-600 shrink-0" />
          <p className="leading-relaxed">
            <strong>Copied to clipboard successfully!</strong> Simply open your Excel log, click on the target <strong>Date</strong> starting cell (e.g. <code>A3</code>), and press <strong>CTRL+V</strong>. The columns will paste perfectly into your layout.
          </p>
        </div>
      )}

    </div>
  );
}
