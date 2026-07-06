const SHELL_SINGLE_QUOTE_ESCAPE = String.raw`'\''`;

export function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", SHELL_SINGLE_QUOTE_ESCAPE) + "'";
}
