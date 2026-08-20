import { expect, test } from "vitest";
import { servicesNavHints, statusHints } from "./status-bar.tsx";

test("servicesNavHints always includes L logs and adds T tests on source services", () => {
  expect(servicesNavHints("db")).toContain("L logs");
  expect(servicesNavHints("db")).not.toContain("T tests");
  expect(servicesNavHints("instance")).toContain("L logs");
  expect(servicesNavHints("instance")).toContain("T tests");
  expect(servicesNavHints("daemon")).toContain("T tests");
  expect(servicesNavHints("web")).toContain("T tests");
  expect(servicesNavHints("ui")).toContain("T tests");
  expect(servicesNavHints("website")).toContain("T tests");
});

test("statusHints uses L logs on the services list and the tests overlay copy", () => {
  const list = statusHints({ activeAreaId: "services", selectedServiceId: "ui" });
  expect(list).toContain("L logs");
  expect(list).toContain("T tests");
  expect(list).not.toContain("T tail");

  const overlay = statusHints({
    activeAreaId: "services",
    selectedServiceId: "ui",
    serviceTestsRepoId: "ui",
  });
  expect(overlay).toContain("Esc back/cancel");
  expect(overlay).not.toContain("L logs");
});
