import { useEffect, useRef, useState } from "react";

export type PlaybackResult = "ended" | "stopped" | "error";
type Playback = {
  accent: "UK" | "US";
  resolve: (result: PlaybackResult) => void;
  audio?: HTMLAudioElement;
  utterance?: SpeechSynthesisUtterance;
};

export function usePronunciation() {
  const [active, setActive] = useState<string | null>(null);
  const [error, setError] = useState("");
  const playback = useRef<Playback | null>(null);
  useEffect(
    () => () => {
      const current = playback.current;
      playback.current = null;
      if (!current) return;
      if (current.audio) {
        current.audio.onended = null;
        current.audio.onerror = null;
        current.audio.pause();
      }
      if (current.utterance) {
        current.utterance.onend = null;
        current.utterance.onerror = null;
        window.speechSynthesis?.cancel();
      }
      current.resolve("stopped");
    },
    [],
  );

  function finish(current: Playback, result: PlaybackResult, message = "") {
    if (playback.current !== current) return;
    playback.current = null;
    setActive(null);
    if (message) setError(message);
    current.resolve(result);
  }
  function stop() {
    const current = playback.current;
    if (!current) return;
    playback.current = null;
    if (current.audio) {
      current.audio.onended = null;
      current.audio.onerror = null;
      current.audio.pause();
    }
    if (current.utterance) {
      current.utterance.onend = null;
      current.utterance.onerror = null;
      window.speechSynthesis?.cancel();
    }
    setActive(null);
    current.resolve("stopped");
  }
  function play(text: string, accent: "UK" | "US", url?: string): Promise<PlaybackResult> {
    if (playback.current?.accent === accent) {
      stop();
      return Promise.resolve("stopped");
    }
    stop();
    setError("");
    return new Promise((resolve) => {
      const current: Playback = { accent, resolve };
      playback.current = current;
      setActive(accent);
      if (url) {
        const audio = new Audio(url);
        current.audio = audio;
        audio.onended = () => finish(current, "ended");
        audio.onerror = () => finish(current, "error", "Ses oynatılamadı. Yeniden deneyebilirsin.");
        void audio
          .play()
          .catch(() => finish(current, "error", "Ses oynatılamadı. Yeniden deneyebilirsin."));
        return;
      }
      if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
        finish(current, "error", "Bu tarayıcı sesli okumayı desteklemiyor.");
        return;
      }
      try {
        const language = accent === "UK" ? "en-GB" : "en-US";
        const utterance = new SpeechSynthesisUtterance(text);
        current.utterance = utterance;
        utterance.lang = language;
        utterance.rate = 0.85;
        utterance.voice =
          speechSynthesis.getVoices().find((voice) => voice.lang.replace("_", "-") === language) ??
          null;
        utterance.onend = () => finish(current, "ended");
        utterance.onerror = (event) => {
          if (event.error === "interrupted" || event.error === "canceled")
            finish(current, "stopped");
          else finish(current, "error", "İngilizce ses oynatılamadı. Yeniden deneyebilirsin.");
        };
        speechSynthesis.speak(utterance);
      } catch {
        finish(current, "error", "İngilizce ses başlatılamadı. Yeniden deneyebilirsin.");
      }
    });
  }
  return { active, error, play };
}
