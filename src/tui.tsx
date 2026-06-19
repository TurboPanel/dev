import React, { useState } from "react";
import { render, useInput, useWindowSize } from "ink";
import { AppView, AREAS } from "./app.tsx";

function App() {
  const { columns, rows } = useWindowSize();
  const [activeIndex, setActiveIndex] = useState(0);

  useInput((_input, key) => {
    if (key.leftArrow) {
      setActiveIndex((index) => Math.max(0, index - 1));
    }
    if (key.rightArrow) {
      setActiveIndex((index) => Math.min(AREAS.length - 1, index + 1));
    }
  });

  return <AppView activeIndex={activeIndex} columns={columns} rows={rows} />;
}

const { waitUntilExit } = render(<App />, {
  alternateScreen: true,
  exitOnCtrlC: true,
});

await waitUntilExit();
