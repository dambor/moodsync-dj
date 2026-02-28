export class CameraManager {
  constructor() {
    this.videoStream = null;
    this.audioStream = null;
    this.videoEl = null;
    this.canvas = document.createElement("canvas");
    this.canvas.width = 320;
    this.canvas.height = 240;
    this.analyser = null;
    this.audioCtx = null;
    this.startingPromise = null;
  }

  start(videoEl, deviceId = null) {
    if (this.startingPromise) return this.startingPromise;
    this.startingPromise = this._startImpl(videoEl, deviceId);
    return this.startingPromise;
  }

  async _startImpl(videoEl, deviceId) {
    this.videoEl = videoEl;
    this.currentDeviceId = deviceId;

    const videoConstraints = deviceId
      ? { deviceId: { exact: deviceId }, width: 640, height: 480 }
      : { facingMode: "environment", width: 640, height: 480 };

    this.videoStream = await navigator.mediaDevices.getUserMedia({
      video: videoConstraints,
      audio: false,
    });
    videoEl.srcObject = this.videoStream;
    try {
      await videoEl.play();
    } catch (e) {
      console.warn("Camera play interrupted or failed:", e);
    }

    try {
      this.audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.audioCtx = new AudioContext();
      const src = this.audioCtx.createMediaStreamSource(this.audioStream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 256;
      src.connect(this.analyser);
    } catch {
      console.warn("Mic not available — running without ambient audio analysis");
    }
  }

  captureFrame() {
    if (!this.videoEl || this.videoEl.readyState < 2) return null;
    const ctx = this.canvas.getContext("2d");
    ctx.drawImage(this.videoEl, 0, 0, 320, 240);
    return this.canvas.toDataURL("image/jpeg", 0.6).split(",")[1];
  }

  getAudioContext() {
    if (!this.analyser) return { level: 0, band: "silent" };
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(data);
    const avg = data.reduce((a, b) => a + b, 0) / data.length;
    const level = Math.min(avg / 128, 1);
    const low = data.slice(0, 10).reduce((a, b) => a + b, 0);
    const mid = data.slice(10, 40).reduce((a, b) => a + b, 0);
    const high = data.slice(40).reduce((a, b) => a + b, 0);
    let band = "balanced";
    if (low > mid && low > high) band = "bass-heavy";
    else if (high > mid && high > low) band = "treble-heavy";
    else if (level < 0.05) band = "silent";
    else if (level > 0.6) band = "loud";
    return { level: Math.round(level * 100) / 100, band };
  }

  async pauseVideo() {
    if (this.videoStream) {
      // Fully stop tracks to release hardware LED (Mac green light)
      this.videoStream.getVideoTracks().forEach(t => t.stop());
    }
  }

  async resumeVideo() {
    const tracks = this.videoStream?.getVideoTracks() || [];
    if (tracks.every(t => t.readyState === "ended")) {
      this.startingPromise = null;
      await this.start(this.videoEl, this.currentDeviceId);
    } else {
      tracks.forEach(t => t.enabled = true);
    }
  }

  stop() {
    this.videoStream?.getTracks().forEach(t => t.stop());
    this.audioStream?.getTracks().forEach(t => t.stop());
    this.audioCtx?.close();
    this.videoStream = null;
    this.audioStream = null;
    this.startingPromise = null;
  }
}
