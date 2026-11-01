import { Upload } from "tus-js-client";
import { api, url, publicKey } from "./api";
import { sha } from "../../../packages/contracts/core";
export async function upload(
  file: Blob,
  kind: string,
  paper_id: string | undefined,
  progress: (p: number) => void,
  existingId?: string,
  metadata: any = {},
  reserved?: (id: string) => void,
) {
  const hash = await sha(await file.arrayBuffer());
  const reservation = existingId
    ? await api("upload/resume", { id: existingId })
    : await api("upload/reserve", {
        kind,
        paper_id,
        bytes: file.size,
        sha256: hash,
        metadata,
      });
  const asset = reservation.asset;
  reserved?.(asset.id);
  if (asset.sha256 !== hash || asset.bytes !== file.size)
    throw Error("다시 선택한 파일이 업로드 예약과 다릅니다.");
  if (asset.status !== "verified") await tusUpload(file, reservation, progress);
  await api("upload/verify", { id: asset.id, inspection: metadata.inspection });
  return asset;
}
export function tusUpload(
  file: Blob,
  reservation: any,
  progress: (p: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const asset = reservation.asset;
    const endpoint =
      url.replace(".supabase.co", ".storage.supabase.co") +
      "/storage/v1/upload/resumable/sign";
    const token =
      reservation.token ||
      new URL(reservation.signedURL, url).searchParams.get("token");
    if (!token) {
      reject(Error("UPLOAD_TOKEN_MISSING"));
      return;
    }
    const task = new Upload(file, {
      endpoint,
      retryDelays: [0, 1000, 3000, 5000],
      chunkSize: 6 * 1024 * 1024,
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      headers: { apikey: publicKey, "x-signature": token, "x-upsert": "false" },
      metadata: {
        bucketName: asset.kind,
        objectName: asset.path,
        contentType: "application/pdf",
        cacheControl: "3600",
      },
      onProgress: (sent, total) => progress(sent / total),
      onError: reject,
      onSuccess: () => resolve(),
    });
    task
      .findPreviousUploads()
      .then((previous) => {
        if (previous.length) task.resumeFromPreviousUpload(previous[0]);
        task.start();
      })
      .catch(reject);
  });
}
