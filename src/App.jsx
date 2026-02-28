import { useState, useEffect, useRef, useCallback } from "react";
import { SCENE_PRESETS } from "./data/presets";
import { analyzeScene } from "./lib/gemini";
import { LyriaSession } from "./lib/lyria";
import { CameraManager } from "./lib/camera";
import "./App.css";

const ANALYSIS_INTERVAL = 12000;

export default function App() {
  const [apiKey, setApiKey] = useState(import.meta.env.VITE_GEMINI_API_KEY || "");
  const [started, setStarted] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [cameraStatus, setCameraStatus] = useState("idle");
  const [lyriaStatus, setLyriaStatus] = useState("idle");
  const [currentScene, setCurrentScene] = useState(null);
  const [energy, setEnergy] = useState(0.5);
  const [keywords, setKeywords] = useState([]);
  const [reasoning, setReasoning] = useState("");
  const [activePrompts, setActivePrompts] = useState([]);
  const [log, setLog] = useState([]);
  const [error, setError] = useState("");
  const [frameCount, setFrameCount] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [musicPlaying, setMusicPlaying] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [isCameraPaused, setIsCameraPaused] = useState(false);
  const [stylePreference, setStylePreference] = useState("");
  const [eq, setEq] = useState({ bass: 0, mid: 0, treble: 0 });
  const [activeInstruments, setActiveInstruments] = useState(["keyboard", "voice", "bass", "guitar"]);
  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [uploadedImage, setUploadedImage] = useState(null);

  const videoRef = useRef(null);
  const cameraRef = useRef(null);
  const lyriaRef = useRef(null);
  const intervalRef = useRef(null);
  const audioLevelRef = useRef(null);
  const analysisInFlight = useRef(false);
  const fileInputRef = useRef(null);

  const scene = currentScene || SCENE_PRESETS.calm_indoor;

  const addLog = useCallback((msg) => {
    setLog(prev => [{ time: new Date().toLocaleTimeString(), msg }, ...prev].slice(0, 30));
  }, []);

  const updateEq = useCallback((band, value) => {
    setEq(prev => ({ ...prev, [band]: value }));
    if (lyriaRef.current) lyriaRef.current.setEq(band, value);
  }, []);

  const blendPrompts = useCallback((presetPrompts, geminiSuggestion) => {
    let prompts = presetPrompts;
    if (geminiSuggestion) {
      prompts = [
        { text: geminiSuggestion, weight: 0.5 },
        ...presetPrompts.map(p => ({ ...p, weight: p.weight * 0.5 })),
      ];
    }

    // Inject user style preference immediately overriding scene
    if (stylePreference.trim()) {
      prompts = [
        { text: `${stylePreference.trim()} genre, heavy ${stylePreference.trim()} musical elements`, weight: 2.5 },
        ...prompts.map(p => ({ ...p, weight: p.weight * 0.2 })),
      ];
    }

    // Stem Separation Engine
    // Forcefully remove inactive instruments from the AI mix
    const allStems = ["keyboard", "voice", "bass", "guitar"];
    allStems.forEach(stem => {
      if (!activeInstruments.includes(stem)) {
        prompts.push({ text: `no ${stem}, absolutely no ${stem} sounds`, weight: -2.0 });
      } else {
        prompts.push({ text: `featuring acoustic or electric ${stem}`, weight: 0.8 });
      }
    });

    // Filter out effectively zero weight positive prompts for Lyria
    return prompts.filter(p => p.weight > 0.05 || p.weight < -0.05).slice(0, 10);
  }, [stylePreference, activeInstruments]);

  const runAnalysis = useCallback(async () => {
    if (!cameraRef.current || analysisInFlight.current || isCameraPaused) return;
    const frame = cameraRef.current.captureFrame();
    if (!frame) return;
    analysisInFlight.current = true;
    setFrameCount(c => c + 1);
    addLog("🔍 Analyzing scene...");
    try {
      const audioCtx = cameraRef.current.getAudioContext();
      const result = await analyzeScene(apiKey, frame, audioCtx);
      const preset = SCENE_PRESETS[result.scene_type] || SCENE_PRESETS.calm_indoor;
      const blended = blendPrompts(preset.prompts, result.music_suggestion);
      setCurrentScene({ ...preset, type: result.scene_type });
      setEnergy(result.energy_level ?? 0.5);
      setKeywords(result.mood_keywords || []);
      setReasoning(result.reasoning || "");
      setActivePrompts(blended);
      if (lyriaRef.current?.connected) {
        lyriaRef.current.setPrompts(blended);
        lyriaRef.current.setGenerationConfig({
          guidance: 3 + result.energy_level * 3,
          brightness: 0.3 + result.energy_level * 0.5,
          density: 0.2 + result.energy_level * 0.6,
          audioFormat: "pcm16",
          sampleRateHz: 44100,
        });
      }
      addLog(`🎵 → ${preset.label} | energy: ${Math.round(result.energy_level * 100)}%`);
    } catch (e) {
      addLog(`❌ Analysis error: ${e.message}`);
      console.error(e);
    } finally {
      analysisInFlight.current = false;
    }
  }, [apiKey, blendPrompts, addLog, isCameraPaused]);

  const handleImageUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Pause camera so its interval doesn't override our static uploaded analysis
    setIsCameraPaused(true);
    setManualMode(false);

    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64Url = e.target.result;
      const base64Data = base64Url.split(",")[1];
      setUploadedImage(base64Url);

      analysisInFlight.current = true;
      setFrameCount(c => c + 1);
      addLog("🖼️ Analyzing uploaded image...");
      try {
        const audioCtx = cameraRef.current ? cameraRef.current.getAudioContext() : { level: 0, band: "silent" };
        const result = await analyzeScene(apiKey, base64Data, audioCtx);
        const preset = SCENE_PRESETS[result.scene_type] || SCENE_PRESETS.calm_indoor;
        const blended = blendPrompts(preset.prompts, result.music_suggestion);
        setCurrentScene({ ...preset, type: result.scene_type });
        setEnergy(result.energy_level ?? 0.5);
        setKeywords(result.mood_keywords || []);
        setReasoning(result.reasoning || "");
        setActivePrompts(blended);
        if (lyriaRef.current?.connected) {
          lyriaRef.current.setPrompts(blended);
          lyriaRef.current.setGenerationConfig({
            guidance: 3 + result.energy_level * 3,
            brightness: 0.3 + result.energy_level * 0.5,
            density: 0.2 + result.energy_level * 0.6,
            audioFormat: "pcm16",
            sampleRateHz: 44100,
          });
        }
        addLog(`🎵 → ${preset.label} | energy: ${Math.round(result.energy_level * 100)}%`);
      } catch (err) {
        addLog(`❌ Upload error: ${err.message}`);
        console.error(err);
      } finally {
        analysisInFlight.current = false;
      }
    };
    reader.readAsDataURL(file);
    event.target.value = ""; // reset so they can re-upload same file
  };

  // Re-push prompts to active Lyria stream if user changes style or instruments directly
  useEffect(() => {
    if (lyriaRef.current?.connected && scene?.prompts) {
      const blended = blendPrompts(scene.prompts, "");
      setActivePrompts(blended);
      lyriaRef.current.setPrompts(blended);
      addLog(`🎨 Audio profile updated`);
    }
  }, [stylePreference, activeInstruments, blendPrompts, scene.prompts]);

  const selectScene = useCallback((key) => {
    const preset = SCENE_PRESETS[key];
    setCurrentScene({ ...preset, type: key });
    setEnergy(preset.energy);
    setActivePrompts(preset.prompts);
    setKeywords(preset.label.split(" "));
    setReasoning("Manual selection");
    if (lyriaRef.current?.connected) {
      lyriaRef.current.setPrompts(preset.prompts);
      lyriaRef.current.setGenerationConfig({
        guidance: 3 + preset.energy * 3,
        brightness: 0.3 + preset.energy * 0.5,
        density: 0.2 + preset.energy * 0.6,
        audioFormat: "pcm16",
        sampleRateHz: 44100,
      });
      addLog(`🎵 Manual → ${preset.label}`);
    }
  }, [addLog]);

  const refreshDevices = useCallback(async () => {
    try {
      let allDevices = await navigator.mediaDevices.enumerateDevices();
      let videoInputDevices = allDevices.filter(device => device.kind === "videoinput");

      // Chrome often masks device labels and obscures virtual cameras until a raw {video:true} stream is explicitly granted in the current session
      if (videoInputDevices.some(d => d.label === '')) {
        const tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
        tempStream.getTracks().forEach(track => track.stop());
        allDevices = await navigator.mediaDevices.enumerateDevices();
        videoInputDevices = allDevices.filter(device => device.kind === "videoinput");
      }

      setDevices(videoInputDevices);
      if (videoInputDevices.length > 0 && !selectedDeviceId) {
        setSelectedDeviceId(videoInputDevices[0].deviceId);
      }
    } catch (e) {
      console.warn("Failed to enumerate devices:", e);
    }
  }, [selectedDeviceId]);

  const handleStart = useCallback(async () => {
    if (!apiKey.trim()) { setError("Enter your Gemini API key (or set VITE_GEMINI_API_KEY in .env)"); return; }
    setError("");
    setStarted(true);
    addLog("🚀 Starting MoodSync DJ...");

    if (!manualMode) {
      try {
        cameraRef.current = new CameraManager();
        await cameraRef.current.start(videoRef.current, selectedDeviceId);
        setCameraStatus("connected");
        addLog("📷 Camera ready");
        // Fetch available devices after permissions are granted
        await refreshDevices();

        // Listen for Continuity Camera or USB hotplugs
        navigator.mediaDevices.addEventListener("devicechange", refreshDevices);
      } catch (e) {
        setCameraStatus("error");
        setError(`Camera: ${e.message}. Try manual mode.`);
        addLog(`❌ Camera error: ${e.message}`);
      }
    }

    try {
      lyriaRef.current = new LyriaSession(apiKey, {
        onStatus: s => { setLyriaStatus(s); addLog(`🎹 Lyria: ${s}`); },
        onError: msg => addLog(`❌ Lyria: ${msg}`),
        onPromptAck: () => addLog("✅ Prompt accepted by Lyria"),
      });
      await lyriaRef.current.connect();
      const initial = SCENE_PRESETS.calm_indoor;
      lyriaRef.current.setPrompts(initial.prompts);
      setCurrentScene({ ...initial, type: "calm_indoor" });
      setActivePrompts(initial.prompts);
      setMusicPlaying(true);
    } catch (e) {
      addLog(`⚠️ Lyria failed: ${e.message} — running in visual-only mode`);
    }

    if (!manualMode) {
      setTimeout(runAnalysis, 2000);
    }
  }, [apiKey, manualMode, runAnalysis, addLog, blendPrompts, selectedDeviceId]);

  // Handle hot-swapping cameras if selectedDeviceId changes after start
  useEffect(() => {
    if (started && !manualMode && cameraRef.current && selectedDeviceId) {
      const switchDevice = async () => {
        cameraRef.current.stop();
        cameraRef.current = new CameraManager();
        try {
          await cameraRef.current.start(videoRef.current, selectedDeviceId);
          addLog("📷 Camera switched");
        } catch (e) {
          addLog(`❌ Switch failed: ${e.message}`);
        }
      };
      switchDevice();
    }
  }, [selectedDeviceId, started, manualMode, addLog]);

  useEffect(() => {
    if (!started || manualMode || isCameraPaused) {
      if (cameraRef.current) cameraRef.current.pauseVideo();
      return;
    }

    if (cameraRef.current) {
      cameraRef.current.resumeVideo().catch(e => addLog(`Camera resume error: ${e.message}`));
    }

    audioLevelRef.current = setInterval(() => {
      if (cameraRef.current) { const { level } = cameraRef.current.getAudioContext(); setAudioLevel(level); }
    }, 200);

    return () => clearInterval(audioLevelRef.current);
  }, [started, manualMode, isCameraPaused, addLog]);

  useEffect(() => {
    if (!started || isCameraPaused) {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      return;
    }
    if (manualMode && intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    } else if (!manualMode && !intervalRef.current) {
      intervalRef.current = setInterval(runAnalysis, ANALYSIS_INTERVAL);
    }

    return () => {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    };
  }, [manualMode, started, isCameraPaused, runAnalysis]);

  useEffect(() => {
    return () => {
      clearInterval(intervalRef.current);
      clearInterval(audioLevelRef.current);
      lyriaRef.current?.disconnect();
      cameraRef.current?.stop();
    };
  }, []);

  return (
    <>
      <video ref={videoRef} style={{ display: "none" }} playsInline muted />
      {!started ? (
        <div className="app setup">
          <div className="setup-card">
            <div className="logo">
              <span className="logo-icon">🎧</span>
              <h1>MoodSync DJ</h1>
              <p className="subtitle">Environment-aware adaptive music<br />Gemini 3 + Lyria RealTime</p>
            </div>
            <div className="form-group">
              <label>GEMINI API KEY</label>
              <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="AIza..." />
              <span className="hint">Get one free at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">aistudio.google.com</a></span>
            </div>
            {error && <p className="error">{error}</p>}
            <button className="btn-start" onClick={handleStart}>Start MoodSync DJ</button>
            <div className="how-it-works">
              <strong>How it works:</strong> Camera captures your environment every 6s → Gemini 3 analyzes the scene → translates to music parameters → Lyria RealTime streams adaptive music that morphs continuously.
            </div>
          </div>
        </div>
      ) : (
        <div className="app dj" style={{ "--scene-color": scene.color }}>
          {/* Left Sidebar */}
          <aside className="dj-sidebar">
            <div className="brand">
              <span className="logo-icon" style={{ fontSize: "28px" }}>🎧</span>
              <h1>MoodSync DJ</h1>
            </div>

            <div className="sidebar-section">
              <label>Input Source</label>
              <div className="scene-list" style={{ flexDirection: "column", gap: "12px" }}>

                {/* Embedded Manual Mode Toggle */}
                <div
                  className="toggle-row compact"
                  onClick={() => setManualMode(!manualMode)}
                  style={{ background: "rgba(255,255,255,0.05)", padding: "12px", borderRadius: "8px", cursor: "pointer", display: "flex", alignItems: "center", gap: "12px" }}
                >
                  <div className={`toggle ${manualMode ? "on" : ""}`}><div className="toggle-thumb" /></div>
                  <div style={{ flex: 1 }}>
                    <div className="toggle-label" style={{ fontSize: "13px", color: "#fff" }}>Manual Mode</div>
                    <div className="toggle-hint" style={{ fontSize: "11px", marginTop: "2px", color: "var(--muted)" }}>
                      {manualMode ? "Pick scenes directly" : "Camera auto-detect"}
                    </div>
                  </div>
                </div>

                {!manualMode && (
                  <>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button
                        className={`scene-btn ${!isCameraPaused && !uploadedImage ? "active" : ""}`}
                        onClick={() => { setIsCameraPaused(!isCameraPaused); setUploadedImage(null); }}
                        style={{ flex: 1, justifyContent: "center", padding: "10px 4px" }}
                        title={isCameraPaused ? "Resume Camera" : "Pause Camera"}
                      >
                        <span className="scene-emoji">{(!isCameraPaused && !uploadedImage) ? "🔴" : "⏸️"}</span>
                        <span>Cam</span>
                      </button>

                      <button
                        className={`scene-btn ${uploadedImage ? "active" : ""}`}
                        onClick={() => fileInputRef.current?.click()}
                        style={{ flex: 1, justifyContent: "center", padding: "10px 4px" }}
                        title="Upload a static picture"
                      >
                        <span className="scene-emoji">🖼️</span>
                        <span>Upload</span>
                      </button>
                      <input
                        type="file"
                        accept="image/*"
                        ref={fileInputRef}
                        onChange={handleImageUpload}
                        style={{ display: "none" }}
                      />
                    </div>

                    {devices.length > 0 && !uploadedImage && (
                      <div style={{ display: "flex", gap: "8px" }}>
                        <select
                          value={selectedDeviceId}
                          onChange={(e) => setSelectedDeviceId(e.target.value)}
                          style={{
                            flex: 1,
                            padding: "8px 12px",
                            background: "rgba(255,255,255,0.1)",
                            border: "none",
                            borderRadius: "6px",
                            color: "#fff",
                            fontSize: "14px",
                            outline: "none",
                            cursor: "pointer"
                          }}
                        >
                          {devices.map((device, i) => (
                            <option key={device.deviceId} value={device.deviceId} style={{ color: "#000" }}>
                              {device.label || `Camera ${i + 1}`}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={refreshDevices}
                          style={{
                            padding: "8px",
                            background: "rgba(255,255,255,0.1)",
                            border: "none",
                            borderRadius: "6px",
                            color: "#fff",
                            cursor: "pointer"
                          }}
                          title="Refresh cameras"
                        >
                          🔄
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="sidebar-section">
              <label>Style Override</label>
              <div className="prompt-cloud">
                <button
                  className={`prompt-chip ${stylePreference === "" ? "active" : ""}`}
                  style={{
                    cursor: "pointer",
                    border: stylePreference === "" ? "1px solid var(--spotify-green)" : "1px solid transparent",
                    background: stylePreference === "" ? "#1a1a1a" : "rgba(255,255,255,0.1)",
                    color: stylePreference === "" ? "var(--spotify-green)" : "#fff",
                    fontWeight: stylePreference === "" ? "700" : "500"
                  }}
                  onClick={() => setStylePreference("")}
                >
                  None
                </button>
                {["Rock", "Hard Rock", "Samba", "Salsa", "Acoustic", "Electronic", "Cyberpunk", "Lo-Fi", "Orchestral", "8-bit", "Jazz", "Hip-Hop", "Synthwave", "Ambient"].map(style => (
                  <button
                    key={style}
                    className={`prompt-chip ${stylePreference === style ? "active" : ""}`}
                    onClick={() => setStylePreference(stylePreference === style ? "" : style)}
                    style={{
                      cursor: "pointer",
                      border: stylePreference === style ? "1px solid var(--spotify-green)" : "1px solid transparent",
                      background: stylePreference === style ? "#1a1a1a" : "rgba(255,255,255,0.1)",
                      color: stylePreference === style ? "var(--spotify-green)" : "#fff",
                      fontWeight: stylePreference === style ? "700" : "500"
                    }}
                  >
                    {style}
                  </button>
                ))}
              </div>
            </div>

            <div className="sidebar-section">
              <label>Instrument Mix (AI Stems)</label>
              <div className="prompt-cloud">
                {["keyboard", "voice", "bass", "guitar"].map(stem => {
                  const isActive = activeInstruments.includes(stem);
                  return (
                    <button
                      key={stem}
                      className={`prompt-chip ${isActive ? "active" : ""}`}
                      onClick={() => {
                        setActiveInstruments(prev =>
                          isActive ? prev.filter(i => i !== stem) : [...prev, stem]
                        );
                      }}
                      style={{
                        cursor: "pointer",
                        border: isActive ? "1px solid var(--spotify-green)" : "1px solid transparent",
                        background: isActive ? "#1a1a1a" : "rgba(255,255,255,0.1)",
                        color: isActive ? "var(--spotify-green)" : "#fff",
                        fontWeight: isActive ? "700" : "500",
                        textTransform: "capitalize"
                      }}
                    >
                      {isActive ? "🔊 " : "🔇 "} {stem}
                    </button>
                  );
                })}
              </div>
            </div>

            {manualMode && (
              <div className="sidebar-section">
                <label>Manual Scenes</label>
                <div className="scene-list">
                  {Object.entries(SCENE_PRESETS).map(([key, preset]) => (
                    <button key={key} className={`scene-btn ${currentScene?.type === key ? "active" : ""}`} onClick={() => selectScene(key)}>
                      <span className="scene-emoji">{preset.emoji}</span>
                      <span>{preset.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="sidebar-section">
              <label>Audio Mixer</label>
              <div style={{ display: "flex", flexDirection: "column", gap: "20px", background: "rgba(255,255,255,0.05)", padding: "16px", borderRadius: "12px" }}>

                {/* Volume Control */}
                <div className="volume-control" style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <span className="volume-icon" style={{ fontSize: "16px" }}>{volume === 0 ? '🔇' : volume < 0.4 ? '🔈' : volume < 0.7 ? '🔉' : '🔊'}</span>
                  <input
                    type="range" min="0" max="1" step="0.01" value={volume}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setVolume(val);
                      if (lyriaRef.current) lyriaRef.current.setVolume(val);
                    }}
                    className="volume-slider"
                    style={{ flex: 1 }}
                  />
                  <span style={{ fontSize: "12px", color: "var(--muted)", width: "32px", textAlign: "right" }}>{Math.round(volume * 100)}%</span>
                </div>

                {/* EQ Controls */}
                <div className="eq-controls" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {["bass", "mid", "treble"].map(band => (
                    <div key={band} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <span style={{ fontSize: "11px", textTransform: "uppercase", color: "var(--spotify-subtext)", width: "40px", fontWeight: "600" }}>{band}</span>
                      <input
                        type="range"
                        min="-15" max="15" step="0.5"
                        value={eq[band]}
                        onChange={(e) => updateEq(band, parseFloat(e.target.value))}
                        style={{
                          flex: 1,
                          accentColor: eq[band] === 0 ? "var(--spotify-subtext)" : "var(--spotify-green)",
                        }}
                      />
                      <span style={{ fontSize: "11px", fontWeight: "bold", color: "#fff", width: "24px", textAlign: "right" }}>{eq[band] > 0 ? `+${eq[band]}` : eq[band]}</span>
                    </div>
                  ))}
                </div>

              </div>
            </div>
          </aside>

          {/* Main Content Area */}
          <main className="dj-main-area">
            <div className="main-header">
              <StatusPill status={cameraStatus} label="Cam" />
              <StatusPill status={lyriaStatus} label="Lyria" />
            </div>

            <div className="hero-section">
              <div className="orb-container">
                <div className={`mood-orb ${lyriaStatus === "streaming" ? "active" : ""}`} style={{ "--pulse-speed": `${2 - energy}s` }}>
                  <span className="orb-emoji">{scene.emoji || "🎵"}</span>
                </div>
              </div>
              <div className="hero-text">
                <div className="hero-subtitle">Now Playing Playlist</div>
                <h1 className="hero-title">{scene.label}</h1>
                <div className="stats-panel">
                  <div className="stat-item">
                    <span className="stat-label">Energy</span>
                    <span className="stat-value">{Math.round(energy * 100)}%</span>
                    <div className="energy-bar-mini"><div className="energy-fill-mini" style={{ width: `${energy * 100}%` }} /></div>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">Mood Keywords</span>
                    <span className="stat-value" style={{ color: "var(--muted)", fontWeight: "normal" }}>{keywords.join(" • ")}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="prompts-section">
              <h3>Active Generating Elements</h3>
              <div className="prompt-chips">
                {activePrompts.map((p, i) => (
                  <div key={i} className="prompt-chip">
                    <span className="prompt-weight">{Math.round(p.weight * 100)}%</span>{p.text}
                  </div>
                ))}
              </div>
            </div>

            {!manualMode && (
              <div>
                <h3 style={{ fontSize: "16px", marginBottom: "16px", fontWeight: "700" }}>{uploadedImage ? "Uploaded Static Image" : "Live Input Stream"}</h3>
                <div className="camera-preview">
                  {uploadedImage ? (
                    <img src={uploadedImage} alt="Uploaded scene" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  ) : (
                    <video
                      ref={el => {
                        if (el && cameraRef.current?.videoStream && el.srcObject !== cameraRef.current.videoStream) {
                          el.srcObject = cameraRef.current.videoStream;
                          el.play().catch(() => { });
                        }
                      }}
                      playsInline muted autoPlay
                    />
                  )}
                  <div className="camera-overlay"><span className="frame-count">{uploadedImage ? "Static Analysis" : `Vison Frame: #${frameCount}`}</span></div>
                </div>
              </div>
            )}
          </main>

          {/* Bottom Player Bar */}
          <footer className="dj-player">
            <div className="player-left">
              <div className="now-playing-art">
                {scene.emoji || "🎵"}
              </div>
              <div className="now-playing-info">
                <span className="now-title">Lyria RealTime Stream</span>
                <span className="now-subtitle">{scene.label} Synthesis</span>
              </div>
            </div>

            <div className="player-center">
              <div className="transport-controls">
                <button
                  className={`transport-btn ${musicPlaying ? '' : 'active'}`}
                  onClick={() => {
                    if (lyriaRef.current) { lyriaRef.current.stop(); setMusicPlaying(false); addLog('⏹ Music stopped'); }
                  }}
                  disabled={!musicPlaying}
                  title="Stop"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2" /></svg>
                </button>
                <button
                  className={`transport-btn play ${musicPlaying ? 'active' : ''}`}
                  onClick={() => {
                    if (lyriaRef.current) { lyriaRef.current.play(); setMusicPlaying(true); addLog('▶️ Music playing'); }
                  }}
                  disabled={musicPlaying}
                  title="Play/Pause"
                >
                  {musicPlaying ?
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg> :
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                  }
                </button>
              </div>
              <div className="audio-meter"><div className="audio-meter-fill" style={{ width: `${audioLevel * 100}%` }} /></div>
            </div>

            <div className="player-right" style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: "16px" }}>
              {/* Reserved for future controls */}
            </div>
          </footer>
        </div>
      )}
    </>
  );
}

function StatusPill({ status, label }) {
  return (
    <span className={`status-pill ${status}`}>
      <span className="status-dot" />{label} {status}
    </span>
  );
}
