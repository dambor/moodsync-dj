export const SCENE_PRESETS = {
  calm_indoor: {
    prompts: [
      { text: "Lo-fi chill beats, warm Rhodes piano, soft vinyl crackle, gentle brushed drums, 85 BPM", weight: 0.7 },
      { text: "Ambient pads, smooth jazz undertones, mellow vibes", weight: 0.3 },
    ],
    color: "#4A90D9", label: "Chill Vibes", emoji: "☕", energy: 0.3,
  },
  energetic: {
    prompts: [
      { text: "Upbeat electronic dance, driving four-on-the-floor beat, bright synths, 128 BPM", weight: 0.7 },
      { text: "Festival energy, euphoric drops, pulsing bass, hands-in-the-air moment", weight: 0.3 },
    ],
    color: "#E74C3C", label: "High Energy", emoji: "🔥", energy: 0.9,
  },
  nature: {
    prompts: [
      { text: "Ambient nature soundscape, gentle acoustic guitar, flowing water textures, open air feeling", weight: 0.6 },
      { text: "Peaceful folk melody, warm strings, birds, sunlight warmth", weight: 0.4 },
    ],
    color: "#2ECC71", label: "Nature Flow", emoji: "🌿", energy: 0.4,
  },
  work_focus: {
    prompts: [
      { text: "Minimal ambient electronica, soft pads, no drums, low brightness, repetitive gentle patterns", weight: 0.8 },
      { text: "Deep focus drone, warm textures, concentration", weight: 0.2 },
    ],
    color: "#9B59B6", label: "Deep Focus", emoji: "🧠", energy: 0.2,
  },
  social: {
    prompts: [
      { text: "Upbeat funk groove, slap bass, claps, bright horns, 110 BPM", weight: 0.6 },
      { text: "Feel-good pop energy, catchy rhythm, warm party vibe", weight: 0.4 },
    ],
    color: "#F39C12", label: "Social Groove", emoji: "🎉", energy: 0.7,
  },
  night: {
    prompts: [
      { text: "Dark ambient, deep bass drones, cinematic tension, sparse percussion", weight: 0.6 },
      { text: "Synthwave, retrowave pads, neon city atmosphere, nocturnal", weight: 0.4 },
    ],
    color: "#2C3E50", label: "Night Mode", emoji: "🌙", energy: 0.4,
  },
  rainy: {
    prompts: [
      { text: "Melancholic piano, soft rain textures, gentle cello, slow tempo, 70 BPM", weight: 0.7 },
      { text: "Cozy jazz cafe, brushed drums, warm upright bass", weight: 0.3 },
    ],
    color: "#5D6D7E", label: "Rainy Day", emoji: "🌧️", energy: 0.3,
  },
  workout: {
    prompts: [
      { text: "Intense EDM, hard-hitting drums, aggressive bass drops, 140 BPM, adrenaline", weight: 0.7 },
      { text: "Shredding guitar, powerful drum fills, stadium energy", weight: 0.3 },
    ],
    color: "#E67E22", label: "Beast Mode", emoji: "💪", energy: 0.95,
  },
};

export const SCENE_TYPES = Object.keys(SCENE_PRESETS);
export const GEMINI_SCENE_SCHEMA = `one of [${SCENE_TYPES.map(s => `"${s}"`).join(",")}]`;
