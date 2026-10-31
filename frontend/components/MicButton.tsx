"use client";

import { useEffect, useRef, useState } from "react";

// The browser's speech recognition isn't in TypeScript's built-in types,
// so describe just the parts we use.
interface SpeechRes {
  0: { transcript: string };
  isFinal: boolean;
}
interface SpeechEvt {
  results: ArrayLike<SpeechRes>;
}
interface SpeechRec {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: SpeechEvt) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type SpeechRecCtor = new () => SpeechRec;

function getCtor(): SpeechRecCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecCtor;
    webkitSpeechRecognition?: SpeechRecCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

type Lang = "hi-IN" | "en-IN";

/**
 * Tap, speak, and the words land in the invoice textbox. Uses the
 * browser's own speech recognition (works best in Chrome; the audio is
 * processed by the browser vendor's speech service, not by Bahi).
 * Renders nothing in browsers that don't support it.
 */
export function MicButton({
  onTranscript,
}: {
  /** Called with the text heard so far; final=true when the speaker stops. */
  onTranscript: (text: string, final: boolean) => void;
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [lang, setLang] = useState<Lang>("hi-IN");
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRec | null>(null);

  useEffect(() => {
    setSupported(getCtor() !== null);
    return () => recRef.current?.stop();
  }, []);

  if (!supported) return null;

  function toggle() {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const Ctor = getCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      onTranscript(text.trim(), e.results[e.results.length - 1].isFinal);
    };
    rec.onerror = (e) => {
      setError(
        e.error === "not-allowed" || e.error === "service-not-allowed"
          ? "The microphone is blocked. Allow it in your browser's site settings, or type instead."
          : e.error === "no-speech"
          ? "Didn't hear anything. Tap the mic and try again."
          : `Couldn't hear that (${e.error}). Try again or type.`
      );
    };
    rec.onend = () => setListening(false);
    recRef.current = rec;
    setError(null);
    setListening(true);
    try {
      rec.start();
    } catch {
      setListening(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 mt-3">
      <button
        type="button"
        onClick={toggle}
        aria-pressed={listening}
        aria-label={listening ? "Stop listening" : "Speak the invoice"}
        className={`inline-flex items-center gap-2 rounded-card px-4 py-2.5 text-sm font-medium border transition-colors ${
          listening
            ? "bg-bahi-red text-white border-bahi-red"
            : "bg-paper-raised text-ink border-ledger-line hover:border-bahi-red"
        }`}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <rect x="9" y="3" width="6" height="12" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </svg>
        {listening ? "Listening… tap to stop" : "Speak"}
      </button>

      <div className="flex gap-1" role="group" aria-label="Speech language">
        {(["hi-IN", "en-IN"] as const).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLang(l)}
            aria-pressed={lang === l}
            disabled={listening}
            className={`px-3 py-1.5 rounded-card text-xs border ${
              lang === l
                ? "bg-ink text-white border-ink"
                : "border-ledger-line text-slate hover:text-ink"
            }`}
          >
            {l === "hi-IN" ? "हिन्दी" : "English"}
          </button>
        ))}
      </div>

      {error && <p className="w-full text-xs text-bahi-red-dark">{error}</p>}
    </div>
  );
}
