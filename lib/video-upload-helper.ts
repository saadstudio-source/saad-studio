export function inferVideoUploadMimeType(file: File): string {
  if (file.type && file.type !== "application/octet-stream") return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase();
  const byExt: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    mp4: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    mkv: "video/x-matroska",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    wav: "audio/wav",
    ogg: "audio/ogg",
    aac: "audio/aac",
  };
  return (ext && byExt[ext]) || file.type || "application/octet-stream";
}

export async function readVideoUploadError(response: Response, fallback = "Failed to upload media."): Promise<string> {
  try {
    const data = await response.json();
    return typeof data?.error === "string" ? data.error : fallback;
  } catch {
    try {
      const text = await response.text();
      return text || fallback;
    } catch {
      return fallback;
    }
  }
}

export async function uploadVideoRequestFile(
  file: File,
  authFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = fetch,
): Promise<string> {
  const fileType = inferVideoUploadMimeType(file);
  const signRes = await authFetch("/api/media/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: file.name || `video-reference-${Date.now()}`,
      fileType,
    }),
  });

  if (!signRes.ok) {
    throw new Error(await readVideoUploadError(signRes));
  }

  const signData = await signRes.json();
  const signedUrl = signData?.signedUrl;
  const publicUrl = signData?.publicUrl;
  if (!signedUrl || !publicUrl) {
    throw new Error("Failed to receive signed upload URL.");
  }

  const uploadRes = await fetch(signedUrl, {
    method: "PUT",
    headers: { "Content-Type": fileType },
    body: file,
  });

  if (!uploadRes.ok) {
    throw new Error(await readVideoUploadError(uploadRes));
  }

  return String(publicUrl);
}

export function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
