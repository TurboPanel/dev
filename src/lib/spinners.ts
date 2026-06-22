export const INSTALL_SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export const PURGE_SPINNER_FRAMES = ["|", "/", "-", "\\"];
export const TASK_SPINNER_FRAMES = [".", "o", "O", "o"];

export type DaemonOperation =
  | "install"
  | "purge"
  | "restart"
  | "dev-env"
  | "build-daemon-binaries";

export function spinnerFrames(operation: DaemonOperation): string[] {
  return operation === "purge" ? PURGE_SPINNER_FRAMES : INSTALL_SPINNER_FRAMES;
}

/** Braille for console steps/plays; dot pulse for Ansible leaf tasks. */
export function ansibleSpinnerFrames(depth: number): string[] {
  return depth >= 2 ? TASK_SPINNER_FRAMES : INSTALL_SPINNER_FRAMES;
}
