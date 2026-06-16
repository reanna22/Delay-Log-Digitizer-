/**
 * Full-stack Express server integrating Vite middleware in development
 * and serving built static assets in production.
 * Handles the Gemini API calls for handwritten log digitization.
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

// Safe runtime path resolution for ESM/CJS compatibility without redeclaration collisions
const resolvedFilename = typeof __filename !== 'undefined' ? __filename : (typeof import.meta !== 'undefined' && import.meta.url ? fileURLToPath(import.meta.url) : '');
const resolvedDirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(resolvedFilename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Setup body parsers with limits for large image files (up to 50mb)
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Shared Gemini client. Standard lazy-load style to ensure no crash if key is missing initially.
  let aiClient: GoogleGenAI | null = null;
  function getGeminiClient(): GoogleGenAI {
    if (!aiClient) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error('GEMINI_API_KEY environment variable is not configured. Please add your key in Settings > Secrets.');
      }
      aiClient = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });
    }
    return aiClient;
  }

  // --- Gemini API Robust Retry and Fallback Helpers ---
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  function isRetryableError(error: any): boolean {
    if (!error) return false;
    const errMsg = String(error.message || error).toLowerCase();
    return (
      errMsg.includes('503') ||
      errMsg.includes('429') ||
      errMsg.includes('unavailable') ||
      errMsg.includes('high demand') ||
      errMsg.includes('overloaded') ||
      errMsg.includes('rate limit') ||
      errMsg.includes('spikes in demand') ||
      errMsg.includes('resource_exhausted') ||
      errMsg.includes('temporary') ||
      errMsg.includes('service unavailable')
    );
  }

  async function generateContentWithRetryAndFallback(ai: GoogleGenAI, baseParams: any) {
    const modelsToTry = [
      'gemini-2.5-flash',
      'gemini-3.5-flash',
      'gemini-3.1-flash-lite',
      'gemini-flash-latest',
      'gemini-3.1-pro-preview',
      'gemini-2.5-pro'
    ];

    let lastError: any = null;
    let isQuotaErrorEncountered = false;

    for (let m = 0; m < modelsToTry.length; m++) {
      const currentModel = modelsToTry[m];
      console.log(`[Gemini API] Attempting generation with model: ${currentModel}`);

      const maxRetries = 3;
      let delay = 1000;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const response = await ai.models.generateContent({
            ...baseParams,
            model: currentModel,
          });

          if (response && response.text) {
            console.log(`[Gemini API] Success with model: ${currentModel} on attempt ${attempt}`);
            return response;
          }
          throw new Error('Empty response received from Gemini');
        } catch (error: any) {
          lastError = error;
          const errMsg = String(error.message || error);
          console.warn(`[Gemini API] Attempt ${attempt} failed for model ${currentModel}. Error: ${errMsg}`);

          if (
            errMsg.toLowerCase().includes('quota') ||
            errMsg.toLowerCase().includes('rate limit') ||
            errMsg.toLowerCase().includes('resource_exhausted') ||
            error.status === 'RESOURCE_EXHAUSTED' ||
            error.statusCode === 429
          ) {
            isQuotaErrorEncountered = true;
          }

          const retryable = isRetryableError(error);
          if (retryable && attempt < maxRetries) {
            console.log(`[Gemini API] Transient error detected. Retrying in ${delay}ms...`);
            await sleep(delay);
            delay *= 2; // Exponential backoff
          } else if (!retryable) {
            const isAuthError = errMsg.toLowerCase().includes('api key') || 
                                errMsg.toLowerCase().includes('unauthorized') || 
                                errMsg.toLowerCase().includes('key not valid') ||
                                errMsg.toLowerCase().includes('not configured');
            if (isAuthError) {
              throw error;
            }
            // For other errors, break out of retry loop to try the next model immediately
            break;
          }
        }
      }
    }

    if (isQuotaErrorEncountered) {
      throw new Error(
        'You have temporarily exceeded the daily Gemini API quota on the free tier. ' +
        'To bypass this limit, please configure your own Google AI Studio API Key in the "Settings > Secrets" panel.'
      );
    }

    throw lastError || new Error('All Gemini API models failed to process the request due to high demand');
  }

  // --- API Routes ---

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  // Digitize paper log
  app.post('/api/digitize', async (req, res) => {
    try {
      let imagesBatch: { data: string; mimeType: string }[] = [];

      if (req.body.images && Array.isArray(req.body.images)) {
        imagesBatch = req.body.images;
      } else if (req.body.image && req.body.mimeType) {
        imagesBatch = [{ data: req.body.image, mimeType: req.body.mimeType }];
      }

      if (imagesBatch.length === 0) {
        res.status(400).json({ success: false, error: 'Missing image data or images batch array' });
        return;
      }

      console.log(`[API] Received digitize request with ${imagesBatch.length} images in batch.`);

      const ai = getGeminiClient();

      // Setup parts for multimodal Gemini model
      const imageParts = imagesBatch.map((img: any) => ({
        inlineData: {
          mimeType: img.mimeType,
          data: img.data,
        },
      }));

      const systemInstruction = `
You are an expert OCR and terminal ops data-digitization tool. You analyze handwriting in crane and RTG/RMG delay logs, extracting structured log data.
Identify if the document is a "Crane Delay Log" or a "RTG and RMG Delay Log" based on the headers. 
Extract key headers and each row in the log. Return a strictly conforming JSON result.

Rules for fields:
1. "date": Extract date from the top header. Standardize all dates to "D-MMM" format (e.g. "2-Jun", "20-Apr", "12-Jun", "9-Jun", "14-Jun").
2. "vessel": Extract "Frankfurt Express" or other vessel name from the Vessel field if present, or leave empty.
3. "foreman" and "electrician": Extract names from Foreman and Electrician headers.
4. "shift": Standard Shift number (e.g., "1").
5. "rows": Array of each row in the main log table. Only extract rows where something was written!
   IMPORTANT: If a handwritten row lists multiple equipment codes/numbers (for example, "3 & 4" or "09 & 10" or "5 & 2" or "5 &2" under Crane), you should split them into separate objects in the "rows" array. Each split object should have the exact same information (times, details, comments, reportedProblem, resolution, etc.) but with its own individual equipmentCode and rawEquipmentCode. For example, if an RMG row lists "03 & 4" (representing RMG 6003 and RMG 6004), generate one object for RMG 6003 (rawEquipmentCode "03", equipmentCode "6003") and a second separate object with the exact same details/times for RMG 6004 (rawEquipmentCode "4", equipmentCode "6004"). If a Crane row lists "5 & 2" (representing Crane 4005 and Crane 4002), generate one object with "4005" (raw "5") and a second separate object with "4002" (raw "2") with the exact same details/times/etc.
   For each row:
   a. "equipmentType": Should be "CRANE", "RTG", or "RMG".
      - "CRANE": From Crane Delay Log.
      - "RTG": From RTG/RMG Delay Log, for rows starting with "50" or having RTG context.
      - "RMG": From RTG/RMG Delay Log. CRITICAL HANDWRITTEN OVERRIDES: If a row has printed "50--" or "RTG" or is in the RTG section, but has a manual handwritten correction (e.g. someone wrote "RMG" next to it, crossed out the printed "50", crossed out "RTG", or changed the prefix to write "60" or "600-"), you MUST classify this row as equipmentType "RMG" and NOT "RTG".
     b. "rawEquipmentCode": Extract the handwritten number part (e.g., "7" or "09" or "01").
   c. "equipmentCode": The computed equipment code of format:
      - Crane: "40" + 2-digit padded raw number (e.g. Crane 7 -> "4007", Crane 4 -> "4004"). Let's pad it carefully! E.g., Crane 12 is "4012".
      - RTG: "50" + 2-digit padded raw number (e.g. RTG 09 -> "5009").
      - RMG: "60" + 2-digit padded raw number (e.g. RMG 01 -> "6001"). Note: If an RTG entry was manually corrected with a cross-out to be RMG or 600-, the prefix MUST be "60" instead of "50" (e.g., "6001").
   d. "reportedProblem": Handwritten reported symptom (e.g., "No gantry", "HOIST CUTS OUT", "O/H. GEAR").
   e. "resolution": Handwritten resolution details (e.g., "Gantry ok slow to start moving...", "HOIST DRIVE FLT.").
   f. "opsOrMaint": Categorization. Look for circled "O" (Ops) or "M" (Maint). If an M is crossed/slashed out AND an O is present/circled/indicated, select "O". If an O is crossed/slashed out AND an M is present/circled/indicated, select "M". In any case where an "O" or "M" is crossed out with no replacement, or if neither is selected, leave "opsOrMaint" as empty "".
   g. "faultCode": "OPD" for "O", or "ENG" for "M". Default empty if neither can be identified.
   h. "startTime" and "endTime": Start and Finish times (e.g. "5:55" and "6:30"). Preserve the exact handwritten hours and minutes.
   i. "delayMinutes": Calculate time duration. Calculate absolute difference in minutes. For example, 1:20 to 1:32 = 12 mins. 5:55 to 6:30 = 35 mins. 5:11 to 5:18 = 7 mins. 5:27 to 5:32 = 5 mins. Ensure calculations are exact!
   j. "details": Excel details description. Combine "REPORTED_PROBLEM - RESOLUTION" neatly (e.g. "No gantry - Gantry ok slow to start moving Brk Rel Time out" or "HOIST CUTS OUT - HOIST DRIVE FLT."). Expand abbreviations where appropriate to sound professional and clear.
   k. "isIgnored": Set to true if any of the following apply: (1) The whole row is slashed/crossed out horizontally or diagonally with a line. (2) There is an "M" or "O" crossed out with no replacement. (3) Neither "O" nor "M" is circled/selected or exists for the row. If an "M" or "O" is crossed out BUT has a replacement selected (e.g., M is crossed out and O is circled as the replacement, or vice versa), the row is NOT ignored! Only ignore if the entire row's data is slashed/crossed out, explicitly cancelled, or there is no "O" or "M" indicator/replacement.
   l. "ignoreReason": E.g. "Red line cross out", "No O or M indicator", or empty.
   m. "date": The standardized date format "D-MMM" (e.g., "12-Jun", "20-Apr", "9-Jun", "14-Jun") extracted from the header (top-left or top section) of the specific page/image where this row is found. Each sheet in the batch might have a different date; ensure that the "date" field for each row matches the date shown on its specific sheet!
`;

      const prompt = `You are processing a batch of delay log images. Treat each image as an independent page. Analyze all images in the order provided.
Extract all valid delay log entries from every image.
For each row, find the date header on its specific page (usually top left, formatted in various ways, for example: "April 20 2026", "12-jun-26", "12-june-2026", "12-june-26", "Jun 9 2026", "9-Jun-26", etc.). Standardize that page's date to "D-MMM" format (e.g., "20-Apr", "12-Jun", "9-Jun", "14-Jun") and assign it to the row's "date" field.
Do not assign the same date to all rows if they come from pages with different dates.
Return one JSON response containing all extracted rows from the entire batch.`;

      const response = await generateContentWithRetryAndFallback(ai, {
        contents: { parts: [...imageParts, { text: prompt }] },
        config: {
          systemInstruction: systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              vessel: { type: Type.STRING },
              date: { type: Type.STRING },
              shift: { type: Type.STRING },
              foreman: { type: Type.STRING },
              electrician: { type: Type.STRING },
              equipmentList: { type: Type.STRING },
              rows: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    equipmentType: { type: Type.STRING, description: "CRANE, RTG, or RMG" },
                    rawEquipmentCode: { type: Type.STRING },
                    equipmentCode: { type: Type.STRING },
                    reportedProblem: { type: Type.STRING },
                    resolution: { type: Type.STRING },
                    opsOrMaint: { type: Type.STRING, description: "M or O" },
                    faultCode: { type: Type.STRING, description: "ENG or OPD" },
                    startTime: { type: Type.STRING },
                    endTime: { type: Type.STRING },
                    delayMinutes: { type: Type.INTEGER },
                    details: { type: Type.STRING },
                    isIgnored: { type: Type.BOOLEAN },
                    ignoreReason: { type: Type.STRING },
                    date: { type: Type.STRING, description: "The standardized date 'D-MMM' (e.g., '2-Jun') from the header at the top of the specific page/image where this row is found" }
                  },
                  required: [
                    'equipmentType',
                    'rawEquipmentCode',
                    'equipmentCode',
                    'reportedProblem',
                    'resolution',
                    'opsOrMaint',
                    'faultCode',
                    'startTime',
                    'endTime',
                    'delayMinutes',
                    'details',
                    'isIgnored',
                    'date'
                  ]
                }
              }
            },
            required: ['rows']
          }
        }
      });

      const responseText = response.text;
      if (!responseText) {
        throw new Error('Gemini model returned an empty response');
      }

      console.log('[API] Gemini Raw response received, text length:', responseText.length);
      
      let cleanedText = responseText.trim();
      
      // Strip markdown code block backticks if present
      if (cleanedText.startsWith('```')) {
        cleanedText = cleanedText
          .replace(/^```json\s*/i, '')
          .replace(/^```\s*/, '')
          .replace(/\s*```$/, '')
          .trim();
      }

      // Extract only the JSON object between the first '{' and the last '}'
      const startIdx = cleanedText.indexOf('{');
      const endIdx = cleanedText.lastIndexOf('}');
      if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        cleanedText = cleanedText.substring(startIdx, endIdx + 1);
      }

      let parsedData;
      try {
        parsedData = JSON.parse(cleanedText);
      } catch (jsonErr: any) {
        console.error('[API] JSON Parse Error. Raw response was:', responseText);
        console.error('[API] Cleaned substring for parse was:', cleanedText);
        console.error('[API] Parse error message:', jsonErr.message);
        throw new Error(`The digitization results from the AI model were not in a valid JSON format. Details: ${jsonErr.message}`);
      }

      // Safeguard: Post-processing to split rows if multiple equipment codes are written in a single line
      if (parsedData && Array.isArray(parsedData.rows)) {
        const expandedRows: any[] = [];
        for (const r of parsedData.rows) {
          const rawCodeStr = String(r.rawEquipmentCode || '').trim();
          const eqCodeStr = String(r.equipmentCode || '').trim();
          
          // Pattern checking for common multiple indicators: "&", "and", ",", "/"
          const splitPattern = /&|\band\b|,|\//i;
          
          if (!splitPattern.test(rawCodeStr) && !splitPattern.test(eqCodeStr)) {
            expandedRows.push(r);
            continue;
          }

          let rawTokens: string[] = [];
          if (splitPattern.test(rawCodeStr)) {
            rawTokens = rawCodeStr.split(splitPattern).map(s => s.trim()).filter(Boolean);
          } else {
            const eqTokens = eqCodeStr.split(splitPattern).map(s => s.trim()).filter(Boolean);
            rawTokens = eqTokens.map(eq => {
              if (eq.length === 4 && (eq.startsWith('40') || eq.startsWith('50') || eq.startsWith('60'))) {
                return eq.substring(2);
              }
              return eq;
            });
          }

          if (rawTokens.length <= 1) {
            expandedRows.push(r);
            continue;
          }

          const type = String(r.equipmentType || 'CRANE').toUpperCase();
          let prefix = '40';
          if (type === 'RTG') prefix = '50';
          else if (type === 'RMG') prefix = '60';

          for (const token of rawTokens) {
            let paddedToken = token;
            if (/^\d+$/.test(token)) {
              paddedToken = token.padStart(2, '0');
            }
            const computedEqCode = prefix + paddedToken;
            expandedRows.push({
              ...r,
              rawEquipmentCode: token,
              equipmentCode: computedEqCode,
            });
          }
        }
        parsedData.rows = expandedRows;
      }

      res.json({
        success: true,
        data: parsedData,
      });

    } catch (error: any) {
      console.error('[API Error] Digitization failed:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Server digitization error',
      });
    }
  });

  // --- Serve Frontend Application ---

  // In production, serve build folder static assets. In dev, mount Vite dev server.
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    // SPA fallback
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Container started. Directing port 3000 -> HTTP`);
    console.log(`[Server] Running on http://localhost:${PORT}`);
  });
}

startServer();
