// SaadStudio Deploy Manager - Renderer Logic
const $ = (id) => document.getElementById(id);

// الحالات العامة للتطبيق
let authState = "disconnected";
let ready = false;
let polling = false;
let devicePrompt = "";
let currentWizardStep = 1;
let lastKnownRuns = [];
let readinessBusy = false;
let rollbackReady = false;
let firstLoad = true;

// نصوص وحالات المصادقة بالعربية
const LABELS = {
  disconnected: "غير متصل",
  pending: "بانتظار موافقة GitHub",
  verifying: "جارٍ التحقق",
  connected: "متصل وجاهز",
  expired: "انتهت الجلسة",
  connection_error: "خطأ في الاتصال",
  permission_error: "صلاحيات غير كافية",
  denied: "تم الرفض",
  api_error: "خطأ GitHub"
};

// ============================================================================
// أدوات المخرجات وحماية الأسرار (Secret Scrubbing & Console)
// ============================================================================
function scrubSecrets(text) {
  if (typeof text !== "string") {
    try {
      text = JSON.stringify(text, null, 2);
    } catch {
      text = String(text);
    }
  }
  // إخفاء مفاتيح SSH الخاصة
  text = text.replace(/-----BEGIN (?:OPENSSH|RSA|EC|DSA)? PRIVATE KEY-----[\s\S]*?-----END (?:OPENSSH|RSA|EC|DSA)? PRIVATE KEY-----/g, "[مفتاح SSH الخاص مشفر ومحمي - لا يُعرض في السجلات]");
  // إخفاء رموز الوصول والتوكنز
  text = text.replace(/(ghp_[A-Za-z0-9_]{20,80})/g, "ghp_***REDACTED***");
  text = text.replace(/(gho_[A-Za-z0-9_]{20,80})/g, "gho_***REDACTED***");
  text = text.replace(/(github_pat_[A-Za-z0-9_]{40,100})/g, "github_pat_***REDACTED***");
  text = text.replace(/("password"\s*:\s*)"[^"]+"/gi, '$1"***"');
  text = text.replace(/("token"\s*:\s*)"[^"]+"/gi, '$1"***"');
  return text;
}

function out(v) {
  const terminal = $("output");
  if (!terminal) return;
  const time = new Date().toLocaleTimeString("ar-EG", { hour12: false });
  const cleaned = scrubSecrets(v);
  terminal.textContent = `[${time}] ${cleaned}\n` + terminal.textContent;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
// Never let a pending IPC call keep the UI in a loading state forever.
function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`انتهت مهلة ${label} (${Math.round(ms / 1000)} ثانية)`)), ms); })]).finally(() => clearTimeout(timer));
}
// Rollback target = the previous successful run, never the newest run (which may be the failed/current one).
function pickRollbackTarget(runs) {
  const successes = (runs || []).filter((r) => r.conclusion === "success" && /^[0-9a-f]{40}$/i.test(r.head_sha || ""));
  return successes.length >= 2 ? successes[1] : null;
}
let actionBusy = false;
async function guarded(button, task) {
  if (actionBusy) { out("توجد عملية قيد التنفيذ؛ انتظر اكتمالها."); return; }
  actionBusy = true; setAuth(authState); if (button) button.disabled = true; // disables BOTH deploy and rollback while one runs
  try { return await task(); } finally { actionBusy = false; if (button) button.disabled = false; setAuth(authState); }
}

function friendlyIpcError(error) {
  return String(error?.message || error || "خطأ غير معروف")
    .replace(/^Error invoking remote method '[^']+':\s*Error:\s*/i, "");
}

// مسح ونسخ الطرفية
if ($("btnClearOutput")) {
  $("btnClearOutput").onclick = () => {
    $("output").textContent = "تم مسح السجل.";
  };
}
if ($("btnCopyOutput")) {
  $("btnCopyOutput").onclick = async () => {
    try {
      await navigator.clipboard.writeText($("output").textContent);
      const original = $("btnCopyOutput").textContent;
      $("btnCopyOutput").textContent = "تم النسخ!";
      setTimeout(() => $("btnCopyOutput").textContent = original, 1500);
    } catch (e) {
      out(e.message);
    }
  };
}

// ============================================================================
// معالجة وإصلاح بصمة SSH (Root-Cause Fingerprint Formatter)
// ============================================================================
async function computeSha256Fingerprint(bytes) {
  if (!bytes || bytes.length === 0) return "";
  const hashBuffer = await window.crypto.subtle.digest("SHA-256", bytes);
  const hashArray = new Uint8Array(hashBuffer);
  let binary = "";
  for (let i = 0; i < hashArray.byteLength; i++) {
    binary += String.fromCharCode(hashArray[i]);
  }
  return "SHA256:" + btoa(binary);
}

async function formatFingerprint(raw) {
  if (!raw) return "";

  // إذا كانت سلسلة نصية
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.startsWith("SHA256:")) {
      return trimmed;
    }
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      const bytes = new Uint8Array(trimmed.match(/.{2}/g).map((pair) => parseInt(pair, 16)));
      return await computeSha256Fingerprint(bytes);
    }
    // في حال كانت سلسلة أرقام مفصولة بفواصل مثل "0,0,0,7,115,115,104,..."
    if (/^\d+(?:\s*,\s*\d+)+$/.test(trimmed)) {
      const numbers = trimmed.split(",").map((n) => parseInt(n.trim(), 10));
      return await computeSha256Fingerprint(new Uint8Array(numbers));
    }
    return trimmed;
  }

  // إذا كانت كائناً من نوع Uint8Array أو مصفوفة أرقام أو Buffer
  let bytes = null;
  if (raw instanceof Uint8Array) {
    bytes = raw;
  } else if (Array.isArray(raw)) {
    bytes = new Uint8Array(raw);
  } else if (raw && typeof raw === "object") {
    if (Array.isArray(raw.data)) {
      bytes = new Uint8Array(raw.data);
    } else if (raw.buffer instanceof ArrayBuffer) {
      bytes = new Uint8Array(raw.buffer, raw.byteOffset || 0, raw.byteLength || raw.buffer.byteLength);
    }
  }

  if (bytes && bytes.length > 0) {
    return await computeSha256Fingerprint(bytes);
  }

  return String(raw);
}

