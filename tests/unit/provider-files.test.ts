import { it, expect } from "vitest";
import {
  multipart,
  fileMetadata,
} from "../../supabase/functions/_shared/provider-files";
import { sha, enc } from "../../packages/contracts/core";
import { unb64 } from "../../supabase/functions/_shared/runtime";
it("multipart wire manifests reconstruct exact bytes without repeating PDF data", async () => {
  const pdf = enc.encode("%PDF synthetic bytes");
  for (const p of ["openai", "anthropic"] as const) {
    const wire = multipart(p, pdf, "fixed-boundary");
    const prefix = unb64(wire.prefix),
      suffix = unb64(wire.suffix),
      restored = new Uint8Array(prefix.length + pdf.length + suffix.length);
    restored.set(prefix);
    restored.set(pdf, prefix.length);
    restored.set(suffix, prefix.length + pdf.length);
    expect(await sha(restored)).toBe(await sha(wire.body));
    expect(new TextDecoder().decode(prefix)).not.toContain("synthetic bytes");
  }
});
it("file handles have official shapes and explicit readiness", () => {
  expect(
    fileMetadata("google", {
      file: {
        uri: "https://generativelanguage.googleapis.com/v1beta/files/test",
        state: "PROCESSING",
        expirationTime: "2026-10-26T00:00:00Z",
      },
    }).state,
  ).toBe("processing");
  expect(() =>
    fileMetadata("google", {
      uri: "https://evil.invalid/file",
      state: "ACTIVE",
    }),
  ).toThrow();
  expect(
    fileMetadata("openai", { id: "file-test", status: "processed" }).state,
  ).toBe("ready");
  expect(fileMetadata("anthropic", { id: "file_test" }).expires_at).toBeNull();
});
