import { createElement } from "react";
import { render, Text } from "ink";
import { PassThrough } from "node:stream";

type TtyStream = PassThrough & {
  isTTY: boolean;
  columns: number;
  rows: number;
  setRawMode: (mode: boolean) => void;
  ref: () => void;
  unref: () => void;
};

export function createTtyStream(): TtyStream {
  const stream = new PassThrough() as TtyStream;
  stream.isTTY = true;
  stream.columns = 80;
  stream.rows = 24;
  stream.setRawMode = () => undefined;
  stream.ref = () => undefined;
  stream.unref = () => undefined;
  return stream;
}

export type MountedHook<T> = {
  get: () => T;
  rerender: () => void;
  unmount: () => void;
  flush: () => Promise<void>;
  stdin: TtyStream;
};

/**
 * Mount a hook under Ink so effects, intervals, and `useInput` run in Vitest's
 * node environment without a DOM or extra test renderer.
 */
export function mountHook<T>(useHook: () => T): MountedHook<T> {
  const box: { current: T | undefined } = { current: undefined };

  function Probe() {
    box.current = useHook();
    return createElement(Text, null, "hook");
  }

  const stdout = createTtyStream();
  const stdin = createTtyStream();
  const stderr = createTtyStream();
  const instance = render(createElement(Probe), {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    stderr: stderr as unknown as NodeJS.WriteStream,
    exitOnCtrlC: false,
    patchConsole: false,
    debug: true,
    interactive: true,
  });

  return {
    get() {
      if (box.current === undefined) {
        throw new TypeError("hook has not rendered");
      }
      return box.current;
    },
    rerender() {
      instance.rerender(createElement(Probe));
    },
    unmount() {
      instance.unmount();
      instance.cleanup();
    },
    async flush() {
      await instance.waitUntilRenderFlush();
      await Promise.resolve();
      await Promise.resolve();
      await instance.waitUntilRenderFlush();
    },
    stdin,
  };
}