// ============================================================================
// نظام التنقل بين التبويبات (Navigation System)
// ============================================================================
const VIEW_METADATA = {
  "view-dashboard": { title: "لوحة التحكم الرئيسية", desc: "مراقبة الاتصالات وإدارة نشر موقع SaadStudio بأمان" },
  "view-github": { title: "إعدادات GitHub", desc: "إعدادات المستودع وتفويض الـ Workflow وتوكن الوصول" },
  "view-contabo": { title: "إعدادات خادم Contabo", desc: "بيانات خادم الإنتاج والتحقق من بصمة SSH وبدء الربط" },
  "view-ssh": { title: "إدارة مفاتيح SSH", desc: "توليد وتخزين مفاتيح Ed25519 الآمنة في Windows Credential Manager" },
  "view-audit": { title: "التشخيص الشامل للسيرفر", desc: "فحوصات قراءة فقط عبر SSH دون Deploy أو Rollback" },
  "view-repair": { title: "إصلاح وتجهيز السيرفر", desc: "إجراءات منفصلة بموافقة صريحة قبل كل تغيير" },
  "view-runs": { title: "سجل النشر والتشغيل", desc: "سجل عمليات النشر والتراجع السابقة عبر GitHub Actions" },
  "view-settings": { title: "الإعدادات العامة", desc: "تخزين الإعدادات وإعادة تشغيل معالج الإعداد وتشخيص النظام" },
  "view-wizard": { title: "معالج الإعداد الأولي", desc: "تهيئة الاتصالات والمفاتيح خطوة بخطوة" }
};

function switchView(viewId) {
  // إخفاء كل الصفحات
  document.querySelectorAll(".content-view").forEach((v) => v.classList.remove("active"));
  // إزالة تفعيل أزرار القائمة
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));

  // تفعيل الصفحة المستهدفة
  const targetView = $(viewId);
  if (targetView) targetView.classList.add("active");

  // تفعيل زر القائمة المناظر
  const navBtn = document.querySelector(`.nav-item[data-view="${viewId}"]`);
  if (navBtn) navBtn.classList.add("active");

  // تحديث عنوان الشريط العلوي
  const meta = VIEW_METADATA[viewId] || VIEW_METADATA["view-dashboard"];
  if ($("pageTitle")) $("pageTitle").textContent = meta.title;
  if ($("pageDesc")) $("pageDesc").textContent = meta.desc;
}

// ربط أزرار القائمة الجانبية
document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.onclick = () => {
    const target = btn.getAttribute("data-view");
    if (target) switchView(target);
  };
});

if ($("btnLaunchWizard")) {
  $("btnLaunchWizard").onclick = () => {
    switchView("view-wizard");
    goToWizardStep(1);
  };
}

if ($("btnRestartWizard")) {
  $("btnRestartWizard").onclick = () => {
    localStorage.removeItem("saadstudio_setup_completed");
    switchView("view-wizard");
    goToWizardStep(1);
  };
}

// ============================================================================
// نظام نافذة التأكيد المنبثقة (Confirmation Modal System)
// ============================================================================
let pendingModalAction = null;

function showConfirmModal({ title, message, icon = "⚠️", confirmLabel = "تأكيد التنفيذ", onConfirm }) {
  const modal = $("confirmModal");
  if (!modal) {
    if (confirm(message)) onConfirm();
    return;
  }
  $("modalTitle").textContent = title;
  $("modalMessage").textContent = message;
  $("modalIcon").textContent = icon;
  $("modalBtnConfirm").textContent = confirmLabel;
  pendingModalAction = onConfirm;
  modal.style.display = "flex";
}

function hideConfirmModal() {
  const modal = $("confirmModal");
  if (modal) modal.style.display = "none";
  pendingModalAction = null;
}

if ($("modalBtnCancel")) $("modalBtnCancel").onclick = hideConfirmModal;
if ($("modalBtnConfirm")) {
  $("modalBtnConfirm").onclick = () => {
    const action = pendingModalAction;
    hideConfirmModal();
    if (action) action();
  };
}

// ============================================================================
// تحديث حالات واجهة المستخدم والمؤشرات
// ============================================================================
function setAuth(state, message) {
  authState = state;
  const badge = $("badge");
  if (badge) {
    badge.textContent = LABELS[state] || state;
    badge.className = "status-badge";
    if (state === "connected" && ready) {
      badge.classList.add("badge-success");
    } else if (state === "pending" || state === "verifying") {
      badge.classList.add("badge-warning");
    } else {
      badge.classList.add("badge-danger");
    }
  }

  // تفعيل أو تعطيل أزرار النشر
  const canDeploy = (state === "connected" && ready && !actionBusy);
  const canRollbackNow = (state === "connected" && rollbackReady && !actionBusy);
  if ($("deploy")) $("deploy").disabled = !canDeploy;
  if ($("rollback")) $("rollback").disabled = !canRollbackNow;

  // تحديث بانر الجاهزية الرئيسي
  updateReadinessBanner(canDeploy, message);

  if (message) out(message);
}

function updateReadinessBanner(isReady, customMessage) {
  const banner = $("readinessBanner");
  const icon = $("readinessIcon");
  const title = $("readinessTitle");
  const desc = $("readinessDesc");

  if (!banner) return;

  if (isReady) {
    icon.textContent = "🚀";
    title.textContent = "النظام جاهز تماماً للنشر إلى الإنتاج";
    desc.textContent = "الاتصالات موثقة بالكامل، الخادم مؤمّن بمفاتيح SSH، والموقع يعمل بشكل سليم.";
  } else {
    icon.textContent = "⚠️";
    title.textContent = "النشر معطّل - يلزم استكمال الجاهزية";
    desc.textContent = customMessage || "تحقق من ربط GitHub، وبصمة الخادم، واختبار SSH لتمكين النشر.";
  }
}

function updateSidebarIndicators({ github, contabo, actions, health }) {
  const setInd = (id, status) => {
    const el = $(id);
    if (!el) return;
    el.className = `indicator-item ${status}`;
  };

  setInd("indGithub", github ? "online" : "offline");
  setInd("indContabo", contabo ? "online" : "warning");
  setInd("indActions", actions ? "online" : "warning");
  setInd("indHealth", health ? "online" : "offline");
}

