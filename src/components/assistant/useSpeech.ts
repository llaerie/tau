"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

const noSubscribe = () => () => {};

type RecognitionCtor = new () => SpeechRecognitionLike;
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type ListenState = "idle" | "listening" | "denied" | "unsupported" | "error";

/**
 * Push-to-talk on top of the browser's Web Speech API. Nothing is captured
 * until the user presses the button, and the transcript is previewed before
 * it is sent. Unsupported browsers keep the text composer only.
 */
export function useSpeechRecognition(onFinal: (text: string) => void) {
  const [state, setState] = useState<ListenState>("idle");
  const [interim, setInterim] = useState("");
  const ref = useRef<SpeechRecognitionLike | null>(null);
  const supported = useSyncExternalStore(noSubscribe, () => recognitionCtor() !== null, () => false);

  const stop = useCallback(() => {
    ref.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      setState("unsupported");
      return;
    }
    if (ref.current) return;
    const rec = new Ctor();
    rec.lang = navigator.language || "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = "";
    rec.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        text += r[0].transcript;
        if (r.isFinal) finalText = text;
      }
      setInterim(text);
    };
    rec.onerror = (e) => {
      setState(e.error === "not-allowed" || e.error === "service-not-allowed" ? "denied" : "error");
    };
    rec.onend = () => {
      ref.current = null;
      setInterim("");
      const t = (finalText || "").trim();
      if (t) onFinal(t);
      setState((s) => (s === "denied" || s === "error" ? s : "idle"));
    };
    ref.current = rec;
    setState("listening");
    setInterim("");
    try {
      rec.start();
    } catch {
      ref.current = null;
      setState("error");
    }
  }, [onFinal]);

  useEffect(() => () => ref.current?.abort(), []);
  return { state: supported ? state : "unsupported", interim, start, stop, supported };
}

/** Optional spoken replies through speechSynthesis. Off by default; a mute control always stops speech. */
export function useSpokenReplies(enabled: boolean) {
  const [speaking, setSpeaking] = useState(false);
  // Server renders "unsupported"; the client resolves after hydration without a state update in an effect.
  const supported = useSyncExternalStore(noSubscribe, () => "speechSynthesis" in window, () => false);
  const mute = useCallback(() => {
    if (supported) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [supported]);
  const speak = useCallback(
    (text: string) => {
      if (!enabled || !supported || !text.trim()) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text.slice(0, 600));
      u.onend = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);
      setSpeaking(true);
      window.speechSynthesis.speak(u);
    },
    [enabled, supported],
  );
  useEffect(() => () => mute(), [mute]);
  return { speak, mute, speaking, supported };
}
