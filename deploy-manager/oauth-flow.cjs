function classifyDeviceResponse(data) {
  if (data && data.access_token) return { ok: true, state: "connected", scope: data.scope || "", access_token: data.access_token };
  if (data?.error === "authorization_pending" || data?.error === "slow_down") return { ok: false, state: "pending", error: data.error, interval: data.interval };
  if (data?.error === "expired_token") return { ok: false, state: "expired", error: "انتهت صلاحية رمز الجهاز" };
  if (data?.error === "access_denied") return { ok: false, state: "denied", error: "تم رفض تفويض GitHub" };
  return { ok: false, state: "api_error", error: data?.error_description || data?.error || "فشل تفويض GitHub" };
}

async function pollDeviceToken({ fetchImpl, clientId, deviceCode }) {
  try {
    const response = await fetchImpl("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: String(clientId || ""), device_code: String(deviceCode || ""), grant_type: "urn:ietf:params:oauth:grant-type:device_code" })
    });
    return classifyDeviceResponse(await response.json());
  } catch { return { ok: false, state: "connection_error", error: "تعذر الاتصال بـ GitHub أثناء التفويض" }; }
}

module.exports = { classifyDeviceResponse, pollDeviceToken };
