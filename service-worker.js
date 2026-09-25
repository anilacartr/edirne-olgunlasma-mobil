/* ===========================================================================
   SERVICE WORKER — Mobil (PWA) çevrimdışı destek + OTOMATİK GÜNCELLEME
   ---------------------------------------------------------------------------
   Masaüstü (Electron) sürümü bu dosyayı kullanmaz; orada güncelleme
   electron-updater ile yapılır. Bu dosya telefona "Ana ekrana ekle" ile
   kurulan sürüm içindir.

   GÜNCELLEME MANTIĞI
   • Uygulama kabuğu (index.html, app.js, styles.css, public-config.js)
     ÖNCE ÖNBELLEKTEN verilir, ardından arka planda ağdan tazelenir
     (stale-while-revalidate). Kabuk ~1,4 MB olduğu için eskiden her açılışta
     bu dosyalar ağdan bekleniyor ve mobilde uygulama saniyelerce boş
     kalıyordu; artık anında açılıyor.
   • Yeni sürümü kaçırmamayı service worker'ın kendi sürüm denetimi sağlar:
     tarayıcı service-worker.js'i her zaman ağdan doğrular, CACHE_VERSION
     değişince yeni kabuk indirilir ve sıraya alınır.
   • Sıradaki sürüm, uygulamanın BİR SONRAKİ AÇILIŞINDA kendiliğinden devreye
     girer. Oturum ortasında bulunursa kullanıcıya "yeni sürüm var" bandı
     gösterilir, onaylayınca SKIP_WAITING ile hemen geçilir.
   • CACHE_NAME değiştiğinde eski önbellekler silinir.
   Yeni sürüm yayınlarken CACHE_NAME içindeki sürüm numarasını artırın
   (build:web betiği bunu otomatik yapar).
   =========================================================================== */

const CACHE_VERSION = 'v2.9.6-202609251456';
const CACHE_NAME = 'edirne-olgunlasma-' + CACHE_VERSION;

// Kurulumda hemen önbelleğe alınacak çekirdek dosyalar.
// Ağır kütüphaneler (vendor/html2pdf, vendor/pptxgen) burada YOK: uygulama
// onları ilk kullanımda indiriyor, sonrasında aşağıdaki fetch stratejisi
// önbellekten veriyor.
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './tema-onyukleme.js',
  './public-config.js',
  './dogrula.html',
  './dogrula.js',
  './vendor/qrcode.js',
  './manifest.json',
  './favicon.svg',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // Tek bir dosya 404 verirse tüm kurulum çökmesin diye tek tek eklenir.
      // cache: 'reload' → tarayıcının HTTP önbelleğini atlayıp gerçekten
      // yeni dosyayı al. Aksi hâlde yeni sürüm eskisiyle doldurulabilir.
      .then((cache) => Promise.all(
        APP_SHELL.map((yol) => cache.add(new Request(yol, { cache: 'reload' })).catch((err) => {
          console.warn('[SW] Önbelleğe alınamadı:', yol, err);
        }))
      ))
  );
  // Bekleyen sürüm, kullanıcı onayı gelene kadar bekler (SKIP_WAITING mesajı).
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((adlar) => Promise.all(
        adlar.filter((ad) => ad !== CACHE_NAME).map((ad) => caches.delete(ad))
      ))
      .then(() => self.clients.claim())
  );
});

// Sayfa "hemen geç" derse bekleyen sürümü devreye al
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'GET_VERSION' && event.source) {
    event.source.postMessage({ type: 'VERSION', version: CACHE_VERSION });
  }
});

self.addEventListener('fetch', (event) => {
  const istek = event.request;
  if (istek.method !== 'GET') return;

  const url = new URL(istek.url);

  // Apps Script / Google istekleri hiç dokunulmadan geçer
  if (url.origin !== self.location.origin) return;
  // Yerel sunucunun API uçları önbelleklenmez
  if (url.pathname.startsWith('/api/')) return;

  // Ortak strateji: önbellekten ver, arka planda tazele.
  // Kabuk dosyaları (index.html, app.js, styles.css...) ~1,4 MB tuttuğu için
  // bunları ağdan beklemek açılışa saniyeler ekliyordu. Sürüm takibini
  // service-worker.js'in kendi güncelleme denetimi yapıyor; bu yüzden kabuğu
  // önbellekten vermek yeni sürümü kaçırmaya yol açmaz.
  const onbellektenVer = (yedekIndex) => caches.match(istek).then((onbellek) => {
    const agdan = fetch(istek).then((yanit) => {
      if (yanit && yanit.status === 200 && yanit.type === 'basic') {
        const kopya = yanit.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(istek, kopya));
      }
      return yanit;
    }).catch(() => onbellek || (yedekIndex ? caches.match('./index.html') : undefined));

    if (onbellek) {
      agdan.catch(() => {}); // tazeleme sessizce arka planda sürsün
      return onbellek;
    }
    return agdan;
  });

  // 1) Gezinme istekleri: önbellek yoksa ağ, o da yoksa uygulama kabuğu
  if (istek.mode === 'navigate') {
    event.respondWith(onbellektenVer(true));
    return;
  }

  // 2) Kabuk ve diğer yerel dosyalar
  event.respondWith(onbellektenVer(false));
});