// ============================================================================
// تحميل الإعدادات وتحديث البطاقات الشاملة (Settings & State Loading)
// ============================================================================
async function loadAndSyncSettings(options = {}) {
  try {
    const s = await window.deployManager.getSettings();
    if (Number.isInteger(Number(s.wizardStep))) currentWizardStep = Math.max(1, Math.min(5, Number(s.wizardStep)));

    // ملء حقول الإدخال
    const fields = ["githubClientId", "owner", "repo", "workflow", "host", "user", "domain"];
    fields.forEach((k) => {
      const el = $(k);
      if (el) el.value = s[k] || "";
    });

    // معالجة بصمة SSH بصيغة SHA256
    const formattedFp = await formatFingerprint(s.fingerprint);
    if ($("fingerprint")) $("fingerprint").value = formattedFp;

    // مزامنة حقول المعالج
    if ($("wizGithubClientId")) $("wizGithubClientId").value = s.githubClientId || "";
    if ($("wizOwner")) $("wizOwner").value = s.owner || "saadstudio-source";
    if ($("wizRepo")) $("wizRepo").value = s.repo || "saad-studio";
    if ($("wizHost")) $("wizHost").value = s.host || "161.97.77.229";
    if ($("wizDomain")) $("wizDomain").value = s.domain || "saadstudio.app";
    if ($("wizUser")) $("wizUser").value = s.user || "";
    if ($("wizFingerprint")) $("wizFingerprint").value = formattedFp;

    if ($("valGithubRepo")) $("valGithubRepo").textContent = `${s.owner || ""}/${s.repo || ""}`;

    const publicKey = s.sshPublicKey || "";
    if ($("publicSshKeyDisplay")) $("publicSshKeyDisplay").value = publicKey;
    if ($("wizPublicKeyDisplay")) $("wizPublicKeyDisplay").value = publicKey;

    // فحص حالة مفتاح SSH في مدير الاعتمادات
    if ($("sshKeyStatusDesc")) {
      $("sshKeyStatusDesc").textContent = s.sshKeyState === "valid"
        ? "مفتاح Ed25519 صالح؛ تم استعادة المفتاح العام من Credential Manager."
        : s.sshKeyMessage || "لا يوجد مفتاح SSH صالح؛ لا يمكن اعتباره جاهزاً.";
    }

    // فحص حالة GitHub
    let ghStatus = { ok: false, state: "disconnected" };
    try {
      ghStatus = await withTimeout(window.deployManager.githubStatus(), 20000, "فحص GitHub");
    } catch (e) {
      ghStatus = { ok: false, state: "connection_error", message: friendlyIpcError(e) };
    }

    // تحديث بطاقة GitHub في الداشبورد
    const pillGithub = $("pillGithub");
    if (pillGithub) {
      pillGithub.textContent = LABELS[ghStatus.state] || ghStatus.state;
      pillGithub.className = `card-badge ${ghStatus.ok ? "badge-success" : "badge-danger"}`;
    }
    if ($("valGithubUser")) $("valGithubUser").textContent = ghStatus.login || (s.hasGithubToken ? "رمز محفوظ" : "غير مربوط");
    if ($("valGithubPerms")) {
      $("valGithubPerms").textContent = ghStatus.permissions?.push ? "Push / Admin متاح" : (ghStatus.ok ? "قراءة فقط" : "غير متاح");
    }

    // فحص جاهزية النشر الشاملة
    let check = { ok: false, ssh: { ok: false }, health: { ok: false } };
    let readinessError = "";
    try {
      check = await withTimeout(window.deployManager.readiness(), 60000, "فحص الجاهزية");
    } catch (e) {
      readinessError = friendlyIpcError(e);
      check = { ok: false, ssh: { ok: false }, health: { ok: false } };
    }
    ready = Boolean(check.ok);
    rollbackReady = Boolean(check.canRollback);
    const failedParts = ["github", "workflow", "secrets", "ssh", "server", "health"].filter((k) => check[k] && !check[k].ok).map((k) => `${k}: ${check[k].message || check[k].state || "فشل"}`);
    const readinessMessage = readinessError ? `فشل فحص الجاهزية: ${readinessError}` : (ready ? ghStatus.message : `غير جاهز — ${failedParts.join(" | ") || "الفحوص غير مكتملة"}`);

    // تحديث بطاقة Contabo
    const pillContabo = $("pillContabo");
    const hasSshConfig = Boolean(s.hasSshKey && s.fingerprint);
    if (pillContabo) {
      pillContabo.textContent = hasSshConfig ? "مهيأ" : "يحتاج ضبط";
      pillContabo.className = `card-badge ${hasSshConfig ? "badge-success" : "badge-warning"}`;
    }
    if ($("valContaboHost")) $("valContaboHost").textContent = `${s.host || "161.97.77.229"}:22`;
    if ($("valContaboUser")) $("valContaboUser").textContent = s.contaboUser || "saaddeploy";
    if ($("valContaboFpStatus")) {
      $("valContaboFpStatus").textContent = formattedFp ? "موثقة SHA256" : "غير محددة";
    }

    // فحص أسرار Actions
    let secrets = { ok: false, environment: false, names: [] };
    try {
      secrets = await withTimeout(window.deployManager.secretsStatus(), 20000, "فحص Secrets");
    } catch {}
    const pillActions = $("pillActions");
    if (pillActions) {
      pillActions.textContent = secrets.ok ? "جاهز" : "غير مكتمل";
      pillActions.className = `card-badge ${secrets.ok ? "badge-success" : "badge-warning"}`;
    }
    if ($("valActionsSecrets")) {
      $("valActionsSecrets").textContent = secrets.names?.length ? `${secrets.names.length} أسرار مسجلة` : "فحص…";
    }

    // فحص صحة الموقع
    const pillHealth = $("pillHealth");
    if (pillHealth) {
      pillHealth.textContent = check.health?.ok ? "200 OK متصل" : "غير متاح";
      pillHealth.className = `card-badge ${check.health?.ok ? "badge-success" : "badge-danger"}`;
    }
    if ($("valHealthCode")) $("valHealthCode").textContent = check.health?.status ? `HTTP ${check.health.status}` : "تعذر الاتصال";

    // تحديث مؤشرات الشريط الجانبي
    updateSidebarIndicators({
      github: ghStatus.ok,
      contabo: hasSshConfig,
      actions: secrets.ok,
      health: check.health?.ok
    });

    // ضبط حالة التطبيق
    setAuth(ghStatus.state || "disconnected", readinessMessage);

    // التبديل بين الصفحات يتم عند الإقلاع فقط؛ التحديثات اللاحقة لا تنقل المستخدم من الصفحة الحالية
    if (options.keepWizard) {
      switchView("view-wizard");
      goToWizardStep(currentWizardStep);
    } else if (firstLoad) {
      if (localStorage.getItem("saadstudio_setup_completed") !== "true" && !(s.hasSshKey && s.fingerprint && s.hasGithubToken)) {
        switchView("view-wizard");
        goToWizardStep(currentWizardStep);
      } else {
        switchView("view-dashboard");
      }
    }
    firstLoad = false;

    return s;
  } catch (err) {
    firstLoad = false;
    ready = false; rollbackReady = false;
    setAuth("connection_error", "تعذر تقييم الجاهزية: " + friendlyIpcError(err));
    out("خطأ أثناء تحميل الإعدادات: " + friendlyIpcError(err));
  }
}

