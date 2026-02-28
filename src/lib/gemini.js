import { SCENE_TYPES } from "../data/presets";

const MAX_RETRIES = 3;

async function fetchWithRetry(url, options, retries = MAX_RETRIES) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return await res.json();

      if ((res.status === 503 || res.status === 429) && attempt < retries) {
        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500;
        console.warn(`Backend ${res.status} — retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${retries})`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      const errText = await res.text();
      throw new Error(`API ${res.status}: ${errText}`);
    } catch (err) {
      if (attempt >= retries) throw err;
      const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500;
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

export async function analyzeScene(apiKey, imageBase64, audioCtx = {}) {
  // We no longer need the apiKey here since the Python backend handles it via .env,
  // but we keep the signature the same so App.jsx doesn't break.
  return fetchWithRetry("http://localhost:8000/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image_base64: imageBase64,
      audio_context: {
        level: audioCtx.level || 0,
        band: audioCtx.band || "silent"
      }
    })
  });
}
