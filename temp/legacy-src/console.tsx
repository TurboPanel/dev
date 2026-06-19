import { Box } from "ink";
import { MenuBar } from "@turbopanel/components/layout/menu-bar.tsx";
import { CONSOLE_AREAS, useConsole } from "@turbopanel/hooks/use-console.ts";

export function App() {
  const c = useConsole();

  return (
    <Box flexDirection="column" width={c.columns} height={c.appHeight}>
      <Box flexShrink={0} paddingX={1}>
        <MenuBar
          areas={CONSOLE_AREAS}
          activeIndex={c.areaIndex}
          instanceRuntime={c.instanceRuntime}
          columns={c.columns}
        />
      </Box>
      <Box flexGrow={1} flexShrink={1} minHeight={0} />
    </Box>
  );
}
