import { useCallback, useEffect, useRef, useState } from "react";

type RoutineStep = {
  name: string;
  durationSeconds: number | null;
  guidance?: GuidedInterval[];
};

type GuidedInterval = {
  name: string;
  cue: string;
  durationSeconds: number;
};

type TimerStatus = "idle" | "running" | "paused" | "manual" | "complete";

const ROUTINE_STEPS: RoutineStep[] = [
  { name: "Breathing", durationSeconds: 45 },
  { name: "Shake Body", durationSeconds: 60 },
  { name: "Stretch Flow", durationSeconds: 90 },
  { name: "Happy Moment", durationSeconds: 60 },
  { name: "Easy Push-ups", durationSeconds: 30 },
];

const FINAL_MESSAGE = ["One step. One action at a time. Be present."];

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function getGuidedInterval(guidance: GuidedInterval[], totalSeconds: number, secondsRemaining: number) {
  const elapsedSeconds = totalSeconds - secondsRemaining;
  let intervalEnd = 0;

  for (let index = 0; index < guidance.length; index += 1) {
    intervalEnd += guidance[index].durationSeconds;

    if (elapsedSeconds < intervalEnd) {
      return {
        interval: guidance[index],
        index,
        nextInterval: guidance[index + 1],
        secondsRemaining: intervalEnd - elapsedSeconds,
      };
    }
  }

  return {
    interval: guidance[guidance.length - 1],
    index: guidance.length - 1,
    nextInterval: undefined,
    secondsRemaining: 1,
  };
}

