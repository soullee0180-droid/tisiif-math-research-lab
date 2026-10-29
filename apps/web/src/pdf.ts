let pending = Promise.resolve();
export function pdfTask(
  op: string,
  bytes: Uint8Array,
  options: any = {},
  progress?: (n: number) => void,
): Promise<any> {
  const run = () =>
    new Promise((resolve, reject) => {
      const worker = new Worker(
        new URL("./workers/pdf.worker.ts", import.meta.url),
        { type: "module" },
      );
      const timer = setTimeout(() => {
        worker.terminate();
        reject(Error("PDF 처리 시간이 초과되었습니다."));
      }, 90000);
      worker.onmessage = (e) => {
        if (e.data.progress !== undefined) {
          progress?.(e.data.progress);
          return;
        }
        if (!("result" in e.data) && !e.data.error) return;
        clearTimeout(timer);
        worker.terminate();
        e.data.error ? reject(Error(e.data.error)) : resolve(e.data.result);
      };
      worker.onerror = (e) => {
        clearTimeout(timer);
        worker.terminate();
        reject(Error(e.message));
      };
      const copy = bytes.slice();
      worker.postMessage({ op, bytes: copy.buffer, ...options }, [copy.buffer]);
    });
  const result = pending.then(run);
  pending = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
