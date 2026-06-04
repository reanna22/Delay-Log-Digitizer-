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
      'gemini-3.5-flash',
      'gemini-flash-latest',
      'gemini-3.1-flash-lite'
    ];

    let lastError: any = null;

    for (let m = 0; m < modelsToTry.length; m++) {
      const currentModel = modelsToTry[m];
      console.log(`[Gemini API] Attempting generation with model: ${currentModel}`);

      const maxRetries = currentModel === 'gemini-3.5-flash' ? 3 : 2;
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
      const { image, mimeType } = req.body;

      if (!image || !mimeType) {
        res.status(400).json({ success: false, error: 'Missing image data or mimeType' });
        return;
      }

      console.log(`[API] Received digitize request, image length: ${image.length}, type: ${mimeType}`);

      const ai = getGeminiClient();

      // Setup parts for multimodal Gemini model
      const imagePart = {
        inlineData: {
          mimeType: mimeType,
          data: image,
        },
      };

      const systemInstruction = `
You are an expert OCR and terminal ops data-digitization tool. You analyze handwriting in crane and RTG/RMG delay logs, extracting structured log data.
Identify if the document is a "Crane Delay Log" or a "RTG and RMG Delay Log" based on the headers. 
Extract key headers and each row in the log. Return a strictly conforming JSON result.

Rules for fields:
1. "date": Extract date (e.g. "2-Jun-26") from header. Formats should be standardized as "D-MMM" (e.g., "2-Jun").
2. "vessel": Extract "Frankfurt Express" or other vessel name from the Vessel field if present, or leave empty.
3. "foreman" and "electrician": Extract names from Foreman and Electrician headers.
4. "shift": Standard Shift number (e.g., "1").
5. "rows": Array of each row in the main log table. Only extract rows where something was written!
   For each row:
   a. "equipmentType": Should be "CRANE", "RTG", or "RMG".
      - "CRANE": From Crane Delay Log.
      - "RTG": From RTG/RMG Delay Log, for rows starting with "50" or having RTG context.
      - "RMG": From RTG/RMG Delay Log, specifically if RMG is written (e.g., in the leftmost margin next to the 60 code) or for rows starting with "60".
   b. "rawEquipmentCode": Extract the handwritten number part (e.g., "7" or "09" or "01").
   c. "equipmentCode": The computed equipment code of format:
      - Crane: "40" + 2-digit padded raw number (e.g. Crane 7 -> "4007", Crane 4 -> "4004"). Let's pad it carefully! E.g., Crane 12 is "4012".
      - RTG: "50" + 2-digit padded raw number (e.g. RTG 09 -> "5009").
      - RMG: "60" + 2-digit padded raw number (e.g. RMG 01 -> "6001").
   d. "reportedProblem": Handwritten reported symptom (e.g., "No gantry", "HOIST CUTS OUT", "O/H. GEAR").
   e. "resolution": Handwritten resolution details (e.g., "Gantry ok slow to start moving...", "HOIST DRIVE FLT.").
   f. "opsOrMaint": Categorization. Look for circled "O" (Ops) or "M" (Maint). If M has a red line/slash crossing it out, and O is green circled, select "O". Or vice versa. If O is circled with green, it is "O". If M is circled with green, it is "M". If neither, default to "".
   g. "faultCode": "OPD" for "O", or "ENG" for "M". Default empty if neither can be identified.
   h. "startTime" and "endTime": Start and Finish times (e.g. "5:55" and "6:30"). Preserve the exact handwritten hours and minutes.
   i. "delayMinutes": Calculate time duration. Calculate absolute difference in minutes. For example, 1:20 to 1:32 = 12 mins. 5:55 to 6:30 = 35 mins. 5:11 to 5:18 = 7 mins. 5:27 to 5:32 = 5 mins. Ensure calculations are exact!
   j. "details": Excel details description. Combine "REPORTED_PROBLEM - RESOLUTION" neatly (e.g. "No gantry - Gantry ok slow to start moving Brk Rel Time out" or "HOIST CUTS OUT - HOIST DRIVE FLT."). Expand abbreviations where appropriate to sound professional and clear.
   k. "isIgnored": Set to true if a whole row has a red horizontal line/diagonal line slashing or crossing through it (e.g., the whole Crane 4 row in Image 1 is slashed with a red diagonal line). If just a single cell or letter is corrected with a slash (like the M in RMG 60 01 being slashed out and O circled in green next to it in Image 2), the row is NOT ignored! Only ignore if the entire row's data is slashed/crossed out or explicitly cancelled.
   l. "ignoreReason": E.g. "Red line cross out" or empty.
`;

      const prompt = `Please analyze this image of a delay log and extract all headers and row logs according to the specified instructions. Run OCR on all fields. Make sure to carefully process green circles and red crossings, and output valid JSON.`;

      const response = await generateContentWithRetryAndFallback(ai, {
        contents: { parts: [imagePart, { text: prompt }] },
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
                    ignoreReason: { type: Type.STRING }
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
                    'isIgnored'
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
