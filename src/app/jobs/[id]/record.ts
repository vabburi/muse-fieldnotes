// Records from the microphone (the phone's, or a Bluetooth headset's such as Ray-Ban Meta
// glasses) and hands back 16 kHz mono 16-bit WAV, the only format Muse Voice Transcribe takes.
// Browsers record webm or mp4; decoding and resampling here keeps ffmpeg off the server.

const RATE = 16000;

async function open() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => chunks.push(e.data);
  recorder.start();
  const stop = () =>
    new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        resolve(new Blob(chunks, { type: recorder.mimeType }));
      };
      recorder.stop();
    });
  return { stream, stop };
}

// Push to talk: recording starts now; call the returned function to stop and get the WAV.
export async function startRecording(): Promise<() => Promise<Blob>> {
  const { stop } = await open();
  return async () => toWav(await stop());
}

// Hands-free: records one answer and stops by itself, after `quietMs` of quiet once the speaker
// has started, after `waitMs` if they never start, or after `maxMs` in all. Returns null when
// nothing was said.
export async function recordAnswer({ quietMs = 1500, waitMs = 8000, maxMs = 30000 } = {}): Promise<Blob | null> {
  const { stream, stop } = await open();
  const context = new AudioContext();
  const analyser = context.createAnalyser();
  context.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  const started = Date.now();
  let heard = false;
  let lastLoud = started;
  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);
      const now = Date.now();
      if (rms > 0.02) {
        heard = true;
        lastLoud = now;
      }
      if (now - started > maxMs || (heard ? now - lastLoud > quietMs : now - started > waitMs)) {
        clearInterval(timer);
        resolve();
      }
    }, 100);
  });
  const recording = await stop();
  await context.close();
  return heard ? toWav(recording) : null;
}

// Says something through the phone's speaker, or the glasses' when they're connected. Some
// browsers never fire `end`, so it also gives up after a generous estimate of the length.
export function say(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) return resolve();
    const utterance = new SpeechSynthesisUtterance(text);
    const timer = setTimeout(resolve, 2000 + text.length * 90);
    utterance.onend = utterance.onerror = () => {
      clearTimeout(timer);
      resolve();
    };
    speechSynthesis.speak(utterance);
  });
}

async function toWav(recording: Blob): Promise<Blob> {
  const context = new AudioContext();
  const decoded = await context.decodeAudioData(await recording.arrayBuffer());
  await context.close();
  // Rendering into a one-channel context at 16 kHz mixes down and resamples.
  const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * RATE)), RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const samples = (await offline.startRendering()).getChannelData(0);

  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const text = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE * 2, true); // bytes per second
  view.setUint16(32, 2, true); // bytes per sample
  view.setUint16(34, 16, true); // bits per sample
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((x, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x)) * 0x7fff, true));
  return new Blob([view], { type: "audio/wav" });
}
