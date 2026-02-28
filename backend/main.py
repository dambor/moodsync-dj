import os
import base64
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from google import genai
from google.genai import types
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Use the new official SDK
client = genai.Client(api_key=os.getenv("VITE_GEMINI_API_KEY"))

# Match the JS predefined scenes
SCENE_TYPES = ["calm_indoor", "work_focus", "social", "nature", "night", "workout", "reading"]

class AudioContextRequest(BaseModel):
    level: float = 0.0
    band: str = "silent"

class AnalyzeRequest(BaseModel):
    image_base64: str
    audio_context: AudioContextRequest = AudioContextRequest()

class SceneAnalysisResponse(BaseModel):
    scene_type: str
    energy_level: float
    mood_keywords: list[str]
    music_suggestion: str
    reasoning: str

SYSTEM_PROMPT = """You are an environment-to-music translator for an adaptive DJ app.
Analyze the camera frame and ambient audio context provided.

Guidelines:
- laptop/desk/screen → work_focus (unless many people)
- people gathered, drinks, food → social
- trees/sky/outdoors → nature
- darkness or dim lighting → night
- exercise equipment or physical activity → workout
- ambiguous → calm_indoor
- energy_level: static=low, movement=high
- music_suggestion: genre, mood, 2 instruments, tempo BPM. MUST be under 25 words.
- reasoning: one short sentence about what you see."""

@app.post("/analyze", response_model=SceneAnalysisResponse)
async def analyze_scene(req: AnalyzeRequest):
    try:
        audio_note = f"\nAmbient audio: level {req.audio_context.level}/1.0, profile: {req.audio_context.band}" if req.audio_context.level > 0 else ""
        
        # Construct the generation request to gemini-2.5-flash
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=[
                SYSTEM_PROMPT + audio_note,
                types.Part.from_bytes(
                    data=base64.b64decode(req.image_base64),
                    mime_type='image/jpeg'
                ),
            ],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=SceneAnalysisResponse,
                temperature=0.3,
            ),
        )

        # The SDK automatically gives us a Pydantic object back if we requested a schema!
        # But wait, generate_content just returns JSON text if we use `response_schema` directly without `parsed`
        # Using `client.models.generate_content(...).parsed` gets the loaded Pydantic object
        if hasattr(response, 'parsed') and response.parsed:
             return response.parsed
             
        # Fallback if `.parsed` isn't populated (depends on Exact SDK version)
        import json
        return SceneAnalysisResponse.model_validate_json(response.text)

    except Exception as e:
        print(f"Error calling Gemini: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
