import { describe, expect, it } from "vitest";

import {
  downloadFileName,
  isPublicDownloadHost,
  pickExtension,
  safeContentType,
} from "@/lib/smart-cli-preview-download";

describe("pickExtension", () => {
  it("prefers the response content type", () => {
    expect(pickExtension("image/jpeg; charset=binary", "https://cdn.example.com/a.png", "image")).toBe("jpg");
    expect(pickExtension("video/mp4", "https://cdn.example.com/v", "video")).toBe("mp4");
    expect(pickExtension("audio/mpeg", "https://cdn.example.com/a", "audio")).toBe("mp3");
  });

  it("falls back to the URL extension, then to the kind default", () => {
    expect(pickExtension("application/octet-stream", "https://cdn.example.com/x/clip.WEBM?sig=1", "video")).toBe("webm");
    expect(pickExtension(null, "https://cdn.example.com/x/noext", "image")).toBe("png");
    expect(pickExtension(null, "not a url", "audio")).toBe("mp3");
  });
});

describe("safeContentType", () => {
  it("passes only the matching media family", () => {
    expect(safeContentType("image/webp", "image")).toBe("image/webp");
    expect(safeContentType("video/mp4; codecs=avc1", "video")).toBe("video/mp4");
    expect(safeContentType("text/html", "image")).toBe("application/octet-stream");
    expect(safeContentType("video/mp4", "image")).toBe("application/octet-stream");
    expect(safeContentType(null, "audio")).toBe("application/octet-stream");
  });

  it("never serves SVG as an image (it can carry script)", () => {
    expect(safeContentType("image/svg+xml", "image")).toBe("application/octet-stream");
  });
});

describe("downloadFileName", () => {
  it("is one-based, branded and sanitised", () => {
    expect(downloadFileName("image", 0, "png")).toBe("saad-studio-image-1.png");
    expect(downloadFileName("video", 2, "MP4")).toBe("saad-studio-video-3.mp4");
    expect(downloadFileName("audio", 0, '"/..')).toBe("saad-studio-audio-1.mp3");
  });
});

describe("isPublicDownloadHost", () => {
  it("accepts public https CDN hosts", () => {
    expect(isPublicDownloadHost("https://cdn.saadstudio.app/a.png")).toBe(true);
    expect(isPublicDownloadHost("https://pub-123.r2.dev/a.mp4")).toBe(true);
  });

  it("rejects non-https, localhost, internal names and IP literals", () => {
    expect(isPublicDownloadHost("http://cdn.example.com/a.png")).toBe(false);
    expect(isPublicDownloadHost("https://localhost/a.png")).toBe(false);
    expect(isPublicDownloadHost("https://intranet/a.png")).toBe(false);
    expect(isPublicDownloadHost("https://db.internal/a.png")).toBe(false);
    expect(isPublicDownloadHost("https://127.0.0.1/a.png")).toBe(false);
    expect(isPublicDownloadHost("https://169.254.169.254/latest")).toBe(false);
    expect(isPublicDownloadHost("https://[::1]/a.png")).toBe(false);
    expect(isPublicDownloadHost("garbage")).toBe(false);
  });
});
