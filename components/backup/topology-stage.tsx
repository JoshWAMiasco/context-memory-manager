"use client";

import { Laptop, Server } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { EnergyFlow, type EnergyFlowStatus } from "@/components/backup/energy-flow";
import { EjectShieldIcon, ExternalDriveIcon, UsbFlashDiskIcon } from "@/components/icons/ccm-icons";
import { formatFileSize } from "@/components/page-sections/applications/file-manager/format-file-size";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useServerEvent } from "@/hooks/use-server-events";
import type { BackupMachine, BackupProfile, JobSummary, StorageSummary } from "@/lib/api-types";
import {
  buildPipe,
  buildPipePath,
  MACHINE_CENTER,
  MODE_COLORS,
  placeDriveNodes,
  readEntryPoint,
  readFlowColor,
  readPipePoint,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  type Pipe,
  type Point,
} from "@/lib/backup-topology";
import { formatTimeLeft, readJobPercentage } from "@/lib/client/jobs";

/** A node of the topology: the machine (every internal storage) or one drive. */
export type TopologyNodeId = "machine" | `drive:${string}`;

const MACHINE_RADIUS = 50;
const DRIVE_RADIUS = 38;
const MACHINE_PIPE_BEND = 0.12;
const DRIVE_ARC_BEND = 0.28;
/** A drag shorter than this is a click. */
const DRAG_THRESHOLD_PIXELS = 6;
/** How long the burst and check mark stay at a finished backup's destination. */
const COMPLETION_MILLISECONDS = 2600;
/** Failed backups keep their red pipe this long, so the error can be clicked. */
const FAILED_VISIBLE_MILLISECONDS = 10 * 60 * 1000;

export interface TopologyStageProps {
  storages: StorageSummary[];
  machine?: BackupMachine;
  jobs: JobSummary[];
  profiles: BackupProfile[];
  /** A drag from one node to another: open the profile editor with both filled in. */
  onConnect: (source: TopologyNodeId, destination: TopologyNodeId) => void;
  onBackUpToDrive: (storageId: string) => void;
  onBackUpFromDrive: (storageId: string) => void;
  onEject: (storage: StorageSummary) => void;
  onMount: (storage: StorageSummary) => void;
  onSelectJob: (jobId: string) => void;
}

interface Flow {
  job: JobSummary;
  from: TopologyNodeId;
  to: TopologyNodeId;
  pipe: Pipe;
}

/** Node names get a halo in the background colour, so pipes passing behind them don't cut through the text. */
const LABEL_HALO_CLASS_NAME = "stroke-surface [stroke-linejoin:round]";

/** Spots along a pipe to try for a flow's speed label, best first: past the middle, toward the destination. */
const LABEL_SHARES = [0.62, 0.5, 0.72, 0.4, 0.8, 0.3];
const LABEL_HEIGHT = 22;

function measureFlowLabel(text: string): number {
  return text.length * 6.4 + 18;
}

/** Whether two boxes, each given by its centre and size, overlap. */
function overlapsBox(center: Point, width: number, box: { center: Point; width: number; height: number }): boolean {
  return (
    Math.abs(center.x - box.center.x) < (width + box.width) / 2 &&
    Math.abs(center.y - box.center.y) < (LABEL_HEIGHT + box.height) / 2
  );
}

/** Whether a label box centred on `center` overlaps a node's circle (with its rings) or the name under it. */
function overlapsNode(center: Point, width: number, node: { point: Point; radius: number }): boolean {
  const nearestX = Math.max(center.x - width / 2, Math.min(node.point.x, center.x + width / 2));
  const nearestY = Math.max(center.y - LABEL_HEIGHT / 2, Math.min(node.point.y, center.y + LABEL_HEIGHT / 2));
  if (Math.hypot(node.point.x - nearestX, node.point.y - nearestY) < node.radius) return true;
  const nameBox = { center: { x: node.point.x, y: node.point.y + node.radius + 14 }, width: 150, height: 40 };
  return overlapsBox(center, width, nameBox);
}

