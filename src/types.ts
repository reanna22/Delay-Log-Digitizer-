/**
 * Global types for the Dock Log Digitizer application.
 */

export type EquipmentType = 'CRANE' | 'RTG' | 'RMG';

export interface DigitizedRow {
  id: string; // Unique local identifier (uuid or generated index)
  date?: string; // Optional row-specific date from top of scanned form
  equipmentType: EquipmentType;
  rawEquipmentCode: string; // "7", "09", "01"
  equipmentCode: string; // "4007", "5009", "6001"
  reportedProblem: string; // Symptom
  resolution: string; // Resolution/Correction details
  opsOrMaint: 'O' | 'M' | ''; // Selected category from paper log
  faultCode: 'OPD' | 'ENG' | ''; // OPD for 'O', ENG for 'M'
  startTime: string; // "5:55"
  endTime: string; // "6:30"
  delayMinutes: number; // calculated time difference
  details: string; // Details of fault (typically reportedProblem + " - " + resolution)
  isIgnored: boolean; // whole row is ignored if crossed/red/empty
  ignoreReason?: string; // e.g. "Red crossed out", "Missing data"
}

export interface DigitizeResponse {
  success: boolean;
  error?: string;
  vessel?: string;
  date?: string; // e.g. "2-Jun-26"
  shift?: string; // "1"
  foreman?: string; // "FRASER"
  electrician?: string; // "MIKE"
  equipmentList?: string; // "467" or others
  rows: Omit<DigitizedRow, 'id'>[]; // parsed rows from model, isIgnored is included
}

export interface SavedLogSession {
  id: string; // Unique ID
  timestamp: string; // Saved ISO string
  vessel: string;
  date: string;
  shift: string;
  foreman: string;
  electrician: string;
  fileName: string;
  previewUrl?: string; // base64 preview of uploaded image
  rows: DigitizedRow[];
}
