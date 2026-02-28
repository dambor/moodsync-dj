// Lyria RealTime uses the BidiGenerateMusic endpoint (NOT BidiGenerateContent)
// Ref: https://ai.google.dev/gemini-api/docs/music-generation
const LYRIA_MODEL = "models/lyria-realtime-exp";
const SAMPLE_RATE = 44100;
const NUM_CHANNELS = 2;

export class LyriaSession {
  constructor(apiKey, { onStatus, onError, onPromptAck }) {
    this.apiKey = apiKey;
    this.ws = null;
    this.connected = false;
    this.onStatus = onStatus || (() => { });
    this.onError = onError || console.error;
    this.onPromptAck = onPromptAck || (() => { });
    this.onPromptAck = onPromptAck || (() => { });

    // Audio graph nodes
    this.audioCtx = null;
    this.gainNode = null;
    this.bassNode = null;
    this.midNode = null;
    this.trebleNode = null;

    this.nextPlayTime = 0;
    this.isPlaying = false;
    this.isMuted = false;
    this.volume = 0.8;
    this.currentPrompts = [];
  }

  async connect() {
    this.onStatus("connecting");
    this.audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });

    // Equalizer: Bass
    this.bassNode = this.audioCtx.createBiquadFilter();
    this.bassNode.type = "lowshelf";
    this.bassNode.frequency.value = 250;

    // Equalizer: Mid
    this.midNode = this.audioCtx.createBiquadFilter();
    this.midNode.type = "peaking";
    this.midNode.frequency.value = 1000;
    this.midNode.Q.value = 1;

    // Equalizer: Treble
    this.trebleNode = this.audioCtx.createBiquadFilter();
    this.trebleNode.type = "highshelf";
    this.trebleNode.frequency.value = 4000;

    // Master Volume
    this.gainNode = this.audioCtx.createGain();
    this.gainNode.gain.value = this.volume;

    // Mount the Audio Graph: Source -> Bass -> Mid -> Treble -> Gain -> Output
    // (Source will connect to bassNode in _playRawAudio)
    this.bassNode.connect(this.midNode);
    this.midNode.connect(this.trebleNode);
    this.trebleNode.connect(this.gainNode);
    this.gainNode.connect(this.audioCtx.destination);

    // BidiGenerateMusic endpoint — dedicated for Lyria music generation
    const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateMusic?key=${this.apiKey}`;

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        // BidiGenerateMusicSetup — first message only needs the model
        this.ws.send(JSON.stringify({
          setup: {
            model: LYRIA_MODEL,
          },
        }));
      };

      this.ws.onmessage = (event) => this._handleMessage(event, resolve);

      this.ws.onerror = (e) => {
        this.onStatus("error");
        this.onError("WebSocket error — Lyria RealTime may not be available in your region or API tier");
        reject(e);
      };

      this.ws.onclose = (e) => {
        this.connected = false;
        this.isPlaying = false;
        this.onStatus("disconnected");
        if (e.code !== 1000) this.onError(`Lyria disconnected: code=${e.code} reason=${e.reason || "unknown"}`);
      };

      setTimeout(() => {
        if (!this.connected) { this.onStatus("error"); reject(new Error("Lyria connection timeout (10s)")); }
      }, 10000);
    });
  }

  async _handleMessage(event, resolveConnect) {
    try {
      let msgText = "";
      if (typeof event.data === "string") {
        msgText = event.data;
      } else if (event.data instanceof Blob) {
        msgText = await event.data.text();
      } else {
        return;
      }

      const msg = JSON.parse(msgText);

      // Debug: log all messages until connected
      if (!this.connected) {
        console.log("[Lyria] Server message (pre-connect):", msgText.substring(0, 500));
      }

      // BidiGenerateMusicSetupComplete — check multiple possible field names
      if (msg.setupComplete || msg.setup_complete || msg.serverContent?.setupComplete) {
        this.connected = true;
        this.onStatus("connected");
        // After setup completes, send play command to start music generation
        this._sendPlayback("PLAY");
        resolveConnect?.();
        return;
      }

      // If the message has no audio and we're not connected yet,
      // treat the first non-error server message as setup confirmation
      if (!this.connected && !msg.error) {
        const keys = Object.keys(msg);
        console.log("[Lyria] Unrecognized pre-connect message keys:", keys);
        // Some APIs send an empty object or different field for setup ack
        if (keys.length === 0 || keys.some(k => k.toLowerCase().includes("setup"))) {
          this.connected = true;
          this.onStatus("connected");
          this._sendPlayback("PLAY");
          resolveConnect?.();
          return;
        }
      }

      // Audio chunks from Lyria come in serverContent.audioChunks
      if (msg.serverContent?.audioChunks) {
        for (const chunk of msg.serverContent.audioChunks) {
          if (chunk.data) this._playAudioChunk(chunk.data);
        }
      }

      // Also handle modelTurn.parts for backwards compatibility
      if (msg.serverContent?.modelTurn?.parts) {
        for (const part of msg.serverContent.modelTurn.parts) {
          if (part.inlineData?.data) this._playAudioChunk(part.inlineData.data);
        }
      }

      if (msg.serverContent?.promptFeedback) this.onPromptAck(msg.serverContent.promptFeedback);
      if (msg.serverContent?.filteredPrompts) this.onPromptAck(msg.serverContent.filteredPrompts);
    } catch (e) {
      console.error("Lyria message parse error:", e);
    }
  }

  _playAudioChunk(base64Data) {
    if (!this.audioCtx) return;
    try {
      const raw = atob(base64Data);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      this._playRawAudio(bytes.buffer);
    } catch (e) {
      console.error("Failed to decode audio base64:", e);
    }
  }

  _playRawAudio(arrayBuffer) {
    if (!this.audioCtx || this.isMuted) return;

    // Safety check: ensure even number of bytes for 16-bit PCM
    const safeLength = Math.floor(arrayBuffer.byteLength / 2) * 2;
    if (safeLength === 0) return;

    const view = new DataView(arrayBuffer, 0, safeLength);
    // Determine if stream is mono or stereo based on length — handle both safely
    const numSamplesTotal = safeLength / 2;
    const channelsToUse = numSamplesTotal % 2 === 0 ? NUM_CHANNELS : 1;
    const numFrames = Math.floor(numSamplesTotal / channelsToUse);

    if (numFrames === 0) return;

    const audioBuffer = this.audioCtx.createBuffer(NUM_CHANNELS, numFrames, SAMPLE_RATE);

    // Parse Little-Endian 16-bit PCM into Float32 [-1, 1]
    for (let ch = 0; ch < NUM_CHANNELS; ch++) {
      const channelData = audioBuffer.getChannelData(ch);
      // If stream is mono, read channel 0 twice
      const streamCh = channelsToUse === 1 ? 0 : ch;
      for (let i = 0; i < numFrames; i++) {
        const byteOffset = (i * channelsToUse + streamCh) * 2;
        channelData[i] = view.getInt16(byteOffset, true) / 32768;
      }
    }

    const src = this.audioCtx.createBufferSource();
    src.buffer = audioBuffer;

    // Feed into the hardware EQ chain 
    src.connect(this.bassNode);

    const now = this.audioCtx.currentTime;
    // Add small continuous buffer gap to prevent underrun clicking
    if (this.nextPlayTime < now) {
      this.nextPlayTime = now + 0.05;
    }
    src.start(this.nextPlayTime);
    this.nextPlayTime += audioBuffer.duration;

    if (!this.isPlaying) { this.isPlaying = true; this.onStatus("streaming"); }
  }

  // Send playbackControl command (PLAY, PAUSE, STOP)
  _sendPlayback(action) {
    if (!this.ws || !this.connected) return;
    const msg = { playbackControl: action };
    console.log("[Lyria] Sending playback:", JSON.stringify(msg));
    this.ws.send(JSON.stringify(msg));
  }

  // Send weighted prompts via clientContent
  setPrompts(prompts) {
    if (!this.ws || !this.connected) return false;
    this.currentPrompts = prompts;
    try {
      const msg = {
        clientContent: {
          weightedPrompts: prompts.map(p => ({ text: p.text, weight: p.weight })),
        },
      };
      console.log("[Lyria] Sending prompts:", JSON.stringify(msg));
      this.ws.send(JSON.stringify(msg));
      return true;
    } catch (e) { this.onError(`Failed to set prompts: ${e.message}`); return false; }
  }

  // Send musicGenerationConfig to update generation parameters
  setGenerationConfig({ guidance, brightness, density, bpm, temperature } = {}) {
    if (!this.ws || !this.connected) return;
    const cfg = {};
    if (guidance !== undefined) cfg.guidance = guidance;
    if (brightness !== undefined) cfg.brightness = brightness;
    if (density !== undefined) cfg.density = density;
    if (bpm !== undefined) cfg.bpm = bpm;
    if (temperature !== undefined) cfg.temperature = temperature;
    const msg = {
      musicGenerationConfig: cfg,
    };
    console.log("[Lyria] Sending config:", JSON.stringify(msg));
    this.ws.send(JSON.stringify(msg));
  }

  play() {
    this.isMuted = false;
    if (this.gainNode) {
      this.gainNode.gain.cancelScheduledValues(this.audioCtx.currentTime);
      this.gainNode.gain.linearRampToValueAtTime(this.volume, this.audioCtx.currentTime + 0.1);
    }
    this.nextPlayTime = 0;
    this._sendPlayback("PLAY");
    this.isPlaying = true;
    this.onStatus("streaming");
  }

  pause() {
    if (this.gainNode) {
      this.gainNode.gain.cancelScheduledValues(this.audioCtx.currentTime);
      this.gainNode.gain.linearRampToValueAtTime(0, this.audioCtx.currentTime + 0.15);
    }
    this.isMuted = true;
    this._sendPlayback("PAUSE");
    this.isPlaying = false;
    this.onStatus("paused");
  }

  stop() {
    if (this.gainNode) {
      this.gainNode.gain.cancelScheduledValues(this.audioCtx.currentTime);
      this.gainNode.gain.linearRampToValueAtTime(0, this.audioCtx.currentTime + 0.15);
    }
    this.isMuted = true;
    this.nextPlayTime = 0;
    this._sendPlayback("STOP");
    this.isPlaying = false;
    this.onStatus("stopped");
  }

  setVolume(value) {
    this.volume = Math.max(0, Math.min(1, value));
    if (this.gainNode && !this.isMuted) {
      this.gainNode.gain.cancelScheduledValues(this.audioCtx.currentTime);
      this.gainNode.gain.linearRampToValueAtTime(this.volume, this.audioCtx.currentTime + 0.05);
    }
  }

  disconnect() {
    if (this.ws) { this.ws.close(1000, "user disconnect"); this.ws = null; }
    if (this.audioCtx) { this.audioCtx.close(); this.audioCtx = null; }
    this.gainNode = null;
    this.connected = false;
    this.isPlaying = false;
    this.isMuted = false;
  }
}
