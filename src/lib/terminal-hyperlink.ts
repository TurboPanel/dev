/** OSC 8 hyperlink — clickable in iTerm2, Kitty, WezTerm, VS Code terminal, etc. */
export function formatTerminalHyperlink(url: string, label?: string): string {
  const text = label ?? url;
  return `\u001b]8;;${url}\u001b\\${text}\u001b]8;;\u001b\\`;
}
