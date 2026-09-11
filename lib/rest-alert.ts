// Rest-timer-done alert — a synthesized beep (no audio asset to bundle
// or host) plus a vibration where supported. Nothing like this exists
// anywhere else in the app yet; both halves are independently guarded
// and silently no-op on an unsupported/blocked browser rather than
// throwing, matching this app's established defensive style
// (lib/card-size.ts's try/catch-and-degrade convention).
export function playRestAlert(): void {
  try {
    const AudioContextClass =
      window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContextClass) {
      const ctx = new AudioContextClass();
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.6);
      oscillator.onended = () => ctx.close();
    }
  } catch {
    // AudioContext unsupported/blocked — no sound, not fatal.
  }

  try {
    navigator.vibrate?.([200, 100, 200]);
  } catch {
    // Vibration unsupported — not fatal.
  }
}
