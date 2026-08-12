/**
 * Bootstrap orchestration sub-phases shown in the provisioner task list.
 *
 * Deno is ensured *before* uv/python/ansible/converge. Tracking it as its own
 * phase keeps a GitHub/curl Deno failure from painting "Install uv package
 * manager" as the failed step.
 */

export const BOOTSTRAP_DENO = "Ensure Deno runtime";
export const BOOTSTRAP_UV = "Install uv package manager";
export const BOOTSTRAP_PYTHON = "Install Python runtime";
export const BOOTSTRAP_ANSIBLE = "Install Ansible tooling";
export const BOOTSTRAP_CONVERGE = "Converge daemon stack (Ansible)";

export type BootstrapPhase =
  | "deno"
  | "uv"
  | "python"
  | "ansible"
  | "converge";

/** Maps the in-flight bootstrap sub-phase to the task-list label it corresponds to. */
export function bootstrapStepForPhase(phase: BootstrapPhase): string {
  switch (phase) {
    case "deno":
      return BOOTSTRAP_DENO;
    case "uv":
      return BOOTSTRAP_UV;
    case "python":
      return BOOTSTRAP_PYTHON;
    case "ansible":
      return BOOTSTRAP_ANSIBLE;
    case "converge":
      return BOOTSTRAP_CONVERGE;
  }
}