function App() {
  const [status, setStatus] = useState<TimerStatus>("idle");
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [secondsRemaining, setSecondsRemaining] = useState(ROUTINE_STEPS[0].durationSeconds ?? 0);
  const [stepSignal, setStepSignal] = useState(0);
  const endTimeRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const stepCompletedRef = useRef(false);
  const guidedIntervalIndexRef = useRef(0);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const wakeLockRequestPendingRef = useRef(false);
  const shouldKeepScreenAwakeRef = useRef(false);

  const currentStep = ROUTINE_STEPS[currentStepIndex];
  const nextStep = ROUTINE_STEPS[currentStepIndex + 1];
  const guidedInterval =
    currentStep.guidance && currentStep.durationSeconds !== null
      ? getGuidedInterval(currentStep.guidance, currentStep.durationSeconds, secondsRemaining)
      : null;

  const unlockAudio = useCallback(() => {
    const AudioContextClass =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextClass) {
      return;
    }

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextClass();
    }

    void audioContextRef.current.resume();
  }, []);

  const requestWakeLock = useCallback(async () => {
    if (
      !("wakeLock" in navigator) ||
      document.visibilityState !== "visible" ||
      wakeLockRef.current ||
      wakeLockRequestPendingRef.current
    ) {
      return;
    }

    wakeLockRequestPendingRef.current = true;

    try {
      const wakeLock = await navigator.wakeLock.request("screen");

      if (!shouldKeepScreenAwakeRef.current) {
        await wakeLock.release();
        return;
      }

      wakeLockRef.current = wakeLock;
      wakeLock.addEventListener("release", () => {
        if (wakeLockRef.current === wakeLock) {
          wakeLockRef.current = null;
        }
      });
    } catch {
      // The routine still works when a browser or device does not allow wake locks.
    } finally {
      wakeLockRequestPendingRef.current = false;
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    const wakeLock = wakeLockRef.current;
    wakeLockRef.current = null;

    if (wakeLock) {
      try {
        await wakeLock.release();
      } catch {
        // The browser may already have released the wake lock.
      }
    }
  }, []);

  const signalStepComplete = useCallback(() => {
    const audioContext = audioContextRef.current;
    setStepSignal((signal) => signal + 1);

    if (audioContext) {
      void audioContext.resume().then(() => {
        const now = audioContext.currentTime;

        [0, 0.22, 0.44].forEach((delay, index) => {
          const oscillator = audioContext.createOscillator();
          const gain = audioContext.createGain();
          const startTime = now + delay;

          oscillator.type = "sine";
          oscillator.frequency.setValueAtTime(index === 2 ? 1046 : 880, startTime);
          gain.gain.setValueAtTime(0.0001, startTime);
          gain.gain.exponentialRampToValueAtTime(0.34, startTime + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.16);
          oscillator.connect(gain);
          gain.connect(audioContext.destination);
          oscillator.start(startTime);
          oscillator.stop(startTime + 0.18);
        });
      });
    }

    if ("vibrate" in navigator) {
      navigator.vibrate([140, 70, 140]);
    }
  }, []);

  const signalGuideChange = useCallback(() => {
    const audioContext = audioContextRef.current;
    setStepSignal((signal) => signal + 1);

    if (audioContext) {
      void audioContext.resume().then(() => {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        const now = audioContext.currentTime;

        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(660, now);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.24, now + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.start(now);
        oscillator.stop(now + 0.18);
      });
    }

    if ("vibrate" in navigator) {
      navigator.vibrate(100);
    }
  }, []);

  const goToStep = useCallback((index: number) => {
    if (index >= ROUTINE_STEPS.length) {
      setStatus("complete");
      return;
    }

    const step = ROUTINE_STEPS[index];
    stepCompletedRef.current = false;
    guidedIntervalIndexRef.current = 0;
    setCurrentStepIndex(index);

    if (step.durationSeconds === null) {
      setSecondsRemaining(0);
      setStatus("manual");
      return;
    }

    setSecondsRemaining(step.durationSeconds);
    endTimeRef.current = Date.now() + step.durationSeconds * 1000;
    setStatus("running");
  }, []);

  const advanceStep = useCallback(() => {
    goToStep(currentStepIndex + 1);
  }, [currentStepIndex, goToStep]);

  const shouldKeepScreenAwake = status === "running" || status === "paused" || status === "manual";

  useEffect(() => {
    shouldKeepScreenAwakeRef.current = shouldKeepScreenAwake;

    if (!shouldKeepScreenAwake) {
      void releaseWakeLock();
      return;
    }

    void requestWakeLock();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void requestWakeLock();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [releaseWakeLock, requestWakeLock, shouldKeepScreenAwake]);

  useEffect(
    () => () => {
      shouldKeepScreenAwakeRef.current = false;
      void releaseWakeLock();
    },
    [releaseWakeLock],
  );

  useEffect(() => {
    if (status !== "running") {
      return;
    }

    const updateTimer = () => {
      const millisecondsRemaining = endTimeRef.current - Date.now();

      if (millisecondsRemaining <= 0) {
        if (stepCompletedRef.current) {
          return;
        }

        stepCompletedRef.current = true;
        signalStepComplete();
        advanceStep();
        return;
      }

      setSecondsRemaining(Math.ceil(millisecondsRemaining / 1000));
    };

    updateTimer();
    const intervalId = window.setInterval(updateTimer, 200);
    return () => window.clearInterval(intervalId);
  }, [advanceStep, signalStepComplete, status]);

  useEffect(() => {
    if (
      status !== "running" ||
      !guidedInterval ||
      guidedInterval.index <= guidedIntervalIndexRef.current
    ) {
      return;
    }

    guidedIntervalIndexRef.current = guidedInterval.index;
    signalGuideChange();
  }, [guidedInterval, signalGuideChange, status]);

  const startRoutine = () => {
    unlockAudio();
    goToStep(0);
  };

  const pauseRoutine = () => {
    const remaining = Math.max(1, Math.ceil((endTimeRef.current - Date.now()) / 1000));
    setSecondsRemaining(remaining);
    setStatus("paused");
  };

  const resumeRoutine = () => {
    unlockAudio();
    endTimeRef.current = Date.now() + secondsRemaining * 1000;
    setStatus("running");
  };

  const skipStep = () => {
    advanceStep();
  };

  const resetRoutine = () => {
    setStatus("idle");
    setCurrentStepIndex(0);
    setSecondsRemaining(ROUTINE_STEPS[0].durationSeconds ?? 0);
  };

  if (status === "idle") {
    return (
      <main className="app-shell">
        <section className="screen start-screen" aria-labelledby="app-title">
          <div className="morning-mark" aria-hidden="true" />
          <h1 id="app-title">Morning Routine Timer</h1>
          <button className="button button-primary button-start" onClick={startRoutine}>
            Start
          </button>
        </section>
      </main>
    );
  }

  if (status === "complete") {
    return (
      <main className="app-shell">
        <section className="screen completion-screen" aria-live="polite">
          <p className="completion-label">Routine complete</p>
          <div className="completion-mark" aria-hidden="true">
            <span />
          </div>
          <div className="final-message">
            {FINAL_MESSAGE.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
          <button className="button button-secondary" onClick={resetRoutine}>
            Reset
          </button>
        </section>
      </main>
    );
  }

  const isManualStep = status === "manual";

  return (
    <main className="app-shell">
      {stepSignal > 0 && <div key={stepSignal} className="step-change-flash" aria-hidden="true" />}
      <section className="screen timer-screen">
        <header className="step-header">
          <p className="progress">
            Step {currentStepIndex + 1} of {ROUTINE_STEPS.length}
          </p>
          <div
            className="progress-track"
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={ROUTINE_STEPS.length}
            aria-valuenow={currentStepIndex + 1}
          >
            <span style={{ width: `${((currentStepIndex + 1) / ROUTINE_STEPS.length) * 100}%` }} />
          </div>
        </header>

        <div className="step-content" aria-live="polite">
          <h1 className={guidedInterval ? "guided-step-title" : undefined}>{currentStep.name}</h1>

          {guidedInterval ? (
            <div className="guided-interval">
              <p className="guided-label">
                Now · {guidedInterval.index + 1} of {currentStep.guidance?.length}
              </p>
              <h2>{guidedInterval.interval.name}</h2>
              <p className="guided-cue">{guidedInterval.interval.cue}</p>
              <p
                className="countdown guided-countdown"
                aria-label={`${guidedInterval.secondsRemaining} seconds remaining for ${guidedInterval.interval.name}`}
              >
                {formatTime(guidedInterval.secondsRemaining)}
              </p>
              <p className="guided-total">{formatTime(secondsRemaining)} total CARs time left</p>
              <div className="guided-next">
                <span>Next movement</span>
                <strong>{guidedInterval.nextInterval?.name ?? nextStep?.name ?? "Finish"}</strong>
              </div>
            </div>
          ) : isManualStep ? (
            <p className="manual-note">Complete at your own pace</p>
          ) : (
            <p className="countdown" aria-label={`${secondsRemaining} seconds remaining`}>
              {formatTime(secondsRemaining)}
            </p>
          )}

          <div className="next-step">
            <span>{guidedInterval ? "After CARs" : "Next"}</span>
            <strong>{nextStep?.name ?? "Finish"}</strong>
          </div>
        </div>

        <div className="controls">
          {isManualStep && (
            <button className="button button-primary" onClick={advanceStep}>
              Done
            </button>
          )}

          {status === "running" && (
            <button className="button button-primary" onClick={pauseRoutine}>
              Pause
            </button>
          )}

          {status === "paused" && (
            <button className="button button-primary" onClick={resumeRoutine}>
              Resume
            </button>
          )}

          <div className="secondary-controls">
            <button className="button button-secondary" onClick={skipStep}>
              Skip
            </button>
            <button className="button button-secondary" onClick={resetRoutine}>
              Reset
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

export default App;
