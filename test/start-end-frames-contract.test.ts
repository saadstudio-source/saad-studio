import { describe, it, expect } from "vitest";
import { mapToWavespeedInput } from "@/lib/video/wavespeed-input";

describe("Start and End Frame Mapping Contracts for WaveSpeed", () => {
  const startImg = "https://f003.backblazeb2.com/file/storage/start.jpg";
  const endImg = "https://f003.backblazeb2.com/file/storage/end.jpg";

  describe("Kling 2.6", () => {
    it("should include both end_image and last_image for Kling 2.6 Standard", () => {
      const payload = {
        prompt: "Cinematic transition",
        image: startImg,
        end_image: endImg,
        duration: 5,
      };

      const result = mapToWavespeedInput(payload, "kwaivgi/kling-v2.6-std/image-to-video");
      expect(result.image).toBe(startImg);
      expect(result.end_image).toBe(endImg);
      expect(result.last_image).toBe(endImg);
    });

    it("should include both end_image and last_image for Kling 2.6 Pro even with sound enabled", () => {
      const payload = {
        prompt: "Cinematic transition",
        image: startImg,
        end_image: endImg,
        duration: 10,
        sound: true,
      };

      const result = mapToWavespeedInput(payload, "kwaivgi/kling-v2.6-pro/image-to-video");
      expect(result.image).toBe(startImg);
      expect(result.end_image).toBe(endImg);
      expect(result.last_image).toBe(endImg);
      expect(result.sound).toBe(true);
    });
  });

  describe("Kling 3.0", () => {
    it("should include both end_image and last_image for Kling 3.0 Standard", () => {
      const payload = {
        prompt: "Cinematic transition",
        image: startImg,
        end_image: endImg,
        duration: 5,
      };

      const result = mapToWavespeedInput(payload, "kwaivgi/kling-v3.0-std/image-to-video");
      expect(result.image).toBe(startImg);
      expect(result.end_image).toBe(endImg);
      expect(result.last_image).toBe(endImg);
    });

    it("should include both end_image and last_image for Kling 3.0 Pro", () => {
      const payload = {
        prompt: "Cinematic transition",
        image: startImg,
        end_image: endImg,
        duration: 10,
      };

      const result = mapToWavespeedInput(payload, "kwaivgi/kling-v3.0-pro/image-to-video");
      expect(result.image).toBe(startImg);
      expect(result.end_image).toBe(endImg);
      expect(result.last_image).toBe(endImg);
    });
  });

  describe("Kling V3 Turbo", () => {
    it("should include both end_image and last_image for Kling V3 Turbo Standard", () => {
      const payload = {
        prompt: "Cinematic transition",
        image: startImg,
        end_image: endImg,
        duration: 5,
      };

      const result = mapToWavespeedInput(payload, "kwaivgi/kling-v3-turbo-std/image-to-video");
      expect(result.image).toBe(startImg);
      expect(result.end_image).toBe(endImg);
      expect(result.last_image).toBe(endImg);
    });

    it("should include both end_image and last_image for Kling V3 Turbo Pro", () => {
      const payload = {
        prompt: "Cinematic transition",
        image: startImg,
        end_image: endImg,
        duration: 5,
      };

      const result = mapToWavespeedInput(payload, "kwaivgi/kling-v3-turbo-pro/image-to-video");
      expect(result.image).toBe(startImg);
      expect(result.end_image).toBe(endImg);
      expect(result.last_image).toBe(endImg);
    });
  });

  describe("Kling Video O3", () => {
    it("should include both end_image and last_image for Kling O3 image-to-video", () => {
      const payload = {
        prompt: "Cinematic transition",
        image: startImg,
        end_image: endImg,
        duration: 5,
      };

      const result = mapToWavespeedInput(payload, "kwaivgi/kling-video-o3-std/image-to-video");
      expect(result.image).toBe(startImg);
      expect(result.end_image).toBe(endImg);
      expect(result.last_image).toBe(endImg);
    });
  });

  describe("ByteDance Seedance 2.0 & 2.5", () => {
    it("should include both end_image and last_image for Seedance 2.0 Mini", () => {
      const payload = {
        prompt: "Cinematic transition",
        image: startImg,
        end_image: endImg,
        duration: 6,
        resolution: "720p",
      };

      const result = mapToWavespeedInput(payload, "bytedance/seedance-2.0-mini/image-to-video");
      expect(result.image).toBe(startImg);
      expect(result.end_image).toBe(endImg);
      expect(result.last_image).toBe(endImg);
    });

    it("should include both end_image and last_image for Seedance 2.0 Fast", () => {
      const payload = {
        prompt: "Cinematic transition",
        image: startImg,
        end_image: endImg,
        duration: 5,
        resolution: "720p",
      };

      const result = mapToWavespeedInput(payload, "bytedance/seedance-2.0-fast/image-to-video");
      expect(result.image).toBe(startImg);
      expect(result.end_image).toBe(endImg);
      expect(result.last_image).toBe(endImg);
    });

    it("should include both end_image and last_image for Seedance 2.0 Standard", () => {
      const payload = {
        prompt: "Cinematic transition",
        image: startImg,
        end_image: endImg,
        duration: 5,
        resolution: "720p",
      };

      const result = mapToWavespeedInput(payload, "bytedance/seedance-2.0/image-to-video");
      expect(result.image).toBe(startImg);
      expect(result.end_image).toBe(endImg);
      expect(result.last_image).toBe(endImg);
    });

    it("should include both end_image and last_image for Seedance 2.5 Turbo", () => {
      const payload = {
        prompt: "Cinematic transition",
        image: startImg,
        end_image: endImg,
        duration: 5,
        resolution: "720p",
      };

      const result = mapToWavespeedInput(payload, "bytedance/seedance-2.5/image-to-video-turbo");
      expect(result.image).toBe(startImg);
      expect(result.end_image).toBe(endImg);
      expect(result.last_image).toBe(endImg);
    });
  });
});
