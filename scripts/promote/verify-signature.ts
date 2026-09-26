// Verify a channel manifest's Ed25519 signature with the daemon repo's own
// verifier — the same `verifyManifestSignature` and public-key pin run.sh
// and the daemon use — so a promotion only ever re-signs bytes that were
// already signed by the release key. Run under Deno (no dependencies) from
// the workflow, pointing at the SHA-pinned turbopaneld checkout:
//
//   deno run --config <signer-checkout>/deno.json --allow-read scripts/promote/verify-signature.ts <signer-checkout> <manifest.json>
// (the signer's deno.json import map resolves its @std imports)
const [signerDir, manifestPath] = Deno.args;
if (!signerDir || !manifestPath) {
  console.error("usage: verify-signature.ts <signer-checkout> <manifest.json>");
  Deno.exit(2);
}

const signing = await import(`file://${Deno.realPathSync(signerDir)}/src/update/signing.ts`);
const manifest = JSON.parse(await Deno.readTextFile(manifestPath)) as Record<string, unknown>;
await signing.verifyManifestSignature(manifest);
const signature = manifest.signature as { keyId?: string };
console.log(
  `manifest signature verified (keyId ${signature.keyId}, pinned ${signing.RELEASE_SIGNING_PUBLIC_KEY_HEX.slice(0, 8)}…)`,
);
