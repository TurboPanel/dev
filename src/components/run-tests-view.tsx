import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { useLogScroll } from "../hooks/use-log-scroll.ts";
import {
  listAvailableTestRepos,
  runRepoTests,
  type TestRepoDef,
  type TestSuiteDef,
} from "../lib/run-repo-tests.ts";
import { CONSOLE_LAST_TEST_RUN_LOG } from "../lib/paths.ts";
import type { ServiceLogLine } from "../lib/service-log.ts";
import { LIST_SELECT_BG, LIST_SELECT_FG } from "../theme.ts";
import { PlainLogView } from "./plain-log-view.tsx";

const HEADER_ROWS = 3;

type Phase =
  | { kind: "repos" }
  | { kind: "suites"; repo: TestRepoDef }
  | {
    kind: "running";
    repo: TestRepoDef;
    suite: TestSuiteDef;
  }
  | {
    kind: "done";
    repo: TestRepoDef;
    suite: TestSuiteDef;
    exitCode: number;
    aborted: boolean;
    logPath: string | null;
  };

function nowLogLine(text: string): ServiceLogLine {
  return { text, time: new Date().toISOString() };
}

function SelectList<T extends string>({
  width,
  items,
  selectedIndex,
  labelOf,
}: {
  width: number;
  items: readonly T[];
  selectedIndex: number;
  labelOf: (id: T, index: number) => { title: string; detail?: string };
}) {
  return (
    <Box flexDirection="column" width={width}>
      {items.map((id, index) => {
        const selected = index === selectedIndex;
        const { title, detail } = labelOf(id, index);
        return (
          <Box
            key={id}
            width={Math.max(1, width)}
            backgroundColor={selected ? LIST_SELECT_BG : undefined}
            flexDirection="column"
          >
            <Text color={selected ? LIST_SELECT_FG : undefined} bold={selected}>
              {title}
            </Text>
            {detail ? (
              <Text dimColor={!selected} color={selected ? LIST_SELECT_FG : undefined}>
                {`  ${detail}`}
              </Text>
            ) : null}
          </Box>
        );
      })}
    </Box>
  );
}

