# CLAUDE_FULL_SYSTEM_AUDIT — SaadStudio Deploy Manager

تاريخ التدقيق: 2026-11-05 · الفرع: `migration/contabo` · HEAD: `8f8454a` (== `origin/migration/contabo`) · لم يُنفَّذ Commit/Push/Deploy/Rollback ولم يُعدَّل السيرفر.
كل ما يلي مبني على تنفيذ فعلي (Electron حقيقي، SSH حقيقي بقراءة فقط، GitHub API حقيقي، أوامر محلية). لم تُعرض أي أسرار.

## 1) الخلاصة التنفيذية

**جاهزية النشر الفعلية: غير جاهز (NOT READY)** — لثلاثة أسباب مثبتة بالدليل، ليست في واجهة البرنامج:

1. **`deploy.yml` كان YAML غير صالح** (`with: { ref: ${{ ... }} }`) → GitHub سجّل Run #14 و#15 بلا أي Job (`failure`). هذا هو سبب فشل النشر عبر Actions. **أُصلح محلياً** وتم التحقق بمُحلِّل YAML (0 أخطاء) — غير مرفوع.
2. **`/opt/saadstudio/bin/deploy-release` غير موجود على السيرفر** (فحص SSH: `Deployment script missing`). حتى لو نجح الـ Workflow، لا يوجد ما ينفَّذ.
3. **`saaddeploy` لا يملك وصول Docker** (`permission denied … docker.sock`) — وهذا مقصود أمنياً، لكن الـ Workflow القديم كان يستدعي السكربت دون `sudo`، فالتصميم كان متناقضاً. المطلوب: قاعدة sudoers واحدة محددة (مقترح جاهز، **لم يُطبَّق**، يحتاج موافقتك).

ما يعمل فعلاً (PASS مُثبت): SSH بالمفتاح مع تثبيت البصمة، GitHub (token + صلاحية push)، Workflow موجود، Secrets الأربعة موجودة في بيئة Production، الموقع `200` وHealth `ok:true`، قاعدة البيانات `ok` (98ms)، FFmpeg متاح، التخزين (B2/R2/Supabase) مهيّأ.

## 2) المشاكل المكتشفة

| # | الخطورة | المشكلة | السبب الجذري | الحالة |
|---|---|---|---|---|
| 1 | حرجة | `deploy.yml` غير صالح، Runs بلا Jobs | `{ ref: ${{ … }} }` داخل flow-mapping | **أُصلح محلياً** |
| 2 | حرجة | سكربت النشر غير موجود على Contabo | لم يُثبَّت قط | يحتاج موافقتك |
| 3 | حرجة | Rollback داخل السكربت لا يعمل فعلياً | `image: saad-studio:local` ثابت؛ `build` يستبدل الصورة السابقة فتعيد "الاستعادة" نفس الصورة الجديدة | **أُصلح** (وسم `rollback-previous` قبل البناء) |
| 4 | حرجة | السكربت ينشر Commit قديماً | `git rev-parse "$REF"` يقرأ فرعاً محلياً قديماً بعد `fetch` | **أُصلح** (`FETCH_HEAD`) |
| 5 | عالية | زر النشر يرسل `ref: "main"` ثابتاً بينما الـ Workflow على `migration/contabo` فقط (`main` لا يحتويه) | قيمة صلبة في `main.cjs` | **أُصلح** (إعداد `releaseBranch` افتراضي `migration/contabo`) |
| 6 | عالية | "جارٍ تقييم جاهزية النشر…" يعلق للأبد | استدعاءات GitHub بلا مهلة، وSSH يلغي المؤقت عند `ready` ثم `exec` بلا مهلة، ولا `catch` يحدّث الواجهة | **أُصلح** (مهلات 8–10s، سقف 45s في Main و60s في Renderer، رسالة سبب واضحة) |
| 7 | عالية | زر Rollback يتراجع إلى **آخر Run** (قد يكون الفاشل) | `runs[0].head_sha` | **أُصلح** (آخر ثاني Run ناجح، SHA كامل فقط) |
| 8 | عالية | Rollback معطّل عندما يكون الموقع نازلاً | الزر مربوط بـ `ready` الذي يتضمن Health | **أُصلح** (`canRollback` بدون Health) |
| 9 | عالية | حقن أوامر عبر `release_ref` في الـ Workflow | `'${{ inputs.release_ref }}'` داخل `script:` | **أُصلح** (Job تحقق + `env`/`envs`) |
| 10 | عالية | تسريب أجزاء من الأسرار في تقرير الفحص | `[^\\s]*` في regex literal يتوقف عند حرف `s` | **أُصلح** + اختبار |
| 11 | متوسطة | سجل النشر يعرض كل Workflows لا `deploy.yml` فقط | `/actions/runs?workflow_id=` معلمة غير مدعومة | **أُصلح** (`/actions/workflows/{id}/runs`) |
| 12 | متوسطة | فحص Caddy يفشل رغم أن HTTPS وCaddy يعملان | يشترط `2xx` بينما الجذر يردّ `307` | **أُصلح** |
| 13 | متوسطة | لا حماية من نسختين/ضغط متكرر | لا `requestSingleInstanceLock`، `operation` يُحرَّر فوراً | **أُصلح** (قفل نسخة، `guarded()`، رفض الإرسال إن وُجد Run نشط) |
| 14 | متوسطة | الواجهة تقفز للصفحة الرئيسية/المعالج بعد أي تحديث | `switchView` داخل كل `loadAndSyncSettings` | **أُصلح** (عند الإقلاع فقط) |
| 15 | متوسطة | حقن أوامر محتمل عبر `contaboUser` | يُدرَج بدون تحقق في أمر الإعداد | **أُصلح** (`^[a-z_][a-z0-9_-]{0,31}$`) |
| 16 | متوسطة | تثبيت السكربت يتطلب root ويستخدم `/tmp` متوقع الاسم | `sudo install` + ملف ثابت | **أُصلح** (`mktemp`، رفع لمجلد saaddeploy فقط، التثبيت بـ root يدوي) |
| 17 | متوسطة | `bash -n` عند تحميل الوحدة بلا مهلة وقد يعلق/ينهار على Windows | `spawnSync` عند الاستيراد | **أُصلح** (مهلة 8s + try/catch + Git Bash) |
| 18 | متوسطة | لا CSP، لا sandbox، لا حماية تنقل، لا تحقق من مرسل IPC | إعدادات Electron افتراضية | **أُصلح** (CSP، `sandbox:true`، منع `will-navigate`/النوافذ، فحص مصدر IPC) |
| 19 | منخفضة | XSS محتمل في عرض السجل (`innerHTML`) | قيم GitHub بلا escape | **أُصلح** |
| 20 | منخفضة | استطلاع Device Flow يتوقف نهائياً عند خطأ IPC عابر | لا `try/catch` | **أُصلح** |
| 21 | منخفضة | ESLint يفشل بـ 25 خطأ "Definition for rule not found" | الإضافة غير محمّلة في `.eslintrc.json` | **أُصلح** (إضافة `plugins`) |
| 22 | معلومة | النسخ الاحتياطية: لا `/opt/saadstudio/backups` ولا `/var/backups/saadstudio` | غير مُنشأة. قاعدة البيانات خارجية (Neon) فالنسخ عبر مزودها | يحتاج قرارك |

