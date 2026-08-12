"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

const RESTART_COOLDOWN_MS = 320;
const INTERIM_THROTTLE_MS = 120;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

function detachRecognition(rec: SpeechRecognitionLike | null) {
  if (!rec) return;
  rec.onresult = null;
  rec.onerror = null;
  rec.onend = null;
  try {
    rec.abort();
  } catch {
    try {
      rec.stop();
    } catch {
      /* ignore */
    }
  }
}

export type SpeechToTextState = {
  supported: boolean;
  listening: boolean;
  error: string | null;
  start: () => void;
  stop: () => void;
};

/**
 * 浏览器 Web Speech API → 中文语音转文字。
 * 识别结果通过 onTranscript 回传（含 interim，便于边说边看）。
 */
export function useSpeechToText(
  onTranscript: (text: string, isFinal: boolean) => void,
): SpeechToTextState {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  const intentionalStopRef = useRef(false);
  const fatalErrorRef = useRef(false);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingInterimRef = useRef<string | null>(null);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    setSupported(Boolean(getSpeechRecognitionCtor()));
    return () => {
      intentionalStopRef.current = true;
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      if (interimTimerRef.current) clearTimeout(interimTimerRef.current);
      detachRecognition(recognitionRef.current);
      recognitionRef.current = null;
    };
  }, []);

  const flushInterim = useCallback(() => {
    interimTimerRef.current = null;
    const pending = pendingInterimRef.current;
    pendingInterimRef.current = null;
    if (pending) onTranscriptRef.current(pending, false);
  }, []);

  const stop = useCallback(() => {
    intentionalStopRef.current = true;
    fatalErrorRef.current = false;
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (interimTimerRef.current) {
      clearTimeout(interimTimerRef.current);
      interimTimerRef.current = null;
    }
    pendingInterimRef.current = null;
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    detachRecognition(rec);
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setError("当前浏览器不支持语音识别（建议 Chrome / Edge）");
      return;
    }

    setError(null);
    intentionalStopRef.current = false;
    fatalErrorRef.current = false;

    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }

    // 先摘掉旧实例回调，再 abort，避免旧 onend 把新会话 listening 关掉
    const prev = recognitionRef.current;
    recognitionRef.current = null;
    detachRecognition(prev);

    const recognition = new Ctor();
    recognition.lang = "zh-CN";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognitionRef.current = recognition;

    recognition.onresult = (event) => {
      let interim = "";
      let finalChunk = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const piece = event.results[i][0]?.transcript ?? "";
        if (event.results[i].isFinal) {
          finalChunk += piece;
        } else {
          interim += piece;
        }
      }
      if (finalChunk) {
        pendingInterimRef.current = null;
        if (interimTimerRef.current) {
          clearTimeout(interimTimerRef.current);
          interimTimerRef.current = null;
        }
        onTranscriptRef.current(finalChunk.trim(), true);
      } else if (interim) {
        pendingInterimRef.current = interim.trim();
        if (!interimTimerRef.current) {
          interimTimerRef.current = setTimeout(flushInterim, INTERIM_THROTTLE_MS);
        }
      }
    };

    recognition.onerror = (event) => {
      if (recognitionRef.current !== recognition) return;
      const code = event.error;
      if (code === "aborted" || code === "no-speech") {
        return;
      }
      if (code === "not-allowed") {
        setError("麦克风权限被拒绝，请在浏览器设置中允许后重试");
      } else if (code === "network") {
        setError("语音识别需要网络，请检查连接后重试");
      } else {
        setError(`语音识别失败（${code}）`);
      }
      fatalErrorRef.current = true;
      intentionalStopRef.current = true;
      setListening(false);
    };

    recognition.onend = () => {
      // 已被新会话替换：绝不改 listening
      if (recognitionRef.current !== recognition) return;

      if (intentionalStopRef.current || fatalErrorRef.current) {
        setListening(false);
        return;
      }

      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      restartTimerRef.current = setTimeout(() => {
        restartTimerRef.current = null;
        if (
          intentionalStopRef.current ||
          fatalErrorRef.current ||
          recognitionRef.current !== recognition
        ) {
          if (recognitionRef.current === recognition) setListening(false);
          return;
        }
        try {
          recognition.start();
          setListening(true);
        } catch {
          setListening(false);
        }
      }, RESTART_COOLDOWN_MS);
    };

    try {
      recognition.start();
      setListening(true);
    } catch {
      setError("无法启动麦克风，请稍后重试");
      setListening(false);
    }
  }, [flushInterim]);

  return { supported, listening, error, start, stop };
}