// ============================================================================
// جلب وعرض سجل النشر (Deployment Runs)
// ============================================================================
async function fetchAndRenderRuns() {
  const runsContainer = $("runs");
  const fullRunsContainer = $("fullRunsList");

  if (authState !== "connected") {
    if (runsContainer) runsContainer.innerHTML = '<div class="empty-state">يرجى ربط حساب GitHub أولاً لعرض سجل النشر.</div>';
    if (fullRunsContainer) fullRunsContainer.innerHTML = '<div class="empty-state">يرجى ربط حساب GitHub أولاً لعرض سجل النشر.</div>';
    return;
  }

  try {
    const result = await withTimeout(window.deployManager.listRuns(), 25000, "قراءة سجل النشر");
    if (!result.ok) {
      setAuth(result.state, result.message);
      if (runsContainer) runsContainer.innerHTML = `<div class="empty-state">${escapeHtml(result.message)}</div>`;
      if (fullRunsContainer) fullRunsContainer.innerHTML = `<div class="empty-state">${escapeHtml(result.message)}</div>`;
      return;
    }

    const runs = result.runs || [];
    lastKnownRuns = runs;

    // تحديث نص زر التراجع بـ SHA لآخر إصدار ناجح
    if ($("rollbackLabel") && runs.length > 0) {
      const target = pickRollbackTarget(runs);
      $("rollbackLabel").textContent = target ? `Rollback إلى (${target.head_sha.slice(0, 7)})` : "Rollback (لا يوجد إصدار سابق ناجح)";
    }

    if (!runs.length) {
      const emptyHtml = '<div class="empty-state">لا توجد عمليات نشر مسجلة بعد لهذا الـ Workflow.</div>';
      if (runsContainer) runsContainer.innerHTML = emptyHtml;
      if (fullRunsContainer) fullRunsContainer.innerHTML = emptyHtml;
      return;
    }

    // بناء كروت العمليات
    const formatRunCard = (r) => {
      const isSuccess = r.conclusion === "success";
      const isFailed = r.conclusion === "failure";
      const pillClass = isSuccess ? "badge-success" : isFailed ? "badge-danger" : "badge-warning";
      const statusText = escapeHtml(r.status === "completed" ? (r.conclusion || "مكتمل") : "قيد التنفيذ…");
      const dateStr = r.created_at ? escapeHtml(new Date(r.created_at).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" })) : "";
      const safeUrl = /^https:\/\/github\.com\//.test(r.html_url || "") ? escapeHtml(r.html_url) : "#";

      return `
        <div class="run-card">
          <div class="run-primary">
            <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="run-number" title="فتح في GitHub Actions">#${escapeHtml(r.run_number)}</a>
            <span class="run-sha" title="Commit Hash">${escapeHtml(r.head_sha?.slice(0, 7))}</span>
            <span style="color: var(--text-muted); font-size: 11px;">${dateStr}</span>
          </div>
          <div class="run-secondary">
            <span class="run-status-pill ${pillClass}">${statusText}</span>
          </div>
        </div>
      `;
    };

    if (runsContainer) {
      runsContainer.innerHTML = runs.slice(0, 8).map(formatRunCard).join("");
    }
    if (fullRunsContainer) {
      fullRunsContainer.innerHTML = runs.map(formatRunCard).join("");
    }
  } catch (e) {
    const failure = `<div class="empty-state">تعذر جلب السجل: ${escapeHtml(friendlyIpcError(e))}</div>`;
    if (runsContainer) runsContainer.innerHTML = failure;
    if (fullRunsContainer) fullRunsContainer.innerHTML = failure;
  }
}

// ============================================================================
// حفظ الإعدادات (Save Settings)
// ============================================================================
async function saveAllSettings() {
  try {
    const inWizard = $("view-wizard")?.classList.contains("active");
    const rawFp = inWizard ? ($("wizFingerprint")?.value || "") : ($("fingerprint") ? $("fingerprint").value : "");
    const cleanFp = await formatFingerprint(rawFp);

    const payload = {
      githubClientId: (inWizard ? $("wizGithubClientId")?.value : $("githubClientId")?.value) || "",
      owner: (inWizard ? $("wizOwner")?.value : $("owner")?.value) || "",
      repo: (inWizard ? $("wizRepo")?.value : $("repo")?.value) || "",
      workflow: $("workflow")?.value || "",
      host: (inWizard ? $("wizHost")?.value : $("host")?.value) || "",
      user: (inWizard ? $("wizUser")?.value : $("user")?.value) || "",
      domain: (inWizard ? $("wizDomain")?.value : $("domain")?.value) || "",
      fingerprint: cleanFp,
      wizardStep: currentWizardStep,
      githubToken: $("githubToken")?.value || undefined,
      sshKey: $("sshKey")?.value || undefined
    };

    const s = await window.deployManager.saveSettings(payload);

    if ($("githubToken")) $("githubToken").value = "";
    if ($("sshKey")) $("sshKey").value = "";

    out("تم حفظ الإعدادات وتأمين الأسرار في Windows Credential Manager بنجاح.");
    await loadAndSyncSettings({ keepWizard: inWizard });
  } catch (e) {
    out("فشل الحفظ: " + e.message);
  }
}

if ($("save")) $("save").onclick = saveAllSettings;
if ($("saveGithubSettings")) $("saveGithubSettings").onclick = saveAllSettings;
if ($("saveContaboSettings")) $("saveContaboSettings").onclick = saveAllSettings;
if ($("saveSshSettings")) $("saveSshSettings").onclick = saveAllSettings;

// ============================================================================
// توليد مفاتيح SSH واستخراج البصمة (SSH Keygen & Fingerprint)
// ============================================================================
async function handleGenerateSsh() {
  try {
    out("جارٍ إنشاء زوج مفاتيح Ed25519 عالي الأمان…");
    const result = await window.deployManager.generateSsh();
    if (result.ok) {
      if ($("publicSshKeyDisplay")) $("publicSshKeyDisplay").value = result.publicKey;
      if ($("wizPublicKeyDisplay")) $("wizPublicKeyDisplay").value = result.publicKey;
      out("تم إنشاء مفتاح Ed25519 وحفظ المفتاح الخاص بأمان في Windows Credential Manager.\nالمفتاح العام:\n" + result.publicKey);
      await loadAndSyncSettings();
    }
  } catch (e) {
    out("فشل إنشاء المفتاح: " + e.message);
  }
}

if ($("generateSsh")) $("generateSsh").onclick = handleGenerateSsh;
if ($("wizGenerateSsh")) $("wizGenerateSsh").onclick = handleGenerateSsh;

if ($("btnCopyPublicKey")) {
  $("btnCopyPublicKey").onclick = async () => {
    const val = $("publicSshKeyDisplay")?.value;
    if (val) {
      await navigator.clipboard.writeText(val);
      $("btnCopyPublicKey").textContent = "تم النسخ!";
      setTimeout(() => $("btnCopyPublicKey").textContent = "نسخ المفتاح العام", 1500);
    }
  };
}
if ($("btnRestorePublicKey")) {
  $("btnRestorePublicKey").onclick = async () => {
    try {
      out("جارٍ التحقق من المفتاح المحفوظ واستخراج المفتاح العام…");
      const result = await window.deployManager.restorePublicKey();
      if (!result.ok) throw new Error(result.message || "تعذر استعادة المفتاح العام");
      if ($("publicSshKeyDisplay")) $("publicSshKeyDisplay").value = result.publicKey;
      if ($("wizPublicKeyDisplay")) $("wizPublicKeyDisplay").value = result.publicKey;
      out("تمت استعادة المفتاح العام المطابق للمفتاح الخاص المحفوظ.");
      await loadAndSyncSettings();
    } catch (e) {
      out("فشل استعادة المفتاح العام: " + e.message);
    }
  };
}
if ($("btnAddSshSecret")) {
  $("btnAddSshSecret").onclick = async () => {
    const status = $("sshGithubSecretStatus");
    if (!confirm("سيتم تشفير المفتاح الخاص وإرساله إلى GitHub Secret باسم CONTABO_SSH_KEY داخل Production. لن يظهر المفتاح على الشاشة ولن يبدأ النشر. هل تريد المتابعة؟")) { if (status) status.textContent = "تم الإلغاء؛ لم يُرسل أي شيء."; return; }
    const button = $("btnAddSshSecret");
    button.disabled = true;
    if (status) status.textContent = "جارٍ الاتصال بـ GitHub وتشفير المفتاح…";
    try {
      out("جارٍ تشفير مفتاح SSH وإضافته إلى GitHub دون عرضه…");
      const result = await window.deployManager.addSshSecret();
      out(`تمت إضافة ${result.name} إلى بيئة ${result.environment} والتحقق من ظهوره دون تشغيل النشر.`);
      if (status) status.textContent = `تم التحقق: ${result.name} موجود في ${result.environment}.`;
      await loadAndSyncSettings();
    } catch (e) {
      const message = friendlyIpcError(e);
      out("فشل إضافة مفتاح SSH إلى GitHub: " + message);
      if (status) status.textContent = "فشل الإضافة: " + message;
    } finally { button.disabled = false; }
  };
}

let serverAuditRows = [];
// Verdict is READY only when every deployment-critical check actually passed; BLOCKED/UNVERIFIED/FAIL never count as pass.
function auditVerdict() {
  const count = {}; serverAuditRows.forEach((x) => { count[x.state] = (count[x.state] || 0) + 1; });
  const by = Object.fromEntries(serverAuditRows.map((x) => [x.key, x.state]));
  const required = ["preflight", "workflow", "deploy-script", "caddy", "health", "database"];
  const notPassed = required.filter((k) => by[k] !== "PASS");
  const summary = Object.entries(count).map(([k, v]) => k + "=" + v).join(" ");
  return notPassed.length ? "اكتمل الفحص (" + summary + ") — الحكم: غير جاهز للنشر. غير مُثبت: " + notPassed.join("، ") : "اكتمل الفحص (" + summary + ") — الحكم: الفحوصات الأساسية ناجحة فعلياً";
}
let serverAuditUnsubscribe = null;
function renderAuditRow(item) {
  serverAuditRows.push(item);
  const root = $("serverAuditResults"); if (!root) return;
  const row = document.createElement("div"); row.className = "audit-row";
  const state = item.state || "BLOCKED";
  const title = document.createElement("strong"); title.textContent = item.name || "فحص";
  const badge = document.createElement("span"); badge.className = "audit-state " + state.toLowerCase(); badge.textContent = state;
  const meta = document.createElement("small"); meta.textContent = `${item.message || ""} · ${item.durationMs || 0}ms`;
  const evidence = document.createElement("pre"); evidence.textContent = scrubSecrets(item.evidence || item.message || "");
  const streams = document.createElement("pre"); streams.textContent = `exitCode: ${item.exitCode ?? "n/a"}\nstdout:\n${scrubSecrets(item.stdout || "")}\nstderr:\n${scrubSecrets(item.stderr || "")}`;
  row.append(title, badge, meta, evidence, streams);
  root.appendChild(row);
}
if ($("btnStartServerAudit")) {
  $("btnStartServerAudit").onclick = async () => {
    const start = $("btnStartServerAudit"), cancel = $("btnCancelServerAudit"), state = $("serverAuditState"), root = $("serverAuditResults");
    serverAuditRows = []; if (root) root.textContent = ""; start.disabled = true; cancel.disabled = false; if (state) state.textContent = "جارٍ الاتصال والفحص…";
    serverAuditUnsubscribe?.();
    serverAuditUnsubscribe = window.deployManager.onServerAuditEvent((event) => {
      if (event.type === "result") renderAuditRow(event);
      if (event.type === "done") { start.disabled = false; cancel.disabled = true; if (state) state.textContent = event.state === "DONE" ? auditVerdict() : event.message; serverAuditUnsubscribe?.(); serverAuditUnsubscribe = null; }
    });
    try { await window.deployManager.startServerAudit(); } catch (e) { start.disabled = false; cancel.disabled = true; if (state) state.textContent = "فشل بدء الفحص: " + friendlyIpcError(e); serverAuditUnsubscribe?.(); serverAuditUnsubscribe = null; }
  };
}
if ($("btnCancelServerAudit")) $("btnCancelServerAudit").onclick = async () => { $("btnCancelServerAudit").disabled = true; await window.deployManager.cancelServerAudit(); };
if ($("btnCopyServerAudit")) $("btnCopyServerAudit").onclick = async () => { const text = serverAuditRows.map((x) => `${x.name}\t${x.state}\t${x.message}\t${x.evidence || ""}`).join("\n\n"); await navigator.clipboard.writeText(text || "لم يتم تنفيذ الفحص"); $("serverAuditState").textContent = "تم نسخ التقرير الكامل."; };

function renderRepairStep(step) {
  const root = $("repairPlanResults"); if (!root) return;
  const row = document.createElement("div"); row.className = "audit-row";
  const title = document.createElement("strong"); title.textContent = step.title;
  const mode = document.createElement("span"); mode.className = "audit-state " + (step.mode === "write" ? "warning" : "pass"); mode.textContent = step.mode === "write" ? "يتطلب موافقة" : "قراءة فقط";
  const command = document.createElement("pre"); command.textContent = step.command;
  const impact = document.createElement("small"); impact.textContent = step.impact;
  row.append(title, mode, impact, command);
  if (step.mode === "write") {
    const button = document.createElement("button"); button.className = "btn btn-primary";
    const unmet = step.preflight && Object.entries(step.preflight).some(([, value]) => value !== true);
    button.disabled = Boolean(unmet); button.textContent = unmet ? "المتطلبات غير مكتملة" : "موافقة وتنفيذ";
    if (unmet) { const requirement = document.createElement("small"); requirement.textContent = "التثبيت معطل: يجب نجاح فحص المصدر وbash -n والمسار قبل الموافقة."; row.appendChild(requirement); }
    button.onclick = async () => {
      if (!window.confirm(`سيتم تنفيذ الخطوة:\n${step.title}\n\n${step.impact}\n\nهل توافق؟`)) return;
      button.disabled = true; button.textContent = "جارٍ التنفيذ…";
      try { const result = await window.deployManager.applyServerRepair(step.id); const evidence = document.createElement("pre"); evidence.textContent = `PASS\n${result.evidence || "تم التنفيذ دون مخرجات"}`; row.appendChild(evidence); button.textContent = "تم التنفيذ"; }
      catch (e) { const error = document.createElement("small"); error.textContent = "FAIL: " + friendlyIpcError(e); row.appendChild(error); button.disabled = false; button.textContent = "إعادة المحاولة بعد الموافقة"; }
    }; row.appendChild(button);
  }
  root.appendChild(row);
}
if ($("btnLoadRepairPlan")) $("btnLoadRepairPlan").onclick = async () => {
  const button = $("btnLoadRepairPlan"), root = $("repairPlanResults"), state = $("repairState");
  const started = Date.now(); button.disabled = true; root.textContent = ""; state.textContent = "جارٍ الاتصال عبر SSH وفحص خدمة HTTPS قراءة فقط…";
  const log = document.createElement("pre"); log.className = "repair-activity"; log.textContent = `[${new Date().toLocaleTimeString()}] بدء فحص خطة الإصلاح عبر SSH`; root.appendChild(log);
  try {
    const result = await withTimeout(window.deployManager.serverRepairPlan(), 40000, "فحص خطة الإصلاح");
    const probe = document.createElement("div"); probe.className = "audit-row";
    const title = document.createElement("strong"); title.textContent = "نتيجة فحص HTTPS الفعلي";
    const badge = document.createElement("span"); badge.className = "audit-state " + (result.probe.ok ? "pass" : "fail"); badge.textContent = result.probe.ok ? "PASS" : "FAIL";
    const evidence = document.createElement("pre"); evidence.textContent = result.probe.evidence || "لا توجد مخرجات";
    probe.append(title, badge, evidence); root.appendChild(probe);
    result.plan.forEach(renderRepairStep);
    log.textContent += `\n[${new Date().toLocaleTimeString()}] اكتمل الفحص خلال ${Date.now() - started}ms؛ لم تُنفذ أي خطوة كتابة`;
    state.textContent = "الخطة جاهزة؛ راجع الأمر والتأثير ثم وافق على كل خطوة منفصلة.";
  } catch (e) { log.textContent += `\n[${new Date().toLocaleTimeString()}] FAIL: ${friendlyIpcError(e)}`; state.textContent = "فشل الفحص: " + friendlyIpcError(e); }
  finally { button.disabled = false; }
};

// استخراج بصمة الخادم التلقائي مع التحقق المستقل
async function handleFingerprintCheck(targetInputId) {
  const userEl = $("view-wizard")?.classList.contains("active") ? $("wizUser") : $("user");
  const passEl = $("view-wizard")?.classList.contains("active") ? $("wizPassword") : $("bootstrapPassword");
  const username = userEl?.value?.trim() || "root";
  const password = passEl?.value || "";

  if (!password) {
    out("تنبيه: أدخل كلمة مرور SSH الأولية لاستخراج بصمة الخادم.");
    return;
  }

  try {
    out(`جارٍ الاتصال عبر SSH إلى ${$("host")?.value || $("wizHost")?.value || "161.97.77.229"}:22 لاستخراج بصمة المضيف…`);
    const result = await window.deployManager.contaboFingerprint({ user: username, password });

    if (result.fingerprint) {
      const formattedFp = await formatFingerprint(result.fingerprint);

      const targetInput = $(targetInputId) || $("fingerprint");
      if (targetInput) targetInput.value = formattedFp;
      if ($("wizFingerprint")) $("wizFingerprint").value = formattedFp;

      out(`تم استلام بصمة الخادم بنجاح:\n${formattedFp}\n\nتنبيه أمني هام: لا تعتمد هذه البصمة إلا بعد مطابقتها مع لوحة تحكم Contabo أو سجلات الخادم المستقلة.`);
    } else {
      out("تم الاتصال لكن لم تُرجع مكتبة SSH بصمة مضيف قابلة للتحقق.");
    }
  } catch (e) {
    out("فشل استخراج البصمة: " + e.message);
  }
}

if ($("fingerprintCheck")) $("fingerprintCheck").onclick = () => handleFingerprintCheck("fingerprint");
if ($("wizFingerprintCheck")) $("wizFingerprintCheck").onclick = () => handleFingerprintCheck("wizFingerprint");
if ($("btnCopyWizardFingerprint")) {
  $("btnCopyWizardFingerprint").onclick = async () => {
    const value = $("wizFingerprint")?.value?.trim();
    if (!value) { out("لا توجد بصمة لنسخها."); return; }
    await navigator.clipboard.writeText(value);
    $("btnCopyWizardFingerprint").textContent = "تم النسخ";
    setTimeout(() => { if ($("btnCopyWizardFingerprint")) $("btnCopyWizardFingerprint").textContent = "نسخ البصمة"; }, 1500);
  };
}

// ربط سيرفر Contabo وتثبيت مفتاح النشر
async function handleContaboSetup() {
  const chk = $("chkVerifyFingerprint");
  const wizChk = $("wizChkVerifyFingerprint");
  const isVerified = (chk && chk.checked) || (wizChk && wizChk.checked);

  if (!isVerified) {
    out("تنبيه أمني: يجب تحديد خانة التأكيد بأنك تحققت من بصمة SSH بشكل مستقل قبل ربط السيرفر.");
    return;
  }

  showConfirmModal({
    title: "تأكيد ربط خادم Contabo",
    message: "سيتم إنشاء مستخدم نشر محدود (saaddeploy) في الخادم وتثبيت المفتاح العام فقط. هل تريد المتابعة؟",
    confirmLabel: "نعم، تهيئة السيرفر",
    onConfirm: async () => {
      try {
        out("جارٍ تهيئة مستخدم النشر saaddeploy وتثبيت المفتاح على السيرفر…");
        const fp = await formatFingerprint($("fingerprint")?.value || $("wizFingerprint")?.value);
        const result = await window.deployManager.contaboSetup({
          user: $("user")?.value || $("wizUser")?.value,
          password: $("bootstrapPassword")?.value || $("wizPassword")?.value,
          fingerprint: fp
        });

        if ($("bootstrapPassword")) $("bootstrapPassword").value = "";
        if ($("wizPassword")) $("wizPassword").value = "";

        out(`تم إعداد وتجهيز مستخدم النشر (${result.deployUser}) بنجاح. يمكنك الآن اختبار اتصال SSH بالمفتاح.`);
        await loadAndSyncSettings();
      } catch (e) {
        out("فشل تهيئة السيرفر: " + e.message);
      }
    }
  });
}

if ($("contaboSetup")) $("contaboSetup").onclick = handleContaboSetup;
if ($("wizContaboSetup")) $("wizContaboSetup").onclick = handleContaboSetup;

// ============================================================================
// تفويض GitHub Device Flow
// ============================================================================
async function handleGithubDeviceFlow() {
  if (polling) return;
  const clientId = $("githubClientId")?.value || $("wizGithubClientId")?.value;
  if (!clientId) {
    out("أدخل GitHub OAuth Client ID لبدء التفويض.");
    return;
  }

  try {
    out("جارٍ بدء طلب تفويض الجهاز من GitHub…");
    const code = await window.deployManager.githubDevice({ clientId });
    polling = true;

    // إظهار كود التفويض والرابط
    const box = $("deviceFlowBox");
    if (box) box.style.display = "block";
    if ($("deviceFlowCode")) $("deviceFlowCode").textContent = code.user_code;
    if ($("deviceFlowLink")) $("deviceFlowLink").href = code.verification_uri;
    if ($("deviceFlowOpen")) $("deviceFlowOpen").onclick = () => window.deployManager.openExternal(code.verification_uri);
    if ($("deviceFlowCopy")) $("deviceFlowCopy").onclick = async () => { await navigator.clipboard.writeText(code.user_code); $("deviceFlowCopy").textContent = "تم نسخ الرمز"; setTimeout(() => { if ($("deviceFlowCopy")) $("deviceFlowCopy").textContent = "نسخ الرمز"; }, 1500); };

    devicePrompt = `رابط GitHub: ${code.verification_uri}\nرمز التفويض: ${code.user_code}\n\nأدخل الرمز في صفحة GitHub ثم اضغط Continue.`;
    setAuth("pending", devicePrompt);

    const expiresAt = Date.now() + (Number(code.expires_in || 900) * 1000);

    const poll = async () => {
      if (Date.now() >= expiresAt) {
        polling = false;
        setAuth("expired", "انتهت صلاحية رمز التفويض، ابدأ الإعداد من جديد.");
        return;
      }

      let result;
      try {
        result = await withTimeout(window.deployManager.githubPoll({ clientId, deviceCode: code.device_code }), 20000, "استعلام تفويض GitHub");
      } catch (e) {
        result = { ok: false, state: "pending", interval: 10 }; // transient IPC/network failure: keep polling until the code expires
        out("تعذر استعلام GitHub مؤقتاً، ستتم إعادة المحاولة: " + friendlyIpcError(e));
      }

      if (result.ok) {
        polling = false;
        if (box) box.style.display = "none";
        setAuth("verifying", "تمت الموافقة بنجاح، جارٍ التحقق من صلاحيات المستودع…");
        const status = await window.deployManager.githubStatus();
        setAuth(status.state, status.message || `تم الربط بالحساب ${status.login || "GitHub"}`);
        await loadAndSyncSettings();
        await fetchAndRenderRuns();
      } else if (result.state === "pending") {
        setTimeout(poll, Math.max(5, Number(result.interval || code.interval || 5)) * 1000);
      } else {
        polling = false;
        setAuth(result.state || "api_error", result.error);
      }
    };

    setTimeout(poll, Math.max(5, Number(code.interval || 5)) * 1000);
  } catch (e) {
    polling = false;
    setAuth("api_error", e.message);
  }
}

if ($("githubSetup")) $("githubSetup").onclick = handleGithubDeviceFlow;
if ($("wizGithubSetup")) $("wizGithubSetup").onclick = handleGithubDeviceFlow;

// ============================================================================
// عمليات النشر والتراجع الآمنة (Deploy & Rollback Handlers)
// ============================================================================
if ($("deploy")) {
  $("deploy").onclick = () => {
    showConfirmModal({
      title: "تأكيد تشغيل Workflow النشر",
      message: "سيتم إرسال إشارة dispatch إلى GitHub Actions لنشر فرع الإصدار المضبوط في الإعدادات (الافتراضي migration/contabo) إلى خادم Contabo. هل تريد المتابعة؟",
      icon: "🚀",
      confirmLabel: "نشر الآن",
      onConfirm: () => guarded($("deploy"), async () => {
        try {
          out("جارٍ إرسال أمر النشر إلى GitHub Actions…");
          const res = await withTimeout(window.deployManager.dispatch({ action: "deploy" }), 40000, "إرسال النشر");
          out("تم إرسال طلب النشر بنجاح:\n" + JSON.stringify(res, null, 2));
          await fetchAndRenderRuns();
        } catch (e) {
          out("فشل إرسال النشر: " + friendlyIpcError(e));
        }
      })
    });
  };
}

if ($("rollback")) {
  $("rollback").onclick = async () => {
    try {
      const runs = lastKnownRuns.length ? lastKnownRuns : (await withTimeout(window.deployManager.listRuns(), 25000, "قراءة سجل النشر")).runs || [];
      const target = pickRollbackTarget(runs);
      const ref = target?.head_sha;
      if (!ref) {
        out("لا يوجد إصدار سابق ناجح مسجل (يلزم تشغيلان ناجحان على الأقل) للتراجع إليه.");
        return;
      }

      showConfirmModal({
        title: "تأكيد التراجع عن آخر إصدار (Rollback)",
        message: `سيتم التراجع بالخادم إلى الإصدار السابق (${ref.slice(0, 8)}). هل أنت متأكد؟`,
        icon: "⏪",
        confirmLabel: "تأكيد التراجع",
        onConfirm: () => guarded($("rollback"), async () => {
          try {
            out(`جارٍ إرسال أمر التراجع إلى الإصدار ${ref.slice(0, 8)}…`);
            const res = await withTimeout(window.deployManager.dispatch({ action: "rollback", ref }), 40000, "إرسال التراجع");
            out("تم إرسال طلب التراجع بنجاح:\n" + JSON.stringify(res, null, 2));
            await fetchAndRenderRuns();
          } catch (e) {
            out("فشل التراجع: " + friendlyIpcError(e));
          }
        })
      });
    } catch (e) {
      out(e.message);
    }
  };
}

// فحوصات السيرفر وSSH
if ($("status")) {
  $("status").onclick = async () => {
    try {
      out("جارٍ فحص صحة الخادم والموقع من https://saadstudio.app/api/health?full=1…");
      const res = await window.deployManager.serverStatus();
      out("استجابة صحة السيرفر:\n" + JSON.stringify(res, null, 2));
      await loadAndSyncSettings();
    } catch (e) {
      out("فشل فحص صحة السيرفر: " + e.message);
    }
  };
}

async function handleSshTest() {
  try {
    out("جارٍ اختبار اتصال SSH بالمفتاح المخزن…");
    const res = await withTimeout(window.deployManager.sshTest(), 25000, "اختبار SSH");
    out("نتيجة اختبار SSH:\n" + JSON.stringify(res, null, 2));
  } catch (e) {
    out("فشل اختبار SSH: " + e.message);
  }
}

if ($("ssh")) $("ssh").onclick = handleSshTest;
if ($("btnTestSshQuick")) $("btnTestSshQuick").onclick = handleSshTest;
if ($("refresh")) $("refresh").onclick = fetchAndRenderRuns;
if ($("btnRefreshRunsView")) $("btnRefreshRunsView").onclick = fetchAndRenderRuns;
if ($("btnQuickRefresh")) $("btnQuickRefresh").onclick = async () => {
  out("جارٍ التحديث الشامل للاتصالات والجاهزية…");
  await loadAndSyncSettings();
  await fetchAndRenderRuns();
};

// ============================================================================
// إدارة معالج الإعداد الأولي (Interactive Setup Wizard Controller)
// ============================================================================
function goToWizardStep(stepNumber) {
  if (stepNumber < 1 || stepNumber > 5) return;
  currentWizardStep = stepNumber;

  // تحديث دوائر التقدم
  document.querySelectorAll(".wizard-stepper .step-item").forEach((item) => {
    const s = parseInt(item.getAttribute("data-step"), 10);
    item.classList.remove("active", "completed");
    if (s === stepNumber) {
      item.classList.add("active");
    } else if (s < stepNumber) {
      item.classList.add("completed");
    }
  });

  // تحديث الحاويات
  document.querySelectorAll(".wizard-pane").forEach((pane) => pane.classList.remove("active"));
  const targetPane = $(`wizardPane${stepNumber}`);
  if (targetPane) targetPane.classList.add("active");

  // تحديث الأزرار
  if ($("wizBtnPrev")) $("wizBtnPrev").disabled = (stepNumber === 1);
  if ($("wizBtnNext")) $("wizBtnNext").style.display = (stepNumber === 5) ? "none" : "inline-flex";
  if ($("wizBtnFinish")) $("wizBtnFinish").style.display = (stepNumber === 5) ? "inline-flex" : "none";

  // تنفيذ فحوصات خاصة بالخطوة 5
  if (stepNumber === 5) {
    runWizardFinalReadinessCheck();
  }
}

async function runWizardFinalReadinessCheck() {
  if (readinessBusy) return;
  readinessBusy = true;
  const button = $("wizBtnTestReadiness");
  const originalLabel = button?.textContent || "إعادة اختبار الجاهزية الآن";
  if (button) { button.disabled = true; button.textContent = "⏳ جارٍ الفحص…"; }
  try {
    const started = Date.now();
    out("معالج الإعداد: جارٍ فحص GitHub وWorkflow وSecrets وSSH وصحة الموقع…");
    const check = await withTimeout(window.deployManager.readiness(), 60000, "فحص الجاهزية");
    const updateCheckItem = (id, result) => {
      const el = $(id);
      if (!el) return;
      const passed = Boolean(result?.ok);
      el.className = "check-item " + (passed ? "pass" : "fail");
      el.querySelector(".check-icon").textContent = passed ? "✅" : "❌";
      const label = el.querySelector(".check-label");
      if (label) label.textContent = (label.dataset.base || label.textContent.split(" — ")[0]) + " — " + (result?.message || result?.state || "غير متحقق");
    };

    updateCheckItem("wizCheckGithub", check.github);
    updateCheckItem("wizCheckSsh", check.ssh);
    updateCheckItem("wizCheckHealth", check.health);
    updateCheckItem("wizCheckWorkflow", check.workflow);
    updateCheckItem("wizCheckSecrets", check.secrets);
    const detail = $("wizReadinessDetails");
    if (detail) detail.textContent = "آخر فحص: " + (check.checkedAt || new Date().toISOString()) + " — المدة " + (Date.now() - started) + "ms";

    if (check.ok) {
      out("معالج الإعداد: كافة الفحوصات ناجحة، التطبيق جاهز للنشر.");
    } else {
      out("معالج الإعداد: غير جاهز. GitHub=" + check.github?.state + "; Workflow=" + check.workflow?.state + "; Secrets=" + check.secrets?.state + "; SSH=" + check.ssh?.state + "; Health=" + (check.health?.status || check.health?.state || "error") + ".");
    }
  } catch (e) {
    const message = friendlyIpcError(e);
    out("خطأ أثناء فحص جاهزية المعالج: " + message);
    ["wizCheckGithub", "wizCheckSsh", "wizCheckHealth", "wizCheckWorkflow", "wizCheckSecrets"].forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.className = "check-item fail";
      const icon = el.querySelector(".check-icon");
      if (icon) icon.textContent = "❌";
      const label = el.querySelector(".check-label");
      if (label) label.textContent = (label.dataset.base || label.textContent.split(" — ")[0]) + " — فشل الفحص: " + message;
    });
    const detail = $("wizReadinessDetails");
    if (detail) detail.textContent = "فشل الفحص في " + new Date().toISOString() + ": " + message;
  } finally {
    readinessBusy = false;
    if (button) { button.disabled = false; button.textContent = originalLabel; }
  }
}