## 3) الملفات المعدّلة (غير مُلتزَم بها)

`deploy-manager/main.cjs`, `renderer.js`, `index.html`, `server-audit.cjs`, `server-repair.cjs`, **جديد:** `github-secret.cjs`, `audit-fixes.test.cjs` · `deploy/deploy-release.example.sh` · **جديد:** `deploy/saaddeploy-sudoers.example` (مقترح فقط) · `.github/workflows/deploy.yml` · `.eslintrc.json` · هذا التقرير.
التعديلات المحلية السابقة (صفحات cinema/influencer/admin إلخ) لم تُمسّ.

## 4) نتائج الاختبارات

| الاختبار | النتيجة | الدليل |
|---|---|---|
| JS Syntax (`node --check` ×7 + تعديلاتي) | **PASS** | كل ملفات deploy-manager |
| Bash syntax (`bash -n` للسكربت الجديد) | **PASS** | |
| YAML للـ Workflow | **PASS** بعد الإصلاح / **FAIL** قبله (HEAD) | محلّل `yaml`: 0 أخطاء مقابل >100 |
| TypeScript `tsc --noEmit` | **PASS** | exit 0 |
| وحدات Deploy Manager (`node --test`: scrub، sealed-box حسب مواصفة libsodium، تحويل مفتاح OpenSSH يقبله ssh2، خطة الإصلاح بلا root/docker group، OAuth) | **PASS** 5/5 | |
| Electron IPC (تشغيل حقيقي، userData مؤقت) | **PASS** | 22 دالة في preload؛ `require/process` غير متاحة للـ Renderer؛ رُفض: action غير مسموح، ref ضار، rollback بغير SHA، خطوة إصلاح غير معروفة، رابط غير github.com، `contaboUser` ضار؛ CSP موجود؛ readiness انتهى في 1.6s |
| Electron مع إعدادات المستخدم الحقيقية (قراءة فقط) | **PASS** | readiness ok=true في 4s، `canRollback=true` |
| GitHub API | **PASS** | مصادقة، صلاحية push، Workflow، 4 Secrets في Production؛ الفرع الافتراضي `main` |
| SSH (بصمة مثبّتة، `saaddeploy`) | **PASS** | |
| HTTPS / Health API | **PASS** | 200، `ok:true`، DB 98ms، FFmpeg، تخزين |
| Docker readiness لـ `saaddeploy` | **FAIL (مقصود)** | permission denied — يعالجه sudoers المقترح |
| Deployment preflight (سكربت على السيرفر) | **FAIL** | غير موجود |
| Backup readiness | **FAIL** | لا مجلدات نسخ احتياطي |
| Rollback readiness | **BLOCKED** | لا سكربت على السيرفر ولا `current` ولا Releases |
| Vitest | **FAIL** | 49 فشل / 1015 نجاح (25 ملفاً من 133) — انظر §5 |
| ESLint (`next lint`) | **FAIL** | قبل الإصلاح 90 خطأ و322 تحذير؛ بعد إصلاح الإضافة تبقى أخطاء حقيقية (§5). لم يُعَد التشغيل الكامل بعد التعديل |
| Next.js Build | انظر الملحق أدناه | |
| اختبار نقر الواجهة (أزرار فعلية في نافذة Electron) | **UNVERIFIED** | لم أنقر الأزرار بصرياً؛ تحققت من ربط كل `$("id")` بعنصر موجود في HTML ومن IPC برمجياً. لا أزرار وهمية وُجدت بالفحص الآلي |

