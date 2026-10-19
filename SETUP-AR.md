# إعداد لوحة Ascend ونشرها

الموقع ثابت، لذلك لا يمكن حفظ التعديلات العامة بأمان من المتصفح وحده. يستخدم هذا المشروع Cloudflare Worker لحماية كلمة مرور الإدارة ومفتاح GitHub، ويستخدم Cloudflare D1 لحفظ طلبات العملاء بشكل خاص.

## نشر خدمة الإدارة تلقائيًا من GitHub

لا تحتاج إلى نقل DNS أو استخدام Cloudflare لإدارة النطاق: النشر يستخدم عنوان `workers.dev`، بينما يبقى الموقع والدومين على GitHub Pages. أضفت workflow ينشئ قاعدة D1، يطبق migration، ينشر Worker، ثم يحدّث `api-config.js` تلقائيًا.

1. تحتاج إلى حساب Cloudflare، وCloudflare API Token يسمح بإدارة Workers وD1، وAccount ID من لوحة Cloudflare. كما تحتاج إلى GitHub Fine-grained token محدود بالمستودع `ascendrealestate69-svg/ascend` وصلاحية `Contents: Read and write`. لا ترسل هذه القيم في المحادثات.
2. من المستودع على GitHub، افتح **Settings → Secrets and variables → Actions → New repository secret**، وأضف الأسرار التالية:

   | الاسم | القيمة |
   | --- | --- |
   | `CLOUDFLARE_API_TOKEN` | Cloudflare API Token |
   | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID |
   | `ASCEND_CONTENTS_TOKEN` | GitHub Fine-grained token للمستودع |
   | `ASCEND_ADMIN_PASSWORD` | كلمة مرور إدارة قوية وفريدة |

3. شغّل workflow **Deploy admin API** من تبويب **Actions** باستخدام **Run workflow** على الفرع `main`.
4. بعد نجاح التشغيل، انتظر اكتمال نشر GitHub Pages، ثم افتح `https://ascendrealestates.com/admin.html`.

الـworkflow لا يقرأ الأسرار أو يطبعها في السجلات؛ تُخزَّن كلمة المرور ومفتاح المستودع كأسرار داخل Cloudflare Worker. تقيّد CORS الطلبات على نطاقي الموقع المحددين في `worker/wrangler.toml`.

بعد اكتمال الإعداد، افتح لوحة الإدارة وسجّل الدخول بكلمة المرور التي أضفتها. إدارة العقارات والشعار تحفظ تغييراتها في ملفات المستودع، وطلبات العملاء تظهر في اللوحة وتُحفظ في D1، لا في مستودع عام.