// أزرار المعالج
if ($("wizBtnPrev")) {
  $("wizBtnPrev").onclick = () => goToWizardStep(currentWizardStep - 1);
}
if ($("wizBtnNext")) {
  $("wizBtnNext").onclick = async () => {
    if (currentWizardStep === 3) {
      const fp = await formatFingerprint($("wizFingerprint")?.value || "");
      if (!/^SHA256:[A-Za-z0-9+/=]+$/.test(fp) || !$("wizChkVerifyFingerprint")?.checked) {
        out("لا يمكن المتابعة: أدخل بصمة SHA256 وتحقق منها بشكل مستقل ثم فعّل مربع التأكيد.");
        return;
      }
    }
    // حفظ التغييرات الحالية ومتابعة
    const nextStep = Math.min(5, currentWizardStep + 1);
    await saveAllSettings();
    currentWizardStep = nextStep;
    await window.deployManager.saveSettings({ wizardStep: nextStep });
    goToWizardStep(nextStep);
  };
}
if ($("wizBtnSkip")) {
  $("wizBtnSkip").onclick = () => {
    switchView("view-dashboard");
  };
}
if ($("wizBtnFinish")) {
  $("wizBtnFinish").onclick = async () => {
    localStorage.setItem("saadstudio_setup_completed", "true");
    out("تم إكمال معالج الإعداد بنجاح.");
    switchView("view-dashboard");
    await loadAndSyncSettings();
  };
}
if ($("wizBtnTestReadiness")) {
  $("wizBtnTestReadiness").onclick = runWizardFinalReadinessCheck;
}
if ($("wizSaveGithub")) {
  $("wizSaveGithub").onclick = async () => {
    await saveAllSettings();
    currentWizardStep = 2;
    await window.deployManager.saveSettings({ wizardStep: 2 });
    goToWizardStep(2);
  };
}

// تمكين النقر المباشر على دوائر المعالج
document.querySelectorAll(".wizard-stepper .step-item").forEach((item) => {
  item.onclick = () => {
    const s = parseInt(item.getAttribute("data-step"), 10);
    goToWizardStep(s);
  };
});

if ($("wizChkVerifyFingerprint")) { $("wizChkVerifyFingerprint").checked = false; $("wizChkVerifyFingerprint").indeterminate = false; }

// ============================================================================
// بدء التشغيل التلقائي (Bootstrap & Initialization)
// ============================================================================
loadAndSyncSettings()
  .then(fetchAndRenderRuns)
  .catch((e) => out("خطأ في بدء التشغيل: " + e.message));
