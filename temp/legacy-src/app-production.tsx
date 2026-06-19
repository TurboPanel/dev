import React from "react";
import { AppShell } from "@turbopanel/components/layout/app-shell.tsx";
import { MenuBar } from "@turbopanel/components/layout/menu-bar.tsx";
import { StatusBar } from "@turbopanel/components/layout/status-bar.tsx";
import { ConfirmPrompt } from "@turbopanel/components/confirm-prompt.tsx";
import { RuntimeSelectPrompt } from "@turbopanel/components/runtime-select-prompt.tsx";
import { CONSOLE_AREAS, useConsole } from "@turbopanel/hooks/use-console.ts";
import { resetDevEnvironment } from "@turbopanel/lib/reset-dev-environment.ts";
import { MainScreen } from "@turbopanel/screens/main-screen.tsx";
import { TaskRunScreen } from "@turbopanel/screens/task-run-screen.tsx";

/** Shipped console UI — swap back via TURBOPANEL_CONSOLE_UI=production. */
export function App() {
  const c = useConsole();

  const mainContent = c.taskRun
    ? (
      <TaskRunScreen
        title={c.taskRun.title}
        tasks={c.ansible.tasks}
        recap={c.ansible.recap}
        error={c.ansible.error}
        errorLogPath={c.ansible.errorLogPath}
        done={c.ansible.done}
        onDone={() => c.setTaskRun(null)}
      />
    )
    : c.resetPrompt?.step === "runtime"
    ? (
      <RuntimeSelectPrompt
        onSelect={(target) => {
          if (!target) {
            c.setResetPrompt(null);
            return;
          }
          c.setResetPrompt({ step: "confirm", target });
        }}
      />
    )
    : c.resetPrompt?.step === "confirm"
    ? (
      <ConfirmPrompt
        question="This wipes all Postgres data and restarts the instance. Continue?"
        onConfirm={(confirmed) => {
          if (!confirmed) {
            c.setResetPrompt(null);
            return;
          }
          const target = c.resetPrompt?.step === "confirm"
            ? c.resetPrompt.target
            : "deno";
          c.setResetPrompt(null);
          c.beginTaskRun("Resetting development environment…", async (handlers) => {
            await resetDevEnvironment(target, handlers);
          });
        }}
      />
    )
    : (
      <MainScreen
        area={c.activeArea}
        mainHeight={c.mainHeight}
        runtimeReady={c.runtimeReady}
        daemonStatus={c.daemonStatus}
        daemonPresent={c.daemonPresent}
        platformDirectAccess={c.platformDirectAccess}
        stackUnits={c.stackUnits}
        developerUnlocked={c.developerUnlocked}
        stackHealthy={c.stackHealthy}
        developerState={c.developerState}
        onInstanceSwitch={c.handleInstanceSwitch}
        onDeveloperEditingChange={c.setDeveloperEditing}
        onDeveloperPanelFocusChange={c.setDeveloperPanelFocused}
      />
    );

  return (
    <AppShell
      height={c.appHeight}
      columns={c.columns}
      menuBar={
        <MenuBar
          areas={CONSOLE_AREAS}
          activeIndex={c.areaIndex}
          instanceRuntime={c.instanceRuntime}
          columns={c.columns}
        />
      }
      main={mainContent}
      statusBar={
        c.inOverlay
          ? null
          : (
            <StatusBar
              showMenu={c.showMenu}
              menuItems={c.menuItems}
              onMenuSelect={c.handleMenuSelect}
              hints={c.hints}
              statusSummary={c.statusSummary}
              columns={c.columns}
              rows={c.rows}
            />
          )
      }
    />
  );
}
