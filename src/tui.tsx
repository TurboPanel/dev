import { Box, Text, render } from "ink";

function App() {
  return (
    <Box flexDirection="column">
      <Text bold>TurboPanel development console</Text>
      <Text>Install and launch succeeded.</Text>
      <Text dimColor>Press Ctrl-C to exit.</Text>
    </Box>
  );
}

const { waitUntilExit } = await render(<App />, {
  alternateScreen: true,
  exitOnCtrlC: true,
});

await waitUntilExit();
