"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Sparkles } from "lucide-react";

const INTRO_DURATION = 880;
const FLIGHT_DURATION = 640;
const REDUCED_MOTION_DURATION = 820;
const EXIT_DURATION = 220;

type WelcomePhase = "entering" | "exiting";
type NamePosition = { left: number; top: number; fontFamily: string; fontSize: string; fontWeight: string; lineHeight: string; letterSpacing: string; color: string };

function getVisibleProfileName(currentTarget?: HTMLElement | null): HTMLElement | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>("[data-profile-name]"))
    .filter((element) => element.getClientRects().length > 0);
  return candidates.find((element) => element !== currentTarget && getComputedStyle(element).visibility !== "hidden")
    ?? (currentTarget && currentTarget.getClientRects().length > 0 ? currentTarget : null);
}

export function WelcomeToast({ firstName, isFirstLogin, onComplete }: { firstName: string; isFirstLogin: boolean; onComplete: () => void }) {
  const nameRef = useRef<HTMLSpanElement>(null);
  const placeholderRef = useRef<HTMLSpanElement>(null);
  const [phase, setPhase] = useState<WelcomePhase>("entering");
  const [entranceComplete, setEntranceComplete] = useState(false);
  const [namePosition, setNamePosition] = useState<NamePosition | null>(null);

  useLayoutEffect(() => {
    if (!entranceComplete || phase === "exiting") return;
    const updatePosition = () => {
      const placeholder = placeholderRef.current;
      if (!placeholder) return;
      const rect = placeholder.getBoundingClientRect();
      const style = getComputedStyle(placeholder);
      setNamePosition({
        left: rect.left,
        top: rect.top,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing,
        color: style.color,
      });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.visualViewport?.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.visualViewport?.removeEventListener("resize", updatePosition);
    };
  }, [entranceComplete, phase]);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let timer = 0;
    let animation: Animation | null = null;
    let target: HTMLElement | null = null;
    let previousVisibility = "";
    let completed = false;
    let flightStart: DOMRect | null = null;
    let targetScale = 1;

    const restoreTarget = () => {
      if (target) target.style.visibility = previousVisibility;
      target = null;
    };

    const complete = () => {
      if (completed) return;
      completed = true;
      restoreTarget();
      onComplete();
    };

    const exitWithoutFlight = () => {
      setPhase("exiting");
      timer = window.setTimeout(complete, EXIT_DURATION);
    };

    if (reducedMotion) {
      timer = window.setTimeout(exitWithoutFlight, REDUCED_MOTION_DURATION);
      return () => {
        window.clearTimeout(timer);
        restoreTarget();
        animation?.cancel();
      };
    }

    const updateDestination = () => {
      const name = nameRef.current;
      if (!name || !flightStart || !animation) return;

      const nextTarget = getVisibleProfileName(target);
      if (!nextTarget) {
        restoreTarget();
        const currentStyle = getComputedStyle(name);
        name.style.transform = currentStyle.transform;
        name.style.opacity = currentStyle.opacity;
        animation.cancel();
        animation = name.animate([{ opacity: currentStyle.opacity }, { opacity: 0 }], {
          duration: EXIT_DURATION,
          easing: "ease-out",
          fill: "forwards",
        });
        animation.onfinish = complete;
        return;
      }
      if (nextTarget !== target) {
        restoreTarget();
        target = nextTarget;
        previousVisibility = target.style.visibility;
        target.style.visibility = "hidden";
      }

      const destination = target.getBoundingClientRect();
      const dx = destination.left + destination.width / 2 - (flightStart.left + flightStart.width / 2);
      const dy = destination.top + destination.height / 2 - (flightStart.top + flightStart.height / 2);
      const effect = animation.effect as KeyframeEffect | null;
      effect?.setKeyframes([
        { transform: "translate(0, 0) scale(1)", opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) scale(${targetScale})`, opacity: 0.96 },
      ]);
    };

    const handleViewportChange = () => updateDestination();

    timer = window.setTimeout(() => {
      const name = nameRef.current;
      const destination = getVisibleProfileName();
      if (!name || !destination) {
        exitWithoutFlight();
        return;
      }

      flightStart = name.getBoundingClientRect();
      const sourceFontSize = Number.parseFloat(getComputedStyle(name).fontSize) || 16;
      const destinationFontSize = Number.parseFloat(getComputedStyle(destination).fontSize) || sourceFontSize;
      targetScale = Math.min(1, Math.max(0.72, destinationFontSize / sourceFontSize));

      target = destination;
      previousVisibility = target.style.visibility;
      target.style.visibility = "hidden";
      setPhase("exiting");

      animation = name.animate([
        { transform: "translate(0, 0) scale(1)", opacity: 1 },
        { transform: "translate(0, 0) scale(1)", opacity: 1 },
      ], { duration: FLIGHT_DURATION, easing: "cubic-bezier(.2,.8,.2,1)", fill: "forwards" });

      // Set the destination after creating the animation so viewport changes can
      // update its endpoint without restarting the shared-element flight.
      updateDestination();
      window.addEventListener("resize", handleViewportChange);
      window.visualViewport?.addEventListener("resize", handleViewportChange);
      animation.onfinish = complete;
    }, INTRO_DURATION);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", handleViewportChange);
      window.visualViewport?.removeEventListener("resize", handleViewportChange);
      restoreTarget();
      animation?.cancel();
    };
  }, [onComplete]);

  return (
    <div className={`welcome-overlay${phase === "exiting" ? " welcome-overlay-exiting" : ""}`} aria-live="polite" role="status">
      <div className={`welcome-glass${entranceComplete ? " welcome-glass-settled" : ""}`} onAnimationEnd={(event) => { if (event.target === event.currentTarget) setEntranceComplete(true); }}>
        <Sparkles className="welcome-sparkle" aria-hidden="true" />
        <span className="welcome-copy">{isFirstLogin ? "Welcome" : "Welcome back"},</span>
        <span ref={placeholderRef} className="welcome-name" style={namePosition ? { visibility: "hidden" } : undefined}>{firstName}</span>
      </div>
      {namePosition && typeof document !== "undefined" && createPortal(
        <span ref={nameRef} className="welcome-name-flight" style={{ position: "fixed", left: namePosition.left, top: namePosition.top, zIndex: 110, margin: 0, pointerEvents: "none", transformOrigin: "center center", fontFamily: namePosition.fontFamily, fontSize: namePosition.fontSize, fontWeight: namePosition.fontWeight, lineHeight: namePosition.lineHeight, letterSpacing: namePosition.letterSpacing, color: namePosition.color }}>{firstName}</span>,
        document.body,
      )}
    </div>
  );
}
