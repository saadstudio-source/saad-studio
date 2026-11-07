import { homedir } from "node:os";
import { join } from "node:path";

export const API_BASE = process.env.SAADSTUDIO_API_BASE ?? "https://saadstudio.app";
export const AUTHORIZE_PATH = "/smart-cli/authorize";
export const TOKEN_PATH = "/api/smart-cli/oauth/token";
export const MCP_RESOURCE = `${API_BASE}/api/smart-cli/mcp`;

export const CLIENT_ID = "saadstudio-cli";
export const SCOPE = "smart_cli.generate smart_cli.read";

export const CONFIG_DIR = process.env.SAADSTUDIO_CONFIG_DIR ?? join(homedir(), ".saadstudio");
export const TOKEN_FILE = join(CONFIG_DIR, "token.json");

export const DEFAULT_IMAGE_MODEL = "nano-banana-pro";
export const DEFAULT_VIDEO_MODEL = "kling-3.0/video";
