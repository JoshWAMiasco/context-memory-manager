"use client";

import { useEffect, useId, useRef } from "react";
import { MAX_PARTICLES, PARTICLE_TRAVEL_SECONDS, readParticleRate } from "@/lib/backup-topology";

export type EnergyFlowStatus = "queued" | "running" | "paused" | "failed" | "done";

export interface EnergyFlowProps {
  /** The pipe, from the source to the destination. */
  pathData: string;
  color: string;
  status: EnergyFlowStatus;
  speedBytesPerSecond?: number;
  /** Off with reduced motion: the pipe is highlighted without particles. */
  showsParticles: boolean;
  /** A click on a failed pipe opens the job's details. */
  onSelect?: () => void;
  jobId: string;
}

interface Particle {
  /** 0 at the source, 1 at the destination. */
  progress: number;
  size: number;
  /** Each particle travels at its own pace, between 0.85 and 1.15. */
  pace: number;
  isActive: boolean;
}

const FAILED_COLOR = "#ff6b81";

/**
 * The animation of one running backup on its pipe: a glowing stroke with a streaming
 * dash, and particles travelling from source to destination, more of them the faster it copies
 * (at most 60). The stage draws its speed and time left above everything. Paused, the particles freeze and the pipe breathes; failed, it turns red and
 * flickers and a click opens the details. Drawn with `requestAnimationFrame`, which stops while
 * the tab is hidden. Without `showsParticles` (reduced motion) only the highlighted pipe is drawn.
 *
 * @example
 * <EnergyFlow pathData={pipe} color="#22d3ee" status="running" speedBytesPerSecond={speed} showsParticles jobId={job.id} />
 */
export function EnergyFlow({
  pathData,
  color,
  status,
  speedBytesPerSecond,
  showsParticles,
  onSelect,
  jobId,
}: EnergyFlowProps) {
  const filterId = useId();
  const pathReference = useRef<SVGPathElement>(null);
  const particlesReference = useRef<SVGGElement>(null);
  const statusReference = useRef(status);
  const speedReference = useRef(speedBytesPerSecond);
  const strokeColor = status === "failed" ? FAILED_COLOR : color;

  useEffect(() => {
    statusReference.current = status;
    speedReference.current = speedBytesPerSecond;
  }, [status, speedBytesPerSecond]);

  useEffect(() => {
    const pipe = pathReference.current;
    const group = particlesReference.current;
    if (!showsParticles || !pipe || !group) return;
    const pipeLength = pipe.getTotalLength();
    const circles = [...group.querySelectorAll("circle")];
    const particles: Particle[] = circles.map(() => ({ progress: 0, size: 0, pace: 1, isActive: false }));
    let frameHandle = 0;
    let lastTime = performance.now();
    let pendingEmissions = 0;

    const drawFrame = (now: number) => {
      const elapsedSeconds = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;
      const currentStatus = statusReference.current;
      if (currentStatus === "running") {
        pendingEmissions += elapsedSeconds * readParticleRate(speedReference.current);
        while (pendingEmissions >= 1) {
          pendingEmissions -= 1;
          const free = particles.find((particle) => !particle.isActive);
          if (!free) break;
          free.isActive = true;
          free.progress = 0;
          free.size = 2.2 + Math.random() * 1.8;
          free.pace = 0.85 + Math.random() * 0.3;
        }
      }
      const isMoving = currentStatus === "running" || currentStatus === "done";
      for (const [particleIndex, particle] of particles.entries()) {
        const circle = circles[particleIndex];
        if (!circle) continue;
        if (currentStatus === "failed") particle.isActive = false;
        if (particle.isActive && isMoving) {
          particle.progress += (elapsedSeconds / PARTICLE_TRAVEL_SECONDS) * particle.pace;
          if (particle.progress >= 1) particle.isActive = false;
        }
        if (!particle.isActive) {
          circle.setAttribute("r", "0");
          continue;
        }
        const point = pipe.getPointAtLength(particle.progress * pipeLength);
        circle.setAttribute("cx", point.x.toFixed(1));
        circle.setAttribute("cy", point.y.toFixed(1));
        circle.setAttribute("r", particle.size.toFixed(2));
        circle.setAttribute("opacity", (0.35 + 0.65 * Math.sin(Math.PI * particle.progress)).toFixed(2));
      }
      frameHandle = requestAnimationFrame(drawFrame);
    };

    const start = () => {
      cancelAnimationFrame(frameHandle);
      lastTime = performance.now();
      frameHandle = requestAnimationFrame(drawFrame);
    };
    const handleVisibilityChange = () => {
      if (document.hidden) cancelAnimationFrame(frameHandle);
      else start();
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      cancelAnimationFrame(frameHandle);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [showsParticles, pathData]);

  const pipeClassName =
    status === "failed" ? "backup-pipe-flicker" : status === "paused" || status === "queued" ? "backup-pipe-pulse" : "";

  return (
    <g
      data-testid="energy-flow"
      data-job-id={jobId}
      data-status={status}
      className={onSelect ? "cursor-pointer" : undefined}
      onClick={onSelect}
    >
      <defs>
        <filter id={filterId} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
      </defs>
      <g className={pipeClassName}>
        <path
          d={pathData}
          fill="none"
          stroke={strokeColor}
          strokeWidth={10}
          strokeLinecap="round"
          opacity={0.32}
          filter={`url(#${filterId})`}
        />
        <path
          ref={pathReference}
          d={pathData}
          fill="none"
          stroke={strokeColor}
          strokeWidth={2.6}
          strokeLinecap="round"
        />
        {status === "running" && (
          <path
            d={pathData}
            fill="none"
            stroke="white"
            strokeOpacity={0.55}
            strokeWidth={1.6}
            strokeLinecap="round"
            className="backup-flow-dash"
          />
        )}
      </g>
      {showsParticles && (
        <g ref={particlesReference} data-testid="energy-particles" fill={strokeColor} pointerEvents="none">
          {Array.from({ length: MAX_PARTICLES }, (_, particleIndex) => (
            <circle key={particleIndex} r={0} cx={0} cy={0} />
          ))}
        </g>
      )}
    </g>
  );
}
