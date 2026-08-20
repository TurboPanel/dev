import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Dispatch, SetStateAction } from "react";
import { appendConvergeServiceLogLine } from "../lib/converge-service-log.ts";
import {
  trackConvergeServiceEvent,
  type ConvergeServicePhase,
} from "./use-dev-env-converge.ts";

vi.mock("../lib/converge-service-log.ts", () => ({
  appendConvergeServiceLogLine: vi.fn(),
}));

function createTracker() {
  const currentServiceId = { current: null as string | null };
  let phases: Record<string, ConvergeServicePhase> = {};
  const setServicePhases: Dispatch<
    SetStateAction<Record<string, ConvergeServicePhase>>
  > = (update) => {
    if (typeof update === "function") {
      phases = update(phases);
      return;
    }
    phases = update;
  };
  return {
    currentServiceId,
    get phases() {
      return phases;
    },
    track(event: unknown) {
      trackConvergeServiceEvent(event, currentServiceId, setServicePhases);
    },
  };
}

describe("trackConvergeServiceEvent", () => {
  beforeEach(() => {
    vi.mocked(appendConvergeServiceLogLine).mockReset();
  });

  it("ignores non-Ansible JSONL payloads", () => {
    const tracker = createTracker();
    tracker.track(null);
    tracker.track("v2_playbook_on_play_start");
    tracker.track({ play: { name: "postgres" } });
    expect(tracker.currentServiceId.current).toBeNull();
    expect(tracker.phases).toEqual({});
  });

  it("marks a mapped play as installing and a build play as compiling", () => {
    const tracker = createTracker();
    tracker.track({
      _event: "v2_playbook_on_play_start",
      play: { name: "postgres" },
    });
    expect(tracker.currentServiceId.current).toBe("db");
    expect(tracker.phases).toEqual({ db: "installing" });
    tracker.track({
      _event: "v2_playbook_on_play_start",
      play: { name: "instance-build" },
    });
    expect(tracker.currentServiceId.current).toBe("instance");
    expect(tracker.phases).toEqual({ db: "ready", instance: "compiling" });
  });

  it("does not close the current service when the same play repeats", () => {
    const tracker = createTracker();
    tracker.track({
      _event: "v2_playbook_on_play_start",
      play: { name: "postgres" },
    });
    tracker.track({
      _event: "v2_playbook_on_play_start",
      play: { name: "postgres" },
    });
    expect(tracker.phases).toEqual({ db: "installing" });
  });

  it("clears the current service for unmapped play names", () => {
    const tracker = createTracker();
    tracker.track({
      _event: "v2_playbook_on_play_start",
      play: { name: "postgres" },
    });
    tracker.track({
      _event: "v2_playbook_on_play_start",
      play: { name: "unrelated play" },
    });
    expect(tracker.currentServiceId.current).toBeNull();
    expect(tracker.phases).toEqual({ db: "ready" });
  });

  it("advances the current service from a mapped task start", () => {
    const tracker = createTracker();
    tracker.track({
      _event: "v2_playbook_on_task_start",
      task: { name: "docker : Install engine" },
    });
    expect(tracker.currentServiceId.current).toBe("daemon");
    expect(tracker.phases).toEqual({ daemon: "installing" });
    tracker.track({
      _event: "v2_runner_on_start",
      task: { name: "caddy : compile assets" },
    });
    expect(tracker.currentServiceId.current).toBe("web");
    expect(tracker.phases.web).toBe("compiling");
  });

  it("leaves phases unchanged for an unmapped task name", () => {
    const tracker = createTracker();
    tracker.track({
      _event: "v2_runner_on_start",
      task: { name: "Gather facts" },
    });
    expect(tracker.currentServiceId.current).toBeNull();
    expect(tracker.phases).toEqual({});
  });

  it("appends a converge log line for runner results on the current service", () => {
    const tracker = createTracker();
    tracker.track({
      _event: "v2_playbook_on_play_start",
      play: { name: "caddy" },
    });
    tracker.track({
      _event: "v2_runner_on_ok",
      task: { name: "Reload" },
      hosts: { localhost: { changed: true } },
    });
    tracker.track({
      _event: "v2_runner_on_ok",
      task: { name: "Noop" },
    });
    tracker.track({
      _event: "v2_runner_on_skipped",
      task: { name: "  " },
    });
    expect(appendConvergeServiceLogLine).toHaveBeenCalledTimes(3);
    expect(appendConvergeServiceLogLine).toHaveBeenNthCalledWith(
      1,
      "web",
      "Reload [changed]",
      expect.any(String),
    );
    expect(appendConvergeServiceLogLine).toHaveBeenNthCalledWith(
      2,
      "web",
      "Noop [ok]",
      expect.any(String),
    );
    expect(appendConvergeServiceLogLine).toHaveBeenNthCalledWith(
      3,
      "web",
      "task [skipped]",
      expect.any(String),
    );
  });

  it("does not log runner results before a service is current", () => {
    const tracker = createTracker();
    tracker.track({
      _event: "v2_runner_on_failed",
      task: { name: "Boom" },
    });
    expect(appendConvergeServiceLogLine).not.toHaveBeenCalled();
  });

  it("marks the finishing service ready on stats", () => {
    const tracker = createTracker();
    tracker.track({
      _event: "v2_playbook_on_play_start",
      play: { name: "tabix" },
    });
    tracker.track({ _event: "v2_playbook_on_stats", stats: {} });
    expect(tracker.currentServiceId.current).toBeNull();
    expect(tracker.phases).toEqual({ tabix: "ready" });
    tracker.track({ _event: "v2_playbook_on_stats", stats: {} });
    expect(tracker.currentServiceId.current).toBeNull();
  });

  it("records unreachable and failed statuses from the current service", () => {
    const tracker = createTracker();
    tracker.track({
      _event: "v2_playbook_on_play_start",
      play: { name: "redis" },
    });
    tracker.track({
      _event: "v2_runner_on_unreachable",
      task: { name: "Ping" },
    });
    tracker.track({
      _event: "v2_runner_on_failed",
      task: { name: "Start" },
    });
    expect(appendConvergeServiceLogLine).toHaveBeenNthCalledWith(
      1,
      "cache",
      "Ping [unreachable]",
      expect.any(String),
    );
    expect(appendConvergeServiceLogLine).toHaveBeenNthCalledWith(
      2,
      "cache",
      "Start [failed]",
      expect.any(String),
    );
  });
});
