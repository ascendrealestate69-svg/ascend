# إعداد لوحة Ascend ونشرها

الموقع ثابت، لذلك لا يمكن حفظ التعديلات العامة بأمان من المتصفح وحده. يستخدم هذا المشروع Cloudflare Worker لحماية كلمة مرور الإدارة ومفتاح GitHub، ويستخدم Cloudflare D1 لحفظ طلبات العملاء بشكل خاص.

## المتطلبات

- حساب Cloudflare وNode.js مع npm.
- مستودع GitHub `ascendrealestate69-svg/ascend` والفرع `main`، أو تعديل قيم المستودع في `worker/wrangler.toml`.
- مفتاح GitHub Fine-grained مخصص لهذا المستودع فقط، بصلاحية `Contents: Read and write`. لا تضع المفتاح في ملفات الموقع أو ترسله في المحادثات.

## نشر خدمة الإدارة

1. من الطرفية، انتقل إلى مجلد `worker` وسجّل الدخول إلى Cloudflare:

   ```powershell
   cd worker
   npx wrangler login
   npx wrangler d1 create ascend-leads
   ```

2. انسخ `database_id` الذي يظهر في نتيجة الأمر إلى `database_id` في `wrangler.toml` بدل `REPLACE_WITH_D1_DATABASE_ID`.

3. أنشئ جدول الطلبات في قاعدة D1:

   ```powershell
   npx wrangler d1 migrations apply ascend-leads --remote
   ```

4. أضف المفتاح وكلمة مرور قوية كأسرار في Cloudflare. أدخل القيم في الطرفية عند الطلب فقط:

   ```powershell
   npx wrangler secret put GITHUB_TOKEN
   npx wrangler secret put ADMIN_PASSWORD
   ```

5. انشر الـ Worker:

   ```powershell
   npx wrangler deploy
   ```

   سيظهر عنوان خدمة ينتهي بـ `workers.dev`.

## ربط الموقع

ضع عنوان الـ Worker المنشور في `api-config.js`، مع إبقاء الشرطة المائلة الأخيرة اختيارية:

```js
window.ASCEND_API_URL = 'https://اسم-الخدمة.اسم-الحساب.workers.dev';
```

انشر ملفات الموقع مجددًا على GitHub Pages. تأكد أن عنوان الموقع الفعلي موجود في `ALLOWED_ORIGINS` داخل `worker/wrangler.toml`؛ القيم الافتراضية تسمح بالنطاقين `ascendrealestates.com` و`www.ascendrealestates.com` فقط. إذا كان الموقع يستخدم نطاقًا مختلفًا، حدّث القائمة ثم أعد نشر الـ Worker.

بعد اكتمال الإعداد، افتح `admin.html`، وسجّل الدخول بكلمة مرور `ADMIN_PASSWORD` التي أضفتها. إدارة العقارات والشعار تحفظ تغييراتها في ملفات المستودع، وطلبات العملاء تظهر في لوحة الإدارة وتُحفظ في D1، لا في مستودع عام.
