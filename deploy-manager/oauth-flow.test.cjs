const assert = require("node:assert/strict");
const { classifyDeviceResponse, pollDeviceToken } = require("./oauth-flow.cjs");

assert.equal(classifyDeviceResponse({ error: "authorization_pending" }).state, "pending");
assert.equal(classifyDeviceResponse({ error: "slow_down", interval: 10 }).state, "pending");
assert.equal(classifyDeviceResponse({ error: "expired_token" }).state, "expired");
assert.equal(classifyDeviceResponse({ error: "access_denied" }).state, "denied");
assert.equal(classifyDeviceResponse({ access_token: "secret" }).state, "connected");
(async () => {
  let request;
  const pending = await pollDeviceToken({ clientId: "client-123", deviceCode: "device-456", fetchImpl: async (url, options) => { request = { url, options }; return { json: async () => ({ error: "authorization_pending" }) }; } });
  assert.equal(pending.state, "pending");
  assert.match(String(request.options.body), /client_id=client-123/);
  assert.match(String(request.options.body), /device_code=device-456/);
  const connection = await pollDeviceToken({ clientId: "client-123", deviceCode: "device-456", fetchImpl: async () => { throw new Error("offline"); } });
  assert.equal(connection.state, "connection_error");
  console.log("oauth-mock-contract=PASS");
})();
