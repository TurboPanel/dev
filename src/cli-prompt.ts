async function openTty(): Promise<Deno.FsFile> {
  return await Deno.open("/dev/tty", { read: true, write: true });
}

async function writeTty(tty: Deno.FsFile, text: string): Promise<void> {
  await tty.write(new TextEncoder().encode(text));
}

async function readTtyLine(tty: Deno.FsFile): Promise<string> {
  const buf = new Uint8Array(256);
  const chunks: string[] = [];

  while (true) {
    const n = await tty.read(buf);
    if (n === null) break;
    const piece = new TextDecoder().decode(buf.subarray(0, n));
    chunks.push(piece);
    if (piece.includes("\n") || piece.includes("\r")) break;
  }

  return chunks.join("").trim();
}

export async function promptRuntimeTarget(): Promise<
  "deno" | "workers" | null
> {
  const tty = await openTty();
  try {
    await writeTty(tty, "\nReset turbopanel development environment\n");
    await writeTty(
      tty,
      "Which runtime should start fresh after the reset?\n",
    );
    await writeTty(tty, "  1) Self-hosted Deno instance\n");
    await writeTty(tty, "  2) Cloudflare Workers (wrangler dev)\n");
    await writeTty(tty, "Select [1/2]: ");

    const answer = await readTtyLine(tty);
    if (answer === "1") return "deno";
    if (answer === "2") return "workers";
    return null;
  } finally {
    tty.close();
  }
}

export async function promptConfirm(message: string): Promise<boolean> {
  const tty = await openTty();
  try {
    await writeTty(tty, `\n${message} [y/N]: `);
    const answer = await readTtyLine(tty);
    return answer === "y" || answer === "Y";
  } finally {
    tty.close();
  }
}