## 5) المشاكل المتبقية (خارج Deploy Manager — لم أعدّلها)

- **Vitest 49 فشل**: ~16 اختباراً يستورد `mapToWavespeedInput` من `app/api/video/route` وهو غير مُصدَّر (اختبارات قديمة مقابل Route)؛ والباقي فروقات تسعير (مثل 44.8 مقابل 22.4 — ضعف تماماً — و89.6 مقابل 3) في Seedance/Kling/Hailuo/TTS. **`verify` في الـ Workflow يشغّل `test:run`، لذا النشر سيتوقف هنا حتى تُصلح الاختبارات أو منطق التسعير.** لن أعدّل التسعير دون قرارك (حساس مالياً).
- **ESLint**: ~35 خطأ `react-hooks/rules-of-hooks` (Hooks بعد `return` مبكر) و25 `no-unescaped-entities` — أخطاء حقيقية في مكونات التطبيق.
- أي Run على GitHub يبني بـ `npm install --legacy-peer-deps` (غير `npm ci`) — غير حتمي.
- أي شخص يستطيع دفع Commit إلى المستودع ويشغّل Workflow يحصل عملياً على صلاحيات Docker/root على السيرفر عبر `docker build` (طبيعة النشر عبر CI). احمِ الفرع وبيئة Production بمراجعين مطلوبين.
- `STRIPE_API_KEY` ضمن "مفقود موصى به" في Health.
- `docker-compose.yml` ينشر المنفذ 3000 على الشبكة؛ المُشاهَد من `ss` أنه على `127.0.0.1` فقط (جيد).

## 6) التغييرات التي تحتاج موافقتك (لم تُنفَّذ)

1. **دمج/رفع التعديلات**: Commit + Push لـ `deploy.yml` المصلح (بدونه تبقى الـ Runs فاشلة). بما أن الفرع الافتراضي `main` لا يحتوي الـ Workflow، إمّا دمج `migration/contabo` في `main` أو إبقاء `releaseBranch=migration/contabo` (الحالي، ويعمل لأن Run #15 وُجد على هذا الفرع).
2. **على السيرفر (root)**: تثبيت السكربت: `install -o root -g root -m 0755 deploy-release /opt/saadstudio/bin/deploy-release` بعد مطابقة SHA-256، ثم ملف `deploy/saaddeploy-sudoers.example` → `/etc/sudoers.d/saaddeploy` مع `visudo -cf`. لا يمنح root عاماً ولا عضوية docker ولا حق استبدال السكربت.
3. إنشاء `/opt/saadstudio/backups` وسياسة نسخ (قاعدة Neon: PITR/تصدير من المزود).
4. قرار إصلاح الاختبارات الفاشلة الـ 49 (خصوصاً التسعير).
5. التحقق من وجود `/opt/saadstudio/.env.production` (فحص `backup-plan` في المعالج يغطيه؛ لم أشغّله لأنه لم يكن ضمن الفحص الشامل).

## 7) الخطوة التنفيذية التالية

1. راجع الفرق (`git diff`) ثم وافق على Commit.
2. وافق على خطوة السيرفر (§6.2) — أو اطلب مني توليد أمر التثبيت الدقيق مع SHA-256 للسكربت الحالي.
3. حدّد كيف نتعامل مع الاختبارات الفاشلة، ثم أول `deploy` تجريبي من الواجهة.

## ملحق: نتيجة Build
**`next build` → PASS (exit 0)**، 264 صفحة، مع تحذيرات فقط (autoprefixer في `composer.module.css`). **لم يظهر خطأ `EPERM: .next/server/app/.well-known`** في هذا التشغيل بحساب المستخدم الحالي؛ ACL المجلد يضم `SAAD\CodexSandboxUsers` (حساب Codex) — يرجّح أن الخطأ السابق يخص سياق ذلك الحساب. لم أغيّر أي صلاحيات ولم أحذف شيئاً. حالة السبب الجذري: **UNVERIFIED** (لم يُعاد إنتاج الخطأ).
ملاحظة: التشغيلات الطويلة السابقة لـ TypeScript لم تتعلق في بيئتي (انتهى `tsc` بنجاح)؛ بناء Vitest استغرق 316s (بيئة jsdom 203s) فاستخدم مهلات ≥ 300s.
