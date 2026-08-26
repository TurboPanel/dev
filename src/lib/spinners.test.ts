import { expect, test } from "vitest";
import {
  INSTALL_SPINNER_FRAMES,
  PURGE_SPINNER_FRAMES,
  TASK_SPINNER_FRAMES,
  ansibleSpinnerFrames,
  spinnerFrames,
  type DaemonOperation,
} from "./spinners.ts";

test("spinnerFrames uses purge frames only for purge", () => {
  expect(spinnerFrames("purge")).toEqual(PURGE_SPINNER_FRAMES);
  const otherOperations: DaemonOperation[] = [
    "install",
    "restart",
    "dev-env",
    "reset-dev-env",
    "reset-dev-db",
    "sync-dev-build",
    "rebuild-daemon-upgrade",
  ];
  for (const operation of otherOperations) {
    expect(spinnerFrames(operation)).toEqual(INSTALL_SPINNER_FRAMES);
  }
});

test("ansibleSpinnerFrames uses the task pulse at leaf depth", () => {
  expect(ansibleSpinnerFrames(0)).toEqual(INSTALL_SPINNER_FRAMES);
  expect(ansibleSpinnerFrames(1)).toEqual(INSTALL_SPINNER_FRAMES);
  expect(ansibleSpinnerFrames(2)).toEqual(TASK_SPINNER_FRAMES);
  expect(ansibleSpinnerFrames(3)).toEqual(TASK_SPINNER_FRAMES);
});