/**
 * Where a flow's speed label goes: the first spot along the pipe, just above or below it, or
 * beside its middle, that keeps clear of both end nodes and their names, so a short pipe never
 * puts the label over a drive.
 */
function placeFlowLabel(pipe: Pipe, text: string, fromRadius: number, toRadius: number): Point {
  const width = measureFlowLabel(text);
  const ends = [
    { point: pipe.from, radius: fromRadius },
    { point: pipe.to, radius: toRadius },
  ];
  const middle = readPipePoint(pipe, 0.5);
  const candidates: Point[] = [
    ...LABEL_SHARES.flatMap((share) => {
      const point = readPipePoint(pipe, share);
      return [-20, 20].map((offset) => ({ x: point.x, y: point.y + offset }));
    }),
    ...[-1, 1].map((side) => ({ x: middle.x + side * (width / 2 + 14), y: middle.y })),
  ];
  return (
    candidates.find((center) => !ends.some((end) => overlapsNode(center, width, end))) ?? {
      x: middle.x,
      y: middle.y - 20,
    }
  );
}

function FlowLabel({ point, text }: { point: Point; text: string }) {
  const width = measureFlowLabel(text);
  return (
    <g transform={`translate(${point.x} ${point.y})`} pointerEvents="none" data-testid="energy-label">
      <rect x={-width / 2} y={-11} width={width} height={22} rx={11} className="fill-surface stroke-line" />
      <text textAnchor="middle" dominantBaseline="central" className="fill-foreground text-[11px] tabular-nums">
        {text}
      </text>
    </g>
  );
}

function toNodeId(storages: readonly StorageSummary[], storageId: string): TopologyNodeId | undefined {
  const storage = storages.find((candidate) => candidate.id === storageId);
  if (!storage) return undefined;
  return storage.kind === "internal" ? "machine" : `drive:${storage.id}`;
}

function readFlowStatus(job: JobSummary): EnergyFlowStatus {
  if (job.status === "cancelled") return "done";
  return job.status;
}

function describeFlow(job: JobSummary): string | undefined {
  const { progress } = job;
  if (job.status !== "running" || progress.phase !== "copying" || !progress.speed) return undefined;
  const parts = [`${formatFileSize(progress.speed)}/s`];
  if (progress.eta !== undefined) parts.push(formatTimeLeft(progress.eta));
  return parts.join(" · ");
}

function CapacityRing({
  radius,
  fraction,
  strokeClassName,
  width = 4,
  testId,
}: {
  radius: number;
  fraction: number;
  strokeClassName: string;
  width?: number;
  testId?: string;
}) {
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(1, Math.max(0, fraction));
  return (
    <g transform="rotate(-90)" data-testid={testId} data-fraction={clamped.toFixed(3)}>
      <circle r={radius} fill="none" strokeWidth={width} className="stroke-surface-strong" opacity={0.6} />
      <circle
        r={radius}
        fill="none"
        strokeWidth={width}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - clamped)}
        className={`${strokeClassName} transition-[stroke-dashoffset] duration-300 ease-linear motion-reduce:transition-none`}
      />
    </g>
  );
}

function ProgressRing({ radius, fraction, color }: { radius: number; fraction: number; color: string }) {
  const circumference = 2 * Math.PI * radius;
  return (
    <g transform="rotate(-90)" data-testid="destination-progress" data-fraction={fraction.toFixed(3)}>
      <circle
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={5}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - Math.min(1, Math.max(0, fraction)))}
        className="transition-[stroke-dashoffset] duration-300 ease-linear motion-reduce:transition-none"
      />
    </g>
  );
}