export function RunTestsView({
  width,
  height,
  focused,
  onClose,
}: {
  width: number;
  height: number;
  focused: boolean;
  onClose: () => void;
}) {
  const repos = useMemo(() => listAvailableTestRepos(), []);
  const [phase, setPhase] = useState<Phase>({ kind: "repos" });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [logLines, setLogLines] = useState<ServiceLogLine[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef(0);

  const selectionKey = phase.kind === "repos"
    ? "repos"
    : `suites:${phase.repo.id}`;

  const logHeight = Math.max(1, height - HEADER_ROWS);
  const scrollFocused = phase.kind === "running" || phase.kind === "done";
  const { scrollIndex: logScrollIndex, handleLogKey } = useLogScroll({
    lineCount: logLines.length,
    viewportHeight: logHeight,
    focused: focused && scrollFocused,
    resetKey: `${phase.kind}:${phase.kind === "running" || phase.kind === "done" ? phase.suite.id : "idle"}`,
    followResetKey: logLines.length,
  });

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    setSelectedIndex(0);
  }, [selectionKey]);

  const appendLog = (line: string) => {
    setLogLines((current) => [...current, nowLogLine(line)]);
  };

  const startSuite = (repo: TestRepoDef, suite: TestSuiteDef) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;

    setLogLines([
      nowLogLine(`Running ${suite.label} in ${repo.label}…`),
    ]);
    setPhase({ kind: "running", repo, suite });

    void runRepoTests(repo.id, suite.id, appendLog, { signal: controller.signal })
      .then((result) => {
        if (runIdRef.current !== runId) {
          return;
        }
        if (result.aborted) {
          appendLog("Cancelled.");
        } else if (result.exitCode === 0) {
          appendLog(`Finished successfully (exit ${result.exitCode}).`);
        } else {
          appendLog(`Finished with exit code ${result.exitCode}.`);
        }
        if (result.logPath) {
          appendLog(`Full log: ${result.logPath}`);
          appendLog(`Also: ${CONSOLE_LAST_TEST_RUN_LOG}`);
        }
        setPhase({
          kind: "done",
          repo,
          suite,
          exitCode: result.exitCode,
          aborted: result.aborted,
          logPath: result.logPath,
        });
      })
      .catch((error: unknown) => {
        if (runIdRef.current !== runId) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        appendLog(`Failed: ${message}`);
        setPhase({
          kind: "done",
          repo,
          suite,
          exitCode: 1,
          aborted: false,
          logPath: null,
        });
      });
  };

  useInput((_input, key) => {
    if (phase.kind === "running") {
      if (key.escape) {
        abortRef.current?.abort();
        return;
      }
      handleLogKey(key);
      return;
    }

    if (phase.kind === "done") {
      if (key.escape || key.leftArrow) {
        setPhase({ kind: "suites", repo: phase.repo });
        setLogLines([]);
        return;
      }
      if (key.return) {
        startSuite(phase.repo, phase.suite);
        return;
      }
      handleLogKey(key);
      return;
    }

    if (key.escape || key.leftArrow) {
      if (phase.kind === "suites") {
        setPhase({ kind: "repos" });
        return;
      }
      onClose();
      return;
    }

    const items = phase.kind === "repos" ? repos : phase.repo.suites;
    if (items.length === 0) {
      return;
    }
    const lastIndex = items.length - 1;
    if (key.upArrow) {
      setSelectedIndex((index) => Math.max(0, index - 1));
    }
    if (key.downArrow) {
      setSelectedIndex((index) => Math.min(lastIndex, index + 1));
    }
    if (key.return) {
      if (phase.kind === "repos") {
        const repo = repos[selectedIndex];
        if (repo) {
          setPhase({ kind: "suites", repo });
        }
        return;
      }
      const suite = phase.repo.suites[selectedIndex];
      if (suite) {
        startSuite(phase.repo, suite);
      }
    }
  }, { isActive: focused });

  const title = (() => {
    if (phase.kind === "repos") {
      return "Run tests";
    }
    if (phase.kind === "suites") {
      return `Run tests · ${phase.repo.label}`;
    }
    return `Run tests · ${phase.repo.label} · ${phase.suite.label}`;
  })();

  const subtitle = (() => {
    switch (phase.kind) {
      case "repos":
        if (repos.length === 0) {
          return "No platform checkouts found under TURBOPANEL_DEV_ROOT.";
        }
        return "Pick a repository";
      case "suites":
        return "Pick a suite";
      case "running":
        return "Running… Esc cancels";
      case "done":
        if (phase.logPath) {
          if (phase.aborted) {
            return `Cancelled · log saved · Enter re-run · Esc back`;
          }
          if (phase.exitCode === 0) {
            return "Passed · log saved · Enter re-run · Esc back";
          }
          return `Failed (exit ${phase.exitCode}) · see last-test-run.log · Enter re-run · Esc back`;
        }
        if (phase.aborted) {
          return "Cancelled · Enter re-run · Esc back";
        }
        if (phase.exitCode === 0) {
          return "Passed · Enter re-run · Esc back";
        }
        return `Failed (exit ${phase.exitCode}) · Enter re-run · Esc back`;
    }
  })();

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      paddingX={1}
      paddingY={1}
    >
      <Text bold>{title}</Text>
      <Box marginTop={1}>
        <Text
          dimColor={phase.kind !== "done" || phase.exitCode === 0 || phase.aborted}
          color={
            phase.kind === "done" && phase.exitCode !== 0 && !phase.aborted
              ? "red"
              : undefined
          }
        >
          {subtitle}
        </Text>
      </Box>

      {(phase.kind === "running" || phase.kind === "done") ? (
        <Box marginTop={1} flexGrow={1}>
          <PlainLogView
            lines={logLines}
            width={width}
            height={logHeight}
            selectedIndex={logScrollIndex}
            focused={focused}
          />
        </Box>
      ) : (
        <Box marginTop={1} flexDirection="column">
          {phase.kind === "repos" ? (
            <SelectList
              width={Math.max(1, width - 2)}
              items={repos.map((repo) => repo.id)}
              selectedIndex={selectedIndex}
              labelOf={(id) => {
                const repo = repos.find((entry) => entry.id === id);
                return { title: repo?.label ?? id };
              }}
            />
          ) : (
            <SelectList
              width={Math.max(1, width - 2)}
              items={phase.repo.suites.map((suite) => suite.id)}
              selectedIndex={selectedIndex}
              labelOf={(id) => {
                const suite = phase.repo.suites.find((entry) => entry.id === id);
                return {
                  title: suite?.label ?? id,
                  detail: suite?.detail,
                };
              }}
            />
          )}
        </Box>
      )}
    </Box>
  );
}
