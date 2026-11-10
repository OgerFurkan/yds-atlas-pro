import { HttpError } from "./errors";
export async function readJson(request: Request, maxBytes = 1_500_000): Promise<unknown> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json"))
    throw new HttpError(415, "JSON içerik bekleniyor.", "UNSUPPORTED_MEDIA_TYPE");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "İstek gövdesi eksik.", "INVALID_BODY");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new HttpError(413, "İstek çok büyük.", "BODY_TOO_LARGE");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "İstek gövdesi geçerli JSON olmalıdır.", "INVALID_JSON");
  } finally {
    reader.releaseLock();
  }
}