function CompletionBurst({ point, color, isReduced }: { point: Point; color: string; isReduced: boolean }) {
  return (
    <g transform={`translate(${point.x} ${point.y})`} data-testid="completion-burst" pointerEvents="none">
      {!isReduced && (
        <motion.circle
          r={DRIVE_RADIUS}
          fill="none"
          stroke={color}
          strokeWidth={3}
          initial={{ scale: 1, opacity: 0.9 }}
          animate={{ scale: 2.4, opacity: 0 }}
          transition={{ duration: 1.1, ease: "easeOut" }}
        />
      )}
      <motion.g
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 1, 1, 0] }}
        transition={{ duration: 2.4, times: [0, 0.15, 0.8, 1] }}
      >
        <circle r={14} cx={DRIVE_RADIUS - 6} cy={-DRIVE_RADIUS + 6} className="fill-success" />
        <motion.path
          d={`M ${DRIVE_RADIUS - 12} ${-DRIVE_RADIUS + 6} l 4 4 l 8 -8`}
          fill="none"
          stroke="white"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: isReduced ? 1 : 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.4, delay: 0.15 }}
        />
      </motion.g>
    </g>
  );
}

/**
 * The live topology at the top of the Backup page: this computer in the middle
 * with a capacity ring per internal storage, and every drive on an orbit around it, each at an
 * angle that stays put per volume. Drives fly in when plugged in (with a ripple) and dissolve
 * when removed; unmounted drives are dashed. Pipes join the machine and each drive, and two
 * drives that a profile or job connects. A running backup streams energy along its pipe and fills
 * a ring at its destination. Drag from one node to another to plan a backup between them; click a
 * drive for its menu.
 *
 * @example
 * <TopologyStage storages={storages} jobs={jobs} profiles={profiles} onConnect={openEditor} … />
 */
