import { describe, expect, it } from "vitest";
import {
  BOOTSTRAP_ANSIBLE,
  BOOTSTRAP_CONVERGE,
  BOOTSTRAP_DENO,
  BOOTSTRAP_PYTHON,
  BOOTSTRAP_UV,
  bootstrapStepForPhase,
} from "../lib/bootstrap-phase.ts";

describe("bootstrapStepForPhase", () => {
  it("maps deno separately from uv so Deno install failures label correctly", () => {
    expect(bootstrapStepForPhase("deno")).toBe(BOOTSTRAP_DENO);
    expect(bootstrapStepForPhase("uv")).toBe(BOOTSTRAP_UV);
    expect(BOOTSTRAP_DENO).toBe("Ensure Deno runtime");
    expect(BOOTSTRAP_UV).toBe("Install uv package manager");
  });

  it("covers every orchestration sub-phase", () => {
    expect(bootstrapStepForPhase("python")).toBe(BOOTSTRAP_PYTHON);
    expect(bootstrapStepForPhase("ansible")).toBe(BOOTSTRAP_ANSIBLE);
    expect(bootstrapStepForPhase("converge")).toBe(BOOTSTRAP_CONVERGE);
  });
});
