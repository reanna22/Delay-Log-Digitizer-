import React from 'react';
import { SavedLogSession } from '../types';
import { History, Calendar, Ship, HardDrive, Trash2, ArrowUpRight, Clock } from 'lucide-react';

interface HistoryPanelProps {
  sessions: SavedLogSession[];
  onLoadSession: (session: SavedLogSession) => void;
  onDeleteSession: (id: string) => void;
  onClearAllSessions: () => void;
}

export default function HistoryPanel({
  sessions,
  onLoadSession,
  onDeleteSession,
  onClearAllSessions,
}: HistoryPanelProps) {
  if (sessions.length === 0) {
    return (
      <div id="empty-history-indicator" className="bg-slate-50 border border-slate-200 rounded-xl p-6 text-center text-slate-400 space-y-2">
        <History className="h-6 w-6 text-slate-300 mx-auto" />
        <h4 className="font-semibold text-slate-600 text-xs">No saved history sessions yet</h4>
        <p className="text-[11px] text-slate-400 max-w-[240px] mx-auto leading-relaxed">
          Your digitized logs remain here in local history after you hit "Save Session" on corrected tables.
        </p>
      </div>
    );
  }

  return (
    <div id="history-panel-container" className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
          <History className="h-4 w-4 text-slate-400" />
          Saved Sessions ({sessions.length})
        </h4>
        <button
          id="btn-clear-history"
          onClick={onClearAllSessions}
          className="text-[10px] font-bold text-slate-400 hover:text-red-500 transition-all cursor-pointer"
        >
          Clear History
        </button>
      </div>

      <div id="history-sessions-list" className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
        {sessions.map((session) => {
          const totalRowsCount = session.rows.length;
          const activeRowsCount = session.rows.filter(r => !r.isIgnored).length;

          return (
            <div
              id={`history-session-item-${session.id}`}
              key={session.id}
              className="group p-3 bg-white border border-slate-250 hover:border-slate-300 rounded-xl flex items-center justify-between gap-3 shadow-xs hover:shadow-xs transition-all text-xs"
            >
              <div className="space-y-1 select-none flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-bold text-slate-800 text-xs flex items-center gap-1">
                    <Calendar className="h-3 h-3 text-slate-400" />
                    {session.date || 'Unspecified Date'}
                  </span>
                  {session.vessel && (
                    <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-sm font-medium flex items-center gap-1 text-[10px] shrink-0 max-w-[120px] truncate">
                      <Ship className="h-2.5 w-2.5" />
                      {session.vessel}
                    </span>
                  )}
                  {session.shift && (
                    <span className="bg-amber-50 text-amber-800 border border-amber-100 px-1.5 py-0.5 rounded-sm font-bold text-[9px] shrink-0">
                      Shift {session.shift}
                    </span>
                  )}
                </div>
                
                <div className="flex items-center gap-2 text-[10px] text-slate-400 font-medium">
                  <span>FM: {session.foreman || 'N/A'}</span>
                  <span>•</span>
                  <span>EL: {session.electrician || 'N/A'}</span>
                  <span>•</span>
                  <span className="text-amber-600 font-semibold">{activeRowsCount} active delays</span>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                {/* Restore / Load */}
                <button
                  id={`btn-load-session-${session.id}`}
                  onClick={() => onLoadSession(session)}
                  title="Load log into editor"
                  className="p-1 px-2.5 text-[10px] font-bold bg-slate-50 hover:bg-slate-900 border border-slate-200 text-slate-700 hover:text-white rounded-lg flex items-center gap-1 group/btn transition-all"
                >
                  Edit
                  <ArrowUpRight className="h-3 w-3 text-slate-400 group-hover/btn:text-white transition-colors" />
                </button>

                {/* Delete */}
                <button
                  id={`btn-delete-session-${session.id}`}
                  onClick={() => onDeleteSession(session.id)}
                  title="Remove from history"
                  className="p-1.5 text-slate-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-all"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