export function TopologyStage({
  storages,
  machine,
  jobs,
  profiles,
  onConnect,
  onBackUpToDrive,
  onBackUpFromDrive,
  onEject,
  onMount,
  onSelectJob,
}: TopologyStageProps) {
  // Live, unlike motion's useReducedMotion (read once): turning the OS setting on stops the particles at once.
  const isReduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const svgReference = useRef<SVGSVGElement>(null);
  const containerReference = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ from: TopologyNodeId; start: Point; pointer: Point; isDragging: boolean }>();
  const [menu, setMenu] = useState<{ storageId: string; left: number; top: number }>();
  const [completions, setCompletions] = useState<{ jobId: string; point: Point; color: string }[]>([]);
  const [now, setNow] = useState(() => Date.now());

  const drives = useMemo(() => storages.filter((storage) => storage.kind !== "internal"), [storages]);
  const positions = useMemo(() => placeDriveNodes(drives.map((drive) => drive.id)), [drives]);
  const readPoint = (nodeId: TopologyNodeId): Point | undefined =>
    nodeId === "machine" ? MACHINE_CENTER : positions.get(nodeId.slice("drive:".length));

  const flows = useMemo(() => {
    const result: Flow[] = [];
    for (const job of jobs) {
      if (!job.transfer) continue;
      const isRecentFailure =
        job.status === "failed" && now - new Date(job.updatedAt).getTime() < FAILED_VISIBLE_MILLISECONDS;
      if (!["queued", "running", "paused"].includes(job.status) && !isRecentFailure) continue;
      const from = toNodeId(storages, job.transfer.source.storageId);
      const to = toNodeId(storages, job.transfer.destination.storageId);
      if (!from || !to || from === to) continue;
      const fromPoint = from === "machine" ? MACHINE_CENTER : positions.get(from.slice(6));
      const toPoint = to === "machine" ? MACHINE_CENTER : positions.get(to.slice(6));
      if (!fromPoint || !toPoint) continue;
      const pipe =
        from === "machine" || to === "machine"
          ? buildPipe(fromPoint, toPoint, from === "machine" ? MACHINE_PIPE_BEND : -MACHINE_PIPE_BEND)
          : buildPipe(fromPoint, toPoint, DRIVE_ARC_BEND, MACHINE_CENTER);
      result.push({ job, from, to, pipe });
    }
    return result;
  }, [jobs, storages, positions, now]);

  /** How far a node reaches from its centre, rings included (labels keep clear of it). */
  const readNodeRadius = (nodeId: TopologyNodeId) =>
    nodeId === "machine" ? MACHINE_RADIUS + 14 + (machine?.storages.length ?? 0) * 8 : DRIVE_RADIUS + 10;

  const driveArcs = useMemo(() => {
    const pairs = new Map<string, [string, string]>();
    const addPair = (firstId: string, secondId: string) => {
      const firstNode = toNodeId(storages, firstId);
      const secondNode = toNodeId(storages, secondId);
      if (!firstNode?.startsWith("drive:") || !secondNode?.startsWith("drive:") || firstId === secondId) return;
      const ordered = [firstId, secondId].toSorted() as [string, string];
      pairs.set(ordered.join("|"), ordered);
    };
    for (const profile of profiles) addPair(profile.source.storageId, profile.destination.storageId);
    for (const flow of flows) {
      if (flow.job.transfer) addPair(flow.job.transfer.source.storageId, flow.job.transfer.destination.storageId);
    }
    return [...pairs.values()];
  }, [profiles, flows, storages]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const handleJobState = useCallback(
    ({ job }: { job: JobSummary }) => {
      if (job.status !== "done" || !job.transfer) return;
      const destination = toNodeId(storages, job.transfer.destination.storageId);
      const point =
        destination === "machine" ? MACHINE_CENTER : destination ? positions.get(destination.slice(6)) : undefined;
      if (!point) return;
      const completion = { jobId: job.id, point, color: MODE_COLORS[job.transfer.mode] };
      setCompletions((current) => [...current.filter((existing) => existing.jobId !== job.id), completion]);
      setTimeout(
        () => setCompletions((current) => current.filter((existing) => existing !== completion)),
        COMPLETION_MILLISECONDS,
      );
    },
    [storages, positions],
  );
  useServerEvent("job.state", handleJobState);

  useEffect(() => {
    if (!menu) return;
    const close = (event: KeyboardEvent | PointerEvent) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (
        event instanceof PointerEvent &&
        (event.target as Element | null)?.closest("[data-testid='topology-node-menu']")
      )
        return;
      setMenu(undefined);
    };
    window.addEventListener("keydown", close);
    window.addEventListener("pointerdown", close);
    return () => {
      window.removeEventListener("keydown", close);
      window.removeEventListener("pointerdown", close);
    };
  }, [menu]);

  const toStagePoint = (clientX: number, clientY: number): Point => {
    const svg = svgReference.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return { x: 0, y: 0 };
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return { x: point.x, y: point.y };
  };

  const openMenu = (storageId: string, element: Element) => {
    const container = containerReference.current?.getBoundingClientRect();
    const node = element.getBoundingClientRect();
    if (!container) return;
    setMenu({ storageId, left: node.left - container.left + node.width / 2, top: node.bottom - container.top + 4 });
  };

  /** Starts a drag from a node (`data-node-id`); a release without moving is a click (a drive's menu). */
  const handleNodePointerDown = (event: ReactPointerEvent<SVGGElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const nodeElement = event.currentTarget;
    const nodeId = nodeElement.getAttribute("data-node-id") as TopologyNodeId;
    const start = { x: event.clientX, y: event.clientY };
    setDrag({ from: nodeId, start, pointer: toStagePoint(event.clientX, event.clientY), isDragging: false });
    const handleMove = (moveEvent: PointerEvent) => {
      const moved = Math.hypot(moveEvent.clientX - start.x, moveEvent.clientY - start.y) > DRAG_THRESHOLD_PIXELS;
      setDrag(
        (current) =>
          current && {
            ...current,
            pointer: toStagePoint(moveEvent.clientX, moveEvent.clientY),
            isDragging: current.isDragging || moved,
          },
      );
    };
    const handleUp = (upEvent: PointerEvent) => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      const moved = Math.hypot(upEvent.clientX - start.x, upEvent.clientY - start.y) > DRAG_THRESHOLD_PIXELS;
      setDrag(undefined);
      if (!moved) {
        if (nodeId !== "machine") openMenu(nodeId.slice("drive:".length), nodeElement);
        return;
      }
      const target = document
        .elementFromPoint(upEvent.clientX, upEvent.clientY)
        ?.closest("[data-node-id]")
        ?.getAttribute("data-node-id") as TopologyNodeId | null | undefined;
      if (target && target !== nodeId) onConnect(nodeId, target);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  };

  const destinationProgress = (nodeId: TopologyNodeId) =>
    flows.find((flow) => flow.to === nodeId && (flow.job.status === "running" || flow.job.status === "paused"));
  const menuStorage = menu ? drives.find((drive) => drive.id === menu.storageId) : undefined;
  const machineProgress = destinationProgress("machine");
  const dragFromPoint = drag?.isDragging ? readPoint(drag.from) : undefined;

  return (
    <div ref={containerReference} className="relative h-full w-full select-none" data-testid="topology-stage">
      <svg
        ref={svgReference}
        viewBox={`0 0 ${STAGE_WIDTH} ${STAGE_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full touch-none"
        role="img"
        aria-label="Backup topology: this computer and the connected drives"
        data-reduced-motion={isReduced ? "true" : "false"}
      >
        <g data-testid="topology-pipes">
          {drives.map((drive) => {
            const point = positions.get(drive.id);
            if (!point) return null;
            return (
              <path
                key={drive.id}
                data-testid={`topology-pipe-${drive.id}`}
                d={buildPipePath(MACHINE_CENTER, point, MACHINE_PIPE_BEND)}
                fill="none"
                strokeWidth={2}
                strokeLinecap="round"
                className={`stroke-foreground-faint ${drive.available ? "backup-pipe-shimmer" : ""}`}
                opacity={drive.available ? 0.45 : 0.2}
              />
            );
          })}
          {driveArcs.map(([firstId, secondId]) => {
            const first = positions.get(firstId);
            const second = positions.get(secondId);
            if (!first || !second) return null;
            return (
              <path
                key={`${firstId}|${secondId}`}
                data-testid={`topology-arc-${firstId}-${secondId}`}
                d={buildPipePath(first, second, DRIVE_ARC_BEND, MACHINE_CENTER)}
                fill="none"
                strokeWidth={2}
                strokeLinecap="round"
                className="backup-pipe-shimmer stroke-foreground-faint"
                opacity={0.45}
              />
            );
          })}
        </g>

        <g data-testid="topology-flows">
          {flows.map((flow) => (
            <EnergyFlow
              key={flow.job.id}
              jobId={flow.job.id}
              pathData={flow.pipe.pathData}
              color={readFlowColor(flow.job.transfer?.mode ?? "copy", flow.job.progress.phase)}
              status={readFlowStatus(flow.job)}
              speedBytesPerSecond={flow.job.progress.speed}
              showsParticles={!isReduced}
              onSelect={flow.job.status === "failed" ? () => onSelectJob(flow.job.id) : undefined}
            />
          ))}
        </g>

        <g
          transform={`translate(${MACHINE_CENTER.x} ${MACHINE_CENTER.y})`}
          data-node-id="machine"
          data-testid="topology-node-machine"
          className="cursor-grab"
          onPointerDown={handleNodePointerDown}
        >
          {(machine?.storages ?? []).map((storage, storageIndex) => (
            <g key={storage.storageId}>
              <title>{`${storage.label}: ${formatFileSize(storage.used)} of ${formatFileSize(storage.size)} used`}</title>
              <CapacityRing
                radius={MACHINE_RADIUS + 10 + storageIndex * 8}
                fraction={storage.size > 0 ? storage.used / storage.size : 0}
                strokeClassName="stroke-primary"
                width={4}
                testId={`machine-capacity-${storage.storageId}`}
              />
            </g>
          ))}
          {machineProgress && (
            <ProgressRing
              radius={MACHINE_RADIUS + 4}
              fraction={(readJobPercentage(machineProgress.job.progress) ?? 0) / 100}
              color={readFlowColor(machineProgress.job.transfer?.mode ?? "copy", machineProgress.job.progress.phase)}
            />
          )}
          <circle r={MACHINE_RADIUS} className="fill-surface stroke-line" strokeWidth={2} />
          {machine?.mode === "server" ? (
            <Server x={-17} y={-17} width={34} height={34} strokeWidth={1.2} className="text-foreground" />
          ) : (
            <Laptop x={-17} y={-17} width={34} height={34} strokeWidth={1.2} className="text-foreground" />
          )}
          <text
            y={MACHINE_RADIUS + 22 + Math.max(0, (machine?.storages.length ?? 0) - 1) * 8}
            textAnchor="middle"
            className={`fill-foreground text-[14px] font-medium ${LABEL_HALO_CLASS_NAME}`}
            strokeWidth={5}
            paintOrder="stroke"
          >
            {machine?.hostname ?? "This computer"}
          </text>
        </g>

        <AnimatePresence initial={false}>
          {drives.map((drive) => {
            const point = positions.get(drive.id);
            if (!point) return null;
            const entry = readEntryPoint(point);
            const nodeId: TopologyNodeId = `drive:${drive.id}`;
            const progress = destinationProgress(nodeId);
            const capacity = drive.size && drive.size > 0 ? (drive.used ?? 0) / drive.size : 0;
            const Glyph = drive.kind === "usb" ? UsbFlashDiskIcon : ExternalDriveIcon;
            return (
              <motion.g
                key={drive.id}
                data-node-id={nodeId}
                data-testid={`topology-node-${drive.id}`}
                data-available={drive.available ? "true" : "false"}
                className="cursor-grab"
                initial={
                  isReduced
                    ? { opacity: 0, x: point.x, y: point.y }
                    : { opacity: 0, scale: 0.6, x: entry.x, y: entry.y }
                }
                animate={{ opacity: 1, scale: 1, x: point.x, y: point.y }}
                exit={isReduced ? { opacity: 0 } : { opacity: 0, scale: 1.25, filter: "blur(6px)" }}
                transition={{ type: "spring", stiffness: 140, damping: 18 }}
                style={{ transformBox: "fill-box", transformOrigin: "center" }}
                onPointerDown={handleNodePointerDown}
              >
                {!isReduced && (
                  <motion.circle
                    r={DRIVE_RADIUS}
                    fill="none"
                    className="stroke-primary"
                    strokeWidth={2}
                    initial={{ scale: 1, opacity: 0.8 }}
                    animate={{ scale: 2.6, opacity: 0 }}
                    transition={{ duration: 1.3, ease: "easeOut", delay: 0.35 }}
                    pointerEvents="none"
                    data-testid="connect-ripple"
                  />
                )}
                {!isReduced &&
                  [0, 1, 2, 3, 4].map((sparkIndex) => (
                    <motion.circle
                      key={sparkIndex}
                      r={2.5}
                      className="fill-warning"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 0 }}
                      exit={{
                        opacity: [0, 1, 0],
                        x: Math.cos((sparkIndex / 5) * 2 * Math.PI) * 70,
                        y: Math.sin((sparkIndex / 5) * 2 * Math.PI) * 70,
                      }}
                      transition={{ duration: 0.7 }}
                      pointerEvents="none"
                    />
                  ))}
                {drive.available && (
                  <CapacityRing
                    radius={DRIVE_RADIUS + 7}
                    fraction={capacity}
                    strokeClassName="stroke-primary"
                    width={4}
                  />
                )}
                {progress && (
                  <ProgressRing
                    radius={DRIVE_RADIUS + 14}
                    fraction={(readJobPercentage(progress.job.progress) ?? 0) / 100}
                    color={readFlowColor(progress.job.transfer?.mode ?? "copy", progress.job.progress.phase)}
                  />
                )}
                <circle
                  r={DRIVE_RADIUS}
                  className="fill-surface stroke-line"
                  strokeWidth={2}
                  strokeDasharray={drive.available ? undefined : "6 5"}
                  opacity={drive.available ? 1 : 0.7}
                />
                <Glyph x={-15} y={-15} width={30} height={30} className="text-foreground" />
                <text
                  y={DRIVE_RADIUS + 26}
                  textAnchor="middle"
                  className={`fill-foreground text-[13px] font-medium ${LABEL_HALO_CLASS_NAME}`}
                  strokeWidth={5}
                  paintOrder="stroke"
                >
                  {drive.label}
                </text>
                <text
                  y={DRIVE_RADIUS + 42}
                  textAnchor="middle"
                  className="fill-foreground-subtle text-[11px] uppercase"
                >
                  {drive.available ? (drive.fsType ?? "") : "Not mounted"}
                </text>
                {drive.canEject && (
                  <g
                    transform={`translate(${DRIVE_RADIUS - 4} ${-DRIVE_RADIUS + 4})`}
                    className="cursor-pointer"
                    role="button"
                    aria-label={`Eject ${drive.label}`}
                    data-testid={`topology-eject-${drive.id}`}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => onEject(drive)}
                  >
                    <circle r={11} className="fill-surface-muted stroke-line" />
                    <EjectShieldIcon x={-7} y={-7} width={14} height={14} className="text-foreground-muted" />
                  </g>
                )}
                {!drive.available && drive.canMount && (
                  <g
                    transform={`translate(0 ${DRIVE_RADIUS + 60})`}
                    className="cursor-pointer"
                    role="button"
                    aria-label={`Mount ${drive.label}`}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => onMount(drive)}
                  >
                    <rect x={-26} y={-11} width={52} height={22} rx={11} className="fill-primary" />
                    <text
                      textAnchor="middle"
                      dominantBaseline="central"
                      className="fill-on-primary text-[11px] font-medium"
                    >
                      Mount
                    </text>
                  </g>
                )}
              </motion.g>
            );
          })}
        </AnimatePresence>

        <g data-testid="topology-labels">
          {flows.map((flow) => {
            const text = describeFlow(flow.job);
            return text ? (
              <FlowLabel
                key={flow.job.id}
                point={placeFlowLabel(flow.pipe, text, readNodeRadius(flow.from), readNodeRadius(flow.to))}
                text={text}
              />
            ) : null;
          })}
        </g>

        {completions.map((completion) => (
          <CompletionBurst
            key={completion.jobId}
            point={completion.point}
            color={completion.color}
            isReduced={isReduced}
          />
        ))}

        {drag && dragFromPoint && (
          <line
            x1={dragFromPoint.x}
            y1={dragFromPoint.y}
            x2={drag.pointer.x}
            y2={drag.pointer.y}
            strokeWidth={2}
            strokeDasharray="6 6"
            className="stroke-primary"
            pointerEvents="none"
            data-testid="topology-drag-line"
          />
        )}
      </svg>

      {menu && menuStorage && (
        <div
          role="menu"
          data-testid="topology-node-menu"
          className="absolute z-10 w-64 -translate-x-1/2 rounded-lg border border-line bg-surface p-1 text-sm shadow-lg"
          style={{ left: menu.left, top: menu.top }}
        >
          <div className="truncate px-3 py-1.5 text-xs text-foreground-subtle">{menuStorage.label}</div>
          <button
            type="button"
            role="menuitem"
            disabled={!menuStorage.available || menuStorage.access !== "write"}
            className="w-full rounded-md px-3 py-2 text-left hover:bg-surface-muted disabled:opacity-50"
            onClick={() => {
              setMenu(undefined);
              onBackUpToDrive(menuStorage.id);
            }}
          >
            Back up this computer to this drive…
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!menuStorage.available}
            className="w-full rounded-md px-3 py-2 text-left hover:bg-surface-muted disabled:opacity-50"
            onClick={() => {
              setMenu(undefined);
              onBackUpFromDrive(menuStorage.id);
            }}
          >
            Back up this drive to…
          </button>
          {menuStorage.canEject && (
            <button
              type="button"
              role="menuitem"
              className="w-full rounded-md px-3 py-2 text-left hover:bg-surface-muted"
              onClick={() => {
                setMenu(undefined);
                onEject(menuStorage);
              }}
            >
              Eject
            </button>
          )}
        </div>
      )}
    </div>
  );
}
