/**
 * Edirne Olgunlaşma Enstitüsü Yönetim Sistemi - Frontend Controller (SPA)
 */

const DEFAULT_SHEET_URL = 'https://script.google.com/macros/s/AKfycbyBzhoIl714t9u_gJVXn0hjrLfR1gogihwkQ72-QLke7Zm3ach0_sTpGxvlwYpgWjFPqQ/exec';

// Global State
const STATE = {
  currentUser: null,
  selectedInventoryItem: null,
  selectedPhotoCardItem: null,
  motifs: {},
  sheetUrl: DEFAULT_SHEET_URL,
  magazaSheetUrl: '',
  literaturSheetUrl: '',
  photocardsSheetUrl: '',
  projeSheetUrl: '',
  mesajlarSheetUrl: '',
  // Apps Script erişim anahtarları (Ayarlar > Siber Güvenlik sekmesinden yönetilir)
  literaturToken: '',
  photocardsToken: '',
  mesajlarToken: '',
  envanterTableUrl: '',
  literaturTableUrl: '',
  magazaTableUrl: '',
  projeTableUrl: '',
  photocardsTableUrl: '',
  literaturFormUrl: 'https://docs.google.com/forms/d/e/1FAIpQLSc49ZWaO8quni5u2ZICXDF2QcBbo8gm3veim6jWkkAIQft3pg/viewform?usp=header',
  inventory: [],
  literature: [],
  photocards: [],
  egitim: [],
  materyaller: [],
  sertifikalar: [],
  prototipler: [],
  muzeKayitlari: [],
  muzeKoleksiyonlar: [],
  muzeAnahtarlar: [],
  tedarikciler: [],
  siparisler: [],
  users: [],
  logs: [],
  selectedPersonnel: null,
  activeView: 'envanter-view',
  isOffline: false,
  soundTheme: 'modern',
  soundVolume: 60,
  charts: {
    projeTime: null
  },
  personnel: [],
  selectedAtolye: null,
  appLogo: '',
  institutionLogo: '',
  messages: [],
  activeChatContact: 'ALL',
  presenceStore: {},
  // Mesajlaşma senkronizasyon durumu
  messagesRowCursor: 0,      // Sunucudaki en son okunan satır numarası
  messageIds: null,          // Set - tekilleştirme için, ilk merge'de kurulur
  messageOutbox: [],         // Gönderilemeyen mesajlar (bağlantı dönünce tekrar denenir)
  readOutbox: [],            // İletilemeyen "okundu" bildirimleri
  messagingBackoff: 0,       // Ardışık hata sayacı
  messagingFirstSyncDone: false,
  messagingUrlWarned: false,
  magaza: {
    stock: [],
    cash: [],
    expenses: [],
    needs: []
  },
  // E-Ticaret siparişleri mağaza e-tablosunda tutulur; listeler sunucudan gelir
  // ki durum/kanal adları tek yerden yönetilsin.
  // Dijital koruma kayıt defteri (PID, sağlama, sürüm, biçim riski)
  koruma: { kayitlar: [], ozet: null },
  // E-bülten: abone listesi ve gönderim kuyruğu (yalnızca yönetici)
  bulten: { aboneler: [], gonderimler: [], ozet: null, segmentler: [], durumlar: [], kota: null },
  // Veri ambarı / iş zekâsı panosu
  bi: { kpiler: [], kpiTanimlari: [], metrikler: [], boyutlar: [], seri: [], uyarilar: [],
        tarihAraligi: [], toplamOlcum: 0, arsiv: null },
  // Sıfır atık / kaynak takibi. Analiz sunucuda hesaplanır, burada saklanır.
  surdurulebilirlik: {
    kayitlar: [],
    analiz: null,
    faktorler: null,
    secenekler: null
  },
  eticaret: {
    siparisler: [],
    kanallar: [],
    odemeDurumlari: [],
    kargoFirmalari: [],
    kargoAyarlari: []
  }
};

// ==========================================================================
// 1.b SEKME VERİ ÖNBELLEĞİ (mobil hız katmanı)
// --------------------------------------------------------------------------
// Sorun: Her sekme geçişinde ilgili modül Apps Script'e yeniden gidiyordu.
// Apps Script bir POST'u 302 ile googleusercontent'e yönlendirdiği için tek
// istek bile mobil bağlantıda 3-6 sn sürüyor; bir sekmede iki-üç istek olunca
// bekleme 10 sn'yi geçiyordu. Bu katman üç iş yapar:
//
//   1. KALICI ÖNBELLEK — modül verisi localStorage'a yazılır, uygulama açılır
//      açılmaz STATE'e geri yüklenir. Sekme ilk dokunuşta dolu gelir.
//   2. TAZELİK SÜRESİ  — aynı veri TTL içinde tekrar istenmez; sekmeler
//      arasında gidip gelmek artık ağa hiç çıkmaz.
//   3. İSTEK TEKİLLEŞTİRME — aynı modül için eşzamanlı iki çağrı tek isteğe
//      iner.
//
// Yazma işlemlerinden sonra çağrılan sync'ler TTL'i bilmez (doğrudan çalışır);
// TTL yalnızca sekme açılışındaki arka plan tazelemesini kısar. Böylece kayıt
// ekleyip listeye dönen kullanıcı hep güncel veriyi görür.
// ==========================================================================

// Sekme açılışında arka plan tazelemesinin atlanacağı süre (ms).
const SEKME_TAZELIK_MS = 120000; // 2 dakika

// Modül anahtarı -> son başarılı çekim zamanı (ms)
const _modulDamga = {};
// Modül anahtarı -> localStorage'a yazılacak STATE alanları
const MODUL_ONBELLEK_HARITASI = {
  materyaller:       ['materyaller'],
  sertifikalar:      ['sertifikalar'],
  prototipler:       ['prototipler'],
  tedarik:           ['tedarikciler', 'siparisler'],
  muze:              ['muzeKayitlari', 'muzeKoleksiyonlar'],
  koruma:            ['koruma'],
  bulten:            ['bulten'],
  surdurulebilirlik: ['surdurulebilirlik'],
  eticaret:          ['eticaret']
};

const MODUL_ONBELLEK_ANAHTARI = 'eo_modul_cache_v1';
// Tek bir modülün önbelleğe yazılabilecek en büyük boyutu. localStorage
// kotasını (genelde 5 MB) doldurup diğer önbellekleri düşürmemek için.
const MODUL_ONBELLEK_SINIRI = 700000;

function _modulOnbellegiOku() {
  try {
    const ham = localStorage.getItem(MODUL_ONBELLEK_ANAHTARI);
    return ham ? JSON.parse(ham) : null;
  } catch (err) {
    console.warn('[Önbellek] Okunamadı:', err);
    return null;
  }
}

/**
 * Modül verisini kalıcı önbelleğe yazar ve tazelik damgasını günceller.
 * @param {string} anahtar MODUL_ONBELLEK_HARITASI içindeki anahtar
 */
function modulOnbellegeYaz(anahtar) {
  _modulDamga[anahtar] = Date.now();

  const alanlar = MODUL_ONBELLEK_HARITASI[anahtar];
  if (!alanlar) return;

  try {
    const kutu = _modulOnbellegiOku() || {};
    // Önbellek kullanıcıya bağlıdır: başka hesap açılırsa baştan kurulur.
    const kullanici = STATE.currentUser ? STATE.currentUser.username : '';
    if (kutu._kullanici !== kullanici) {
      for (const k of Object.keys(kutu)) delete kutu[k];
      kutu._kullanici = kullanici;
    }

    const veri = {};
    alanlar.forEach((alan) => { veri[alan] = STATE[alan]; });
    const metin = JSON.stringify(veri);
    if (metin.length > MODUL_ONBELLEK_SINIRI) {
      delete kutu[anahtar]; // Büyük veri saklanmaz; sekme yine ağdan dolar.
    } else {
      kutu[anahtar] = { zaman: _modulDamga[anahtar], veri: veri };
    }
    localStorage.setItem(MODUL_ONBELLEK_ANAHTARI, JSON.stringify(kutu));
  } catch (err) {
    // Kota dolduysa önbelleği bırakıp devam ediyoruz; işlevsellik etkilenmez.
    console.warn('[Önbellek] Yazılamadı (' + anahtar + '):', err);
  }
}

/**
 * Uygulama açılışında (girişten hemen sonra) kalıcı önbelleği STATE'e yükler.
 * Böylece ilk sekme dokunuşunda ekran boş kalmaz.
 */
function modulOnbelleginiYukle() {
  const kutu = _modulOnbellegiOku();
  if (!kutu) return;

  const kullanici = STATE.currentUser ? STATE.currentUser.username : '';
  if (kutu._kullanici !== kullanici) {
    try { localStorage.removeItem(MODUL_ONBELLEK_ANAHTARI); } catch (e) { /* yok say */ }
    return;
  }

  Object.keys(MODUL_ONBELLEK_HARITASI).forEach((anahtar) => {
    const girdi = kutu[anahtar];
    if (!girdi || !girdi.veri) return;
    MODUL_ONBELLEK_HARITASI[anahtar].forEach((alan) => {
      if (girdi.veri[alan] !== undefined && girdi.veri[alan] !== null) {
        STATE[alan] = girdi.veri[alan];
      }
    });
    // Damgayı geri yüklemiyoruz: açılıştan sonraki ilk ziyarette veri bir kez
    // ağdan tazelensin, sonraki geçişler TTL'e takılsın.
  });
}

/** Kullanıcı çıkış yaptığında modül önbelleğini temizler. */
function modulOnbelleginiTemizle() {
  Object.keys(_modulDamga).forEach((k) => delete _modulDamga[k]);
  Object.keys(_onbellekCizildi).forEach((k) => delete _onbellekCizildi[k]);
  try { localStorage.removeItem(MODUL_ONBELLEK_ANAHTARI); } catch (e) { /* yok say */ }
}

/**
 * Sekme açılışında kullanılan tazeleme kapısı.
 * Veri TTL içindeyse ağa hiç çıkılmaz; değilse verilen iş çalıştırılır.
 * @param {string} anahtar Modül anahtarı
 * @param {Function} calis Arka plan tazeleme işini yapan fonksiyon
 * @param {number} [ttl] Tazelik süresi (ms)
 */
function sekmeTazele(anahtar, calis, ttl) {
  const sure = typeof ttl === 'number' ? ttl : SEKME_TAZELIK_MS;
  const damga = _modulDamga[anahtar];
  if (damga && (Date.now() - damga) < sure) return Promise.resolve(null);
  try {
    return Promise.resolve(calis());
  } catch (err) {
    console.warn('[Önbellek] Tazeleme hatası (' + anahtar + '):', err);
    return Promise.resolve(null);
  }
}

// ==========================================================================
// 1.c AĞIR KÜTÜPHANELERİN İSTEK ÜZERİNE YÜKLENMESİ
// --------------------------------------------------------------------------
// html2pdf (≈900 KB) ve pptxgen (≈480 KB) index.html'de <script defer> ile
// yükleniyordu. defer betikleri DOMContentLoaded'dan ÖNCE çalışmak zorunda
// olduğu için uygulama, kullanıcı hiç PDF üretmeyecek olsa bile her açılışta
// 1,4 MB'ı indirip ayrıştırmayı bekliyordu — mobilde açılışa saniyeler
// ekleyen en büyük kalem buydu.
//
// Artık bu iki kütüphane yalnızca gerçekten kullanılacağı anda yüklenir;
// ayrıca uygulama açıldıktan sonra tarayıcı boşa çıktığında sessizce
// arka planda önden alınır, böylece "PDF indir" tıklaması da beklemez.
// ==========================================================================

const _kutuphaneIstekleri = {};

/** Bir betiği bir kez yükler; sonraki çağrılar aynı sözü döndürür. */
function kutuphaneYukle(yol) {
  if (_kutuphaneIstekleri[yol]) return _kutuphaneIstekleri[yol];
  _kutuphaneIstekleri[yol] = new Promise((coz, red) => {
    const el = document.createElement('script');
    el.src = yol;
    el.async = true;
    el.onload = () => coz(true);
    el.onerror = () => {
      delete _kutuphaneIstekleri[yol]; // Ağ dönerse tekrar denenebilsin
      red(new Error(yol + ' yüklenemedi'));
    };
    document.head.appendChild(el);
  });
  return _kutuphaneIstekleri[yol];
}

/**
 * PDF motorunu hazırlar. Hazırsa anında, değilse indirip döner.
 * @returns {Promise<boolean>} kullanılabilir mi
 */
async function pdfMotoruHazirla() {
  if (typeof window.html2pdf !== 'undefined') return true;
  try {
    await kutuphaneYukle('vendor/html2pdf.bundle.min.js');
    return typeof window.html2pdf !== 'undefined';
  } catch (err) {
    console.error('PDF motoru yüklenemedi:', err);
    showToast('PDF kütüphanesi yüklenemedi. İnternet bağlantınızı kontrol edip tekrar deneyin.', 'danger');
    return false;
  }
}

/** Sunum (PPTX) motorunu hazırlar. */
async function pptxMotoruHazirla() {
  if (typeof window.PptxGenJS !== 'undefined') return true;
  try {
    await kutuphaneYukle('vendor/pptxgen.bundle.js');
    return typeof window.PptxGenJS !== 'undefined';
  } catch (err) {
    console.error('Sunum motoru yüklenemedi:', err);
    showToast('Sunum kütüphanesi yüklenemedi. İnternet bağlantınızı kontrol edip tekrar deneyin.', 'danger');
    return false;
  }
}

/** Uygulama açılıp yerleştikten sonra ağır kütüphaneleri sessizce önden al. */
function agirKutuphaneleriOndenAl() {
  const al = () => {
    kutuphaneYukle('vendor/html2pdf.bundle.min.js').catch(() => {});
    kutuphaneYukle('vendor/pptxgen.bundle.js').catch(() => {});
  };
  // Açılış trafiğiyle yarışmasın diye birkaç saniye beklenir.
  setTimeout(() => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(al, { timeout: 10000 });
    else al();
  }, 4000);
}

// Önbellekten gelen veriyi sekmeye BİR KEZ çizmek için. Sonraki çizimleri
// zaten ilgili sync fonksiyonu yapıyor; her sekme geçişinde tabloyu yeniden
// kurmak gereksiz DOM maliyeti demek.
const _onbellekCizildi = {};
function onbellektenCiz(anahtar, ciz) {
  if (_onbellekCizildi[anahtar]) return;
  _onbellekCizildi[anahtar] = true;
  try {
    ciz();
  } catch (err) {
    console.warn('[Önbellek] İlk çizim başarısız (' + anahtar + '):', err);
  }
}

// Varsayılan Personel ve Atölye Veri Kümesi (E-Tablo bulunamadığında fallback olarak çalışır)
// GÜVENLİK: Telefon ve e-posta alanları BİLEREK boş bırakılmıştır.
// Bu liste yalnızca "Personel" e-tablosuna ulaşılamadığında devreye giren bir
// yedektir ve uygulamayla birlikte her bilgisayara dağıtılır. Önceden 28
// personelin gerçek cep telefonu ve kişisel e-posta adresi kurulum dosyasının
// içinden okunabiliyordu. Gerçek iletişim bilgileri yalnızca e-tablodan gelir.
const DEFAULT_PERSONNEL = [
  { "Görev Yıl": "2025", "Alan / Dal": "Tekstil Ve Moda Tasarım / Moda Tasarım", "Adı": "GÜLCAN", "Soyadı": "SAK", "Telefon": "", "e-Posta": "", "Göreve Başlama Tarihi": "11.09.2025", "Fotoğraf": "" },
  { "Görev Yıl": "2025", "Alan / Dal": "Seramik Ve Cam Teknolojisi / Çinicilik", "Adı": "SEÇİL ERSEV", "Soyadı": "ÇELİK", "Telefon": "", "e-Posta": "", "Göreve Başlama Tarihi": "11.09.2025", "Fotoğraf": "" },
  { "Görev Yıl": "2025", "Alan / Dal": "Sanat Ve Tasarım / Dekoratif Sanatlar", "Adı": "ÖZDEN", "Soyadı": "PEKCAN", "Telefon": "", "e-Posta": "", "Göreve Başlama Tarihi": "22.12.2025", "Fotoğraf": "" },
  { "Görev Yıl": "2025", "Alan / Dal": "Sanat Tarihi / Sanat Tarihi", "Adı": "BESTE", "Soyadı": "BULDURKİ", "Telefon": "", "e-Posta": "", "Göreve Başlama Tarihi": "15.09.2025", "Fotoğraf": "" },
  { "Görev Yıl": "2025", "Alan / Dal": "Sanat Tarihi / Sanat Tarihi", "Adı": "HASAT", "Soyadı": "AKGÜL", "Telefon": "", "e-Posta": "", "Göreve Başlama Tarihi": "15.09.2025", "Fotoğraf": "" },
  { "Görev Yıl": "2025", "Alan / Dal": "Görsel Sanatlar / Görsel Sanatlar", "Adı": "FATMA", "Soyadı": "NİŞ", "Telefon": "", "e-Posta": "", "Göreve Başlama Tarihi": "11.09.2025", "Fotoğraf": "" },
  { "Görev Yıl": "2025", "Alan / Dal": "Sanat Ve Tasarım / Dekoratif Sanatlar", "Adı": "BAHAR", "Soyadı": "GÖÇMEZ", "Telefon": "", "e-Posta": "", "Göreve Başlama Tarihi": "11.09.2025", "Fotoğraf": "" },
  { "Görev Yıl": "2025", "Alan / Dal": "El Sanatları Teknolojisi / El Ve Makine Nakışı", "Adı": "CEMİLE", "Soyadı": "KESKİN", "Telefon": "", "e-Posta": "", "Göreve Başlama Tarihi": "11.09.2025", "Fotoğraf": "" },
  { "Görev Yıl": "2025", "Alan / Dal": "El Sanatları Teknolojisi / El Ve Makine Nakışı", "Adı": "ŞERİFE", "Soyadı": "KOÇ", "Telefon": "", "e-Posta": "", "Göreve Başlama Tarihi": "11.09.2025", "Fotoğraf": "" },
  { "Görev Yıl": "2025", "Alan / Dal": "El Sanatları Teknolojisi / Dekoratif El Sanatları", "Adı": "ÖZLEM", "Soyadı": "DURMAZ", "Telefon": "", "e-Posta": "", "Göreve Başlama Tarihi": "11.09.2025", "Fotoğraf": "" },
  { "Görev Yıl": "2025", "Alan / Dal": "Oymacılık / Oymacılık", "Adı": "EMİRCAN", "Soyadı": "KARADERE", "Telefon": "", "e-Posta": "", "Göreve Başlama Tarihi": "23.03.2026", "Fotoğraf": "" },
  { "Görev Yıl": "2025", "Alan / Dal": "Moda Tasarım Teknolojileri / Kadın Terziliği", "Adı": "FİLİZ", "Soyadı": "KAYA EPECİK", "Telefon": "", "e-Posta": "", "Göreve Başlama Tarihi": "23.03.2026", "Fotoğraf": "" },
  { "Görev Yıl": "2025", "Alan / Dal": "El Sanatları Teknolojisi / Dekoratif El Sanatları", "Adı": "ASLI", "Soyadı": "GÜRE", "Telefon": "", "e-Posta": "", "Göreve Başlama Tarihi": "11.09.2025", "Fotoğraf": "" },
  { "Görev Yıl": "2025", "Alan / Dal": "El Sanatları Teknolojisi / El Dokuma", "Adı": "MERYEM", "Soyadı": "UZEL", "Telefon": "", "e-Posta": "", "Göreve Başlama Tarihi": "24.12.2025", "Fotoğraf": "" },
  { "Görev Yıl": "2025", "Alan / Dal": "Sanat Ve Tasarım / Dekoratif Sanatlar", "Adı": "NİLÜFER", "Soyadı": "EREN", "Telefon": "", "e-Posta": "", "Göreve Başlama Tarihi": "11.09.2025", "Fotoğraf": "" },
  { "Görev Yıl": "2025", "Alan / Dal": "El Sanatları Teknolojisi / El Ve Makine Nakışı", "Adı": "NERMİN", "Soyadı": "BAYRAK", "Telefon": "", "e-Posta": "", "Göreve Başlama Tarihi": "11.09.2025", "Fotoğraf": "" },
  { "Görev Yıl": "2025", "Alan / Dal": "Grafik Ve Fotoğraf / Fotoğraf", "Adı": "BURAK", "Soyadı": "GÜNDÜZ", "Telefon": "", "e-Posta": "", "Göreve Başlama Tarihi": "11.09.2025", "Fotoğraf": "" },
  { "Görev Yıl": "2025", "Alan / Dal": "El Sanatları Teknolojisi / El Ve Makine Nakışı", "Adı": "AYLİN REFİA", "Soyadı": "AKGÜN", "Telefon": "", "e-Posta": "", "Göreve Başlama Tarihi": "11.09.2025", "Fotoğraf": "" },
  { "Görev Yıl": "2025", "Alan / Dal": "El Sanatları Teknolojisi / Dekoratif El Sanatları", "Adı": "NURAY", "Soyadı": "ACAR", "Telefon": "", "e-Posta": "", "Göreve Başlama Tarihi": "23.03.2026", "Fotoğraf": "" },
  { "Görev Yıl": "2025", "Alan / Dal": "Sanat Ve Tasarım / Dekoratif Sanatlar", "Adı": "ŞEYDA", "Soyadı": "CANPOLAT", "Telefon": "", "e-Posta": "", "Göreve Başlama Tarihi": "11.09.2025", "Fotoğraf": "" },
  { "Görev Yıl": "2025", "Alan / Dal": "Sanat Ve Tasarım / Dekoratif Sanatlar", "Adı": "ARZU", "Soyadı": "MUDRİŞLER", "Telefon": "", "e-Posta": "", "Göreve Başlama Tarihi": "22.12.2025", "Fotoğraf": "" },
  { "Görev Yıl": "2025", "Alan / Dal": "El Sanatları Teknolojisi / El Dokuma", "Adı": "NERMİN", "Soyadı": "ACARSOY", "Telefon": "", "e-Posta": "", "Göreve Başlama Tarihi": "24.12.2025", "Fotoğraf": "" },
  { "Görev Yıl": "2025", "Alan / Dal": "Sanat Ve Tasarım / Dekoratif Sanatlar", "Adı": "FERSAN", "Soyadı": "ÖZTUNA", "Telefon": "", "e-Posta": "", "Göreve Başlama Tarihi": "11.09.2025", "Fotoğraf": "" },
  { "Görev Yıl": "2025", "Alan / Dal": "El Sanatları Teknolojisi / El Ve Makine Nakışı", "Adı": "ESRA", "Soyadı": "YAMAN", "Telefon": "", "e-Posta": "", "Göreve Başlama Tarihi": "23.03.2026", "Fotoğraf": "" },
  { "Görev Yıl": "2025", "Alan / Dal": "Görsel Sanatlar / Görsel Sanatlar", "Adı": "MERVE", "Soyadı": "YAZICI", "Telefon": "", "e-Posta": "", "Göreve Başlama Tarihi": "11.09.2025", "Fotoğraf": "" },
  { "Görev Yıl": "2025", "Alan / Dal": "İğne Oyası / İğne Oyası", "Adı": "MİNE", "Soyadı": "CAN", "Telefon": "", "e-Posta": "", "Göreve Başlama Tarihi": "11.09.2025", "Fotoğraf": "" },
  { "Görev Yıl": "2025", "Alan / Dal": "Grafik Ve Fotoğraf / Grafik", "Adı": "NURAN", "Soyadı": "TARLACI", "Telefon": "", "e-Posta": "", "Göreve Başlama Tarihi": "23.03.2026", "Fotoğraf": "" },
  { "Görev Yıl": "2025", "Alan / Dal": "Kuyumculuk/Takı Tasarımı", "Adı": "GAMZE", "Soyadı": "TÜRKOĞLU", "Telefon": "", "e-Posta": "", "Göreve Başlama Tarihi": "30.03.2026", "Fotoğraf": "" }
];

// ==========================================================================
// 1. Yardımcı Fonksiyonlar (Helpers)
// ==========================================================================

// SHA-256 Şifre Hashleme (Native Web Crypto API)
async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Hücre değerini esnek/fuzzy anahtar kelime eşleştirmesi ile getirme (Sütun adı küçük kaymalarını önler)
function getValueByFuzzyKey(obj, possibleKeys) {
  if (!obj) return '';
  const keys = Object.keys(obj);

  // 1. Aşama: Harf/Sayı dışındaki karakterleri temizleyip eşleştirme (Büyük/Küçük harf, boşluk duyarsız)
  for (const possibleKey of possibleKeys) {
    const pkNormalized = possibleKey.toLowerCase().replace(/[^a-z0-9ıışğüöç]/g, '');
    for (const key of keys) {
      const kNormalized = key.toLowerCase().replace(/[^a-z0-9ıışğüöç]/g, '');
      if (kNormalized === pkNormalized) {
        return obj[key];
      }
    }
  }

  // 2. Aşama: İçeriyor mu (includes) kontrolü
  for (const possibleKey of possibleKeys) {
    const pkNormalized = possibleKey.toLowerCase().replace(/[^a-z0-9ıışğüöç]/g, '');
    for (const key of keys) {
      const kNormalized = key.toLowerCase().replace(/[^a-z0-9ıışğüöç]/g, '');
      if (kNormalized.includes(pkNormalized) || pkNormalized.includes(kNormalized)) {
        return obj[key];
      }
    }
  }

  // 3. Aşama: Birebir eşleşme fallback
  for (const pk of possibleKeys) {
    if (obj[pk] !== undefined) return obj[pk];
  }

  return '';
}

// Form alan adını nesnedeki en yakın sütun adıyla eşleştirir (Fuzzy Matching)
function getActualKey(item, fieldName) {
  if (!item) return fieldName;
  const obj = item._original || item;
  const keys = Object.keys(obj);

  // Eşleştirme yapılacak olası anahtar kelime varyasyonları
  const variations = {
    'üretim başlangıç tarihi': ['üretim başlangıç tarihi', 'başlangıç tarihi', 'baslangic tarihi', 'üretim tarihi', 'tarih'],
    'üretim bitiş tarihi': ['üretim bitiş tarihi', 'bitiş tarihi', 'bitis tarihi', 'bitiş', 'bitis'],
    'ürün cinsi': ['ürün cinsi', 'cinsi', 'cins', 'ürün tipi', 'tipi'],
    'cinsi (kullanılan malzeme)': ['cinsi (kullanılan malzeme)', 'kullanılan malzeme', 'malzeme cinsi', 'malzeme'],
    'arşive eklendi / fiş tamam': ['arşive eklendi / fiş tamam', 'arşive eklendi/fiş tamam', 'durum', 'arşiv durumu', 'işlem durumu', 'onay durumu', 'arşive eklendi / fiş onayı', 'arşive eklendi / onaylandı'],
    'atölye': ['atölye', 'üretim yeri', 'grup-tip', 'grup', 'grup/tip', 'atolye'],
    'varsa ortak atölye ve kişi': ['varsa ortak atölye ve kişi', 'ortak atölye', 'ortak atölye ve kişi', 'ortak atolye ve kisi', 'ortak çalışan'],
    'kullanılan teknik': ['kullanılan teknik', 'teknik', 'türü-tekniği', 'türü tekniği', 'kullanilan teknik'],
    'kökeni (kaynak)': ['kökeni (kaynak)', 'kökeni', 'kökene', 'kaynak', 'kokeni (kaynak)', 'kokeni']
  };

  const fnLower = fieldName.toLowerCase().trim();
  const possibleKeys = variations[fnLower] || [fieldName];

  // 1. Aşama: Harf/Sayı dışındaki karakterleri temizleyip eşleştirme
  for (const pk of possibleKeys) {
    const pkNormalized = pk.toLowerCase().replace(/[^a-z0-9ıışğüöç]/g, '');
    for (const key of keys) {
      const kNormalized = key.toLowerCase().replace(/[^a-z0-9ıışğüöç]/g, '');
      if (kNormalized === pkNormalized) {
        return key;
      }
    }
  }

  // 2. Aşama: İçeriyor mu kontrolü
  for (const pk of possibleKeys) {
    const pkNormalized = pk.toLowerCase().replace(/[^a-z0-9ıışğüöç]/g, '');
    for (const key of keys) {
      const kNormalized = key.toLowerCase().replace(/[^a-z0-9ıışğüöç]/g, '');
      if (kNormalized.includes(pkNormalized) || pkNormalized.includes(kNormalized)) {
        return key;
      }
    }
  }

  // 3. Aşama: Birebir eşleşen veya orijinal alan adı
  for (const pk of possibleKeys) {
    if (obj[pk] !== undefined) return pk;
  }

  return fieldName;
}

// Mağaza stok kaydını standart anahtarlar içeren bir nesneye dönüştürür
function standardizeMagazaStockItem(item) {
  if (!item) return null;
  if (item._standardized) return item;

  // Find any key in the raw item that contains a http/https URL and has an empty or "link" header
  const rawObj = item._original || item;
  let detectedGorsel = '';
  Object.keys(rawObj).forEach(k => {
    const val = String(rawObj[k] || '').trim();
    if (val.startsWith('http') && (k === '' || k.toLowerCase().includes('görsel') || k.toLowerCase().includes('link') || k.toLowerCase().includes('resim'))) {
      detectedGorsel = val;
    }
  });

  return {
    _rowNum: item._rowNum,
    _original: item,
    _standardized: true,
    envanterNo: getValueByFuzzyKey(item, ['Envanter No', 'EnvanterNo', 'Envanter Numarası']),
    eserAdi: getValueByFuzzyKey(item, ['Eser Adı', 'EserAdi', 'Ürün Adı', 'ÜrünAdi', 'Adı', 'Adi']),
    olculeri: getValueByFuzzyKey(item, ['Ölçüleri', 'Ölçü', 'Olculeri']),
    tema: getValueByFuzzyKey(item, ['Tema', 'Temalar']),
    cins: getValueByFuzzyKey(item, ['Ürün Cinsi', 'Cinsi', 'Cins', 'Ürün Tipi', 'Atölye', 'Atolye', 'Hikayesi', 'Hikaye']),
    gorselLinki: detectedGorsel || getValueByFuzzyKey(item, ['Görsel Linki', 'Görsel', 'Ürün Görseli', 'Resim', 'Link', 'Ürün Görseli - 1']),
    satisFiyati: getValueByFuzzyKey(item, ['Satış Fiyatı', 'Fiyat', 'Satış Fiyatı (₺)', 'Satis Fiyati']),
    durum: getValueByFuzzyKey(item, ['Durum', 'Mağaza Durumu', 'Stok Durumu', 'Durumu']),
    eklenmeTarihi: getValueByFuzzyKey(item, ['Eklenme Tarihi', 'Tarih', 'Zaman damgası', 'Zaman'])
  };
}

// Envanter kaydını standart anahtarlar içeren bir nesneye dönüştürür (Hızlı erişim için)
function standardizeInventoryItem(item) {
  if (!item) return null;
  // Eğer zaten standardize edilmişse tekrar etme
  if (item._original) return item;

  return {
    _rowNum: item._rowNum,
    _original: item, // Orijinal halini kaydetmek için sakla
    envanterNo: getValueByFuzzyKey(item, ['Envanter No', 'EnvanterNo', 'Envanter Numarası']),
    eserAdi: getValueByFuzzyKey(item, ['Eser Adı', 'EserAdi', 'Eser Name', 'Ürün Adı']),
    personel: getValueByFuzzyKey(item, ['Giriş Yapan Personel', 'Personel', 'Ad Soyad', 'Usta Öğretici']),
    tema: getValueByFuzzyKey(item, ['Tema', 'Temalar']),
    cins: getValueByFuzzyKey(item, ['Ürün Cinsi', 'Cinsi', 'Cins', 'Ürün Tipi']),
    durum: getValueByFuzzyKey(item, ['Arşive Eklendi / Fiş Tamam', 'Arşive Eklendi/Fiş Tamam', 'Durum', 'Arşiv Durumu', 'İşlem Durumu', 'Onay Durumu', 'Arşive Eklendi / Fiş Onayı', 'Arşive Eklendi / Onaylandı']),
    atolye: getValueByFuzzyKey(item, ['Atölye', 'Üretim Yeri', 'Grup-Tip', 'Grup', 'Grup/Tip', 'atolye']),
    teknik: getValueByFuzzyKey(item, ['Kullanılan Teknik', 'Teknik', 'Türü-Tekniği', 'Türü Tekniği', 'kullanilan teknik']),
    malzeme: getValueByFuzzyKey(item, ['Cinsi (Kullanılan Malzeme)', 'Kullanılan Malzeme', 'Malzeme Cinsi', 'Malzeme']),
    tarihBaslangic: getValueByFuzzyKey(item, ['Üretim Başlangıç Tarihi', 'Başlangıç Tarihi', 'Baslangic Tarihi', 'Üretim Tarihi', 'Tarih']),
    tarihBitis: getValueByFuzzyKey(item, ['Üretim Bitiş Tarihi', 'Bitiş Tarihi', 'Bitis Tarihi', 'Bitiş', 'Bitis']),
    koken: getValueByFuzzyKey(item, ['Kökeni (Kaynak)', 'Kökeni', 'Kökene', 'Kaynak', 'kokeni (kaynak)', 'kokeni']),
    aciklama: getValueByFuzzyKey(item, ['Üretici Açıklaması', 'Açıklama', 'Uretici Aciklamasi']),
    hikaye: getValueByFuzzyKey(item, ['Hikaye', 'Öykü', 'Hikayesi']),
    ortak: getValueByFuzzyKey(item, ['Varsa Ortak Atölye Ve Kişi', 'Ortak Atölye', 'Ortak Atölye ve Kişi', 'ortak atolye ve kisi', 'ortak çalışan']),
    eposta: getValueByFuzzyKey(item, ['E-posta Adresi', 'Eposta Adresi', 'E-posta', 'Eposta']),
    stok: getValueByFuzzyKey(item, ['Stok Durumu', 'Stok']),
    olculeri: getValueByFuzzyKey(item, ['Ölçüleri', 'Ölçü']),
    timestamp: getValueByFuzzyKey(item, ['Zaman damgası', 'Zaman Damgasi', 'Tarih', 'Timestamp']),
    linkForm: getValueByFuzzyKey(item, ['Form Düzenleme Linki', 'Form Düzenleme']),
    linkImage: getValueByFuzzyKey(item, ['Ürün Görseli - 1', 'Ürün Görseli', 'Görsel', 'Görsel Linkleri']),
    linkInfo: getValueByFuzzyKey(item, ['Bilgi Fişi', 'Eser Fişi']),
    linkWeb: getValueByFuzzyKey(item, ['Web Görseli Linki', 'Web Görseli'])
  };
}

// Google Drive Linkinden Thumbnail Resim URL'si Üretme
// ==========================================================================
// GOOGLE DRIVE GÖRSELLERİ
// --------------------------------------------------------------------------
// Masaüstünde sayfa file:// kaynağından açılır ve Google'a hiç Referer
// göndermez; mobil sürüm ise https://...github.io kaynağından gönderir.
// Google, başka bir siteden bağlanan (hotlink) isteklere görsel vermediği için
// aynı adres masaüstünde çalışıp telefonda boş kalıyordu. İki önlem alındı:
//   1) Görsel etiketlerine referrerpolicy="no-referrer" eklendi.
//   2) Adres, yönlendirme ve çerez kullanmayan lh3.googleusercontent.com
//      üzerinden verilir; başarısız olursa eski drive.google.com adresine
//      otomatik dönülür (bkz. gorselAlternatifAdres).
// ==========================================================================
function driveDosyaId(driveUrl) {
  if (!driveUrl) return '';
  const urlStr = String(driveUrl).trim();
  if (urlStr.indexOf('drive.google.com') === -1 && urlStr.indexOf('docs.google.com') === -1) return '';
  const m = urlStr.match(/id=([a-zA-Z0-9_-]+)/)
    || urlStr.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)
    || urlStr.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return (m && m[1]) ? m[1] : '';
}

function getDriveThumbnailUrl(driveUrl) {
  const id = driveDosyaId(driveUrl);
  if (!id) return '';
  // 48px'lik küçük görsel, yüksek yoğunluklu telefon ekranlarında bulanık
  // kalmasın diye 160px istenir.
  return `https://lh3.googleusercontent.com/d/${id}=w160`;
}

// Bir Google görsel adresi yüklenemezse denenecek ikinci adres.
// İki uç nokta birbirinin yedeğidir; hangisi engellenirse diğeri denenir.
function gorselAlternatifAdres(src) {
  if (!src || typeof src !== 'string') return '';
  let m = src.match(/lh3\.googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)=w(\d+)/);
  if (m) return `https://drive.google.com/thumbnail?id=${m[1]}&sz=w${m[2]}`;
  m = src.match(/drive\.google\.com\/thumbnail\?id=([a-zA-Z0-9_-]+)&sz=w(\d+)/);
  if (m) return `https://lh3.googleusercontent.com/d/${m[1]}=w${m[2]}`;
  return '';
}

// Esnek yardımcı: birden fazla olası başlığı deneyen global getter
function getLitValueGlobal(item, candidates) {
  if (!item) return '';
  for (const c of candidates) {
    const cl = c.toLowerCase();
    for (const k of Object.keys(item)) {
      if (k === '_rowNum') continue;
      const kl = k.toLowerCase();
      if (kl === cl || kl.includes(cl) || cl.includes(kl)) {
        const val = item[k];
        if (val !== null && val !== undefined && String(val).trim() !== '') {
          return String(val);
        }
      }
    }
  }
  return '';
}

// Lokasyon metnini temizleyip standartlaştıran yardımcı fonksiyon
function getCleanedLocation(rawLocation, rawMaterial) {
  if (!rawLocation) return 'Lokasyon Belirtilmemiş';

  const text = String(rawLocation).trim();
  const words = text.split(/\s+/).filter(w => w.trim() !== '');
  if (words.length === 0) return 'Lokasyon Belirtilmemiş';

  // Türkçe karakterlere duyarlı normalizasyon
  const normalizedWords = words.map(w => w.toLocaleUpperCase('tr-TR'));

  // İlk kelime EDİRNE olmalı
  if (normalizedWords[0] !== 'EDİRNE') {
    return words.map(w => w.charAt(0).toLocaleUpperCase('tr-TR') + w.slice(1).toLocaleLowerCase('tr-TR')).join(' ');
  }

  const parts = ['Edirne'];

  // İkinci kelime ilçe (Keşan, Lalapaşa, Merkez, Uzunköprü)
  if (normalizedWords.length > 1) {
    const w2 = normalizedWords[1];
    let district = '';
    if (w2 === 'KEŞAN') district = 'Keşan';
    else if (w2 === 'LALAPAŞA') district = 'Lalapaşa';
    else if (w2 === 'MERKEZ') district = 'Merkez';
    else if (w2 === 'UZUNKÖPRÜ') district = 'Uzunköprü';

    if (district) {
      parts.push(district);
    } else {
      parts.push(words[1].charAt(0).toLocaleUpperCase('tr-TR') + words[1].slice(1).toLocaleLowerCase('tr-TR'));
    }
  }

  // Üçüncü kelime köy / mahalle (Babademirtaş, Budakdoğanca, Dilaverbey, Karaağaç, Meydan, Sar, Yeniimaret, Rızaefendi, Yeniköy)
  if (normalizedWords.length > 2) {
    const w3 = normalizedWords[2];
    let subLocation = '';

    if (w3.includes('BABADEMİRTAŞ')) {
      subLocation = 'Babademirtaş';
      if (w3.includes('MAHALLESİ') || w3.includes('MAHALLE')) {
        subLocation = 'Babademirtaş Mahallesi';
      }
    }
    else if (w3.includes('BUDAKDOĞANCA')) {
      subLocation = 'Budakdoğanca Köyü';
    }
    else if (w3 === 'DİLAVERBEY') {
      subLocation = 'Dilaverbey';
    }
    else if (w3 === 'KARAAĞAÇ') {
      subLocation = 'Karaağaç';
    }
    else if (w3 === 'MEYDAN') {
      subLocation = 'Meydan';
    }
    else if (w3 === 'SAR') {
      subLocation = 'Sar';
    }
    else if (w3 === 'YENİİMARET') {
      subLocation = 'Yeniimaret';
    }
    else if (w3 === 'RIZAEFENDİ') {
      subLocation = 'Rızaefendi';
    }
    else if (w3 === 'YENİKÖY') {
      subLocation = 'Yeniköy';
    }

    if (subLocation) {
      parts.push(subLocation);
    }
  }

  return parts.join(', ');
}

// Google Drive veya genel görsel URL'sini hızlı/direkt olarak çözen fonksiyon
function resolveImageUrl(item, size = 300) {
  if (!item) return '';
  const driveId = getLitValueGlobal(item, ['Drive Dosya ID', 'Dosya ID', 'File ID']);
  const driveLink = getLitValueGlobal(item, ['Orijinal Görsel Linki', 'Görsel Linki', 'Görsel Linkleri', 'Link', 'Drive Link', 'Arşiv Link']);

  if (driveId) {
    return `https://lh3.googleusercontent.com/d/${driveId}=w${size}`;
  }

  if (driveLink) {
    const urlStr = String(driveLink).trim();
    if (urlStr.startsWith('http')) {
      if (urlStr.includes('drive.google.com') || urlStr.includes('docs.google.com')) {
        const fileIdMatch = urlStr.match(/id=([a-zA-Z0-9_-]+)/) || urlStr.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || urlStr.match(/\/d\/([a-zA-Z0-9_-]+)/);
        if (fileIdMatch && fileIdMatch[1]) {
          return `https://lh3.googleusercontent.com/d/${fileIdMatch[1]}=w${size}`;
        }
      } else {
        return urlStr;
      }
    }
  }
  return '';
}


// Türkçe tarih formatı (DD.MM.YYYY HH:MM:SS) veya standart formatları ayrıştırır
function parseDateRobust(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) return d;

  const parts = String(dateStr).split(' ');
  if (parts.length > 0) {
    const dateParts = parts[0].split('.');
    if (dateParts.length === 3) {
      const day = parseInt(dateParts[0], 10);
      const month = parseInt(dateParts[1], 10) - 1;
      const year = parseInt(dateParts[2], 10);

      let hour = 0, min = 0, sec = 0;
      if (parts.length > 1) {
        const timeParts = parts[1].split(':');
        if (timeParts.length >= 2) {
          hour = parseInt(timeParts[0], 10);
          min = parseInt(timeParts[1], 10);
          if (timeParts.length > 2) {
            sec = parseInt(timeParts[2], 10);
          }
        }
      }
      const parsed = new Date(year, month, day, hour, min, sec);
      if (!isNaN(parsed.getTime())) return parsed;
    }
  }
  return null;
}

// Bir tarihin seçili tarih aralığında olup olmadığını doğrular
function isDateInRange(itemDateStr, startVal, endVal) {
  if (!itemDateStr) return false;
  const date = parseDateRobust(itemDateStr);
  if (!date) return false;

  const compareDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

  if (startVal) {
    const start = new Date(startVal);
    const startDate = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
    if (compareDate < startDate) return false;
  }
  if (endVal) {
    const end = new Date(endVal);
    const endDate = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
    if (compareDate > endDate) return false;
  }
  return true;
}

// Girdiyi geciktirmek için debounce yardımcı fonksiyonu (Arama performansını artırır)
function debounce(func, delay) {
  let timeoutId;
  return function (...args) {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      func.apply(this, args);
    }, delay);
  };
}

// Yükleme Göstergesi Kontrolü
function toggleLoading(show, text = 'Yükleniyor...') {
  const overlay = document.getElementById('loading-overlay');
  const textEl = document.getElementById('loading-text');
  if (show) {
    textEl.textContent = text;
    overlay.classList.remove('hidden');
  } else {
    overlay.classList.add('hidden');
  }
}

// Bildirim Seslerini Çalan Web Audio API Yardımcısı
function playNotificationSound(type = 'info') {
  if (STATE.soundTheme === 'muted') return;

  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const now = ctx.currentTime;
    const masterVolume = (STATE.soundVolume !== undefined ? STATE.soundVolume : 60) / 100;

    // Yardımcı fonksiyon: Filtrelenmiş ve pürüzsüz ses oluşturma
    function playTone(freq, startTime, duration, vol = 0.1, typeOsc = 'sine', freqRamp = null) {
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      osc.type = typeOsc;
      osc.frequency.setValueAtTime(freq, startTime);
      if (freqRamp) {
        osc.frequency.exponentialRampToValueAtTime(freqRamp, startTime + duration);
      }

      // Yumuşak sesler için alçak geçiren filtre (harş sesleri tıraşlar)
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1400, startTime);

      // Pürüzsüz ses zarfı (Click engellemek için hafif attack ve yumuşak decay)
      gainNode.gain.setValueAtTime(0, startTime);
      gainNode.gain.linearRampToValueAtTime(vol * masterVolume, startTime + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

      osc.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + duration + 0.05);
    }

    const theme = STATE.soundTheme || 'modern';

    if (theme === 'modern') {
      if (type === 'success') {
        // Modern & Dijital: A major chord arpeggio chime (warm and cozy)
        // A4 (440Hz), C#5 (554.37Hz), E5 (659.25Hz), A5 (880Hz)
        playTone(440.00, now, 0.8, 0.06, 'sine');
        playTone(554.37, now + 0.06, 0.7, 0.05, 'sine');
        playTone(659.25, now + 0.12, 0.6, 0.05, 'sine');
        playTone(880.00, now + 0.18, 0.8, 0.04, 'sine');
      } else if (type === 'danger' || type === 'error') {
        // Modern & Dijital: Soft minor third warning drop (A3 -> F3)
        playTone(220.00, now, 0.2, 0.08, 'triangle');
        playTone(174.61, now + 0.12, 0.35, 0.08, 'triangle');
      } else if (type === 'warning') {
        // Modern & Dijital: Fifth interval chime sweep
        playTone(392.00, now, 0.25, 0.06, 'sine');
        playTone(587.33, now + 0.06, 0.4, 0.05, 'sine');
      } else {
        // Modern & Dijital: Bubble pop / water drop UI click
        playTone(900, now, 0.08, 0.06, 'sine', 300);
        playTone(1500, now, 0.04, 0.04, 'sine', 700);
      }
    } else if (theme === 'classic') {
      if (type === 'success') {
        // Klasik Chimes: Ascending bell tones with longer decay
        playTone(1046.50, now, 0.6, 0.05, 'sine');
        playTone(1318.51, now + 0.08, 0.6, 0.04, 'sine');
        playTone(1567.98, now + 0.16, 0.8, 0.04, 'sine');
      } else if (type === 'danger' || type === 'error') {
        // Klasik Chimes: Dissonant dual bell alert
        playTone(493.88, now, 0.35, 0.07, 'sine'); // B4
        playTone(523.25, now + 0.1, 0.45, 0.07, 'sine'); // C5
      } else if (type === 'warning') {
        // Klasik Chimes: Bright dual bell alert
        playTone(880.00, now, 0.3, 0.06, 'sine'); // A5
        playTone(587.33, now + 0.1, 0.4, 0.06, 'sine'); // D5
      } else {
        // Klasik Chimes: Single clean chime drop
        playTone(1174.66, now, 0.4, 0.05, 'sine'); // D6
      }
    } else if (theme === 'minimalist') {
      if (type === 'success') {
        // Minimalist Tıklar: Double quick subtle tick
        playTone(1200, now, 0.03, 0.08, 'sine');
        playTone(1600, now + 0.04, 0.03, 0.07, 'sine');
      } else if (type === 'danger' || type === 'error') {
        // Minimalist Tıklar: Double low flat tick
        playTone(180, now, 0.06, 0.12, 'triangle', 120);
        playTone(180, now + 0.08, 0.06, 0.12, 'triangle', 120);
      } else if (type === 'warning') {
        // Minimalist Tıklar: Double mid-pitch tick
        playTone(450, now, 0.04, 0.09, 'sine', 350);
        playTone(450, now + 0.06, 0.04, 0.09, 'sine', 350);
      } else {
        // Minimalist Tıklar: Single woodblock micro tick
        playTone(1400, now, 0.02, 0.08, 'sine');
      }
    } else if (theme === 'retro') {
      if (type === 'success') {
        // Retro / 8-Bit: Mario-style coin arpeggio
        playTone(987.77, now, 0.08, 0.07, 'square');
        playTone(1318.51, now + 0.08, 0.25, 0.06, 'square');
      } else if (type === 'danger' || type === 'error') {
        // Retro / 8-Bit: Descending siren sweep
        playTone(600, now, 0.35, 0.08, 'sawtooth', 100);
      } else if (type === 'warning') {
        // Retro / 8-Bit: Fast laser warning blips
        playTone(800, now, 0.15, 0.08, 'triangle', 400);
        playTone(800, now + 0.12, 0.15, 0.08, 'triangle', 400);
      } else {
        // Retro / 8-Bit: Simple 8-bit blip
        playTone(523.25, now, 0.08, 0.07, 'triangle');
      }
    }

    // Context'i ses bittikten sonra kapatarak kaynak tüketimini önleyelim
    setTimeout(() => {
      try {
        ctx.close();
      } catch (e) { }
    }, 1500);

  } catch (err) {
    console.warn('Ses çalınamadı (kullanıcı etkileşimi bekleniyor olabilir):', err);
  }
}

// Toast Bildirimi Göster
function showToast(message, type = 'info') {
  playNotificationSound(type);
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<strong>Bildirim</strong><p>${message}</p>`;
  container.appendChild(toast);

  // 4 saniye sonra kaldır
  setTimeout(() => {
    toast.style.animation = 'slideIn 0.3s ease reverse forwards';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Harici URL Açma (Electron & PWA Uyumlu)
function openExternal(url) {
  if (!url || url.indexOf('http') !== 0) {
    showToast('Geçersiz bağlantı adresi!', 'warning');
    return;
  }
  if (window.api && window.api.isElectron) {
    window.api.openExternalUrl(url);
  } else {
    window.open(url, '_blank');
  }
}

// ==========================================================================
// GÜVENLİ GLOBAL OLAY İŞLEYİCİLERİ
// İçerik Güvenliği Politikası (CSP) satır içi kod çalıştırmayı engeller;
// bu yüzden HTML'e gömülü onclick="..." / onerror="..." işleyicileri
// yerine tek bir delege dinleyici kullanılır. Bu aynı zamanda e-tablodan
// gelen bir metnin işleyici içine kaçıp kod çalıştırmasını da imkânsız kılar.
// ==========================================================================
const IMG_FALLBACK_THUMB = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="#ccc"><text x="5" y="17" font-size="14">🖼️</text></svg>');
const IMG_FALLBACK_SMALL = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" fill="#666"><rect width="36" height="36" rx="4"/><text x="10" y="22" fill="#fff" font-size="14">🖼️</text></svg>');

// Ortak sunucu erişim anahtarı (yalnızca telefon/tablet gibi AĞ üzerinden
// bağlanan istemciler için gerekir; aynı bilgisayardan gelen istekler muaf).
// Kurulum: telefonda bir kez  http://<sunucu-ip>:3000/?token=ANAHTAR  açılır.
function apiTokenAl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const gelen = params.get('token');
    if (gelen) {
      localStorage.setItem('eo_api_token', gelen);
      // Anahtarı adres çubuğundan ve geçmişten temizle
      history.replaceState(null, '', window.location.pathname);
      return gelen;
    }
    return localStorage.getItem('eo_api_token') || '';
  } catch (e) {
    return '';
  }
}

function apiTokenBasliklari(ekstra) {
  const h = Object.assign({}, ekstra || {});
  const t = apiTokenAl();
  if (t) h['X-EO-Token'] = t;
  return h;
}


// ==========================================================================
// SİBER GÜVENLİK DEĞERLENDİRME MOTORU
// --------------------------------------------------------------------------
// Bulgular OWASP Top 10 (2021) ve CWE ile eşlenir, CVSS v3.1 taban puanına
// yakın bir ağırlıkla derecelendirilir.
//
// Denetimler YAN ETKİSİZDİR: veri okunmaz/yazılmaz, İşlem Geçmişi'ne kayıt
// düşmez. Yetkilendirmenin devrede olup olmadığını anlamak için scriptlere
// BİLİNMEYEN bir eylem gönderilir:
//   yetkilendirme açık  -> "Yetkilendirme başarısız"  (kapı çalışıyor)
//   yetkilendirme kapalı-> "Bilinmeyen eylem"          (kapı yok)
// ==========================================================================

const SIDDET = {
  KRITIK: { ad: 'KRİTİK', sira: 5, puan: 9.3, sinif: 'kritik' },
  YUKSEK: { ad: 'YÜKSEK', sira: 4, puan: 7.5, sinif: 'yuksek' },
  ORTA:   { ad: 'ORTA',   sira: 3, puan: 5.3, sinif: 'orta'   },
  DUSUK:  { ad: 'DÜŞÜK',  sira: 2, puan: 3.1, sinif: 'dusuk'  },
  BILGI:  { ad: 'BİLGİ',  sira: 1, puan: 0.0, sinif: 'bilgi'  },
  GECTI:  { ad: 'GEÇTİ',  sira: 0, puan: 0.0, sinif: 'gecti'  }
};

const KATEGORI = {
  KIMLIK:      'Kimlik Doğrulama ve Oturum',
  YETKI:       'Yetkilendirme ve Erişim Denetimi',
  SERTLESME:   'Uygulama Sertleştirme',
  TEDARIK:     'Tedarik Zinciri ve Yama Yönetimi',
  AG:          'Ağ ve Aktarım Güvenliği',
  VERI:        'Veri Koruma ve KVKK'
};

let _guvenlikTaramaCalisiyor = false;
let _sonRapor = null;

// Apps Script bazen JSON yerine HTML döndürür: dağıtım "Erişimi olanlar:
// Herkes" değilse Google bir oturum açma sayfası, script hata verirse bir hata
// sayfası basar. Eskiden bu durum ham ayrıştırıcı hatası olarak
// ("Unexpected token '<'") raporlanıyordu ve yöneticiye hiçbir şey anlatmıyordu.
// Artık HTML tanınıyor ve NE YAPILACAĞI yazılıyor.
function guvenlikYanitCoz(metin) {
  const ham = String(metin || '').trim();
  if (!ham) return { ok: false, kanit: 'Sunucu boş yanıt döndürdü.' };
  if (ham.charAt(0) === '<') {
    const girisSayfasi = /accounts\.google\.com|ServiceLogin|Sign in|Oturum aç/i.test(ham);
    return {
      ok: false,
      html: true,
      kanit: girisSayfasi
        ? 'Apps Script JSON yerine Google oturum açma sayfası döndürdü — dağıtım "Erişimi olanlar: Herkes" değil.'
        : 'Apps Script JSON yerine HTML döndürdü — URL yanlış/eski ya da script çalışırken hata veriyor.'
    };
  }
  try {
    return { ok: true, veri: JSON.parse(ham) };
  } catch (err) {
    return { ok: false, kanit: 'Yanıt JSON değil: ' + ham.slice(0, 80) };
  }
}

// --- Yan etkisiz sonda: yetkilendirme kapısı var mı? ---
async function guvenlikSonda(url, token) {
  if (!url) return { durum: 'yok' };
  try {
    const govde = { action: '__guvenlik_kontrolu__', payload: {} };
    if (token) govde.token = token;
    const res = await fetch(url, {
      method: 'POST', mode: 'cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(govde)
    });
    const c = guvenlikYanitCoz(await res.text());
    if (!c.ok) return { durum: 'gecersiz', kanit: c.kanit };
    const d = c.veri;
    const hata = String((d && d.error) || '');
    if (/yetkilendirme/i.test(hata)) return { durum: 'korumali', kanit: hata };
    if (/bilinmeyen/i.test(hata))    return { durum: 'korumasiz', kanit: hata };
    return { durum: 'belirsiz', kanit: hata || JSON.stringify(d).slice(0, 100) };
  } catch (err) {
    return { durum: 'ulasilamadi', kanit: err.message };
  }
}

// --- Ana script varsayılan kimlik bilgisini kabul ediyor mu? ---
async function guvenlikVarsayilanSifreKontrol() {
  if (!STATE.sheetUrl) return { durum: 'yok' };
  try {
    const ozet = await sha256('123456');
    const res = await fetch(STATE.sheetUrl, {
      method: 'POST', mode: 'cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: '__guvenlik_kontrolu__', payload: {},
        auth: { username: 'admin', passwordHash: ozet }
      })
    });
    const c = guvenlikYanitCoz(await res.text());
    if (!c.ok) return { durum: 'ulasilamadi', kanit: c.kanit };
    const d = c.veri;
    const hata = String((d && d.error) || '');
    if (/yetkilendirme/i.test(hata)) return { durum: 'guvenli', kanit: hata };
    if (/bilinmeyen/i.test(hata))    return { durum: 'acik', kanit: hata };
    return { durum: 'belirsiz', kanit: hata };
  } catch (err) {
    return { durum: 'ulasilamadi', kanit: err.message };
  }
}

// --- Kimlik doğrulama kapısı hiç yoksa? (auth göndermeden ayrıcalıklı istek) ---
async function guvenlikSunucuYamasiKontrol() {
  if (!STATE.sheetUrl) return { durum: 'yok' };
  try {
    // ~300 KB dolgu: güncel sürüm "çok büyük" der (256 KB sınırı), eski sürüm
    // gövdeyi kabul edip başka bir hata döndürür. Yan etkisiz: yazma yapılmaz,
    // bilinmeyen eylem + geçersiz kimlikle çağrılır.
    const dolgu = 'x'.repeat(300 * 1024);
    const res = await fetch(STATE.sheetUrl, {
      method: 'POST', mode: 'cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: '__guvenlik_yuk__', payload: { d: dolgu }, auth: null })
    });
    const c = guvenlikYanitCoz(await res.text());
    if (!c.ok) return { durum: 'ulasilamadi', kanit: c.kanit };
    const hata = String((c.veri && c.veri.error) || '');
    if (/çok büyük|cok buyuk/i.test(hata)) return { durum: 'korumali', kanit: hata };
    return { durum: 'korumasiz', kanit: hata || 'Büyük gövde reddedilmedi' };
  } catch (err) {
    return { durum: 'ulasilamadi', kanit: err.message };
  }
}

// --- Kaba kuvvet koruması gerçekten var mı? ---
// Sunucu, sayaç etkinken hatalı girişte "(Kalan deneme: N)" yazar; eski sürüm
// yalnızca "Geçersiz kullanıcı adı..." der. Bu farkı okumak için TEK bir
// başarısız giriş yeterlidir.
// GERÇEK BİR KULLANICI ADI DENENMEZ: var olmayan, rastgele bir ad kullanılır.
// Aksi halde denetimin kendisi bir personeli 15 dakika kilitlerdi.
async function guvenlikKabaKuvvetKontrol() {
  if (!STATE.sheetUrl) return { durum: 'yok' };
  try {
    const sahteKullanici = '__guvenlik_probu__' + Math.random().toString(36).slice(2, 10);
    const res = await fetch(STATE.sheetUrl, {
      method: 'POST', mode: 'cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'login',
        username: sahteKullanici,
        passwordHash: await sha256('guvenlik-denetimi-' + Date.now())
      })
    });
    const c = guvenlikYanitCoz(await res.text());
    if (!c.ok) return { durum: 'ulasilamadi', kanit: c.kanit };
    const hata = String((c.veri && c.veri.error) || '');
    if (/kalan deneme|kilitlendi|çok fazla hatalı/i.test(hata)) {
      return { durum: 'korumali', kanit: 'Sunucu deneme sayacı bildiriyor: "' + hata.slice(0, 70) + '"' };
    }
    if (/geçersiz kullanıcı/i.test(hata)) {
      return { durum: 'korumasiz', kanit: 'Hatalı girişte kalan deneme bildirilmedi: "' + hata.slice(0, 70) + '"' };
    }
    return { durum: 'belirsiz', kanit: hata.slice(0, 90) || 'Beklenmeyen yanıt' };
  } catch (err) {
    return { durum: 'ulasilamadi', kanit: err.message };
  }
}

async function guvenlikAuthKapisiKontrol() {
  if (!STATE.sheetUrl) return { durum: 'yok' };
  try {
    const res = await fetch(STATE.sheetUrl, {
      method: 'POST', mode: 'cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'get_all_data', payload: {}, auth: null })
    });
    const c = guvenlikYanitCoz(await res.text());
    if (!c.ok) return { durum: 'ulasilamadi', kanit: c.kanit };
    const d = c.veri;
    if (d && d.success === true) return { durum: 'acik', kanit: 'Kimlik bilgisi olmadan veri döndü' };
    return { durum: 'korumali', kanit: String(d && d.error || '').slice(0, 90) };
  } catch (err) {
    return { durum: 'ulasilamadi', kanit: err.message };
  }
}

// Apps Script arada bir geçici HTML hata sayfası döndürür ya da yönlendirmede isteği
// kaybeder. Tek bir başarısız sonda "yama yok" diye raporlanırsa denetim yanlış
// alarm üretir; kesin sonuç (korumali/korumasiz/acik/guvenli) alınana kadar sonda
// birkaç kez tekrarlanır.
async function guvenlikKesinSonuc(sonda, deneme = 3) {
  let sonuc;
  for (let i = 0; i < deneme; i++) {
    sonuc = await sonda();
    if (sonuc.durum !== 'ulasilamadi' && sonuc.durum !== 'belirsiz' && sonuc.durum !== 'gecersiz') return sonuc;
    await new Promise((coz) => setTimeout(coz, 1200 * (i + 1)));
  }
  return sonuc;
}

// ==========================================================================
// DENETİM
// ==========================================================================
async function guvenlikDenetimiCalistir() {
  if (_guvenlikTaramaCalisiyor) return;
  _guvenlikTaramaCalisiyor = true;

  const baslangic = Date.now();
  const liste = document.getElementById('guvenlik-liste');
  const btn = document.getElementById('btn-guvenlik-tara');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Denetleniyor...'; }
  if (liste) liste.innerHTML = '<div class="guvenlik-yukleniyor">Denetimler çalıştırılıyor...</div>';

  const B = [];
  let sayac = 0;
  // Sunucu yama durumunu bir kez sorgula; birden fazla bulgu bunu kullanır.
  const yamaSonda = await guvenlikKesinSonuc(guvenlikSunucuYamasiKontrol);
  const kk = await guvenlikKesinSonuc(guvenlikKabaKuvvetKontrol);
  // Deneme sayacı, gövde sınırı, formül temizleme ve tuzlu özetleme aynı sunucu
  // sürümüyle geldi. Sondalardan biri güncel sürümü kanıtlıyorsa diğerinin geçici
  // hatası "yama yok" sayılmaz. "Eski sürüm" kararı yalnızca olumsuz KANITLA verilir.
  const yama = (yamaSonda.durum !== 'korumali' && kk.durum === 'korumali')
    ? { durum: 'korumali', kanit: 'Deneme sayacı etkin (aynı sunucu sürümü): ' + kk.kanit }
    : yamaSonda;
  const yamaVar = yama.durum === 'korumali';
  const yamaYok = yama.durum === 'korumasiz';
  const yamaBelirsizMetin = 'Sunucu sürümü bu denetimde doğrulanamadı (' + (yama.kanit || yama.durum) +
    '). Bu bir açık kanıtı değildir; denetimi birkaç dakika sonra yeniden çalıştırın.';
  const ekle = (o) => {
    sayac++;
    B.push(Object.assign({
      id: 'EO-' + String(sayac).padStart(3, '0'),
      kategori: KATEGORI.SERTLESME,
      siddet: SIDDET.BILGI,
      owasp: '', cwe: '', kanit: '', oneri: ''
    }, o));
  };

  // ---------------- KİMLİK DOĞRULAMA ----------------
  const vs = await guvenlikKesinSonuc(guvenlikVarsayilanSifreKontrol);
  ekle({
    kategori: KATEGORI.KIMLIK, baslik: 'Varsayılan yönetici kimlik bilgisi',
    siddet: vs.durum === 'acik' ? SIDDET.KRITIK : (vs.durum === 'guvenli' ? SIDDET.GECTI : SIDDET.BILGI),
    owasp: 'A07:2021 Kimlik Doğrulama Hataları', cwe: 'CWE-1392',
    aciklama: vs.durum === 'acik'
      ? 'admin / 123456 hesabı hâlâ kabul ediliyor. Web uygulaması "Herkes" erişimine açık olduğundan, adresi bilen herkes tam yönetici olabilir.'
      : (vs.durum === 'guvenli' ? 'Kurulum sırasında oluşturulan varsayılan hesap reddediliyor.'
                                : 'Sonuç kesinleştirilemedi; denetimi yeniden çalıştırın.'),
    kanit: vs.kanit || vs.durum,
    oneri: vs.durum === 'acik' ? 'Kullanıcı Yönetimi ekranından admin şifresini en az 12 karakterlik benzersiz bir şifreyle değiştirin.' : ''
  });

  const ak = await guvenlikKesinSonuc(guvenlikAuthKapisiKontrol);
  ekle({
    kategori: KATEGORI.KIMLIK, baslik: 'Kimlik doğrulama zorunluluğu (ana veri servisi)',
    siddet: ak.durum === 'acik' ? SIDDET.KRITIK : (ak.durum === 'korumali' ? SIDDET.GECTI : SIDDET.BILGI),
    owasp: 'A01:2021 Bozuk Erişim Denetimi', cwe: 'CWE-306',
    aciklama: ak.durum === 'acik'
      ? 'Ana veri servisi kimlik bilgisi olmadan veri döndürüyor.'
      : (ak.durum === 'korumali' ? 'Kimlik bilgisi olmayan istekler reddediliyor.'
                                 : 'Sonuç kesinleştirilemedi; denetimi yeniden çalıştırın.'),
    kanit: ak.kanit || ak.durum,
    oneri: ak.durum === 'acik' ? 'Apps Script içindeki yetkilendirme kapısını geri yükleyin.' : ''
  });

  ekle({
    kategori: KATEGORI.KIMLIK, baslik: 'Şifre özetleme algoritması',
    siddet: yamaVar ? SIDDET.GECTI : (yamaYok ? SIDDET.YUKSEK : SIDDET.BILGI),
    owasp: 'A02:2021 Kriptografik Hatalar', cwe: 'CWE-916',
    aciklama: yamaVar
      ? 'Şifreler kullanıcı başına rastgele TUZ ve çok turlu özetleme ile saklanıyor; rainbow table ve aynı-şifre-aynı-özet zayıflıkları giderildi. Eski tuzsuz kayıtlar, kullanıcılar bir kez giriş yaptıkça otomatik olarak yeni formata yükseliyor (kademeli göç).'
      : (yamaYok
        ? 'Şifreler tuzsuz (salt) ve tek turlu SHA-256 ile özetleniyor. E-tablo ele geçirilirse şifreler sözlük saldırısıyla çözülebilir ve aynı şifreyi kullanan iki kişi aynı özeti üretir.'
        : yamaBelirsizMetin),
    kanit: yamaVar ? 'Tuzlu + çok turlu format (s2$...) aktif; kademeli göç'
      : (yamaYok ? 'Sunucu eski sürüm: tek tur SHA-256, tuz yok' : (yama.kanit || yama.durum)),
    oneri: yamaYok ? 'Güncel google-apps-script.js sürümünü dağıtın (tuzlu göç dahildir).' : ''
  });

  ekle({
    kategori: KATEGORI.KIMLIK, baslik: 'Kaba kuvvet / hız sınırlaması',
    siddet: kk.durum === 'korumasiz' ? SIDDET.ORTA : (kk.durum === 'korumali' ? SIDDET.GECTI : SIDDET.BILGI),
    owasp: 'A07:2021 Kimlik Doğrulama Hataları', cwe: 'CWE-307',
    aciklama: kk.durum === 'korumali'
      ? 'Başarısız girişler kullanıcı adı bazında sayılıyor; 5 hatadan sonra hesap 15 dakika kilitleniyor. Sayaç CacheService üzerinde tutulduğu için e-tabloya yazma maliyeti yok.'
      : (kk.durum === 'korumasiz'
        ? 'Giriş denemeleri için sayaç veya gecikme yok. Uç nokta herkese açık olduğundan otomatik şifre denemeleri sınırsız yapılabilir.'
        : 'Sonuç kesinleştirilemedi.'),
    kanit: kk.kanit || kk.durum,
    oneri: kk.durum === 'korumasiz'
      ? 'Güncel google-apps-script.js sürümünü dağıtın: başarısız denemeleri kullanıcı adı bazında sayıp 5 denemeden sonra 15 dakika kilit uygular.' : ''
  });

  // ---------------- YETKİLENDİRME ----------------
  const moduller = [
    { ad: 'Literatür',         url: STATE.literaturSheetUrl,  token: literaturTokenAl() },
    { ad: 'Fotoğraf Kartları', url: STATE.photocardsSheetUrl, token: photocardsTokenAl() },
    { ad: 'Mesajlaşma',        url: STATE.mesajlarSheetUrl,   token: mesajlarTokenAl() }
  ];
  for (const m of moduller) {
    if (!m.url) {
      ekle({ kategori: KATEGORI.YETKI, baslik: m.ad + ' servisi erişim denetimi',
        siddet: SIDDET.BILGI, aciklama: 'Bu modülün adresi tanımlı değil, denetlenmedi.' });
      continue;
    }
    const r = await guvenlikKesinSonuc(() => guvenlikSonda(m.url, ''));
    ekle({
      kategori: KATEGORI.YETKI, baslik: m.ad + ' servisi erişim denetimi',
      siddet: r.durum === 'korumasiz' ? SIDDET.KRITIK : (r.durum === 'korumali' ? SIDDET.GECTI : SIDDET.ORTA),
      owasp: 'A01:2021 Bozuk Erişim Denetimi', cwe: 'CWE-306',
      aciklama: r.durum === 'korumasiz'
        ? 'Erişim anahtarı doğrulaması KAPALI. Adresi bilen herkes bu modülün tüm verisini okuyabilir ve kayıt ekleyebilir.'
        : (r.durum === 'korumali' ? 'Anahtarsız istekler reddediliyor.' : 'Sonuç kesinleştirilemedi.'),
      kanit: r.kanit || r.durum,
      oneri: r.durum === 'korumasiz'
        ? 'Aşağıdaki "Erişim Anahtarları" bölümünden anahtar üretip kaydedin, AYNI değeri Apps Script dosyasındaki API_TOKEN satırına yazın ve scripti "Yeni sürüm" olarak dağıtın.' : ''
    });
  }

  const yonetici = guvenlikYoneticiMi();
  const maskeli = (() => {
    const el = document.getElementById('settings-script-url');
    return el ? (el.disabled || String(el.value).indexOf('•') === 0) : false;
  })();
  ekle({
    kategori: KATEGORI.YETKI, baslik: 'Yapılandırma sırlarının maskelenmesi',
    siddet: (yonetici || maskeli) ? SIDDET.GECTI : SIDDET.YUKSEK,
    owasp: 'A01:2021 Bozuk Erişim Denetimi', cwe: 'CWE-200',
    aciklama: yonetici
      ? 'Yönetici oturumundasınız; Apps Script adresleri görünür. Yönetici olmayan kullanıcılarda maskelenir.'
      : (maskeli ? 'Apps Script adresleri yönetici olmayan kullanıcılardan gizleniyor.'
                 : 'Adresler yönetici olmayan kullanıcılara açık görünüyor.'),
    kanit: 'settings-script-url alanı: ' + (maskeli ? 'maskeli/kilitli' : 'açık'),
    oneri: (yonetici || maskeli) ? '' : 'Uygulamayı güncelleyin.'
  });

  // ---------------- UYGULAMA SERTLEŞTİRME ----------------
  let g = null;
  if (window.api && window.api.isElectron && window.api.getSecurityInfo) {
    try { g = await window.api.getSecurityInfo(); } catch (e) { g = null; }
  }

  if (g) {
    const izole = g.sandbox && g.contextIsolation && !g.nodeIntegration;
    ekle({
      kategori: KATEGORI.SERTLESME, baslik: 'Arayüz süreci izolasyonu',
      siddet: izole ? SIDDET.GECTI : SIDDET.KRITIK,
      owasp: 'A05:2021 Güvenlik Yapılandırma Hatası', cwe: 'CWE-1188',
      aciklama: izole
        ? 'Kum havuzu, bağlam yalıtımı açık ve Node erişimi kapalı. Arayüzde bir kod çalıştırma açığı oluşsa bile işletim sistemine erişilemez.'
        : 'Arayüz süreci yeterince yalıtılmamış.',
      kanit: `sandbox=${g.sandbox} · contextIsolation=${g.contextIsolation} · nodeIntegration=${g.nodeIntegration}`,
      oneri: izole ? '' : 'Uygulamayı güncelleyin.'
    });

    ekle({
      kategori: KATEGORI.KIMLIK, baslik: 'Oturum bilgisinin diskte korunması',
      siddet: g.oturumSifreleme ? SIDDET.GECTI : SIDDET.ORTA,
      owasp: 'A02:2021 Kriptografik Hatalar', cwe: 'CWE-522',
      aciklama: g.oturumSifreleme
        ? 'Kayıtlı oturum işletim sistemi anahtarlığıyla şifreleniyor; yapılandırma dosyası kurcalanarak yetki yükseltilemiyor.'
        : 'İşletim sistemi anahtarlığı kullanılamıyor. Oturum diske yazılmıyor; her açılışta giriş gerekir.',
      kanit: 'safeStorage.isEncryptionAvailable() = ' + g.oturumSifreleme
    });

    // --- Tedarik zinciri: Electron yama durumu ---
    const d = g.destek || {};
    if (d.bilinmiyor) {
      ekle({
        kategori: KATEGORI.TEDARIK, baslik: 'Electron/Chromium yama durumu',
        siddet: SIDDET.BILGI,
        aciklama: 'Üretici destek takvimi sorgulanamadı (çevrimdışı olabilirsiniz).',
        kanit: 'Electron ' + g.electron + ' · Chromium ' + g.chrome
      });
    } else {
      ekle({
        kategori: KATEGORI.TEDARIK, baslik: 'Electron/Chromium yama durumu',
        siddet: d.destekleniyor ? SIDDET.GECTI : SIDDET.KRITIK,
        owasp: 'A06:2021 Güncelliğini Yitirmiş Bileşenler', cwe: 'CWE-1104',
        aciklama: d.destekleniyor
          ? 'Kullanılan Electron sürümü üretici desteği kapsamında; güvenlik yamaları alınıyor.'
          : `Kullanılan Electron sürümünün desteği ${d.destekSonu} tarihinde sona ermiş. O tarihten bu yana yayımlanan Chromium güvenlik yamaları uygulamaya girmiyor; tarayıcı motorunda bilinen açıklar açık kalıyor.`,
        kanit: `Electron ${g.electron} · Chromium ${g.chrome} · desteklenen sürümler: ${(d.destekli || []).join(', ')}`,
        oneri: d.destekleniyor ? '' :
          `Electron ${d.enSon || 'güncel sürüme'} yükseltilmeli. Bu, ana sürüm atlaması olduğu için ayrı bir yükseltme ve regresyon testi çalışması gerektirir.`
      });
    }

    ekle({
      kategori: KATEGORI.TEDARIK, baslik: 'Kod imzalama ve dağıtım bütünlüğü',
      siddet: g.kodImzali ? SIDDET.GECTI : SIDDET.ORTA,
      owasp: 'A08:2021 Yazılım ve Veri Bütünlüğü Hataları', cwe: 'CWE-347',
      aciklama: g.kodImzali
        ? 'Uygulama geçerli bir sertifikayla imzalanmış.'
        : 'Uygulama kod imzası taşımıyor (adhoc). Kurulum dosyasının yolda değiştirilmediği doğrulanamaz; Windows SmartScreen ve macOS Gatekeeper uyarı verir. macOS\'ta otomatik güncelleme de bu nedenle kullanılamıyor.',
      kanit: 'İmza: adhoc · TeamIdentifier: tanımsız',
      oneri: g.kodImzali ? '' : 'Windows için bir kod imzalama sertifikası, macOS için Apple Developer ID edinilmesi önerilir.'
    });

    ekle({
      kategori: KATEGORI.TEDARIK, baslik: 'Güncelleme kanalı',
      siddet: SIDDET.BILGI,
      aciklama: g.otomatikGuncelleme === 'tam'
        ? 'Güncellemeler HTTPS üzerinden alınıp SHA-512 özetiyle doğrulanarak kuruluyor.'
        : 'Bu platformda yalnızca yeni sürüm bildirimi gösteriliyor; kurulum elle yapılır.',
      kanit: 'Sürüm ' + g.surum + ' · kanal: ' + g.otomatikGuncelleme
    });
  } else {
    ekle({
      kategori: KATEGORI.SERTLESME, baslik: 'Arayüz süreci izolasyonu',
      siddet: SIDDET.BILGI,
      aciklama: 'Tarayıcı sürümünde çalışıyorsunuz; masaüstü izolasyon korumaları geçerli değil.'
    });
  }

  // --- CSP ---
  const cspMeta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
  const csp = cspMeta ? cspMeta.getAttribute('content') : '';
  const cspSaglam = /script-src\s+'self'/.test(csp) && !/script-src[^;]*unsafe-inline/.test(csp) && !/unsafe-eval/.test(csp);
  ekle({
    kategori: KATEGORI.SERTLESME, baslik: 'İçerik Güvenliği Politikası (CSP)',
    siddet: cspSaglam ? SIDDET.GECTI : (cspMeta ? SIDDET.ORTA : SIDDET.YUKSEK),
    owasp: 'A03:2021 Enjeksiyon', cwe: 'CWE-1021',
    aciklama: cspSaglam
      ? "script-src 'self' uygulanıyor; satır içi kod ve eval engelli. E-tablo verisinde bir XSS açığı kalsa bile uzak script yüklenemez."
      : (cspMeta ? 'CSP tanımlı ancak satır içi kod veya eval\'e izin veriyor.' : 'CSP tanımlı değil.'),
    kanit: csp ? csp.replace(/\s+/g, ' ').trim().slice(0, 120) + '…' : 'meta etiketi yok',
    oneri: cspSaglam ? '' : 'Uygulamayı güncelleyin.'
  });

  // --- Dış kaynaklı kod ---
  const uzak = Array.from(document.querySelectorAll('script[src]'))
    .filter(sc => /^https?:/i.test(sc.getAttribute('src') || ''));
  ekle({
    kategori: KATEGORI.TEDARIK, baslik: 'Dış kaynaklı kod (CDN bağımlılığı)',
    siddet: uzak.length === 0 ? SIDDET.GECTI : SIDDET.YUKSEK,
    owasp: 'A08:2021 Yazılım ve Veri Bütünlüğü Hataları', cwe: 'CWE-829',
    aciklama: uzak.length === 0
      ? 'Tüm kütüphaneler uygulamayla birlikte dağıtılıyor; CDN ele geçirilse bile uygulamaya kod giremez.'
      : uzak.length + ' adet script çalışma anında internetten yükleniyor.',
    kanit: uzak.length === 0 ? 'script[src^="http"] eşleşmesi: 0' : uzak.map(x => x.src).join(', ').slice(0, 120),
    oneri: uzak.length === 0 ? '' : 'Kütüphaneleri uygulama paketine dâhil edin.'
  });

  // ---------------- AĞ ----------------
  const adresler = [
    ['Ana Envanter', STATE.sheetUrl], ['Mağaza', STATE.magazaSheetUrl],
    ['Literatür', STATE.literaturSheetUrl], ['Fotoğraf Kartları', STATE.photocardsSheetUrl],
    ['Proje', STATE.projeSheetUrl], ['Mesajlaşma', STATE.mesajlarSheetUrl]
  ].filter(x => x[1]);
  const httpVar = adresler.filter(x => !/^https:/i.test(x[1]));
  ekle({
    kategori: KATEGORI.AG, baslik: 'Aktarım şifrelemesi (TLS)',
    siddet: httpVar.length === 0 ? SIDDET.GECTI : SIDDET.KRITIK,
    owasp: 'A02:2021 Kriptografik Hatalar', cwe: 'CWE-319',
    aciklama: httpVar.length === 0
      ? 'Tanımlı tüm servis adresleri HTTPS kullanıyor; kimlik bilgileri ve veriler şifreli aktarılıyor.'
      : httpVar.length + ' adres şifresiz HTTP kullanıyor.',
    kanit: adresler.length + ' adres denetlendi, ' + httpVar.length + ' tanesi şifresiz',
    oneri: httpVar.length === 0 ? '' : 'Bu adresleri HTTPS ile değiştirin: ' + httpVar.map(x => x[0]).join(', ')
  });

  let yerelDurum, yerelSiddet, yerelKanit;
  try {
    const r = await fetch('http://localhost:3000/api/config?_t=' + Date.now(), { cache: 'no-store' });
    if (r.status === 401) {
      yerelDurum = 'Çalışıyor ve erişim anahtarı istiyor.'; yerelSiddet = SIDDET.GECTI; yerelKanit = 'HTTP 401';
    } else {
      yerelDurum = 'Çalışıyor. Bu bilgisayardan anahtarsız erişilebilir (tasarım gereği). Ağ üzerinden erişim için server_token.txt gerekir.';
      yerelSiddet = SIDDET.BILGI; yerelKanit = 'HTTP ' + r.status;
    }
  } catch (err) {
    yerelDurum = 'Çalışmıyor. Telefon/tarayıcı paylaşımı kapalı olduğundan bu yönde saldırı yüzeyi yok.';
    yerelSiddet = SIDDET.GECTI; yerelKanit = 'bağlantı reddedildi';
  }
  ekle({
    kategori: KATEGORI.AG, baslik: 'Yerel paylaşım sunucusu maruziyeti',
    siddet: yerelSiddet, owasp: 'A05:2021 Güvenlik Yapılandırma Hatası', cwe: 'CWE-306',
    aciklama: yerelDurum, kanit: yerelKanit
  });

  // ---------------- ENJEKSİYON VE İSTEK GÜVENLİĞİ ----------------
  ekle({
    kategori: KATEGORI.SERTLESME, baslik: 'Sunucu tarafı güvenlik yaması (Apps Script)',
    siddet: yama.durum === 'korumali' ? SIDDET.GECTI : (yama.durum === 'korumasiz' ? SIDDET.YUKSEK : SIDDET.BILGI),
    owasp: 'A03:2021 Enjeksiyon', cwe: 'CWE-1284',
    aciklama: yama.durum === 'korumali'
      ? 'Ana veri servisi güncel güvenlik sürümünü çalıştırıyor: aşırı büyük istekler reddediliyor. Aynı sürümle formül/CSV enjeksiyonu temizleme ve kaba kuvvet kilidi de etkindir.'
      : (yama.durum === 'korumasiz'
          ? 'Ana veri servisi ESKİ kodu çalıştırıyor: 300 KB\'lık istek reddedilmedi. Formül enjeksiyonu temizleme, aşırı yük reddi ve kaba kuvvet kilidi henüz dağıtılmamış.'
          : 'Sonuç kesinleştirilemedi: ' + (yama.kanit || yama.durum)),
    kanit: yama.kanit || yama.durum,
    oneri: yama.durum === 'korumasiz'
      ? 'google-apps-script.js güncel sürümünü Ana, Mağaza ve Proje e-tablolarına yapıştırıp "Yeni sürüm" olarak dağıtın.' : ''
  });

  ekle({
    kategori: KATEGORI.VERI, baslik: 'Formül / CSV enjeksiyonu koruması',
    siddet: yamaVar ? SIDDET.GECTI : (yamaYok ? SIDDET.YUKSEK : SIDDET.BILGI),
    owasp: 'A03:2021 Enjeksiyon', cwe: 'CWE-1236',
    aciklama: yamaVar
      ? "E-tabloya yazılan =, +, -, @ ile başlayan değerler baş tırnakla metne zorlanıyor; =IMPORTXML / =IMAGE gibi veri sızdıran formüller çalışmaz."
      : (yamaYok
        ? 'Sunucu eski sürümü çalıştırıyor; kullanıcı girdisi e-tabloya temizlenmeden yazılıyor olabilir.'
        : yamaBelirsizMetin),
    kanit: yamaVar ? 'sanitizeCell() aktif' : (yamaYok ? 'Sunucu eski sürüm' : (yama.kanit || yama.durum)),
    oneri: yamaYok ? 'Sunucu güncel sürümünü dağıtın.' : ''
  });

  // ---------------- GOOGLE WORKSPACE (manuel denetim) ----------------
  ekle({
    kategori: KATEGORI.VERI, baslik: 'E-tablo doğrudan paylaşım ayarı',
    siddet: SIDDET.BILGI, owasp: 'A01:2021 Bozuk Erişim Denetimi', cwe: 'CWE-732',
    aciklama: 'Bu kontrol uygulamadan yapılamaz. Ana veri e-tablolarının "Bağlantıya sahip herkes" ile paylaşılmadığını Google Drive üzerinden DOĞRULAYIN. Aksi halde API atlanarak tüm veri (şifre özetleri dahil) doğrudan indirilebilir. Arayüzün çalışması için e-tablonun dışa açık olmasına GEREK YOKTUR; Web App "Ben olarak çalıştır" ile yetkilidir.',
    kanit: 'Manuel: Drive → e-tablo → Paylaş → "Kısıtlı" olmalı'
  });
  ekle({
    kategori: KATEGORI.VERI, baslik: 'Drive medya klasörü izinleri',
    siddet: SIDDET.BILGI, owasp: 'A01:2021 Bozuk Erişim Denetimi', cwe: 'CWE-552',
    aciklama: 'Eser görselleri ve bilgi fişlerinin tutulduğu Drive klasörünün izinlerini elle denetleyin. Tek tek dosyalar yerine tüm klasörün "Herkes" ile paylaşılması, envanter numarası tahmin edilerek tüm arşivin taranmasına yol açar.',
    kanit: 'Manuel: Drive klasör paylaşımı gözden geçirilmeli'
  });

  // ---------------- VERİ KORUMA ----------------
  const pii = (typeof DEFAULT_PERSONNEL !== 'undefined' ? DEFAULT_PERSONNEL : [])
    .filter(p => (p && (p['Telefon'] || p['e-Posta'])));
  ekle({
    kategori: KATEGORI.VERI, baslik: 'Uygulama paketinde kişisel veri',
    siddet: pii.length === 0 ? SIDDET.GECTI : SIDDET.YUKSEK,
    owasp: 'A01:2021 Bozuk Erişim Denetimi', cwe: 'CWE-359',
    aciklama: pii.length === 0
      ? 'Uygulama paketinde gömülü telefon veya e-posta bilgisi yok; iletişim bilgileri yalnızca e-tablodan geliyor.'
      : pii.length + ' personelin iletişim bilgisi uygulama paketine gömülü. Kurulum dosyasını eline geçiren herkes bu verilere ulaşabilir (KVKK m.12 veri güvenliği).',
    kanit: 'Yedek personel listesinde iletişim alanı taşıyan kayıt: ' + pii.length,
    oneri: pii.length === 0 ? '' : 'Uygulamayı güncelleyin.'
  });

  const rapor = {
    tarih: new Date().toISOString(),
    sureMs: Date.now() - baslangic,
    surum: (g && g.surum) || '-',
    bulgular: B
  };
  _sonRapor = rapor;
  guvenlikSonuclariniCiz(rapor);

  if (btn) { btn.disabled = false; btn.textContent = '🔄 Denetimi Yenile'; }
  _guvenlikTaramaCalisiyor = false;
}

// ==========================================================================
// RAPORLAMA
// ==========================================================================
function guvenlikSonuclariniCiz(rapor) {
  const liste = document.getElementById('guvenlik-liste');
  if (!liste) return;
  const B = rapor.bulgular;

  // Şiddete göre sırala, sonra kategoriye göre grupla
  const siraliKategoriler = Object.values(KATEGORI).filter(k => B.some(b => b.kategori === k));

  liste.innerHTML = siraliKategoriler.map(kat => {
    const grup = B.filter(b => b.kategori === kat).sort((a, b) => b.siddet.sira - a.siddet.sira);
    const acikSayi = grup.filter(b => b.siddet.sira >= 3).length;
    return `
      <div class="guvenlik-kategori">
        <div class="guvenlik-kategori-baslik">
          <span>${escapeHtml(kat)}</span>
          <span class="guvenlik-kategori-sayi">${grup.length} kontrol${acikSayi ? ` · ${acikSayi} bulgu` : ''}</span>
        </div>
        ${grup.map(b => `
          <div class="guvenlik-satir ${b.siddet.sinif}">
            <div class="guvenlik-satir-ust">
              <span class="guvenlik-id">${b.id}</span>
              <span class="guvenlik-baslik-metin">${escapeHtml(b.baslik)}</span>
              <span class="guvenlik-rozet ${b.siddet.sinif}">${b.siddet.ad}</span>
              ${b.siddet.puan > 0 ? `<span class="guvenlik-cvss">CVSS ${b.siddet.puan.toFixed(1)}</span>` : ''}
            </div>
            <div class="guvenlik-aciklama">${escapeHtml(b.aciklama)}</div>
            ${b.kanit ? `<div class="guvenlik-kanit"><span>KANIT</span><code>${escapeHtml(b.kanit)}</code></div>` : ''}
            ${b.oneri ? `<div class="guvenlik-oneri"><strong>Öneri:</strong> ${escapeHtml(b.oneri)}</div>` : ''}
            ${(b.owasp || b.cwe) ? `<div class="guvenlik-referans">
              ${b.owasp ? `<span class="guvenlik-etiket">${escapeHtml(b.owasp)}</span>` : ''}
              ${b.cwe ? `<span class="guvenlik-etiket">${escapeHtml(b.cwe)}</span>` : ''}
            </div>` : ''}
          </div>
        `).join('')}
      </div>
    `;
  }).join('');

  // --- Özet ---
  const say = (s) => B.filter(b => b.siddet.sinif === s).length;
  const kritik = say('kritik'), yuksek = say('yuksek'), orta = say('orta'),
        dusuk = say('dusuk'), gecti = say('gecti');

  // Ağırlıklı risk skoru: her bulgu şiddetine göre puan düşürür
  const ceza = kritik * 25 + yuksek * 12 + orta * 5 + dusuk * 2;
  const skor = Math.max(0, 100 - ceza);

  const skorEl = document.getElementById('guvenlik-skor');
  if (skorEl) {
    skorEl.textContent = skor;
    skorEl.className = 'guvenlik-skor ' + (skor >= 85 ? 'iyi' : (skor >= 60 ? 'orta' : 'kotu'));
  }

  const durusEl = document.getElementById('guvenlik-durus');
  if (durusEl) {
    const durus = kritik > 0 ? 'KRİTİK' : (yuksek > 0 ? 'YÜKSEK RİSK' : (orta > 0 ? 'ORTA RİSK' : 'DÜŞÜK RİSK'));
    durusEl.textContent = durus;
    durusEl.className = 'guvenlik-durus ' + (kritik > 0 ? 'kritik' : (yuksek > 0 ? 'yuksek' : (orta > 0 ? 'orta' : 'gecti')));
  }

  const sayaclar = document.getElementById('guvenlik-sayaclar');
  if (sayaclar) {
    const c = [];
    if (kritik) c.push(`<span class="guvenlik-sayac kritik">${kritik} Kritik</span>`);
    if (yuksek) c.push(`<span class="guvenlik-sayac yuksek">${yuksek} Yüksek</span>`);
    if (orta)   c.push(`<span class="guvenlik-sayac orta">${orta} Orta</span>`);
    if (dusuk)  c.push(`<span class="guvenlik-sayac dusuk">${dusuk} Düşük</span>`);
    c.push(`<span class="guvenlik-sayac gecti">${gecti} Geçti</span>`);
    sayaclar.innerHTML = c.join('');
  }

  const ozet = document.getElementById('guvenlik-ozet-metin');
  if (ozet) {
    ozet.textContent = kritik > 0
      ? `${kritik} kritik bulgu acil müdahale gerektiriyor. Bu bulgular kapatılmadan sistem yetkisiz erişime açıktır.`
      : (yuksek > 0 ? `Kritik bulgu yok. ${yuksek} yüksek öncelikli konu planlanmalı.`
      : (orta > 0 ? `Yüksek riskli bulgu yok; ${orta} orta seviye iyileştirme önerisi var.`
                  : 'Tüm kontroller başarılı. Sistem beklenen güvenlik seviyesinde.'));
  }

  const zaman = document.getElementById('guvenlik-son-tarama');
  if (zaman) {
    zaman.textContent = `${new Date(rapor.tarih).toLocaleString('tr-TR')} · ${B.length} kontrol · ${(rapor.sureMs / 1000).toFixed(1)} sn`;
  }
}

// Raporu panoya JSON olarak kopyala (denetim kaydı için)
// PDF için şiddet renkleri (beyaz zeminde okunur)
const GUVENLIK_PDF_RENK = {
  kritik: '#c0261f', yuksek: '#d65a00', orta: '#c78a00', dusuk: '#1565c0', bilgi: '#5b6472', gecti: '#1f7a34'
};

// Kurumsal, resmî siber güvenlik denetim raporunu PDF olarak üretir
async function guvenlikPdfRaporOlustur() {
  if (!_sonRapor) { showToast('Önce denetimi çalıştırın.', 'warning'); return; }
  // PDF motoru istek üzerine yüklenir (açılışı yavaşlatmasın diye).
  if (!(await pdfMotoruHazirla())) return;

  const R = _sonRapor;
  const B = R.bulgular;
  const esc = escapeHtml;
  const say = (s) => B.filter(b => b.siddet.sinif === s).length;
  const kritik = say('kritik'), yuksek = say('yuksek'), orta = say('orta'), dusuk = say('dusuk'), gecti = say('gecti');
  const ceza = kritik * 25 + yuksek * 12 + orta * 5 + dusuk * 2;
  const skor = Math.max(0, 100 - ceza);
  const durus = kritik > 0 ? 'KRİTİK' : (yuksek > 0 ? 'YÜKSEK RİSK' : (orta > 0 ? 'ORTA RİSK' : (dusuk > 0 ? 'DÜŞÜK RİSK' : 'DÜŞÜK RİSK')));
  const durusRenk = kritik > 0 ? GUVENLIK_PDF_RENK.kritik : (yuksek > 0 ? GUVENLIK_PDF_RENK.yuksek : (orta > 0 ? GUVENLIK_PDF_RENK.orta : GUVENLIK_PDF_RENK.gecti));

  const d = new Date(R.tarih);
  const tarihStr = d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' });
  const saatStr = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  const raporNo = 'SGD-' + d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '-' +
    String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');

  // Yönetici özeti değerlendirme metni
  let degerlendirme;
  if (kritik > 0) {
    degerlendirme = `Yürütülen denetimde <b>${kritik} adet kritik</b> bulgu tespit edilmiştir. Bu bulgular, ` +
      `sistemin yetkisiz erişime açık olduğu anlamına gelmekte olup, aşağıda belirtilen önerilerin ` +
      `<b>ivedilikle</b> uygulanması gerekmektedir. Kritik bulgular giderilene kadar sistemin risk altında olduğu değerlendirilmektedir.`;
  } else if (yuksek > 0) {
    degerlendirme = `Denetimde kritik seviyede bir bulguya rastlanmamıştır. Ancak <b>${yuksek} adet yüksek öncelikli</b> ` +
      `konu bulunmakta olup, bunların planlı bir şekilde giderilmesi tavsiye edilir. Sistemin genel güvenlik duruşu kabul edilebilir seviyededir.`;
  } else if (orta > 0 || dusuk > 0) {
    degerlendirme = `Denetimde kritik veya yüksek öncelikli bir bulguya rastlanmamıştır. Tespit edilen ` +
      `${orta + dusuk} adet orta/düşük seviye iyileştirme önerisi, sistemin güvenlik olgunluğunu artırmaya yöneliktir. ` +
      `Sistemin güvenlik duruşu iyi seviyededir.`;
  } else {
    degerlendirme = `Yürütülen tüm güvenlik kontrolleri başarıyla geçilmiştir. Sistem, beklenen güvenlik ` +
      `seviyesinde çalışmakta olup, bilinen bir güvenlik açığı tespit edilmemiştir.`;
  }

  // Güçlü yönler (GEÇTİ bulgular)
  const gectiler = B.filter(b => b.siddet.sinif === 'gecti');
  const gugluHtml = gectiler.length
    ? '<ul class="sg-strong-list">' + gectiler.map(b =>
        `<li><span class="sg-check">✓</span> <b>${esc(b.baslik)}</b> — ${esc(b.aciklama)}</li>`).join('') + '</ul>'
    : '<p class="sg-muted">Bu denetimde başarıyla geçen bir kontrol kaydedilmemiştir.</p>';

  // Bulgular (GEÇTİ hariç), şiddete göre sıralı
  const bulgular = B.filter(b => b.siddet.sinif !== 'gecti')
    .sort((a, b) => b.siddet.sira - a.siddet.sira);
  const bulguHtml = bulgular.length
    ? bulgular.map((b, i) => {
        const renk = GUVENLIK_PDF_RENK[b.siddet.sinif] || '#5b6472';
        return `<div class="sg-finding" style="border-left-color:${renk};">
          <div class="sg-finding-head">
            <span class="sg-finding-id">${b.id}</span>
            <span class="sg-finding-title">${esc(b.baslik)}</span>
            <span class="sg-badge" style="background:${renk};">${b.siddet.ad}${b.siddet.puan ? ' · CVSS ' + b.siddet.puan.toFixed(1) : ''}</span>
          </div>
          <div class="sg-finding-cat">${esc(b.kategori)}${b.owasp ? ' &nbsp;•&nbsp; ' + esc(b.owasp) : ''}${b.cwe ? ' &nbsp;•&nbsp; ' + esc(b.cwe) : ''}</div>
          <div class="sg-finding-desc">${esc(b.aciklama)}</div>
          ${b.kanit ? `<div class="sg-finding-evi"><b>Kanıt:</b> <code>${esc(b.kanit)}</code></div>` : ''}
          ${b.oneri ? `<div class="sg-finding-rec"><b>Öneri:</b> ${esc(b.oneri)}</div>` : ''}
        </div>`;
      }).join('')
    : '<p class="sg-muted">Giderilmesi gereken bir bulgu tespit edilmemiştir.</p>';

  const kapsam = 'Masaüstü uygulaması (Electron), Google Apps Script veri servisleri, kimlik doğrulama ve ' +
    'yetkilendirme katmanı, ağ/aktarım güvenliği, veri koruma (KVKK) ve tedarik zinciri.';

  const html = `
    <div class="sg-report">
      <div class="sg-header">
        <div class="sg-org">EDİRNE OLGUNLAŞMA ENSTİTÜSÜ</div>
        <div class="sg-sub">Bilgi İşlem ve Yönetim Sistemi</div>
        <div class="sg-title">SİBER GÜVENLİK DENETİM RAPORU</div>
      </div>

      <table class="sg-meta">
        <tr><td class="l">Rapor No</td><td class="v">${raporNo}</td><td class="l">Rapor Tarihi</td><td class="v">${tarihStr}, ${saatStr}</td></tr>
        <tr><td class="l">Uygulama Sürümü</td><td class="v">${esc(String(R.surum))}</td><td class="l">Kontrol Sayısı</td><td class="v">${B.length}</td></tr>
        <tr><td class="l">Denetim Süresi</td><td class="v">${(R.sureMs / 1000).toFixed(1)} saniye</td><td class="l">Belge Türü</td><td class="v">Gizli / Kuruma Özel</td></tr>
      </table>

      <div class="sg-sec">1. YÖNETİCİ ÖZETİ</div>
      <div class="sg-summary">
        <div class="sg-score" style="border-color:${durusRenk};">
          <div class="sg-score-num" style="color:${durusRenk};">${skor}</div>
          <div class="sg-score-lbl">GÜVENLİK SKORU</div>
          <div class="sg-score-durus" style="background:${durusRenk};">${durus}</div>
        </div>
        <div class="sg-summary-text">
          <p>${degerlendirme}</p>
          <div class="sg-dist">
            <span class="sg-pill" style="background:${GUVENLIK_PDF_RENK.kritik};">Kritik: ${kritik}</span>
            <span class="sg-pill" style="background:${GUVENLIK_PDF_RENK.yuksek};">Yüksek: ${yuksek}</span>
            <span class="sg-pill" style="background:${GUVENLIK_PDF_RENK.orta};">Orta: ${orta}</span>
            <span class="sg-pill" style="background:${GUVENLIK_PDF_RENK.dusuk};">Düşük: ${dusuk}</span>
            <span class="sg-pill" style="background:${GUVENLIK_PDF_RENK.gecti};">Geçti: ${gecti}</span>
          </div>
        </div>
      </div>

      <div class="sg-sec">2. GÜÇLÜ YÖNLER (SAĞLAM NOKTALAR)</div>
      <p class="sg-intro">Aşağıdaki güvenlik kontrolleri denetimde <b>başarıyla</b> karşılanmıştır. Bu alanlar, sistemin savunma açısından güçlü ve doğru yapılandırılmış yönlerini temsil eder.</p>
      ${gugluHtml}

      <div class="sg-sec">3. TESPİT EDİLEN BULGULAR VE ÖNERİLER</div>
      <p class="sg-intro">Aşağıda, önem derecesine göre sıralanmış bulgular ve her biri için önerilen düzeltici işlemler yer almaktadır. Bulgular OWASP Top 10 (2021) ve CWE sınıflandırmasıyla eşlenmiştir.</p>
      ${bulguHtml}

      <div class="sg-sec">4. YÖNTEM VE KAPSAM</div>
      <table class="sg-meta">
        <tr><td class="l">Kapsam</td><td class="v" colspan="3">${kapsam}</td></tr>
        <tr><td class="l">Yöntem</td><td class="v" colspan="3">Otomatik, canlı ve yan etkisiz kontroller. Denetim sırasında hiçbir veri okunmamış, değiştirilmemiş veya işlem geçmişine kayıt düşülmemiştir.</td></tr>
        <tr><td class="l">Referanslar</td><td class="v" colspan="3">OWASP Top 10 (2021), CWE, CVSS v3.1 taban puanı</td></tr>
      </table>

      <div class="sg-sec">5. SONUÇ VE TAVSİYE</div>
      <p class="sg-intro">${kritik > 0
        ? 'Kritik bulguların ivedilikle giderilmesi, ardından denetimin yenilenerek doğrulanması tavsiye edilir.'
        : (yuksek > 0
          ? 'Yüksek öncelikli konuların planlı biçimde giderilmesi ve düzenli aralıklarla denetimin tekrarlanması tavsiye edilir.'
          : 'Mevcut güvenlik seviyesinin korunması ve denetimin düzenli aralıklarla (önerilen: 3 ayda bir) tekrarlanması tavsiye edilir.')}
        Bu rapor, denetim anındaki durumu yansıtır; yapılandırma değişikliklerinin ardından yeniden çalıştırılmalıdır.</p>

      <div class="sg-sign">
        <div class="sg-sign-block">
          <div class="sg-sign-role">Hazırlayan</div>
          <div class="sg-sign-line"></div>
          <div class="sg-sign-name">Bilgi İşlem Birimi</div>
        </div>
        <div class="sg-sign-block">
          <div class="sg-sign-role">Onaylayan</div>
          <div class="sg-sign-line"></div>
          <div class="sg-sign-name">Kurum Müdürü</div>
        </div>
      </div>

      <div class="sg-foot">Bu belge Edirne Olgunlaşma Enstitüsü Yönetim Sistemi tarafından otomatik olarak üretilmiştir. Gizli / Kuruma Özeldir. &copy; ${d.getFullYear()} Edirne Olgunlaşma Enstitüsü.</div>
    </div>
  `;

  const container = document.createElement('div');
  container.style.width = '700px';
  container.style.background = '#ffffff';
  const style = document.createElement('style');
  style.textContent = `
    .sg-report { font-family: 'Inter', Arial, sans-serif; color: #1a1a1a; padding: 8px 4px; }
    .sg-header { text-align: center; border-bottom: 3px solid #4b1478; padding-bottom: 14px; margin-bottom: 4px; }
    .sg-org { font-size: 19px; font-weight: 800; color: #4b1478; letter-spacing: 1px; }
    .sg-sub { font-size: 12px; color: #666; margin-top: 2px; letter-spacing: 2px; text-transform: uppercase; }
    .sg-title { font-size: 15px; font-weight: 700; color: #1a1a1a; margin-top: 12px; padding-top: 10px; border-top: 1px solid #d4af37; letter-spacing: 1px; }
    .sg-meta { width: 100%; border-collapse: collapse; margin: 18px 0; font-size: 11.5px; }
    .sg-meta td { padding: 7px 9px; border: 1px solid #e6e6ee; }
    .sg-meta td.l { background: #f5f3f9; font-weight: 700; color: #555; width: 16%; }
    .sg-meta td.v { color: #1a1a1a; }
    .sg-sec { font-size: 13px; font-weight: 800; color: #4b1478; text-transform: uppercase; letter-spacing: 0.5px; margin: 26px 0 10px; padding-bottom: 5px; border-bottom: 2px solid #d4af37; }
    .sg-intro { font-size: 11.5px; color: #444; line-height: 1.6; margin: 0 0 12px; }
    .sg-muted { font-size: 11.5px; color: #888; font-style: italic; }
    .sg-summary { display: flex; gap: 18px; align-items: stretch; }
    .sg-score { flex-shrink: 0; width: 130px; text-align: center; border: 2px solid; border-radius: 10px; padding: 14px 8px; }
    .sg-score-num { font-size: 40px; font-weight: 800; line-height: 1; }
    .sg-score-lbl { font-size: 8.5px; font-weight: 700; color: #777; letter-spacing: 0.5px; margin-top: 4px; }
    .sg-score-durus { color: #fff; font-size: 10px; font-weight: 800; padding: 3px 8px; border-radius: 5px; display: inline-block; margin-top: 8px; }
    .sg-summary-text { flex: 1; }
    .sg-summary-text p { font-size: 11.5px; line-height: 1.65; color: #333; margin: 0 0 12px; text-align: justify; }
    .sg-dist { display: flex; gap: 6px; flex-wrap: wrap; }
    .sg-pill { color: #fff; font-size: 10px; font-weight: 700; padding: 3px 9px; border-radius: 20px; }
    .sg-strong-list { list-style: none; padding: 0; margin: 0; }
    .sg-strong-list li { font-size: 11px; line-height: 1.55; color: #2a2a2a; padding: 5px 0 5px 4px; border-bottom: 1px solid #f0f0f0; }
    .sg-check { color: #1f7a34; font-weight: 800; margin-right: 4px; }
    .sg-finding { border: 1px solid #e6e6ee; border-left: 4px solid; border-radius: 6px; padding: 11px 13px; margin-bottom: 10px; page-break-inside: avoid; }
    .sg-finding-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .sg-finding-id { font-family: 'Courier New', monospace; font-size: 9.5px; color: #666; border: 1px solid #ddd; border-radius: 3px; padding: 1px 5px; }
    .sg-finding-title { font-size: 12.5px; font-weight: 700; color: #1a1a1a; }
    .sg-badge { color: #fff; font-size: 8.5px; font-weight: 800; padding: 2px 6px; border-radius: 4px; margin-left: auto; white-space: nowrap; flex-shrink: 0; }
    .sg-finding-cat { font-size: 9.5px; color: #888; margin: 4px 0 6px; }
    .sg-finding-desc { font-size: 11px; line-height: 1.6; color: #333; text-align: justify; }
    .sg-finding-evi { font-size: 10px; color: #555; margin-top: 6px; }
    .sg-finding-evi code { font-family: 'Courier New', monospace; background: #f3f3f6; padding: 1px 5px; border-radius: 3px; }
    .sg-finding-rec { font-size: 10.5px; color: #1a1a1a; margin-top: 6px; background: #fbf7ea; border: 1px solid #ecdcae; border-radius: 5px; padding: 6px 9px; line-height: 1.55; }
    .sg-sign { display: flex; justify-content: space-around; margin-top: 40px; page-break-inside: avoid; }
    .sg-sign-block { text-align: center; width: 40%; }
    .sg-sign-role { font-size: 11px; font-weight: 700; color: #555; margin-bottom: 40px; }
    .sg-sign-line { border-top: 1px solid #999; margin: 0 10px; }
    .sg-sign-name { font-size: 11px; font-weight: 600; color: #1a1a1a; margin-top: 5px; }
    .sg-foot { margin-top: 30px; padding-top: 10px; border-top: 1px solid #e6e6ee; font-size: 9px; color: #999; text-align: center; line-height: 1.5; }
  `;
  container.appendChild(style);
  const govde = document.createElement('div');
  govde.innerHTML = html;
  container.appendChild(govde);

  showToast('Kurumsal PDF raporu oluşturuluyor, lütfen bekleyin...', 'info');

  const opt = {
    margin: [12, 12, 14, 12],
    filename: `Siber_Guvenlik_Denetim_Raporu_${raporNo}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff' },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak: { mode: ['css', 'legacy'] }
  };

  html2pdf().set(opt).from(container).save()
    .then(() => showToast('Siber Güvenlik Denetim Raporu başarıyla kaydedildi.', 'success'))
    .catch(err => {
      console.error('PDF hatası:', err);
      showToast('PDF oluşturulurken hata: ' + err.message, 'danger');
    });
}


function guvenlikYoneticiMi() {
  return !!STATE.currentUser && STATE.currentUser.role === 'admin';
}

// Anahtar alanları da URL'ler gibi yalnızca yöneticiye açıktır
function guvenlikAnahtarFormuDoldur() {
  const yonetici = guvenlikYoneticiMi();
  const esle = [
    ['settings-literatur-token', 'literaturToken'],
    ['settings-photocards-token', 'photocardsToken'],
    ['settings-mesajlar-token', 'mesajlarToken']
  ];
  esle.forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (yonetici) {
      el.value = STATE[key] || '';
      el.disabled = false;
    } else {
      el.value = STATE[key] ? '•••••••••• (yönetici yetkisi gerekir)' : '';
      el.disabled = true;
    }
  });
  ['btn-guvenlik-kaydet', 'btn-guvenlik-anahtar-uret'].forEach(id => {
    const b = document.getElementById(id);
    if (b) b.disabled = !yonetici;
  });
}


// Anahtar önce Ayarlar'dan okunur; boşsa koda gömülü eski sabit kullanılır.
// Böylece anahtar, uygulama yeniden derlenmeden değiştirilebilir.
function literaturTokenAl()  { return STATE.literaturToken  || LITERATUR_API_TOKEN || ''; }
function photocardsTokenAl() { return STATE.photocardsToken || ''; }
function mesajlarTokenAl()   { return STATE.mesajlarToken   || MESAJ_API_TOKEN || ''; }

function initGlobalSafeHandlers() {
  // Görsel yüklenemediğinde yedek davranış. 'error' baloncuklanmadığı için
  // yakalama (capture) aşamasında dinlenir.
  document.addEventListener('error', (e) => {
    const el = e.target;
    if (!el || el.tagName !== 'IMG') return;

    // Önce ikinci Google uç noktasını dene (biri engellenirse diğeri çalışır).
    // Bu, data-fallback taşımayan görseller için de geçerlidir.
    if (el.dataset.altDenendi !== '1') {
      const alternatif = gorselAlternatifAdres(el.getAttribute('src'));
      if (alternatif) {
        el.dataset.altDenendi = '1';
        el.referrerPolicy = 'no-referrer';
        el.src = alternatif;
        return;
      }
    }

    const tur = el.dataset.fallback;
    if (!tur || el.dataset.fallbackApplied === '1') return;
    el.dataset.fallbackApplied = '1';

    switch (tur) {
      case 'favicon':
        el.src = 'favicon.svg';
        break;
      case 'thumb':
        el.src = IMG_FALLBACK_THUMB;
        break;
      case 'small':
        el.src = IMG_FALLBACK_SMALL;
        break;
      case 'sibling':
        // Görseli gizle, yanındaki baş harf rozetini göster
        el.style.display = 'none';
        if (el.nextElementSibling) el.nextElementSibling.style.display = 'flex';
        break;
      case 'placeholder': {
        const kutu = el.parentNode;
        if (kutu) {
          kutu.innerHTML = '';
          const ph = document.createElement('div');
          ph.className = 'photo-card-placeholder';
          ph.textContent = '🖼️';
          kutu.appendChild(ph);
        }
        break;
      }
    }
  }, true);

  // Dış bağlantılar: data-external-url taşıyan öğeler
  document.addEventListener('click', (e) => {
    const hedef = e.target.closest('[data-external-url]');
    if (hedef) {
      e.stopPropagation();
      e.preventDefault();
      openExternal(hedef.dataset.externalUrl);
      return;
    }
    // tel: / mailto: bağlantıları satırın tıklama olayını tetiklemesin
    const iletisim = e.target.closest('a[href^="tel:"], a[href^="mailto:"]');
    if (iletisim) e.stopPropagation();
  });
}

// Platform Bilgisi Göstergeci
function updatePlatformIndicator() {
  const indicator = document.getElementById('platform-indicator');
  if (window.api && window.api.isElectron) {
    indicator.textContent = 'Masaüstü Uygulaması (Electron)';
  } else {
    indicator.textContent = 'Web Tarayıcı / PWA';
  }
}

// ==========================================================================
// OTOMATİK GÜNCELLEME ARAYÜZÜ
// Windows'ta electron-updater indirip kurar; macOS'ta yalnızca bildirilir.
// Tarayıcı/PWA modunda güncelleme Service Worker ile geldiği için gizlenir.
// ==========================================================================
// ==========================================================================
// MASAÜSTÜ OTOMATİK GÜNCELLEME ŞERİDİ
// --------------------------------------------------------------------------
// Yeni sürüm indirildiğinde ekranın altında geri sayımlı bir şerit belirir.
// Süre dolduğunda uygulama kendini günceller ve yeniden açılır; kullanıcının
// Ayarlar bölümüne gitmesine gerek yoktur. "Ertele" denirse kurulum iptal
// olmaz, uygulama normal şekilde kapatıldığında sessizce yapılır.
// ==========================================================================
let _guncellemeGeriSayim = null;

function masaustuGuncellemeSeridi(surum, otomatikSaniye) {
  if (!(window.api && window.api.isElectron)) return;
  if (document.getElementById('app-update-bar')) return;

  const saniyeVar = typeof otomatikSaniye === 'number' && otomatikSaniye > 0;
  let kalan = saniyeVar ? otomatikSaniye : 0;

  const bar = document.createElement('div');
  bar.id = 'app-update-bar';
  bar.className = 'pwa-update-bar';

  const metin = document.createElement('span');
  const metniYaz = () => {
    metin.textContent = saniyeVar
      ? `Sürüm ${surum || ''} hazır — ${kalan} sn içinde güncellenecek.`
      : `Sürüm ${surum || ''} kuruluma hazır.`;
  };
  metniYaz();

  const simdi = document.createElement('button');
  simdi.type = 'button';
  simdi.textContent = 'Şimdi güncelle';
  simdi.addEventListener('click', async () => {
    simdi.disabled = true;
    simdi.textContent = 'Kuruluyor...';
    if (_guncellemeGeriSayim) clearInterval(_guncellemeGeriSayim);
    metin.textContent = 'Uygulama kapatılıp güncelleniyor...';
    await window.api.quitAndInstall();
  });

  const ertele = document.createElement('button');
  ertele.type = 'button';
  ertele.className = 'pwa-update-dismiss';
  ertele.textContent = 'Ertele';
  ertele.style.fontSize = '0.8rem';
  ertele.addEventListener('click', async () => {
    if (_guncellemeGeriSayim) clearInterval(_guncellemeGeriSayim);
    if (window.api.postponeUpdate) await window.api.postponeUpdate();
    bar.remove();
    showToast('Güncelleme ertelendi. Uygulamayı kapattığınızda kurulacak.', 'info');
  });

  bar.appendChild(metin);
  bar.appendChild(simdi);
  bar.appendChild(ertele);
  document.body.appendChild(bar);

  if (saniyeVar) {
    _guncellemeGeriSayim = setInterval(() => {
      kalan -= 1;
      if (kalan <= 0) {
        clearInterval(_guncellemeGeriSayim);
        metin.textContent = 'Uygulama kapatılıp güncelleniyor...';
        simdi.disabled = true;
        ertele.remove();
        return;
      }
      metniYaz();
    }, 1000);
  }
}

function setUpdateStatusText(text) {
  const el = document.getElementById('update-status');
  if (el) el.textContent = text;
}

let _macReleasePageUrl = '';

function handleUpdateStatus(data) {
  if (!data) return;
  const installBtn = document.getElementById('btn-install-update');

  switch (data.durum) {
    case 'denetleniyor':
      setUpdateStatusText('Güncellemeler denetleniyor...');
      break;
    case 'guncel':
      setUpdateStatusText('Programınız güncel (sürüm ' + (data.surum || '') + ').');
      break;
    case 'bulundu':
      if (data.macBildirim) {
        _macReleasePageUrl = data.indirmeSayfasi || '';
        setUpdateStatusText('Yeni sürüm var: ' + data.surum +
          '. macOS\'ta kurulum elle yapılır — indirmek için aşağıdaki butona basın.');
        if (installBtn) {
          installBtn.textContent = 'Yeni Sürümü İndir';
          installBtn.classList.remove('hidden');
        }
      } else {
        setUpdateStatusText('Yeni sürüm bulundu: ' + data.surum + '. Arka planda indiriliyor...');
      }
      break;
    case 'indiriliyor':
      setUpdateStatusText('Yeni sürüm indiriliyor... %' + (data.yuzde || 0));
      break;
    case 'hazir':
      setUpdateStatusText('Sürüm ' + (data.surum || '') + ' kuruluma hazır.');
      if (installBtn) {
        installBtn.textContent = 'Yeniden Başlat ve Kur';
        installBtn.classList.remove('hidden');
      }
      // Kullanıcının Ayarlar'a gitmesi gerekmez: şerit hangi ekranda olursa
      // olsun görünür ve süre dolunca güncelleme kendiliğinden kurulur.
      masaustuGuncellemeSeridi(data.surum, data.otomatikSaniye);
      break;
    case 'hata':
      setUpdateStatusText('Güncelleme denetlenemedi: ' + (data.mesaj || 'bilinmeyen hata'));
      break;
  }
}

async function initUpdateUI() {
  const versionLabel = document.getElementById('app-version-label');
  const checkBtn = document.getElementById('btn-check-updates');
  const installBtn = document.getElementById('btn-install-update');

  if (!(window.api && window.api.isElectron)) {
    // PWA'da güncelleme Service Worker ile gelir; bu kontroller anlamsız
    if (versionLabel) versionLabel.textContent = '1.0.1 (PWA)';
    if (checkBtn) checkBtn.classList.add('hidden');
    setUpdateStatusText('Tarayıcı sürümü sayfa yenilendiğinde kendiliğinden güncellenir.');
    return;
  }

  try {
    const v = await window.api.getAppVersion();
    if (versionLabel) versionLabel.textContent = v + ' (Masaüstü)';
  } catch (e) {
    if (versionLabel) versionLabel.textContent = '-';
  }

  window.api.onUpdateStatus(handleUpdateStatus);

  if (checkBtn) {
    checkBtn.addEventListener('click', async () => {
      checkBtn.disabled = true;
      setUpdateStatusText('Güncellemeler denetleniyor...');
      try {
        const res = await window.api.checkForUpdates();
        // Windows'ta sonuç olaylarla gelir; macOS'ta doğrudan döner
        if (res && res.durum && res.durum !== 'denetleniyor') handleUpdateStatus(res);
      } catch (e) {
        setUpdateStatusText('Güncelleme denetlenemedi: ' + e.message);
      } finally {
        checkBtn.disabled = false;
      }
    });
  }

  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (_macReleasePageUrl || installBtn.textContent.includes('İndir')) {
        await window.api.openReleasePage(_macReleasePageUrl);
        return;
      }
      installBtn.disabled = true;
      installBtn.textContent = 'Kuruluyor...';
      await window.api.quitAndInstall();
    });
  }
}

// ==========================================================================
// 2. Önbellek & Konfigürasyon Yönetimi (Cache / Config)
// ==========================================================================

// Ayarları Yükle
async function loadConfig() {
  if (window.api && window.api.isElectron) {
    // Electron Cache (Önce yerel önbelleği oku, hızlı açılış için)
    const cache = await window.api.readLocalCache('config.json');
    STATE.motifs = await window.api.readLocalCache('motifs_store.json') || {};
    if (cache) {
      STATE.sheetUrl = cache.sheetUrl || DEFAULT_SHEET_URL;
      STATE.magazaSheetUrl = cache.magazaSheetUrl || '';
      STATE.literaturSheetUrl = cache.literaturSheetUrl || '';
      STATE.photocardsSheetUrl = cache.photocardsSheetUrl || '';
      STATE.projeSheetUrl = cache.projeSheetUrl || '';
      STATE.mesajlarSheetUrl = cache.mesajlarSheetUrl || '';
      STATE.literaturToken = cache.literaturToken || '';
      STATE.photocardsToken = cache.photocardsToken || '';
      STATE.mesajlarToken = cache.mesajlarToken || '';
      STATE.envanterTableUrl = cache.envanterTableUrl || '';
      STATE.literaturTableUrl = cache.literaturTableUrl || '';
      STATE.magazaTableUrl = cache.magazaTableUrl || '';
      STATE.projeTableUrl = cache.projeTableUrl || '';
      STATE.photocardsTableUrl = cache.photocardsTableUrl || '';
      STATE.literaturFormUrl = cache.literaturFormUrl || 'https://docs.google.com/forms/d/e/1FAIpQLSc49ZWaO8quni5u2ZICXDF2QcBbo8gm3veim6jWkkAIQft3pg/viewform?usp=header';
      STATE.soundTheme = cache.soundTheme || 'modern';
      STATE.soundVolume = cache.soundVolume !== undefined ? cache.soundVolume : 60;
      STATE.appLogo = cache.appLogo || localStorage.getItem('eo_app_logo') || '';
      STATE.institutionLogo = cache.institutionLogo || localStorage.getItem('eo_institution_logo') || '';
      STATE.currentUser = cache.currentUser || null;
      if (STATE.currentUser) {
        STATE.rememberMe = true;
      }
    }
  } else {
    // Web LocalStorage Cache
    STATE.sheetUrl = localStorage.getItem('eo_sheet_url') || DEFAULT_SHEET_URL;
    STATE.magazaSheetUrl = localStorage.getItem('eo_magaza_sheet_url') || '';
    STATE.literaturSheetUrl = localStorage.getItem('eo_literatur_sheet_url') || '';
    STATE.photocardsSheetUrl = localStorage.getItem('eo_photocards_sheet_url') || '';
    STATE.projeSheetUrl = localStorage.getItem('eo_proje_sheet_url') || '';
    STATE.mesajlarSheetUrl = localStorage.getItem('eo_mesajlar_sheet_url') || '';
    STATE.literaturToken = localStorage.getItem('eo_literatur_token') || '';
    STATE.photocardsToken = localStorage.getItem('eo_photocards_token') || '';
    STATE.mesajlarToken = localStorage.getItem('eo_mesajlar_token') || '';
    STATE.envanterTableUrl = localStorage.getItem('eo_envanter_table_url') || '';
    STATE.literaturTableUrl = localStorage.getItem('eo_literatur_table_url') || '';
    STATE.magazaTableUrl = localStorage.getItem('eo_magaza_table_url') || '';
    STATE.projeTableUrl = localStorage.getItem('eo_proje_table_url') || '';
    STATE.literaturFormUrl = localStorage.getItem('eo_literatur_form_url') || 'https://docs.google.com/forms/d/e/1FAIpQLSc49ZWaO8quni5u2ZICXDF2QcBbo8gm3veim6jWkkAIQft3pg/viewform?usp=header';
    STATE.photocardsTableUrl = localStorage.getItem('eo_photocards_table_url') || '';
    STATE.soundTheme = localStorage.getItem('eo_sound_theme') || 'modern';
    STATE.soundVolume = localStorage.getItem('eo_sound_volume') !== null ? parseInt(localStorage.getItem('eo_sound_volume'), 10) : 60;
    STATE.appLogo = localStorage.getItem('eo_app_logo') || '';
    STATE.institutionLogo = localStorage.getItem('eo_institution_logo') || '';
    const cachedUser = localStorage.getItem('eo_current_user');
    if (cachedUser) {
      STATE.currentUser = JSON.parse(cachedUser);
      STATE.rememberMe = true;
    }
    try {
      STATE.motifs = JSON.parse(localStorage.getItem('eo_motifs_store') || '{}');
    } catch (e) {
      STATE.motifs = {};
    }
  }

  if (!STATE.sheetUrl) {
    STATE.sheetUrl = DEFAULT_SHEET_URL;
  }

  // Logoları Tüm Uygulamaya Uygula
  applyAppLogo(STATE.appLogo);
  applyInstitutionLogo(STATE.institutionLogo);

  // Her zaman sunucudan ortak konfigürasyonu çekmeyi deneyelim (Ortaklaşa paylaşım için)
  const fetchUrl = window.location.protocol.startsWith('http')
    ? `/api/config?_t=${Date.now()}`
    : `http://localhost:3000/api/config?_t=${Date.now()}`;
  try {
    const serverRes = await fetch(fetchUrl, { headers: apiTokenBasliklari() });
    if (serverRes.ok) {
      const serverConfig = await serverRes.json();
      if (serverConfig && serverConfig.sheetUrl) {
        STATE.sheetUrl = serverConfig.sheetUrl;
        if (serverConfig.magazaSheetUrl) STATE.magazaSheetUrl = serverConfig.magazaSheetUrl;
        if (serverConfig.literaturSheetUrl) STATE.literaturSheetUrl = serverConfig.literaturSheetUrl;
        if (serverConfig.photocardsSheetUrl) STATE.photocardsSheetUrl = serverConfig.photocardsSheetUrl;
        if (serverConfig.envanterTableUrl) STATE.envanterTableUrl = serverConfig.envanterTableUrl;
        if (serverConfig.literaturTableUrl) STATE.literaturTableUrl = serverConfig.literaturTableUrl;
        if (serverConfig.magazaTableUrl) STATE.magazaTableUrl = serverConfig.magazaTableUrl;
        if (serverConfig.projeTableUrl) STATE.projeTableUrl = serverConfig.projeTableUrl;
        if (serverConfig.projeSheetUrl) STATE.projeSheetUrl = serverConfig.projeSheetUrl;
        if (serverConfig.mesajlarSheetUrl) STATE.mesajlarSheetUrl = serverConfig.mesajlarSheetUrl;
        if (serverConfig.literaturToken) STATE.literaturToken = serverConfig.literaturToken;
        if (serverConfig.photocardsToken) STATE.photocardsToken = serverConfig.photocardsToken;
        if (serverConfig.mesajlarToken) STATE.mesajlarToken = serverConfig.mesajlarToken;
        if (serverConfig.literaturFormUrl) STATE.literaturFormUrl = serverConfig.literaturFormUrl;
        if (serverConfig.photocardsTableUrl) STATE.photocardsTableUrl = serverConfig.photocardsTableUrl;

        // Önbelleği de tazeleyelim
        if (window.api && window.api.isElectron) {
          await window.api.writeLocalCache('config.json', {
            sheetUrl: STATE.sheetUrl,
            magazaSheetUrl: STATE.magazaSheetUrl,
            literaturSheetUrl: STATE.literaturSheetUrl,
            photocardsSheetUrl: STATE.photocardsSheetUrl,
            envanterTableUrl: STATE.envanterTableUrl,
            literaturTableUrl: STATE.literaturTableUrl,
            magazaTableUrl: STATE.magazaTableUrl,
            projeTableUrl: STATE.projeTableUrl,
            projeSheetUrl: STATE.projeSheetUrl,
            mesajlarSheetUrl: STATE.mesajlarSheetUrl,
            literaturFormUrl: STATE.literaturFormUrl,
            photocardsTableUrl: STATE.photocardsTableUrl,
            currentUser: STATE.currentUser
          });
        } else {
          localStorage.setItem('eo_sheet_url', STATE.sheetUrl);
          localStorage.setItem('eo_magaza_sheet_url', STATE.magazaSheetUrl || '');
          localStorage.setItem('eo_literatur_sheet_url', STATE.literaturSheetUrl || '');
          localStorage.setItem('eo_photocards_sheet_url', STATE.photocardsSheetUrl || '');
          localStorage.setItem('eo_envanter_table_url', STATE.envanterTableUrl || '');
          localStorage.setItem('eo_literatur_table_url', STATE.literaturTableUrl || '');
          localStorage.setItem('eo_magaza_table_url', STATE.magazaTableUrl || '');
          localStorage.setItem('eo_proje_table_url', STATE.projeTableUrl || '');
          localStorage.setItem('eo_proje_sheet_url', STATE.projeSheetUrl || '');
          localStorage.setItem('eo_mesajlar_sheet_url', STATE.mesajlarSheetUrl || '');
          localStorage.setItem('eo_literatur_form_url', STATE.literaturFormUrl || '');
          localStorage.setItem('eo_photocards_table_url', STATE.photocardsTableUrl || '');
        }
      }
    }
  } catch (e) {
    console.warn('Ortak konfigürasyon sunucudan çekilemedi, yerel önbellek kullanılıyor:', e);
  }

  // Statik yayın (GitHub Pages / mobil PWA): arkada sunucu yoktur, adresler
  // uygulamayla gelen public-config.js dosyasından tamamlanır. Sunucudan veya
  // önbellekten gelen DOLU değerlerin üzerine yazmaz, yalnızca boşları doldurur.
  try {
    const pc = window.EO_PUBLIC_CONFIG;
    if (pc && typeof pc === 'object') {
      [
        'sheetUrl', 'magazaSheetUrl', 'literaturSheetUrl', 'photocardsSheetUrl',
        'projeSheetUrl', 'mesajlarSheetUrl', 'envanterTableUrl', 'literaturTableUrl',
        'magazaTableUrl', 'projeTableUrl', 'photocardsTableUrl', 'literaturFormUrl',
        'literaturToken', 'photocardsToken', 'mesajlarToken'
      ].forEach((anahtar) => {
        if (!STATE[anahtar] && pc[anahtar]) STATE[anahtar] = pc[anahtar];
      });
    }
  } catch (e) {
    console.warn('public-config.js okunamadi:', e);
  }
}

// Motifleri Kaydet
async function saveMotifs() {
  if (window.api && window.api.isElectron) {
    await window.api.writeLocalCache('motifs_store.json', STATE.motifs);
  } else {
    try {
      localStorage.setItem('eo_motifs_store', JSON.stringify(STATE.motifs));
    } catch (e) {
      console.error('LocalStorage write error:', e);
    }
  }
}

// Ayarları Kaydet
// DIKKAT: Yeni ayar alanlari 14. parametredeki isimli `extra` cantasina eklenir,
// yeni bir pozisyonel parametre ACILMAZ. Bu liste tamamen URL'lerden olustugu icin
// bir kaydirma hatasi degeri sessizce yanlis alana yazar ve hata vermez.
async function saveConfig(url, magazaUrl, envanterTableUrl, literaturTableUrl, magazaTableUrl, literaturFormUrl, literaturScriptUrl, photocardsTableUrl, photocardsScriptUrl, projeTableUrl, projeScriptUrl, soundTheme, soundVolume, extra = {}) {
  // Kullanicinin kasitli olarak bosalttigi alanlar (yoksa bos dizi). Bu liste olmadan
  // hicbir bos deger kayitli bir baglantiyi silemez - bkz. main.js / server.js mergeConfig.
  const cleared = Array.isArray(STATE.clearedConfigFields) ? STATE.clearedConfigFields : [];
  STATE.clearedConfigFields = [];

  // Isimli ek alanlar - `undefined` = dokunma semantigi burada da gecerli
  if (extra && extra.mesajlarSheetUrl !== undefined) {
    STATE.mesajlarSheetUrl = extra.mesajlarSheetUrl;
  }
  ['literaturToken', 'photocardsToken', 'mesajlarToken'].forEach((k) => {
    if (extra && extra[k] !== undefined) STATE[k] = extra[k];
  });

  STATE.sheetUrl = url;
  if (magazaUrl !== undefined) {
    STATE.magazaSheetUrl = magazaUrl;
  }
  if (envanterTableUrl !== undefined) {
    STATE.envanterTableUrl = envanterTableUrl;
  }
  if (literaturTableUrl !== undefined) {
    STATE.literaturTableUrl = literaturTableUrl;
  }
  if (magazaTableUrl !== undefined) {
    STATE.magazaTableUrl = magazaTableUrl;
  }
  if (projeTableUrl !== undefined) {
    STATE.projeTableUrl = projeTableUrl;
  }
  if (projeScriptUrl !== undefined) {
    STATE.projeSheetUrl = projeScriptUrl;
  }
  if (literaturFormUrl !== undefined) {
    STATE.literaturFormUrl = literaturFormUrl;
  }
  if (literaturScriptUrl !== undefined) {
    STATE.literaturSheetUrl = literaturScriptUrl;
  }
  if (photocardsTableUrl !== undefined) {
    STATE.photocardsTableUrl = photocardsTableUrl;
  }
  if (photocardsScriptUrl !== undefined) {
    STATE.photocardsSheetUrl = photocardsScriptUrl;
  }
  if (soundTheme !== undefined) {
    STATE.soundTheme = soundTheme;
  }
  if (soundVolume !== undefined) {
    STATE.soundVolume = soundVolume;
  }

  const userToSave = STATE.rememberMe ? STATE.currentUser : null;
  if (window.api && window.api.isElectron) {
    await window.api.writeLocalCache('config.json', {
      __cleared: cleared,
      sheetUrl: STATE.sheetUrl,
      magazaSheetUrl: STATE.magazaSheetUrl,
      literaturSheetUrl: STATE.literaturSheetUrl,
      photocardsSheetUrl: STATE.photocardsSheetUrl,
      envanterTableUrl: STATE.envanterTableUrl,
      literaturTableUrl: STATE.literaturTableUrl,
      magazaTableUrl: STATE.magazaTableUrl,
      projeTableUrl: STATE.projeTableUrl,
      projeSheetUrl: STATE.projeSheetUrl,
      mesajlarSheetUrl: STATE.mesajlarSheetUrl,
      literaturToken: STATE.literaturToken,
      photocardsToken: STATE.photocardsToken,
      mesajlarToken: STATE.mesajlarToken,
      literaturFormUrl: STATE.literaturFormUrl,
      photocardsTableUrl: STATE.photocardsTableUrl,
      currentUser: userToSave,
      soundTheme: STATE.soundTheme,
      soundVolume: STATE.soundVolume
    });
  } else {
    // Bos deger, kasitli silme (cleared) olmadikca localStorage'daki dolu degeri ezmez.
    const setUrlItem = (storageKey, stateKey, value) => {
      if (!value && !cleared.includes(stateKey) && localStorage.getItem(storageKey)) return;
      localStorage.setItem(storageKey, value || '');
    };
    setUrlItem('eo_sheet_url', 'sheetUrl', STATE.sheetUrl);
    setUrlItem('eo_magaza_sheet_url', 'magazaSheetUrl', STATE.magazaSheetUrl);
    setUrlItem('eo_literatur_sheet_url', 'literaturSheetUrl', STATE.literaturSheetUrl);
    setUrlItem('eo_photocards_sheet_url', 'photocardsSheetUrl', STATE.photocardsSheetUrl);
    setUrlItem('eo_envanter_table_url', 'envanterTableUrl', STATE.envanterTableUrl);
    setUrlItem('eo_literatur_table_url', 'literaturTableUrl', STATE.literaturTableUrl);
    setUrlItem('eo_magaza_table_url', 'magazaTableUrl', STATE.magazaTableUrl);
    setUrlItem('eo_proje_table_url', 'projeTableUrl', STATE.projeTableUrl);
    setUrlItem('eo_proje_sheet_url', 'projeSheetUrl', STATE.projeSheetUrl);
    setUrlItem('eo_mesajlar_sheet_url', 'mesajlarSheetUrl', STATE.mesajlarSheetUrl);
    localStorage.setItem('eo_literatur_token', STATE.literaturToken || '');
    localStorage.setItem('eo_photocards_token', STATE.photocardsToken || '');
    localStorage.setItem('eo_mesajlar_token', STATE.mesajlarToken || '');
    setUrlItem('eo_literatur_form_url', 'literaturFormUrl', STATE.literaturFormUrl);
    setUrlItem('eo_photocards_table_url', 'photocardsTableUrl', STATE.photocardsTableUrl);
    localStorage.setItem('eo_sound_theme', STATE.soundTheme || 'modern');
    localStorage.setItem('eo_sound_volume', STATE.soundVolume !== undefined ? STATE.soundVolume : 60);
    if (userToSave) {
      localStorage.setItem('eo_current_user', JSON.stringify(userToSave));
    } else {
      localStorage.removeItem('eo_current_user');
    }
  }

  // Sunucuya da ortak konfigürasyonu eşitle (Telefon ve tarayıcı otomatik alsın diye)
  const configPayload = {
    __cleared: cleared,
    sheetUrl: STATE.sheetUrl,
    magazaSheetUrl: STATE.magazaSheetUrl,
    literaturSheetUrl: STATE.literaturSheetUrl,
    photocardsSheetUrl: STATE.photocardsSheetUrl,
    envanterTableUrl: STATE.envanterTableUrl,
    literaturTableUrl: STATE.literaturTableUrl,
    magazaTableUrl: STATE.magazaTableUrl,
    projeTableUrl: STATE.projeTableUrl,
    projeSheetUrl: STATE.projeSheetUrl,
    mesajlarSheetUrl: STATE.mesajlarSheetUrl,
    literaturToken: STATE.literaturToken,
    photocardsToken: STATE.photocardsToken,
    mesajlarToken: STATE.mesajlarToken,
    literaturFormUrl: STATE.literaturFormUrl,
    photocardsTableUrl: STATE.photocardsTableUrl
  };

  if (window.location.protocol.startsWith('http')) {
    try {
      await fetch('/api/config', {
        method: 'POST',
        headers: apiTokenBasliklari({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(configPayload)
      });
    } catch (e) {
      console.warn('Konfigürasyon sunucuya kaydedilemedi:', e);
    }
  } else {
    try {
      await fetch('http://localhost:3000/api/config', {
        method: 'POST',
        headers: apiTokenBasliklari({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(configPayload)
      });
    } catch (e) {
      // Sunucu ayakta olmayabilir
    }
  }
}

// Önbellekten Tüm Verileri Oku (Offline Mod İçin)
async function loadDataFromCache() {
  let cache = null;
  if (window.api && window.api.isElectron) {
    cache = await window.api.readLocalCache('data_cache.json');
  } else {
    const raw = localStorage.getItem('eo_data_cache');
    if (raw) cache = JSON.parse(raw);
  }

  if (cache) {
    STATE.inventory = (cache.inventory || [])
      .map(standardizeInventoryItem)
      .filter(item => item.envanterNo || item.eserAdi || item.timestamp);
    STATE.literature = (cache.literature || []).filter(item => {
      return Object.keys(item).some(k => k !== '_rowNum' && String(item[k] || '').trim() !== '');
    });
    STATE.photocards = (cache.photocards || []).filter(item => {
      return Object.keys(item).some(k => k !== '_rowNum' && String(item[k] || '').trim() !== '');
    });
    STATE.users = cache.users || [];
    STATE.logs = cache.logs || [];
    STATE.personnel = cache.personnel || DEFAULT_PERSONNEL;
    return true;
  }
  return false;
}

// Tüm Verileri Önbelleğe Yaz (Offline Desteği İçin)
async function writeDataToCache() {
  const cacheData = {
    inventory: STATE.inventory,
    literature: STATE.literature,
    photocards: STATE.photocards,
    users: STATE.users,
    logs: STATE.logs,
    personnel: STATE.personnel
  };

  if (window.api && window.api.isElectron) {
    await window.api.writeLocalCache('data_cache.json', cacheData);
  } else {
    localStorage.setItem('eo_data_cache', JSON.stringify(cacheData));
  }
}

// ==========================================================================
// 3. API Haberleşme Katmanı (Network / Google Apps Script)
// ==========================================================================

// API Ortak POST İsteği
async function apiPost(action, payload = {}, subAction = '') {
  if (!STATE.sheetUrl) {
    showToast('Bağlantı URL\'si tanımlanmamış. Ayarlardan kurun.', 'danger');
    return { success: false, error: 'URL Eksik' };
  }

  const authPayload = {
    action: action,
    subAction: subAction,
    payload: payload,
    auth: STATE.currentUser ? {
      username: STATE.currentUser.username,
      passwordHash: STATE.currentUser.passwordHash // Giriş esnasında kaydedilen hash
    } : null
  };

  try {
    const response = await fetch(STATE.sheetUrl, {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'text/plain' // Google Apps Script CORS problemini aşmak için text/plain önerilir
      },
      body: JSON.stringify(authPayload)
    });

    if (!response.ok) {
      throw new Error(`API hatası: Status ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (err) {
    console.error('API Error:', err);
    return { success: false, error: err.message || 'Bağlantı hatası' };
  }
}

// API Literatür POST İsteği
async function apiLiteraturPost(action, payload = {}, subAction = '') {
  const targetUrl = STATE.literaturSheetUrl || STATE.sheetUrl;
  if (!targetUrl) {
    showToast('Literatür bağlantı URL\'si tanımlanmamış. Ayarlardan kurun.', 'danger');
    return { success: false, error: 'URL Eksik' };
  }

  const authPayload = {
    action: action,
    subAction: subAction,
    token: literaturTokenAl(),
    payload: payload,
    auth: STATE.currentUser ? {
      username: STATE.currentUser.username,
      passwordHash: STATE.currentUser.passwordHash
    } : null
  };

  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'text/plain'
      },
      body: JSON.stringify(authPayload)
    });

    if (!response.ok) {
      throw new Error(`API hatası: Status ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (err) {
    console.error('Literatur API Error:', err);
    return { success: false, error: err.message || 'Bağlantı hatası' };
  }
}

// API Fotoğraf Kartları POST İsteği
async function apiPhotocardsPost(action, payload = {}, subAction = '') {
  const targetUrl = STATE.photocardsSheetUrl || STATE.sheetUrl;
  if (!targetUrl) {
    showToast('Fotoğraf Kartları bağlantı URL\'si tanımlanmamış. Ayarlardan kurun.', 'danger');
    return { success: false, error: 'URL Eksik' };
  }

  const authPayload = {
    action: action,
    subAction: subAction,
    token: photocardsTokenAl(),
    payload: payload,
    auth: STATE.currentUser ? {
      username: STATE.currentUser.username,
      passwordHash: STATE.currentUser.passwordHash
    } : null
  };

  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'text/plain'
      },
      body: JSON.stringify(authPayload)
    });

    if (!response.ok) {
      throw new Error(`API hatası: Status ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (err) {
    console.error('Photocards API Error:', err);
    return { success: false, error: err.message || 'Bağlantı hatası' };
  }
}

// API Proje Takip POST İsteği
async function apiProjePost(action, payload = {}, subAction = '') {
  const targetUrl = STATE.projeSheetUrl || STATE.sheetUrl;
  if (!targetUrl) {
    showToast('Proje Takip bağlantı URL\'si tanımlanmamış. Ayarlardan kurun.', 'danger');
    return { success: false, error: 'URL Eksik' };
  }

  const authPayload = {
    action: action,
    subAction: subAction,
    payload: payload,
    auth: STATE.currentUser ? {
      username: STATE.currentUser.username,
      passwordHash: STATE.currentUser.passwordHash
    } : null
  };

  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'text/plain'
      },
      body: JSON.stringify(authPayload)
    });

    if (!response.ok) {
      throw new Error(`API hatası: Status ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (err) {
    console.error('Proje API Error:', err);
    return { success: false, error: err.message || 'Bağlantı hatası' };
  }
}

// Mesajlaşma Apps Script token'ı. mesajlar-google-apps-script.js dosyasındaki
// API_TOKEN ile BİREBİR aynı olmalıdır. İki taraftan biri boşsa doğrulama kapalıdır.
const MESAJ_API_TOKEN = 'Cekos1501.';

// Literatür Apps Script erişim anahtarı.
// UYARI: Boş bırakılırsa literatur-google-apps-script.js doğrulamayı DEVRE DIŞI
// bırakır; adresi bilen herkes tüm literatür/saha verisini okuyabilir ve
// kayıt ekleyebilir. Kapatmak için: bu sabite uzun rastgele bir dize yazın ve
// AYNI değeri Apps Script dosyasındaki API_TOKEN satırına da girin.
const LITERATUR_API_TOKEN = '';

// API Mesajlaşma POST İsteği
// Diğer api*Post yardımcılarından üç farkı vardır:
//  1) STATE.sheetUrl'e geri DÜŞMEZ - ana script bu action'ları tanımadığı için
//     "Bilinmeyen action" döner ve kullanıcıyı yanlış yönlendirir.
//  2) showToast ÇAĞIRMAZ - 15-90 sn'de bir çalıştığı için ekranı bildirime boğardı;
//     kullanıcıya ne söyleneceğine çağıran karar verir.
//  3) Gövdeye token eklenir.
async function apiMesajlarPost(action, payload = {}) {
  if (!STATE.mesajlarSheetUrl) {
    return { success: false, notConfigured: true, error: 'Mesajlaşma URL\'si tanımlanmamış' };
  }

  const body = {
    action: action,
    payload: payload,
    token: mesajlarTokenAl(),
    auth: STATE.currentUser ? {
      username: STATE.currentUser.username,
      passwordHash: STATE.currentUser.passwordHash
    } : null
  };

  try {
    const response = await fetch(STATE.mesajlarSheetUrl, {
      method: 'POST',
      mode: 'cors',
      // text/plain kasıtlıdır: Apps Script CORS preflight'a yanıt veremez
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`API hatası: Status ${response.status}`);
    }
    return await response.json();
  } catch (err) {
    return { success: false, error: err.message || 'Bağlantı hatası' };
  }
}

// Canlı Verileri E-Tablodan Güncelle
async function syncAllData(isBackground = false) {
  // Bu fonksiyon bazı butonlara doğrudan dinleyici olarak bağlı; o durumda
  // ilk argüman Event nesnesi olur ve "arka plan" sanılırdı (perde ve sonuç
  // bildirimi hiç görünmezdi). Yalnızca gerçek true arka plan sayılır.
  isBackground = isBackground === true;

  // Elde hiç veri yoksa önce önbellekten doldurup çiz: arayüz boş kalmasın.
  // Veri zaten duruyorsa bu adım atlanır — aksi hâlde her eşitlemede tüm
  // sekmeler önce bayat veriyle, sonra taze veriyle olmak üzere iki kez
  // çiziliyor ve arayüz gereksiz yere donuyordu.
  if (!STATE.inventory || STATE.inventory.length === 0) {
    await loadDataFromCache();
    renderAllViews();
  }

  if (!isBackground) {
    toggleLoading(true, 'E-Tablodan canlı veriler çekiliyor...');
  }

  // Envanter, literatür ve fotoğraf kartları AYRI Apps Script uçlarında.
  // Eskiden peş peşe beklenirdi; Apps Script her POST'u 302 ile yönlendirdiği
  // için üç istek mobilde 10-20 sn tutuyordu. Artık üçü aynı anda başlatılıp
  // birlikte beklenir → süre en yavaş isteğin süresine iner.
  const litAyri = !!(STATE.literaturSheetUrl && STATE.literaturSheetUrl !== STATE.sheetUrl);
  const fotoAyri = !!(STATE.photocardsSheetUrl && STATE.photocardsSheetUrl !== STATE.sheetUrl);

  const anaIstek = apiPost('get_all_data');
  const litIstek = litAyri
    ? apiLiteraturPost('get_all_data').catch((err) => ({ success: false, error: err.message }))
    : null;
  const fotoIstek = fotoAyri
    ? apiPhotocardsPost('get_all_data').catch((err) => ({ success: false, error: err.message }))
    : null;

  const [res, litRes, photoRes] = await Promise.all([anaIstek, litIstek, fotoIstek]);

  if (!isBackground) {
    toggleLoading(false);
  }

  // Güvenlik Kuralı: Eğer API auth hatası döndüyse veya hesap pasife alındıysa hemen çıkış yaptır!
  if (res && !res.success && res.error && res.error.indexOf('Yetkilendirme başarısız') > -1) {
    showToast('Oturumunuz sonlandırıldı veya hesabınız pasif yapıldı.', 'danger');
    handleLogout();
    return;
  }

  if (res && res.success) {
    // Kendi yetkilerimizi ve rolümüzü güncelleyelim
    if (res.currentUser && STATE.currentUser) {
      STATE.currentUser.role = res.currentUser.role;
      STATE.currentUser.name = res.currentUser.name;
      STATE.currentUser.permissions = res.currentUser.permissions || [];
      STATE.currentUser.gender = res.currentUser.gender || 'erkek';
      if (res.currentUser.avatar !== undefined) STATE.currentUser.avatar = res.currentUser.avatar || '';

      // Arayüzdeki profil alanlarını yenileyelim
      document.getElementById('user-display-name').textContent = STATE.currentUser.name;
      document.getElementById('user-display-role').textContent = translateRole(STATE.currentUser.role);
      updateProfileBadgeAvatar();

      // UI kısıtlamalarını tekrar uygula
      applyRoleSecurityUI();
    }

    STATE.inventory = (res.inventory || [])
      .map(standardizeInventoryItem)
      .filter(item => item.envanterNo || item.eserAdi || item.timestamp);

    const doluSatir = (item) => Object.keys(item)
      .some(k => k !== '_rowNum' && String(item[k] || '').trim() !== '');

    if (litAyri) {
      if (litRes && litRes.success) {
        STATE.literature = (litRes.literature || []).filter(doluSatir);
      } else {
        console.warn('Literatür API yanıt verdi ama başarısız:', litRes && litRes.error);
        showToast('Literatür verileri çekilemedi: ' + (litRes ? litRes.error : 'Geçersiz yanıt'), 'danger');
      }
    } else {
      STATE.literature = (res.literature || []).filter(doluSatir);
    }

    if (fotoAyri) {
      if (photoRes && photoRes.success) {
        STATE.photocards = (photoRes.literature || photoRes.photocards || []).filter(doluSatir);
      } else {
        console.warn('Fotoğraf Kartları API yanıt verdi ama başarısız:', photoRes && photoRes.error);
      }
    } else {
      STATE.photocards = [];
    }

    if (res.users) STATE.users = res.users;
    if (res.logs) STATE.logs = res.logs;
    STATE.egitim = (res.egitim || []).filter(item => {
      return Object.keys(item).some(k => k !== '_rowNum' && String(item[k] || '').trim() !== '');
    });
    STATE.personnel = res.personnel && res.personnel.length > 0 ? res.personnel : DEFAULT_PERSONNEL;
    STATE.isOffline = false;

    // Önbelleğe yaz
    await writeDataToCache();
    if (!isBackground) {
      showToast('Veriler başarıyla güncellendi.', 'success');
    }

    // Görünümleri Yenile
    renderAllViews();

    // Ana sayfa bildirimlerini hesapla ve göster
    updateHomeNotifications();

    // Eğer mağaza entegrasyonu kurulmuşsa ve yetki varsa mağaza verilerini de çekelim
    const hasMagazaPerm = STATE.currentUser && (STATE.currentUser.role === 'admin' || checkUserPermission(STATE.currentUser.permissions, 'magaza-view'));
    if (STATE.magazaSheetUrl && hasMagazaPerm) {
      await syncMagazaData(true); // Mağazayı da arka planda güncelle
    }
  } else {
    STATE.isOffline = true;
    if (!isBackground) {
      showToast('İnternet bağlantısı kurulamadı veya sunucu hatası.', 'warning');
    }
  }
}

// ==========================================================================
// 4. Oturum & Sayfa Kontrolleri (Auth & SPA Navigation)
// ==========================================================================

// Giriş İşlemi
async function handleLogin(e) {
  e.preventDefault();
  const usernameInput = document.getElementById('login-username');
  const passwordInput = document.getElementById('login-password');

  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  if (!username || !password) {
    showToast('Lütfen kullanıcı adı ve şifre girin.', 'warning');
    return;
  }

  // Deneme sınırı doluysa süre bitene kadar sunucuya istek bile gönderilmez
  if (girisKilidiUygula()) {
    showToast('Çok fazla hatalı deneme yapıldı. Lütfen sayaç bitene kadar bekleyin.', 'danger');
    return;
  }

  if (!STATE.sheetUrl) {
    STATE.sheetUrl = DEFAULT_SHEET_URL;
  }

  toggleLoading(true, 'Giriş yapılıyor...');
  const passwordHash = await sha256(password);

  try {
    const rawRes = await fetch(STATE.sheetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'login',
        username: username,
        passwordHash: passwordHash
      })
    });

    const loginRes = await rawRes.json();
    toggleLoading(false);

    if (loginRes && loginRes.success) {
      STATE.currentUser = {
        username: loginRes.user.username,
        name: loginRes.user.name,
        role: loginRes.user.role,
        gender: loginRes.user.gender || 'erkek',
        avatar: loginRes.user.avatar || '',
        permissions: loginRes.user.permissions || [],
        passwordHash: passwordHash // Sonraki istekler için sakla
      };

      // Beni hatırla değerini oku
      STATE.rememberMe = document.getElementById('login-remember').checked;

      // Ayarları kaydet
      await saveConfig(STATE.sheetUrl);

      // Giriş formunu temizle
      passwordInput.value = '';
      girisDenemesiSifirla();

      setupAppView();
    } else {
      girisDenemesiKaydet(username);
      showToast(loginRes ? loginRes.error : 'Kullanıcı adı veya şifre hatalı.', 'danger');
    }
  } catch (err) {
    toggleLoading(false);
    console.warn('Google Sheets sunucusuna erişilemedi:', err);

    // ---------------------------------------------------------------------
    // ÇEVRİMDIŞI GİRİŞ YOKTUR.
    // Eskiden burada, sunucuya ulaşılamadığında "admin" / "editor" / "yonetici"
    // kullanıcı adları HERHANGİ BİR ŞİFREYLE tam yetkili oturum açabiliyordu.
    // Ağı kesmek (kabloyu çıkarmak, uçak modu, hosts dosyası) bu yolu herkese
    // açtığı için sunucudaki kaba kuvvet kilidi de dahil tüm kimlik doğrulama
    // atlanabiliyordu. Şifre yalnızca sunucuda doğrulanabildiğinden, sunucu
    // yoksa giriş de yoktur.
    //
    // Meşru çevrimdışı kullanım engellenmez: "Beni Hatırla" ile daha önce
    // açılmış oturum, işletim sistemi anahtarlığında şifreli tutulur ve
    // uygulama internetsiz açıldığında kendiliğinden devam eder.
    // ---------------------------------------------------------------------
    girisDenemesiKaydet(username);
    showToast('Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edin — çevrimdışı giriş yapılamaz.', 'danger');
  }
}

// ==========================================================================
// GİRİŞ DENEME SINIRI (istemci tarafı)
// --------------------------------------------------------------------------
// Asıl koruma sunucudadır: Apps Script, kullanıcı adı başına 5 hatalı denemeden
// sonra hesabı 15 dakika kilitler. Buradaki sayaç onu tamamlar:
//   • Hatalı denemeyi kullanıcıya görünür kılar ve geri sayım gösterir,
//   • Sunucuya gereksiz istek yağmasını keser,
//   • Sunucuya hiç ulaşılamadığı durumda da (ağ kesik) deneme yağmurunu durdurur.
// localStorage silinerek sıfırlanabilir; bu yüzden tek başına güvenlik sınırı
// değildir, sunucudaki kilit her hâlükârda geçerlidir.
// ==========================================================================
const GIRIS_MAX_DENEME = 5;
const GIRIS_KILIT_SANIYE = 15 * 60;
const GIRIS_DENEME_ANAHTARI = 'eo_giris_denemeleri';

let _girisGeriSayimTimer = null;

function girisDenemeDurumu() {
  try {
    const ham = localStorage.getItem(GIRIS_DENEME_ANAHTARI);
    if (!ham) return { sayi: 0, kilitBitis: 0 };
    const d = JSON.parse(ham);
    return { sayi: Number(d.sayi) || 0, kilitBitis: Number(d.kilitBitis) || 0 };
  } catch (e) {
    return { sayi: 0, kilitBitis: 0 };
  }
}

function girisDenemeYaz(durum) {
  try {
    localStorage.setItem(GIRIS_DENEME_ANAHTARI, JSON.stringify(durum));
  } catch (e) { /* depolama kapalıysa sunucu kilidi yeterlidir */ }
}

function girisDenemesiSifirla() {
  try { localStorage.removeItem(GIRIS_DENEME_ANAHTARI); } catch (e) {}
  girisKilidiUygula();
}

function girisDenemesiKaydet(kullaniciAdi) {
  const durum = girisDenemeDurumu();
  durum.sayi += 1;
  durum.sonKullanici = String(kullaniciAdi || '').slice(0, 60);
  if (durum.sayi >= GIRIS_MAX_DENEME) {
    durum.kilitBitis = Date.now() + GIRIS_KILIT_SANIYE * 1000;
    durum.sayi = 0;
  }
  girisDenemeYaz(durum);
  girisKilidiUygula();
}

// Kilit varsa giriş formunu kapatır ve geri sayımı gösterir.
function girisKilidiUygula() {
  const btn = document.getElementById('btn-login');
  const uyari = document.getElementById('login-lock-notice');
  const durum = girisDenemeDurumu();
  const kalanMs = durum.kilitBitis - Date.now();

  if (_girisGeriSayimTimer) {
    clearInterval(_girisGeriSayimTimer);
    _girisGeriSayimTimer = null;
  }

  if (kalanMs <= 0) {
    if (btn) { btn.disabled = false; btn.textContent = 'Giriş Yap'; }
    if (uyari) uyari.classList.add('hidden');
    if (durum.kilitBitis) girisDenemeYaz({ sayi: 0, kilitBitis: 0 });
    return false;
  }

  const yazdir = () => {
    const kalan = Math.max(0, Math.ceil((girisDenemeDurumu().kilitBitis - Date.now()) / 1000));
    if (kalan <= 0) { girisKilidiUygula(); return; }
    const dk = Math.floor(kalan / 60);
    const sn = String(kalan % 60).padStart(2, '0');
    if (uyari) {
      uyari.classList.remove('hidden');
      uyari.textContent = `🔒 Çok fazla hatalı deneme. Yeni giriş için ${dk}:${sn} bekleyin.`;
    }
    if (btn) { btn.disabled = true; btn.textContent = `Kilitli (${dk}:${sn})`; }
  };

  yazdir();
  _girisGeriSayimTimer = setInterval(yazdir, 1000);
  return true;
}

// Çıkış Yap
async function handleLogout() {
  try { modulOnbelleginiTemizle(); } catch (e) { /* yok say */ }
  STATE.currentUser = null;
  STATE.rememberMe = false;

  if (window.api && window.api.isElectron) {
    const cache = await window.api.readLocalCache('config.json');
    if (cache) {
      cache.currentUser = null;
      await window.api.writeLocalCache('config.json', cache);
    }
  } else {
    localStorage.removeItem('eo_current_user');
  }

  // Satış moduna kilitlenmiş kabuğu geri aç; sonraki kullanıcı tam paneli görsün.
  document.body.classList.remove('sales-only');

  document.getElementById('app-layout').classList.add('hidden');
  document.getElementById('login-view').classList.remove('hidden');
  showToast('Oturum kapatıldı.', 'info');
}

// Uygulama Ekranını Hazırla
function setupAppView() {
  // Rol belli olduktan SONRA ayar formunu yeniden doldur: yönetici değilse
  // Apps Script adresleri maskelenir.
  try { populateSettingsForm(); } catch (e) { console.error(e); }

  document.getElementById('login-view').classList.add('hidden');
  document.getElementById('app-layout').classList.remove('hidden');

  // Profil Alanını Doldur
  document.getElementById('user-display-name').textContent = STATE.currentUser.name;
  document.getElementById('user-display-role').textContent = translateRole(STATE.currentUser.role);
  updateProfileBadgeAvatar();

  // Yetki Kısıtlamalarını Uygula
  applyRoleSecurityUI();

  // Modül önbelleğini (materyal, prototip, koruma, müze, bülten...) diskten
  // geri yükle: sekmelere ilk dokunuşta ekran boş kalmasın, veri ağdan
  // gelene kadar önbellekteki hâli görünsün.
  try { modulOnbelleginiYukle(); } catch (e) { console.warn('Modül önbelleği yüklenemedi:', e); }

  // Yedekleme kartını hazırla (yalnızca admin; durum arka planda yüklenir)
  try { yedekKartiHazirla(); } catch (e) { console.warn('Yedek kartı hazırlanamadı:', e); }

  // Karşılama Bildirimi
  const title = STATE.currentUser.gender === 'kadin' ? 'hanım' : 'bey';
  showToast(`Hoş geldiniz, ${STATE.currentUser.name} ${title}!`, 'success');

  // Verileri Senkronize Et (Arka Planda)
  syncAllData(true);

  // İlk bölüme git (Anasayfa). Yalnızca mağaza yetkisi olan personel için
  // uygulama doğrudan sadeleştirilmiş Satış Ekranı'na kilitlenir.
  showSection('anasayfa-view');
  try {
    const kilitli = applySalesOnlyMode();
    // Telefon ana ekranındaki "Satış" kısayolu (manifest shortcuts) buraya düşer
    if (!kilitli && window.location.hash === '#satis'
        && checkUserPermission(STATE.currentUser.permissions, 'magaza-view')) {
      showSection('satis-modu-view');
    }
  } catch (e) {
    console.error('Satış modu uygulanamadı:', e);
  }

  // Ana sayfa bildirimlerini yükle
  updateHomeNotifications();

  // Ağır dışa aktarım kütüphanelerini açılış bittikten sonra sessizce al
  try { agirKutuphaneleriOndenAl(); } catch (e) { /* yok say */ }
}

// Rolü Türkçeye Çevir
function translateRole(role) {
  const roles = {
    'admin': 'Yönetici (Admin)',
    'editor': 'Editör',
    'okuyucu': 'Okuyucu (Reader)'
  };
  return roles[role] || role;
}

// İzinleri Esnek ve Güvenli Şekilde Kontrol Eder (Türkçe karakterler, farklı isimlendirmeler vb.)
// Kullanıcı başına ayrı sütunda tutulan (sonradan eklenen) sekmeler; sunucudaki YETKI_EK_SUTUNLARI ile aynı.
const YETKI_EK_SEKMELERI = ['egitim-view', 'fotograf-kartlari-view', 'mesajlar-view', 'sanal-muze-view', 'satis-modu-view'];

function checkUserPermission(permissions, target) {
  if (!permissions) return false;

  let permArray = [];
  if (typeof permissions === 'string') {
    permArray = permissions.split(',').map(p => p.trim().toLowerCase()).filter(Boolean);
  } else if (Array.isArray(permissions)) {
    permArray = permissions.map(p => String(p).trim().toLowerCase()).filter(Boolean);
  } else {
    return false;
  }

  const t = String(target).trim().toLowerCase();

  // Güncel sunucu bu sekmelerin izinlerini kullanıcı başına hesaplayıp listeye koyar
  // ve "yetki-v2" işaretini ekler. İşaret yoksa (eski sunucu) aşağıdaki türetme geçerlidir.
  if (permArray.includes('yetki-v2') && YETKI_EK_SEKMELERI.includes(t)) {
    return permArray.includes(t);
  }

  if (t === 'mesajlar-view' || t === 'anasayfa-view' || t === 'ayarlar-view' || t === 'egitim-view') {
    return true;
  }

  // Satış Ekranı, Mağaza Satış Yönetimi ile aynı yetkiden geçer.
  if (t === 'satis-modu-view') {
    return checkUserPermission(permissions, 'magaza-view');
  }

  // Sanal Müze envanterin dışa açılan yüzüdür; ayrı bir yetki sütunu açmak
  // yerine "Envanter Yönetimi" yetkisiyle çalışır. Böylece mevcut dağıtımlarda
  // Kullanicilar e-tablosuna sütun eklemeye ve yeniden yetkilendirmeye gerek
  // kalmaz. API anahtarı yönetimi ayrıca yalnızca yöneticiye açıktır.
  if (t === 'sanal-muze-view') {
    return checkUserPermission(permissions, 'envanter-view');
  }

  // E-Bülten kurum adına dışarıya toplu e-posta gönderir; bu bir yönetim
  // sorumluluğudur. showSection yönetici rolünü zaten geçirdiği için burada
  // yalnızca yönetici olmayanlar değerlendirilir ve erişim verilmez.
  if (t === 'bulten-view') {
    return false;
  }

  if (t === 'envanter-view') {
    return permArray.includes('envanter-view') ||
      permArray.includes('envanter') ||
      permArray.includes('envanter yönetimi') ||
      permArray.includes('envanter yonetimi');
  }
  if (t === 'personel-view') {
    return permArray.includes('personel-view') ||
      permArray.includes('personel') ||
      permArray.includes('personel ürün takibi') ||
      permArray.includes('personel ve proje takibi') ||
      permArray.includes('personel urun takibi');
  }
  if (t === 'atolye-personel-view') {
    return permArray.includes('atolye-personel-view') ||
      permArray.includes('personel-view') ||
      permArray.includes('personel') ||
      permArray.includes('atölye & personel') ||
      permArray.includes('atolye & personel') ||
      permArray.includes('atölye') ||
      permArray.includes('atolye');
  }
  if (t === 'literatur-view') {
    return permArray.includes('literatur-view') ||
      permArray.includes('literatür-view') ||
      permArray.includes('literatur') ||
      permArray.includes('literatür') ||
      permArray.includes('literatür ve saha') ||
      permArray.includes('literatur ve saha');
  }
  if (t === 'fotograf-kartlari-view') {
    return permArray.includes('fotograf-kartlari-view') ||
      permArray.includes('fotograf-view') ||
      permArray.includes('fotoğraf-view') ||
      permArray.includes('fotoğraf') ||
      permArray.includes('fotograf') ||
      permArray.includes('fotoğraf bilgi kartları') ||
      permArray.includes('fotograf bilgi kartlari') ||
      permArray.includes('literatur-view') ||
      permArray.includes('literatür-view') ||
      permArray.includes('literatur') ||
      permArray.includes('literatür');
  }
  if (t === 'rapor-view') {
    return permArray.includes('rapor-view') ||
      permArray.includes('rapor') ||
      permArray.includes('raporlar') ||
      permArray.includes('istatistik') ||
      permArray.includes('istatistik raporları') ||
      permArray.includes('istatistik raporlari');
  }
  if (t === 'magaza-view') {
    return permArray.includes('magaza-view') ||
      permArray.includes('mağaza-view') ||
      permArray.includes('magaza') ||
      permArray.includes('mağaza') ||
      permArray.includes('mağaza satış') ||
      permArray.includes('magaza satis') ||
      permArray.includes('mağaza satış yönetimi') ||
      permArray.includes('magaza satis yonetimi');
  }
  if (t === 'ayarlar-view') {
    return permArray.includes('ayarlar-view') || permArray.includes('ayarlar');
  }

  return permArray.includes(t);
}

// Rol Bazlı Yetkilendirme (UI Sınırları)
function applyRoleSecurityUI() {
  const role = STATE.currentUser.role;
  const permissions = STATE.currentUser.permissions || [];

  // 1. Sidebar Link Koruması (Admin Only - Sadece navigasyon olmayan elementleri gizle/göster)
  const adminElements = document.querySelectorAll('.admin-only');
  adminElements.forEach(el => {
    if (el.tagName === 'LI' || el.classList.contains('nav-item') || el.classList.contains('drawer-nav-item')) {
      el.classList.remove('hidden');
    } else {
      if (role === 'admin') {
        el.classList.remove('hidden');
      } else {
        el.classList.add('hidden');
      }
    }
  });

  // 2. Arayüz Yazma İzinleri (Gizleme/Pasifleştirme)
  const writeElements = document.querySelectorAll('.write-permission');
  writeElements.forEach(el => {
    if (role === 'admin' || role === 'editor') {
      el.removeAttribute('disabled');
      el.classList.remove('hidden');
    } else {
      el.setAttribute('disabled', 'true');
      el.classList.add('hidden'); // Okuyucular için kritik butonları tamamen gizle
    }
  });

  // 3. Sayfa bazlı izin kontrolü (Tümünü görünür kılıyoruz, yetki kısıtlamasını tıklama/giriş anında showSection ile kontrol ediyoruz)
  const navItems = document.querySelectorAll('.nav-item, .drawer-nav-item, .mobile-nav-item');
  navItems.forEach(item => {
    if (item.getAttribute('data-target') === 'fotograf-kartlari-view') {
      return;
    }
    item.classList.remove('hidden');
    const parentLi = item.closest('li');
    if (parentLi) parentLi.classList.remove('hidden');
  });

  // 4. Anasayfa Hızlı Link Yetkilendirmesi (Hepsi görünür kalır)
  const quickNavs = [
    { id: 'btn-quick-envanter', target: 'envanter-view' },
    { id: 'btn-quick-personel', target: 'personel-view' },
    { id: 'btn-quick-literatur', target: 'literatur-view' },
    { id: 'btn-quick-magaza', target: 'magaza-view' },
    { id: 'btn-quick-photocards', target: 'fotograf-kartlari-view' }
  ];

  quickNavs.forEach(nav => {
    const el = document.getElementById(nav.id);
    if (!el) return;
    el.classList.remove('hidden');
  });
}

// Bölüm Değiştir
function showSection(targetId) {
  let isAllowed = true;
  if (STATE.currentUser && targetId !== 'anasayfa-view') {
    const role = STATE.currentUser.role;
    if (role !== 'admin') {
      const permissions = STATE.currentUser.permissions || [];
      isAllowed = checkUserPermission(permissions, targetId);
    }
  }

  STATE.activeView = targetId;

  // Tüm bölümleri pasifleştir
  const sections = document.querySelectorAll('.content-section');
  sections.forEach(s => s.classList.remove('active'));

  // Hedef bölümü aktifleştir
  const targetSection = document.getElementById(targetId);
  if (targetSection) {
    targetSection.classList.add('active');

    // Gated yetki kontrolü
    if (!isAllowed) {
      targetSection.classList.add('gated-restricted');
      let card = targetSection.querySelector('.unauthorized-card');
      if (!card) {
        card = document.createElement('div');
        card.className = 'unauthorized-card';
        card.innerHTML = `
          <div class="unauthorized-icon">🔒</div>
          <h2>Erişim Kısıtlandı</h2>
          <p>Bu ekran için yetkiniz bulunmamaktadır.</p>
          <p class="it-contact">Lütfen IT birimi ile iletişime geçin.</p>
        `;
        targetSection.appendChild(card);
      }
    } else {
      targetSection.classList.remove('gated-restricted');
      const card = targetSection.querySelector('.unauthorized-card');
      if (card) {
        card.remove();
      }
    }
  }

  // ------------------------------------------------------------------
  // Sekme içeriği: ÖNCE önbellekten çiz (anında görünsün), SONRA gerekiyorsa
  // arka planda tazele. sekmeTazele() veri TTL içindeyse ağa hiç çıkmaz;
  // böylece sekmeler arasında gidip gelmek ücretsiz hâle gelir.
  // ------------------------------------------------------------------

  // Eşitleme sonrası sıraya alınmış ama sırası gelmemiş çizim varsa öne al.
  bekleyenCizimleriTamamla(targetId);

  if (targetId === 'magaza-view') {
    renderMagazaDashboard();
    sekmeTazele('magaza', () => syncMagazaData(true));
  }

  if (targetId === 'satis-modu-view') {
    renderSatisModu();
    // Satış ekranı kasa gibi çalışır: stok sapmaması için tazelik süresi kısa.
    sekmeTazele('magaza', () => syncMagazaData(true).then(() => renderSatisModu()), 30000);
  }

  if (targetId === 'literatur-view') {
    renderLiterature();
    renderPhotoCards();
    onbellektenCiz('prototipler', renderPrototipler);
    onbellektenCiz('koruma', renderKoruma);
    sekmeTazele('prototipler', () => syncPrototipler(true));
    sekmeTazele('koruma', () => syncKoruma(true));
  }

  // E-Bülten paneli (yalnızca yönetici)
  if (targetId === 'bulten-view') {
    renderBulten();
    sekmeTazele('bulten', () => syncBulten(true));
  }

  // Envanter paneli: tedarikçi ağı verisi arka planda tazelenir
  if (targetId === 'envanter-view') {
    onbellektenCiz('tedarik', () => {
      renderTedarikciler();
      renderSiparisler();
      renderTedarikRaporu();
    });
    sekmeTazele('tedarik', () => syncTedarik(true));
  }

  // Sanal Müze: kürasyon listesi envanterden çizilir, sergi kayıtları tazelenir
  if (targetId === 'sanal-muze-view') {
    renderMuzeTumu();
    sekmeTazele('muze', () => syncMuze(true));
  }

  if (targetId === 'atolye-personel-view') {
    renderAtolyePersonel();
    sekmeTazele('surdurulebilirlik', () => syncSurdurulebilirlik(true, _suFiltre));
  }

  if (targetId === 'egitim-view') {
    renderEgitim();
    // Materyal ve belge listeleri önbellekten hemen çizilir, gerekiyorsa
    // arka planda tazelenir; aktif alt sekme hangisiyse orası dolu gelir.
    onbellektenCiz('materyaller', renderMateryaller);
    onbellektenCiz('sertifikalar', () => {
      renderSertifikaAdaylari();
      renderSertifikalar();
    });
    sekmeTazele('materyaller', () => syncMateryaller(true));
    sekmeTazele('sertifikalar', () => syncSertifikalar(true));
  }

  // Eğer mesajlar paneli açılıyorsa mesajları yükle ve göster
  if (targetId === 'mesajlar-view') {
    loadMessages();
  }

  // Sidebar butonlarını güncelle
  const navItems = document.querySelectorAll('.nav-item, .drawer-nav-item, .mobile-nav-item');
  navItems.forEach(item => {
    if (item.getAttribute('data-target') === targetId) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  // Mobile Drawer kapat
  document.getElementById('mobile-drawer').classList.add('hidden');
}

// ==========================================================================
// 5. Görünüm Katmanı (View Renderers)
// ==========================================================================

// --------------------------------------------------------------------------
// ÖNCELİKLİ ÇİZİM
// Eskiden her eşitlemede bütün sekmeler tek seferde çizilirdi. Bir eşitleme
// sonrası ana iş parçacığı saniyelerce bloke olduğu için dokunmalar geç
// yanıt veriyor, sekme geçişi "donmuş" gibi görünüyordu. Artık:
//   • AÇIK olan sekme hemen çizilir,
//   • diğerleri tarayıcı boşa çıktıkça tek tek çizilir,
//   • kullanıcı sırası gelmemiş bir sekmeye geçerse o çizim öne alınır.
// Sonuç değişmez (her sekme yine güncellenir), yalnızca sıraya girer.
// --------------------------------------------------------------------------

const _cizimGorevleri = {
  filtreler:    () => populateDropdownFilters(),
  envanter:     () => renderInventory(),
  kampus:       () => { if (typeof renderCampusMap === 'function') renderCampusMap(); },
  personel:     () => renderPersonnel(),
  literatur:    () => renderLiterature(),
  fotograf:     () => renderPhotoCards(),
  egitim:       () => renderEgitim(),
  atolye:       () => renderAtolyePersonel(),
  raporlar:     () => renderReports(),
  kullanicilar: () => { if (STATE.currentUser && STATE.currentUser.role === 'admin') renderUsers(); },
  loglar:       () => { if (STATE.currentUser && STATE.currentUser.role === 'admin') renderLogs(); },
  magaza:       () => {
    if (!STATE.currentUser) return;
    const yetkili = STATE.currentUser.role === 'admin'
      || checkUserPermission(STATE.currentUser.permissions, 'magaza-view');
    if (yetkili) renderMagazaDashboard();
  }
};

// Hangi sekme hangi çizim görevlerine bağlı (sıra önemlidir: filtreler önce).
const VIEW_CIZIM_GOREVLERI = {
  'anasayfa-view': ['kampus'],
  'envanter-view': ['filtreler', 'envanter'],
  'personel-view': ['personel'],
  'literatur-view': ['literatur', 'fotograf'],
  'fotograf-kartlari-view': ['fotograf'],
  'egitim-view': ['egitim'],
  'atolye-personel-view': ['atolye'],
  'rapor-view': ['raporlar'],
  'kullanici-view': ['kullanicilar'],
  'log-view': ['loglar'],
  'magaza-view': ['magaza'],
  'satis-modu-view': ['magaza']
};

let _bekleyenCizimler = new Set();

function _cizimYap(ad) {
  _bekleyenCizimler.delete(ad);
  const gorev = _cizimGorevleri[ad];
  if (!gorev) return;
  try {
    gorev();
  } catch (err) {
    console.warn('[Çizim] "' + ad + '" başarısız:', err);
  }
}

function _bosZamanda(fn) {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(fn, { timeout: 1200 });
  else setTimeout(fn, 0);
}

function renderAllViews() {
  if (!STATE.currentUser) return;

  const tumGorevler = Object.keys(_cizimGorevleri);
  _bekleyenCizimler = new Set(tumGorevler);

  // 1) Açık sekme anında
  (VIEW_CIZIM_GOREVLERI[STATE.activeView] || []).forEach(_cizimYap);

  // 2) Kalanlar sırayla, tarayıcı boşa çıktıkça
  const kalan = tumGorevler.filter((ad) => _bekleyenCizimler.has(ad));
  let i = 0;
  const adim = () => {
    while (i < kalan.length && !_bekleyenCizimler.has(kalan[i])) i++;
    if (i >= kalan.length) return;
    _cizimYap(kalan[i++]);
    _bosZamanda(adim);
  };
  _bosZamanda(adim);
}

/**
 * Bir sekmeye geçilirken, o sekmenin sırası gelmemiş çizimi varsa öne alınır.
 * Böylece kullanıcı hiçbir zaman yarı boş bir tabloyla karşılaşmaz.
 */
function bekleyenCizimleriTamamla(targetId) {
  const gorevler = VIEW_CIZIM_GOREVLERI[targetId];
  if (!gorevler) return;
  gorevler.forEach((ad) => { if (_bekleyenCizimler.has(ad)) _cizimYap(ad); });
}

// Filtre Açılır Kutularını Doldur
function populateDropdownFilters() {
  const themeFilter = document.getElementById('filter-theme');
  const typeFilter = document.getElementById('filter-type');
  const workshopFilter = document.getElementById('filter-workshop');
  const personnelFilter = document.getElementById('filter-personnel');
  const techniqueFilter = document.getElementById('filter-technique');
  const materialFilter = document.getElementById('filter-material');
  const stockFilter = document.getElementById('filter-stock');

  // Benzersiz Temaları bul
  const themes = new Set();
  const types = new Set();
  const workshops = new Set();
  const personnelList = new Set();
  const techniques = new Set();
  const materials = new Set();
  const stocks = new Set();

  STATE.inventory.forEach(item => {
    const tema = getValueByFuzzyKey(item, ['Tema', 'Temalar']);
    const cins = getValueByFuzzyKey(item, ['Ürün Cinsi', 'Cinsi', 'Cins', 'Ürün Tipi']);
    const atolye = getValueByFuzzyKey(item, ['Atölye', 'Üretim Yeri', 'Grup-Tip', 'Grup', 'Grup/Tip', 'atolye']);
    const kisi = getValueByFuzzyKey(item, ['Giriş Yapan Personel', 'Personel', 'Ad Soyad', 'Usta Öğretici']);
    const teknik = getValueByFuzzyKey(item, ['Kullanılan Teknik', 'Teknik', 'Türü-Tekniği', 'Türü Tekniği', 'kullanilan teknik']);
    const malzeme = getValueByFuzzyKey(item, ['Cinsi (Kullanılan Malzeme)', 'Kullanılan Malzeme', 'Malzeme Cinsi', 'Malzeme']);
    const stok = getValueByFuzzyKey(item, ['Stok Durumu', 'Stok']);

    if (tema) themes.add(String(tema).trim());
    if (cins) types.add(String(cins).trim());
    if (atolye) workshops.add(String(atolye).trim());
    if (kisi) personnelList.add(String(kisi).trim());
    if (teknik) techniques.add(String(teknik).trim());
    if (malzeme) materials.add(String(malzeme).trim());
    if (stok) stocks.add(String(stok).trim());
  });

  // Tema Filtresi Temizle ve Doldur
  if (themeFilter) {
    const prevVal = themeFilter.value;
    themeFilter.innerHTML = '<option value="all">Tüm Temalar</option>';
    Array.from(themes).sort((a, b) => a.localeCompare(b, 'tr')).forEach(t => {
      if (t) themeFilter.innerHTML += `<option value="${t}">${t}</option>`;
    });
    themeFilter.value = prevVal || 'all';
  }

  // Ürün Cinsi Temizle ve Doldur
  if (typeFilter) {
    const prevVal = typeFilter.value;
    typeFilter.innerHTML = '<option value="all">Tüm Cinsler</option>';
    Array.from(types).sort((a, b) => a.localeCompare(b, 'tr')).forEach(t => {
      if (t) typeFilter.innerHTML += `<option value="${t}">${t}</option>`;
    });
    typeFilter.value = prevVal || 'all';
  }

  // Atölye Filtresi Temizle ve Doldur
  if (workshopFilter) {
    const prevVal = workshopFilter.value;
    workshopFilter.innerHTML = '<option value="all">Tüm Atölyeler</option>';
    Array.from(workshops).sort((a, b) => a.localeCompare(b, 'tr')).forEach(w => {
      if (w) workshopFilter.innerHTML += `<option value="${w}">${w}</option>`;
    });
    workshopFilter.value = prevVal || 'all';
  }

  // Personel Filtresi Temizle ve Doldur
  if (personnelFilter) {
    const prevVal = personnelFilter.value;
    personnelFilter.innerHTML = '<option value="all">Tüm Personel</option>';
    Array.from(personnelList).sort((a, b) => a.localeCompare(b, 'tr')).forEach(p => {
      if (p) personnelFilter.innerHTML += `<option value="${p}">${p}</option>`;
    });
    personnelFilter.value = prevVal || 'all';
  }

  // Teknik Filtresi Temizle ve Doldur
  if (techniqueFilter) {
    const prevVal = techniqueFilter.value;
    techniqueFilter.innerHTML = '<option value="all">Tüm Teknikler</option>';
    Array.from(techniques).sort((a, b) => a.localeCompare(b, 'tr')).forEach(t => {
      if (t) techniqueFilter.innerHTML += `<option value="${t}">${t}</option>`;
    });
    techniqueFilter.value = prevVal || 'all';
  }

  // Malzeme Filtresi Temizle ve Doldur
  if (materialFilter) {
    const prevVal = materialFilter.value;
    materialFilter.innerHTML = '<option value="all">Tüm Malzemeler</option>';
    Array.from(materials).sort((a, b) => a.localeCompare(b, 'tr')).forEach(m => {
      if (m) materialFilter.innerHTML += `<option value="${m}">${m}</option>`;
    });
    materialFilter.value = prevVal || 'all';
  }

  // Stok Filtresi Temizle ve Doldur
  if (stockFilter) {
    const prevVal = stockFilter.value;
    stockFilter.innerHTML = '<option value="all">Tüm Stok Durumları</option>';
    Array.from(stocks).sort((a, b) => a.localeCompare(b, 'tr')).forEach(s => {
      if (s) stockFilter.innerHTML += `<option value="${s}">${s}</option>`;
    });
    stockFilter.value = prevVal || 'all';
  }
}

// --- Modül 1: Envanter Yönetimi Listesi ---
function renderInventory() {
  const tbody = document.getElementById('inventory-tbody');
  const noData = document.getElementById('inventory-no-data');
  if (!tbody) return;
  renderEnvanterFoto();

  const searchQuery = document.getElementById('inventory-search').value.toLowerCase().trim();
  const statusFilter = document.getElementById('filter-status').value;
  const themeFilter = document.getElementById('filter-theme').value;
  const typeFilter = document.getElementById('filter-type').value;

  // Gelişmiş filtreleri al
  const workshopFilter = document.getElementById('filter-workshop') ? document.getElementById('filter-workshop').value : 'all';
  const personnelFilter = document.getElementById('filter-personnel') ? document.getElementById('filter-personnel').value : 'all';
  const techniqueFilter = document.getElementById('filter-technique') ? document.getElementById('filter-technique').value : 'all';
  const materialFilter = document.getElementById('filter-material') ? document.getElementById('filter-material').value : 'all';
  const stockFilter = document.getElementById('filter-stock') ? document.getElementById('filter-stock').value : 'all';
  const startDateVal = document.getElementById('filter-start-date') ? document.getElementById('filter-start-date').value : '';
  const endDateVal = document.getElementById('filter-end-date') ? document.getElementById('filter-end-date').value : '';

  tbody.innerHTML = '';

  // Veriyi Filtrele
  const filtered = STATE.inventory.filter(item => {
    // Arama Kelimesi Filtresi
    const matchSearch = searchQuery === '' ||
      String(item.envanterNo).toLowerCase().includes(searchQuery) ||
      String(item.eserAdi).toLowerCase().includes(searchQuery) ||
      String(item.personel).toLowerCase().includes(searchQuery) ||
      String(item.tema).toLowerCase().includes(searchQuery);

    // Durum Filtresi
    let matchStatus = true;
    const currentStatusLower = String(item.durum).toLowerCase().replace(/[^a-z0-9ıışğüöç]/g, '');
    if (statusFilter === '1Grafik birimi bekleniyor') {
      matchStatus = currentStatusLower.includes('grafik') || currentStatusLower.includes('bekleniyor') || currentStatusLower.includes('gorsel');
    } else if (statusFilter === 'Arşive Eklendi / Fiş Tamam') {
      matchStatus = currentStatusLower.includes('arsiveeklendi') || currentStatusLower.includes('fistamam') || currentStatusLower.includes('onaylandi');
    } else if (statusFilter === 'other') {
      const isPending = currentStatusLower.includes('grafik') || currentStatusLower.includes('bekleniyor') || currentStatusLower.includes('gorsel');
      const isCompleted = currentStatusLower.includes('arsiveeklendi') || currentStatusLower.includes('fistamam') || currentStatusLower.includes('onaylandi');
      matchStatus = !isPending && !isCompleted;
    }

    // Tema Filtresi
    const matchTheme = themeFilter === 'all' || String(item.tema).trim() === themeFilter;

    // Ürün Cinsi Filtresi
    const matchType = typeFilter === 'all' || String(item.cins).trim() === typeFilter;

    // Atölye Filtresi
    const matchWorkshop = workshopFilter === 'all' || String(item.atolye).trim() === workshopFilter;

    // Personel Filtresi
    const matchPersonnel = personnelFilter === 'all' || String(item.personel).trim() === personnelFilter;

    // Teknik Filtresi
    const matchTechnique = techniqueFilter === 'all' || String(item.teknik).trim() === techniqueFilter;

    // Malzeme Filtresi
    const matchMaterial = materialFilter === 'all' || String(item.malzeme).trim() === materialFilter;

    // Stok Filtresi
    const matchStock = stockFilter === 'all' || String(item.stok).trim() === stockFilter;

    // Tarih Filtresi
    let matchDate = true;
    if (startDateVal || endDateVal) {
      matchDate = isDateInRange(item.timestamp, startDateVal, endDateVal);
    }

    return matchSearch && matchStatus && matchTheme && matchType && matchWorkshop && matchPersonnel && matchDate && matchTechnique && matchMaterial && matchStock;
  });

  // Filtrelenen güncel veriyi küresel/window nesnede sakla
  window._lastFilteredInventory = filtered;

  // Uygulanan filtreleri metin haline getir ve sakla
  const filtersApplied = [];
  if (searchQuery) filtersApplied.push(`Arama: "${searchQuery}"`);
  if (statusFilter !== 'all') filtersApplied.push(`Durum: ${statusFilter}`);
  if (themeFilter !== 'all') filtersApplied.push(`Tema: ${themeFilter}`);
  if (typeFilter !== 'all') filtersApplied.push(`Cins: ${typeFilter}`);
  if (workshopFilter !== 'all') filtersApplied.push(`Atölye: ${workshopFilter}`);
  if (personnelFilter !== 'all') filtersApplied.push(`Personel: ${personnelFilter}`);
  if (techniqueFilter !== 'all') filtersApplied.push(`Teknik: ${techniqueFilter}`);
  if (materialFilter !== 'all') filtersApplied.push(`Malzeme: ${materialFilter}`);
  if (stockFilter !== 'all') filtersApplied.push(`Stok: ${stockFilter}`);
  if (startDateVal) filtersApplied.push(`Başlangıç: ${startDateVal}`);
  if (endDateVal) filtersApplied.push(`Bitiş: ${endDateVal}`);
  window._lastFilteredInventoryFiltersStr = filtersApplied.join(', ') || 'Yok (Tümü)';

  // Filtre durum etiketini yenile
  const countLabel = document.getElementById('filtered-inventory-count');
  if (countLabel) {
    countLabel.textContent = `Filtrelenen: ${filtered.length} / ${STATE.inventory.length} Eser`;
  }

  // Sıralama Uygula
  const sortVal = document.getElementById('sort-inventory') ? document.getElementById('sort-inventory').value : 'default';
  if (sortVal === 'date-desc' || sortVal === 'date-asc') {
    filtered.sort((a, b) => {
      const dateA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const dateB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return sortVal === 'date-desc' ? dateB - dateA : dateA - dateB;
    });
  } else if (sortVal === 'theme-asc') {
    filtered.sort((a, b) => {
      return String(a.tema || '').localeCompare(String(b.tema || ''), 'tr');
    });
  } else if (sortVal === 'status-asc') {
    filtered.sort((a, b) => {
      return String(a.durum || '').localeCompare(String(b.durum || ''), 'tr');
    });
  }

  if (filtered.length === 0) {
    noData.classList.remove('hidden');
    return;
  }
  noData.classList.add('hidden');

  // Tablo Satırlarını Oluştur
  // Satırlar canlı tabloya tek tek değil, önce bir DocumentFragment'e eklenir;
  // böylece tarayıcı her satırda yeniden yerleşim (reflow) yapmaz. Binlerce
  // eserde bu tek başına saniyeler kazandırır.
  const parca = document.createDocumentFragment();
  filtered.forEach(item => {
    const tr = document.createElement('tr');
    tr.setAttribute('data-row', item._rowNum);

    const statusValClean = String(item.durum).toLowerCase().replace(/[^a-z0-9ıışğüöç]/g, '');
    let statusClass = 'badge-role'; // default grey/gold

    const isCompleted = statusValClean.includes('arsiv') || statusValClean.includes('arşiv') || statusValClean.includes('tamam') || statusValClean.includes('onay');
    const isPending = statusValClean.includes('grafik') || statusValClean.includes('bekle') || statusValClean.includes('gorsel') || statusValClean.includes('görsel');

    if (isCompleted) {
      statusClass = 'badge-success';
    } else if (isPending) {
      statusClass = 'badge-warning';
    }

    // Thumbnail (Görsel) URL
    const thumbUrl = getDriveThumbnailUrl(item.linkImage);
    const imgHtml = thumbUrl
      ? `<img src="${thumbUrl}" loading="lazy" decoding="async" referrerpolicy="no-referrer" alt="Görsel" class="table-thumb" data-external-url="${escapeHtml(item.linkImage)}" style="cursor: pointer;" data-fallback="favicon">`
      : `<div class="table-thumb-placeholder">🖼️</div>`;

    // Mobile responsive data-labels definition
    tr.innerHTML = `
      <td data-label="Görsel">${imgHtml}</td>
      <td data-label="Envanter No"><strong class="clickable-cell">${item.envanterNo || '-'}</strong></td>
      <td data-label="Eser Adı"><span class="clickable-cell">${item.eserAdi || '-'}</span></td>
      <td data-label="Personel">${item.personel || '-'}</td>
      <td data-label="Tema">${item.tema || '-'}</td>
      <td data-label="Cins">${item.cins || '-'}</td>
      <td data-label="Durum"><span class="badge ${statusClass}" style="padding: 0.35rem 0.6rem; font-size: 0.7rem;">${item.durum && item.durum !== 'undefined' ? item.durum : 'Belirtilmemiş'}</span></td>
      <td>
        <button class="btn btn-outline-primary btn-sm btn-edit" data-row="${item._rowNum}">İncele / Düzenle</button>
      </td>
    `;

    parca.appendChild(tr);
  });
  tbody.appendChild(parca);
}

// --- Modül 2: Personel Ürün Takibi ---
function renderPersonnel() {
  const personnelList = document.getElementById('personnel-list');
  const statActive = document.getElementById('stat-active-personnel');
  const statTotal = document.getElementById('stat-total-products');
  const statPending = document.getElementById('stat-pending-graphics');
  const statCompleted = document.getElementById('stat-completed-products');

  // İstatistikleri Hesapla
  const personnelMap = new Map(); // Personel adı -> { total: X, pending: Y, completed: Z, items: [] }
  let totalPending = 0;
  let totalCompleted = 0;

  STATE.inventory.forEach(item => {
    const startVal = document.getElementById('personnel-filter-start') ? document.getElementById('personnel-filter-start').value : '';
    const endVal = document.getElementById('personnel-filter-end') ? document.getElementById('personnel-filter-end').value : '';
    if (startVal || endVal) {
      if (!isDateInRange(item.timestamp, startVal, endVal)) return;
    }

    const pName = String(getValueByFuzzyKey(item, ['Giriş Yapan Personel', 'Personel', 'Ad Soyad', 'Usta Öğretici'])).trim();
    if (!pName || pName === 'undefined') return;

    const status = String(getValueByFuzzyKey(item, ['Arşive Eklendi / Fiş Tamam', 'Arşive Eklendi/Fiş Tamam', 'Durum', 'Arşiv Durumu', 'İşlem Durumu', 'Onay Durumu', 'Arşive Eklendi / Fiş Onayı', 'Arşive Eklendi / Onaylandı'])).trim();
    const statusLower = status.toLowerCase().replace(/[^a-z0-9ıışğüöç]/g, '');
    const isPending = statusLower.includes('grafik') || statusLower.includes('bekleniyor') || statusLower.includes('gorsel');
    const isCompleted = statusLower.includes('arsiveeklendi') || statusLower.includes('fistamam') || statusLower.includes('onaylandi');

    if (isPending) totalPending++;
    if (isCompleted) totalCompleted++;

    if (!personnelMap.has(pName)) {
      personnelMap.set(pName, { total: 0, pending: 0, completed: 0, items: [] });
    }

    const pData = personnelMap.get(pName);
    pData.total++;
    if (isPending) pData.pending++;
    if (isCompleted) pData.completed++;
    pData.items.push(item);
  });

  statActive.textContent = personnelMap.size;
  statTotal.textContent = STATE.inventory.length;
  statPending.textContent = totalPending;
  statCompleted.textContent = totalCompleted;

  // Personel Arama Filtresi
  const pSearch = document.getElementById('personnel-search').value.toLowerCase().trim();

  // Personel Listesini Arayüze Dök
  personnelList.innerHTML = '';
  const sortedPersonnel = Array.from(personnelMap.keys()).sort();

  let displayedCount = 0;
  sortedPersonnel.forEach(name => {
    if (pSearch !== '' && !name.toLowerCase().includes(pSearch)) return;

    const pData = personnelMap.get(name);
    const div = document.createElement('div');
    div.className = 'list-item';
    if (STATE.selectedPersonnel === name) div.className += ' selected';
    div.setAttribute('data-name', name);
    div.innerHTML = `
      <span>${name}</span>
      <span class="badge badge-role">${pData.total} Ürün</span>
    `;
    personnelList.appendChild(div);
    displayedCount++;

    div.addEventListener('click', () => {
      selectPersonnel(name, pData);
    });
  });

  // Seçili personel kalmadıysa veya sıfırlandıysa detay panelini kapat
  if (STATE.selectedPersonnel && personnelMap.has(STATE.selectedPersonnel)) {
    selectPersonnel(STATE.selectedPersonnel, personnelMap.get(STATE.selectedPersonnel));
  } else {
    document.getElementById('personnel-details-content').classList.add('hidden');
    document.getElementById('selected-personnel-name').textContent = 'Lütfen bir personel seçin';
  }
}

// Personel Seçildiğinde Detayları Göster
function selectPersonnel(name, data) {
  STATE.selectedPersonnel = name;

  // Listede seçili sınıfını güncelle
  document.querySelectorAll('#personnel-list .list-item').forEach(item => {
    if (item.getAttribute('data-name') === name) {
      item.classList.add('selected');
    } else {
      item.classList.remove('selected');
    }
  });

  document.getElementById('selected-personnel-name').textContent = name;
  document.getElementById('selected-personnel-count').textContent = `${data.total} Ürün`;
  document.getElementById('personnel-details-content').classList.remove('hidden');

  // Ürünlerini Tabloda Göster
  const tbody = document.getElementById('personnel-products-tbody');
  tbody.innerHTML = '';

  data.items.forEach(item => {
    const tr = document.createElement('tr');

    const envNo = item.envanterNo;
    const eserAdi = item.eserAdi;
    const tema = item.tema;
    const statusVal = String(item.durum || '').trim();
    const linkImage = item.linkImage;

    const thumbUrl = getDriveThumbnailUrl(linkImage);
    const imgHtml = thumbUrl
      ? `<img src="${thumbUrl}" loading="lazy" decoding="async" referrerpolicy="no-referrer" alt="Görsel" class="table-thumb" data-external-url="${escapeHtml(linkImage)}" style="cursor: pointer;" data-fallback="favicon">`
      : `<div class="table-thumb-placeholder">🖼️</div>`;

    const statusValClean = statusVal.toLowerCase().replace(/[^a-z0-9ıışğüöç]/g, '');
    let statusClass = 'badge-role';

    const isCompleted = statusValClean.includes('arsiv') || statusValClean.includes('arşiv') || statusValClean.includes('tamam') || statusValClean.includes('onay');
    const isPending = statusValClean.includes('grafik') || statusValClean.includes('bekle') || statusValClean.includes('gorsel') || statusValClean.includes('görsel');

    if (isCompleted) {
      statusClass = 'badge-success';
    } else if (isPending) {
      statusClass = 'badge-warning';
    }

    tr.innerHTML = `
      <td data-label="Görsel">${imgHtml}</td>
      <td data-label="Envanter No"><strong class="clickable-cell" style="cursor: pointer; color: var(--accent-gold); text-decoration: underline;" data-row="${item._rowNum}">${envNo || '-'}</strong></td>
      <td data-label="Eser Adı">${eserAdi || '-'}</td>
      <td data-label="Tema">${tema || '-'}</td>
      <td data-label="Durum"><span class="badge ${statusClass}">${statusVal && statusVal !== 'undefined' ? statusVal : 'Belirtilmemiş'}</span></td>
    `;
    tbody.appendChild(tr);
  });

  // Grafik Çiz
  renderPersonnelChart(name, data);
}

// Personel Bazlı Pasta Grafik (Chart.js)
function renderPersonnelChart(name, data) {
  if (STATE.charts.personnel) {
    STATE.charts.personnel.destroy();
  }

  const ctx = document.getElementById('personnel-chart');
  if (!ctx || !window.Chart) return;

  const other = data.total - data.pending - data.completed;

  STATE.charts.personnel = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: ['Arşive Eklenen', 'Grafik Bekleyen', 'Diğer/Süreçte'],
      datasets: [{
        data: [data.completed, data.pending, other],
        backgroundColor: ['#2e7d32', '#c62828', '#9c27b0'],
        borderColor: '#191425',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#f3effa' }
        }
      }
    }
  });
}

// --- Modül 10: Atölye & Personel Kartları ---
function renderAtolyePersonel() {
  const atolyeGrid = document.getElementById('atolye-grid');
  const personnelGrid = document.getElementById('personnel-cards-grid');
  const atolyeKadroTitle = document.getElementById('atolye-kadro-title');
  const atolyeKadroCount = document.getElementById('atolye-kadro-count');
  const atolyePersonnelNoData = document.getElementById('atolye-personnel-no-data');
  const statTotalWorkshops = document.getElementById('stat-total-workshops-badge');
  const statTotalPersonnel = document.getElementById('stat-total-personnel-badge');
  const clearFilterBtn = document.getElementById('btn-clear-atolye-filter');
  const searchInput = document.getElementById('atolye-personnel-search');
  const searchVal = searchInput ? searchInput.value.toLowerCase().trim() : '';

  const personnelList = STATE.personnel && STATE.personnel.length > 0 ? STATE.personnel : DEFAULT_PERSONNEL;

  // Atölyeleri ve Personel Sayılarını Grupla
  const atolyeMap = new Map();

  personnelList.forEach(person => {
    const atolye = person["Alan / Dal"] || 'Belirtilmemiş';
    if (!atolyeMap.has(atolye)) {
      atolyeMap.set(atolye, []);
    }
    atolyeMap.get(atolye).push(person);
  });

  // Toplam İstatistikler
  if (statTotalWorkshops) statTotalWorkshops.textContent = `${atolyeMap.size} Atölye`;
  if (statTotalPersonnel) statTotalPersonnel.textContent = `${personnelList.length} Personel`;

  // Atölye Kartlarını Oluştur
  if (atolyeGrid) {
    atolyeGrid.innerHTML = '';
    const sortedAtolyeler = Array.from(atolyeMap.keys()).sort();

    sortedAtolyeler.forEach(atolyeName => {
      const members = atolyeMap.get(atolyeName);

      const matchingMembersCount = members.filter(person => {
        if (!searchVal) return true;
        const name = (person["Adı"] || '').toLowerCase();
        const surname = (person["Soyadı"] || '').toLowerCase();
        const fullname = `${name} ${surname}`;
        const phone = (person["Telefon"] || '').toLowerCase();
        const email = (person["e-Posta"] || '').toLowerCase();
        const atolyeLower = atolyeName.toLowerCase();
        return fullname.includes(searchVal) || phone.includes(searchVal) || email.includes(searchVal) || atolyeLower.includes(searchVal);
      }).length;

      if (searchVal && matchingMembersCount === 0) return;

      const atolyeCard = document.createElement('div');
      atolyeCard.className = 'atolye-card';
      if (STATE.selectedAtolye === atolyeName) {
        atolyeCard.classList.add('active');
      }

      const icon = getAtolyeIcon(atolyeName);

      atolyeCard.innerHTML = `
        <div class="atolye-icon-wrapper">${icon}</div>
        <div class="atolye-card-info">
          <h3>${atolyeName}</h3>
          <p>${members.length} Usta Öğretici</p>
        </div>
        <span class="atolye-card-count">${matchingMembersCount}</span>
      `;

      atolyeCard.addEventListener('click', () => {
        if (STATE.selectedAtolye === atolyeName) {
          STATE.selectedAtolye = null;
        } else {
          STATE.selectedAtolye = atolyeName;
        }
        renderAtolyePersonel();
      });

      atolyeGrid.appendChild(atolyeCard);
    });
  }

  // Personel Listesini Filtrele ve Dök
  const filteredPersonnel = personnelList.filter(person => {
    if (STATE.selectedAtolye && person["Alan / Dal"] !== STATE.selectedAtolye) {
      return false;
    }
    if (searchVal) {
      const name = (person["Adı"] || '').toLowerCase();
      const surname = (person["Soyadı"] || '').toLowerCase();
      const fullname = `${name} ${surname}`;
      const phone = (person["Telefon"] || '').toLowerCase();
      const email = (person["e-Posta"] || '').toLowerCase();
      const atolye = (person["Alan / Dal"] || '').toLowerCase();
      return fullname.includes(searchVal) || phone.includes(searchVal) || email.includes(searchVal) || atolye.includes(searchVal);
    }
    return true;
  });

  filteredPersonnel.sort((a, b) => {
    const nameA = ((a["Adı"] || '') + ' ' + (a["Soyadı"] || '')).toLowerCase();
    const nameB = ((b["Adı"] || '') + ' ' + (b["Soyadı"] || '')).toLowerCase();
    return nameA.localeCompare(nameB, 'tr');
  });

  if (personnelGrid) {
    personnelGrid.innerHTML = '';

    if (filteredPersonnel.length === 0) {
      if (atolyePersonnelNoData) atolyePersonnelNoData.classList.remove('hidden');
      personnelGrid.classList.add('hidden');
    } else {
      if (atolyePersonnelNoData) atolyePersonnelNoData.classList.add('hidden');
      personnelGrid.classList.remove('hidden');
    }

    // Başlığı Güncelle
    if (STATE.selectedAtolye) {
      if (atolyeKadroTitle) atolyeKadroTitle.textContent = `${STATE.selectedAtolye} Atölyesi Kadrosu`;
      if (clearFilterBtn) clearFilterBtn.classList.remove('hidden');
    } else {
      if (atolyeKadroTitle) atolyeKadroTitle.textContent = searchVal ? 'Arama Sonuçları' : 'Tüm Personel Kadrosu';
      if (clearFilterBtn) clearFilterBtn.classList.add('hidden');
    }
    if (atolyeKadroCount) atolyeKadroCount.textContent = `${filteredPersonnel.length} Kişi`;

    // Kartları Dök
    filteredPersonnel.forEach(person => {
      const name = person["Adı"] || '';
      const surname = person["Soyadı"] || '';
      const fullname = `${name} ${surname}`;
      const atolye = person["Alan / Dal"] || 'Belirtilmemiş';
      const phone = person["Telefon"] || '';
      const email = person["e-Posta"] || '';
      const dateStart = person["Göreve Başlama Tarihi"] || 'Belirtilmemiş';
      const yearActive = person["Görev Yıl"] || 'Belirtilmemiş';
      const photo = person["Fotoğraf"] || '';

      const initials = (name.charAt(0) + surname.charAt(0)).toUpperCase() || '?';

      const hue = (initials.charCodeAt(0) * 15 + (initials.charCodeAt(1) || 0) * 10) % 360;
      const avatarGradient = `linear-gradient(135deg, hsl(${hue}, 60%, 35%), hsl(${(hue + 60) % 360}, 65%, 15%))`;

      const card = document.createElement('div');
      card.className = 'personnel-card';

      let photoHtml = '';
      if (photo) {
        const imgUrl = photo.length < 30 ? `https://drive.google.com/uc?export=view&id=${photo}` : photo;
        photoHtml = `<img src="${imgUrl}" loading="lazy" decoding="async" referrerpolicy="no-referrer" alt="${escapeHtml(fullname)}" data-fallback="sibling">`;
      }

      card.innerHTML = `
        <div class="personnel-card-header">
          <div class="personnel-card-avatar" style="background: ${avatarGradient};">
            ${photoHtml}
            <span>${initials}</span>
          </div>
          <div class="personnel-card-meta">
            <h3>${fullname}</h3>
            <p>${atolye}</p>
          </div>
        </div>
        <div class="personnel-card-details">
          <div class="personnel-card-detail-item">
            <span class="icon">📅</span>
            <span class="label">İşe Başlama:</span>
            <span class="value">${dateStart}</span>
          </div>
          <div class="personnel-card-detail-item">
            <span class="icon">🗓️</span>
            <span class="label">Görev Yılı:</span>
            <span class="value">${yearActive}</span>
          </div>
          ${phone ? `
          <div class="personnel-card-detail-item">
            <span class="icon">📞</span>
            <span class="label">Telefon:</span>
            <a href="tel:${encodeURIComponent(phone)}" class="value">${escapeHtml(phone)}</a>
          </div>
          ` : ''}
          ${email ? `
          <div class="personnel-card-detail-item">
            <span class="icon">✉️</span>
            <span class="label">e-Posta:</span>
            <a href="mailto:${encodeURIComponent(email)}" class="value">${escapeHtml(email)}</a>
          </div>
          ` : ''}
        </div>
        <div class="personnel-card-actions">
          <button class="btn-link btn-view-id-badge"><span class="icon">🪪</span> Profil Kartını Gör</button>
        </div>
      `;

      card.querySelector('.btn-view-id-badge').addEventListener('click', (e) => {
        e.stopPropagation();
        openPersonnelCardDetail(person);
      });

      card.addEventListener('click', () => {
        openPersonnelCardDetail(person);
      });

      personnelGrid.appendChild(card);
    });
  }
}

function getAtolyeIcon(atolyeName) {
  const name = atolyeName.toLowerCase();
  if (name.includes('seramik') || name.includes('çini') || name.includes('cam')) return '🏺';
  if (name.includes('tekstil') || name.includes('moda') || name.includes('terzi') || name.includes('giyim')) return '🧵';
  if (name.includes('nakış') || name.includes('nakis') || name.includes('el sanatları') || name.includes('el sanatlari')) return '🪡';
  if (name.includes('dokuma')) return '🧶';
  if (name.includes('kuyum') || name.includes('takı') || name.includes('taki')) return '💎';
  if (name.includes('oyma')) return '🪵';
  if (name.includes('fotoğraf') || name.includes('fotograf') || name.includes('grafik')) return '📷';
  if (name.includes('tarih')) return '📜';
  if (name.includes('görsel') || name.includes('gorsel') || name.includes('resim')) return '🎨';
  if (name.includes('iğne') || name.includes('igne') || name.includes('oya')) return '🪡';
  if (name.includes('tasarım') || name.includes('tasarim')) return '🎨';
  return '🏛️';
}

function openPersonnelCardDetail(person) {
  if (!person) return;
  const name = person["Adı"] || '';
  const surname = person["Soyadı"] || '';
  const fullname = `${name} ${surname}`;
  const atolye = person["Alan / Dal"] || 'Belirtilmemiş';
  const phone = person["Telefon"] || '';
  const email = person["e-Posta"] || '';
  const dateStart = person["Göreve Başlama Tarihi"] || 'Belirtilmemiş';
  const yearActive = person["Görev Yıl"] || 'Belirtilmemiş';
  const photo = person["Fotoğraf"] || '';

  const initials = (name.charAt(0) + surname.charAt(0)).toUpperCase() || '?';

  document.getElementById('badge-name').textContent = fullname;
  document.getElementById('badge-title').textContent = atolye;
  document.getElementById('badge-year').textContent = yearActive;
  document.getElementById('badge-start-date').textContent = dateStart;
  document.getElementById('badge-phone').textContent = phone || 'Belirtilmemiş';
  document.getElementById('badge-email').textContent = email || 'Belirtilmemiş';

  const today = new Date();
  const formattedToday = today.getDate().toString().padStart(2, '0') + '.' +
    (today.getMonth() + 1).toString().padStart(2, '0') + '.' +
    today.getFullYear();
  document.getElementById('badge-print-date').textContent = formattedToday;

  const placeholderEl = document.getElementById('badge-avatar-placeholder');
  const imgEl = document.getElementById('badge-avatar-img');

  placeholderEl.textContent = initials;

  const hue = (initials.charCodeAt(0) * 15 + (initials.charCodeAt(1) || 0) * 10) % 360;
  placeholderEl.style.background = `linear-gradient(135deg, #4b0082, #8a2be2)`;

  if (photo) {
    const imgUrl = photo.length < 30 ? `https://drive.google.com/uc?export=view&id=${photo}` : photo;
    imgEl.src = imgUrl;
    imgEl.classList.remove('hidden');
    placeholderEl.classList.add('hidden');
  } else {
    imgEl.src = '';
    imgEl.classList.add('hidden');
    placeholderEl.classList.remove('hidden');
  }

  const pdfBtn = document.getElementById('btn-download-personnel-pdf');
  const newPdfBtn = pdfBtn.cloneNode(true);
  pdfBtn.parentNode.replaceChild(newPdfBtn, pdfBtn);
  newPdfBtn.addEventListener('click', () => downloadPersonnelCardAsPDF(person));

  document.getElementById('dialog-personnel-card').showModal();
}

async function downloadPersonnelCardAsPDF(person) {
  if (!person) return;
  const name = (person["Adı"] || '') + ' ' + (person["Soyadı"] || '');
  const cleanName = name.replace(/[^a-zA-Z0-9]/g, '_');

  const element = document.getElementById('personnel-card-printable');

  const opt = {
    margin: [15, 30],
    filename: `Personel_Kimlik_Karti_${cleanName}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, letterRendering: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  // PDF motoru istek üzerine yüklenir (açılışı yavaşlatmasın diye).
  if (!(await pdfMotoruHazirla())) return;

  showToast('PDF belgesi oluşturuluyor, lütfen bekleyin...', 'info');

  html2pdf().set(opt).from(element).save()
    .then(() => {
      showToast('Personel kimlik kartı başarıyla indirildi.', 'success');
    })
    .catch(err => {
      console.error('PDF Hatası:', err);
      showToast('PDF oluşturulurken bir hata meydana geldi: ' + err.message, 'danger');
    });
}

// --- Modül 3: Literatür ve Saha Ziyaretleri ---
function renderLiterature() {
  const tbody = document.getElementById('literature-tbody');
  const noData = document.getElementById('literature-no-data');
  if (!tbody) return;

  const searchVal = document.getElementById('literature-search').value.toLowerCase().trim();
  const locationFilter = document.getElementById('filter-lit-location')?.value || 'all';
  const personnelFilter = document.getElementById('filter-lit-personnel')?.value || 'all';
  const startDateFilter = document.getElementById('filter-lit-start-date')?.value || '';
  const endDateFilter = document.getElementById('filter-lit-end-date')?.value || '';

  tbody.innerHTML = '';

  // Esnek yardımcı: birden fazla olası başlığı deneyen getter
  function getLitValue(item, candidates) {
    for (const c of candidates) {
      const cl = c.toLowerCase();
      for (const k of Object.keys(item)) {
        if (k === '_rowNum') continue;
        const kl = k.toLowerCase();
        if (kl === cl || kl.includes(cl) || cl.includes(kl)) {
          const val = item[k];
          if (val !== null && val !== undefined && String(val).trim() !== '') {
            return String(val);
          }
        }
      }
    }
    return '';
  }

  // Dinamik olarak filtre seçeneklerini doldur
  const uniqueLocations = new Set();
  const uniquePersonnel = new Set();

  STATE.literature.forEach(item => {
    const yer = getLitValue(item, ['Ziyaret Edilen Yer / Kaynak Arşiv', 'Ziyaret Yeri', 'Kaynak Arşiv', 'Yer', 'Lokasyon', 'Ziyaret Edilen Yer', 'Arşiv']);
    const personel = getLitValue(item, ['Araştırmacı Personel', 'Personel', 'Sorumlu Personel', 'Araştırmacı', 'Kullanıcı', 'Person']);

    if (yer && yer.trim()) uniqueLocations.add(yer.trim());
    if (personel && personel.trim()) uniquePersonnel.add(personel.trim());
  });

  const locSelect = document.getElementById('filter-lit-location');
  const perSelect = document.getElementById('filter-lit-personnel');

  if (locSelect) {
    const currentVal = locSelect.value;
    locSelect.innerHTML = '<option value="all">Tüm Lokasyonlar</option>';
    Array.from(uniqueLocations).sort((a, b) => a.localeCompare(b, 'tr')).forEach(loc => {
      const opt = document.createElement('option');
      opt.value = loc;
      opt.textContent = loc;
      locSelect.appendChild(opt);
    });
    locSelect.value = currentVal || 'all';
    if (locSelect.selectedIndex === -1) locSelect.value = 'all';
  }

  if (perSelect) {
    const currentVal = perSelect.value;
    perSelect.innerHTML = '<option value="all">Tüm Personeller</option>';
    Array.from(uniquePersonnel).sort((a, b) => a.localeCompare(b, 'tr')).forEach(per => {
      const opt = document.createElement('option');
      opt.value = per;
      opt.textContent = per;
      perSelect.appendChild(opt);
    });
    perSelect.value = currentVal || 'all';
    if (perSelect.selectedIndex === -1) perSelect.value = 'all';
  }

  const filtered = STATE.literature.filter(item => {
    const id = getLitValue(item, ['ID', 'Kayıt ID', 'id', 'No']) || 'LIT';
    const konu = getLitValue(item, ['Konu / Başlık', 'Konu', 'Başlık', 'Title', 'Konu / Kaynak Adı', 'Kaynak Adı', 'İşlem Konusu']) || '';
    const yer = getLitValue(item, ['Ziyaret Edilen Yer / Kaynak Arşiv', 'Ziyaret Yeri', 'Kaynak Arşiv', 'Yer', 'Lokasyon', 'Ziyaret Edilen Yer', 'Arşiv']) || '';
    const personel = getLitValue(item, ['Araştırmacı Personel', 'Personel', 'Sorumlu Personel', 'Araştırmacı', 'Kullanıcı', 'Person']) || '';
    const aciklama = getLitValue(item, ['Detaylı Açıklama', 'Açıklama', 'Description', 'Not', 'Detaylar', 'Notlar']) || '';
    const tarih = getLitValue(item, ['Tarih', 'Date', 'Kayıt Tarihi', 'Zaman Damgası', 'Timestamp']) || '';

    // Arama Kelimesi Filtresi
    let matchSearch = true;
    if (searchVal !== '') {
      matchSearch = id.toLowerCase().includes(searchVal) ||
        konu.toLowerCase().includes(searchVal) ||
        yer.toLowerCase().includes(searchVal) ||
        personel.toLowerCase().includes(searchVal) ||
        aciklama.toLowerCase().includes(searchVal);
    }

    // Lokasyon Filtresi
    const matchLocation = locationFilter === 'all' || yer.trim() === locationFilter;

    // Personel Filtresi
    const matchPersonnel = personnelFilter === 'all' || personel.trim() === personnelFilter;

    // Tarih Filtresi
    let matchDate = true;
    if (tarih) {
      const itemDateStr = tarih.split('T')[0];
      let itemDateVal = null;
      if (itemDateStr.includes('.')) {
        const parts = itemDateStr.split('.');
        if (parts.length === 3) {
          itemDateVal = new Date(parts[2], parts[1] - 1, parts[0]);
        }
      } else {
        itemDateVal = new Date(itemDateStr);
      }

      if (itemDateVal && !isNaN(itemDateVal.getTime())) {
        if (startDateFilter) {
          const startLimit = new Date(startDateFilter);
          startLimit.setHours(0, 0, 0, 0);
          if (itemDateVal < startLimit) matchDate = false;
        }
        if (endDateFilter) {
          const endLimit = new Date(endDateFilter);
          endLimit.setHours(23, 59, 59, 999);
          if (itemDateVal > endLimit) matchDate = false;
        }
      }
    } else if (startDateFilter || endDateFilter) {
      matchDate = false;
    }

    return matchSearch && matchLocation && matchPersonnel && matchDate;
  });

  window._lastFilteredLiterature = filtered;
  let filterParts = [];
  if (searchVal) filterParts.push(`Arama: "${searchVal}"`);
  if (locationFilter !== 'all') filterParts.push(`Lokasyon: ${locationFilter}`);
  if (personnelFilter !== 'all') filterParts.push(`Personel: ${personnelFilter}`);
  if (startDateFilter || endDateFilter) {
    filterParts.push(`Tarih: ${startDateFilter || '...'} - ${endDateFilter || '...'}`);
  }
  window._lastFilteredLiteratureFiltersStr = filterParts.length > 0 ? filterParts.join(', ') : 'Yok (Tümü)';

  // Toplam Sayı Güncelle
  const countLabel = document.getElementById('literature-count-label');
  if (countLabel) {
    if (filtered.length === STATE.literature.length) {
      countLabel.textContent = `Toplam: ${STATE.literature.length} Saha Kaydı`;
    } else {
      countLabel.textContent = `Filtrelenen: ${filtered.length} / ${STATE.literature.length} Saha Kaydı`;
    }
  }

  if (filtered.length === 0) {
    noData.classList.remove('hidden');
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4" style="color: var(--text-muted);">Gösterilecek kayıt bulunamadı.</td></tr>`;
    return;
  }
  noData.classList.add('hidden');

  tbody.innerHTML = filtered.map(item => {
    // Esnek sütun başlığı eşleştirmesi
    const id = getLitValue(item, ['ID', 'Kayıt ID', 'id', 'No']) || 'LIT';
    const tarih = getLitValue(item, ['Tarih', 'Date', 'Kayıt Tarihi', 'Zaman Damgası', 'Timestamp']);
    const konu = getLitValue(item, ['Konu / Başlık', 'Konu', 'Başlık', 'Title', 'Konu / Kaynak Adı', 'Kaynak Adı', 'İşlem Konusu']);
    const yer = getLitValue(item, ['Ziyaret Edilen Yer / Kaynak Arşiv', 'Ziyaret Yeri', 'Kaynak Arşiv', 'Yer', 'Lokasyon', 'Ziyaret Edilen Yer', 'Arşiv']);
    const personel = getLitValue(item, ['Araştırmacı Personel', 'Personel', 'Sorumlu Personel', 'Araştırmacı', 'Kullanıcı', 'Person']);
    const aciklama = getLitValue(item, ['Detaylı Açıklama', 'Açıklama', 'Description', 'Not', 'Detaylar', 'Notlar']);

    // Drive/Görsel link
    const driveLink = getLitValue(item, ['Görsel Linkleri', 'Drive', 'Link', 'Dosya', 'Klasör', 'Arşiv Klasörü', 'Arşiv Link']);
    const hasDriveLink = driveLink && (driveLink.includes('drive.google.com') || driveLink.includes('docs.google.com') || driveLink.startsWith('http'));

    // Kayıt ID: Drive linki varsa tıklanabilir, yoksa düz kod
    const idCell = hasDriveLink
      ? `<button class="btn-lit-id-link btn-lit-drive" data-url="${driveLink}" title="📂 Drive klasörünü aç: ${id}" style="background:none;border:none;cursor:pointer;padding:0;">
           <code style="color:#ffffff;text-decoration:underline;text-decoration-style:dotted;font-weight:600;">${id}</code>
           <span style="font-size:0.75em;margin-left:4px;opacity:0.8;">📂</span>
         </button>`
      : `<code>${id}</code>`;

    const rawDate = tarih ? tarih.split('T')[0] : 'Belirtilmemiş';

    return `
      <tr>
        <td data-label="Kayıt ID">${idCell}</td>
        <td data-label="Tarih">${rawDate}</td>
        <td data-label="Konu / Başlık" class="font-semibold">${konu || 'Başlıksız Araştırma'}</td>
        <td data-label="Ziyaret Edilen Yer / Kaynak Arşiv">${yer || 'Belirtilmemiş'}</td>
        <td data-label="Araştırmacı Personel">${personel || 'Bilinmiyor'}</td>
        <td data-label="Detaylı Açıklama" title="${aciklama || ''}" style="max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          ${aciklama || 'Açıklama girilmemiş.'}
        </td>
      </tr>
    `;
  }).join('');

  // Kayıt ID link butonlarına dinleyici ekle
  tbody.querySelectorAll('.btn-lit-drive').forEach(btn => {
    btn.addEventListener('click', () => {
      const url = btn.getAttribute('data-url');
      openExternal(url);
    });
  });
}

// --- Modül 3.5: Fotoğraf Bilgi Kartları Görünümü ---
// Fotograf Kartlari gorunumu acildiginda veri bos ise kendi e-tablosundan ceker.
// Onbellek eski oldugunda (ornegin photocardsSheetUrl bir sure bos kaldiysa)
// kartlar gorselsiz literatur kayitlarina dusuyordu; bu onu engeller.
let _photoCardsFetchInFlight = null;

async function ensurePhotoCardsLoaded() {
  if (STATE.photocards && STATE.photocards.length > 0) return;
  if (!STATE.photocardsSheetUrl || STATE.photocardsSheetUrl === STATE.sheetUrl) return;
  if (_photoCardsFetchInFlight) return _photoCardsFetchInFlight;

  _photoCardsFetchInFlight = (async () => {
    try {
      const res = await apiPhotocardsPost('get_all_data');
      if (res && res.success) {
        const rows = res.photocards || res.literature || [];
        STATE.photocards = rows.filter(item => {
          return Object.keys(item).some(k => k !== '_rowNum' && String(item[k] || '').trim() !== '');
        });
        await writeDataToCache();
        renderPhotoCards();
      } else {
        console.warn('Fotograf Kartlari verisi alinamadi:', res && res.error);
      }
    } catch (err) {
      console.warn('Fotograf Kartlari verisi cekilemedi:', err);
    } finally {
      _photoCardsFetchInFlight = null;
    }
  })();

  return _photoCardsFetchInFlight;
}

function renderPhotoCards() {
  const grid = document.getElementById('photo-cards-grid');
  const noData = document.getElementById('photocards-no-data');
  if (!grid) return;

  const searchVal = document.getElementById('photocards-search').value.toLowerCase().trim();
  const locationFilter = document.getElementById('filter-photo-location').value;
  const materialFilter = document.getElementById('filter-photo-material').value;
  const statusFilter = document.getElementById('filter-photo-status')?.value || 'all';
  const storyFilter = document.getElementById('filter-photo-story')?.value || 'all';
  const startDateFilter = document.getElementById('filter-photo-start-date')?.value || '';
  const endDateFilter = document.getElementById('filter-photo-end-date')?.value || '';

  grid.innerHTML = '';

  // Esnek yardımcı: birden fazla olası başlığı deneyen getter
  function getLitValue(item, candidates) {
    for (const c of candidates) {
      const cl = c.toLowerCase();
      for (const k of Object.keys(item)) {
        if (k === '_rowNum') continue;
        const kl = k.toLowerCase();
        if (kl === cl || kl.includes(cl) || cl.includes(kl)) {
          const val = item[k];
          if (val !== null && val !== undefined && String(val).trim() !== '') {
            return String(val);
          }
        }
      }
    }
    return '';
  }

  // Dinamik olarak filtre seçeneklerini doldur (Sadece ilk renderda veya veri değiştiğinde)
  const uniqueLocations = new Set();
  const uniqueMaterials = new Set();

  // Ayri bir Fotograf Kartlari e-tablosu tanimliysa literature yedegine DUSME.
  // Aksi halde gorsel alani olmayan literatur kayitlari kart olarak cizilip
  // "fotograflar gorunmuyor" izlenimi veriyordu.
  const hasDedicatedSheet = !!STATE.photocardsSheetUrl && STATE.photocardsSheetUrl !== STATE.sheetUrl;
  const photoData = (STATE.photocards && STATE.photocards.length > 0)
    ? STATE.photocards
    : (hasDedicatedSheet ? [] : STATE.literature);

  // Veri bos ve kendi e-tablosu tanimliysa arka planda cekmeyi dene
  if (photoData.length === 0 && hasDedicatedSheet) {
    ensurePhotoCardsLoaded();
  }

  photoData.forEach(item => {
    const yer = getLitValue(item, ['Ziyaret Edilen Yer / Kaynak Arşiv', 'Ziyaret Yeri', 'Kaynak Arşiv', 'Yer', 'Lokasyon', 'Ziyaret Edilen Yer', 'Arşiv', 'Çekildiği Yer']);
    const malzeme = getLitValue(item, ['ürün cinsi', 'cins', 'Tür / Kategori', 'tür', 'kategori', 'malzeme', 'pismis toprak', 'tip']);

    // Clean and normalize location for dropdown
    const cleanYer = getCleanedLocation(yer, malzeme);
    if (cleanYer && cleanYer !== 'Lokasyon Belirtilmemiş') {
      uniqueLocations.add(cleanYer);
    }
    if (malzeme) {
      uniqueMaterials.add(malzeme.trim().toLocaleUpperCase('tr-TR'));
    }
  });

  const locSelect = document.getElementById('filter-photo-location');
  const matSelect = document.getElementById('filter-photo-material');

  // Lokasyon filtresini doldur
  if (locSelect) {
    const currentVal = locSelect.value;
    locSelect.innerHTML = '<option value="all">Tüm Lokasyonlar</option>';
    Array.from(uniqueLocations).sort((a, b) => a.localeCompare(b, 'tr')).forEach(loc => {
      const opt = document.createElement('option');
      opt.value = loc;
      opt.textContent = loc;
      locSelect.appendChild(opt);
    });
    locSelect.value = currentVal || 'all';
    if (locSelect.selectedIndex === -1) {
      locSelect.value = 'all';
    }
  }

  // Malzeme filtresini doldur
  if (matSelect) {
    const currentVal = matSelect.value;
    matSelect.innerHTML = '<option value="all">Tüm Malzemeler</option>';
    Array.from(uniqueMaterials).sort((a, b) => a.localeCompare(b, 'tr')).forEach(mat => {
      const opt = document.createElement('option');
      opt.value = mat;
      opt.textContent = mat;
      matSelect.appendChild(opt);
    });
    matSelect.value = currentVal || 'all';
    if (matSelect.selectedIndex === -1) {
      matSelect.value = 'all';
    }
  }

  // Veriyi Filtrele
  const filtered = photoData.filter(item => {
    const id = getLitValue(item, ['ID', 'Kayıt ID', 'id', 'No']) || 'LIT';
    const konu = getLitValue(item, ['Tür / Kategori', 'Tür', 'Kategori', 'Dosya Adı', 'Konu / Başlık', 'Konu', 'Başlık', 'Title', 'Konu / Kaynak Adı', 'Kaynak Adı', 'İşlem Konusu']) || '';
    const yer = getLitValue(item, ['Ziyaret Edilen Yer / Kaynak Arşiv', 'Ziyaret Yeri', 'Kaynak Arşiv', 'Yer', 'Lokasyon', 'Ziyaret Edilen Yer', 'Arşiv', 'Çekildiği Yer']) || '';
    const aciklama = getLitValue(item, ['Yapay Zeka Hikayesi', 'Hikaye', 'Yapay Zeka', 'Hikayesi', 'Detaylı Açıklama', 'Açıklama', 'Description', 'Not', 'Detaylar', 'Notlar']) || '';
    const malzeme = getLitValue(item, ['ürün cinsi', 'cins', 'Tür / Kategori', 'tür', 'kategori', 'malzeme', 'pismis toprak', 'tip']) || '';
    const personel = getLitValue(item, ['Araştırmacı Personel', 'Personel', 'Sorumlu Personel', 'Araştırmacı', 'Kullanıcı', 'Person']) || '';

    // Arama Kelimesi Filtresi
    let matchSearch = true;
    if (searchVal !== '') {
      matchSearch = id.toLowerCase().includes(searchVal) ||
        konu.toLowerCase().includes(searchVal) ||
        yer.toLowerCase().includes(searchVal) ||
        aciklama.toLowerCase().includes(searchVal) ||
        malzeme.toLowerCase().includes(searchVal) ||
        personel.toLowerCase().includes(searchVal);
    }

    // Lokasyon Filtresi (Cleaned matching)
    const cleanYer = getCleanedLocation(yer, malzeme);
    const matchLocation = locationFilter === 'all' || cleanYer === locationFilter;

    // Malzeme Filtresi (Loose case-insensitive matching)
    const matchMaterial = materialFilter === 'all' ||
      malzeme.trim().toLocaleUpperCase('tr-TR').includes(materialFilter) ||
      materialFilter.includes(malzeme.trim().toLocaleUpperCase('tr-TR'));

    // Onay Durumu Filtresi
    const onayDurumu = getLitValue(item, ['Onay Durumu', 'Durum', 'Status']) || 'Bekliyor';
    const matchStatus = statusFilter === 'all' || onayDurumu === statusFilter;

    // Hikaye Durumu Filtresi
    let matchStory = true;
    if (storyFilter === 'has_story') {
      matchStory = aciklama !== '' && !aciklama.toLowerCase().startsWith('hata:') && aciklama !== 'Açıklama girilmemiş.';
    } else if (storyFilter === 'no_story') {
      matchStory = aciklama === '' || aciklama.toLowerCase().startsWith('hata:') || aciklama === 'Açıklama girilmemiş.';
    }

    // Tarih Filtresi
    let matchDate = true;
    const tarih = getLitValue(item, ['Tarih', 'Date', 'Kayıt Tarihi', 'Zaman Damgası', 'Timestamp']) || '';
    if (tarih) {
      const itemDateStr = tarih.split('T')[0];
      let itemDateVal = null;
      if (itemDateStr.includes('.')) {
        const parts = itemDateStr.split('.');
        if (parts.length === 3) {
          itemDateVal = new Date(parts[2], parts[1] - 1, parts[0]);
        }
      } else {
        itemDateVal = new Date(itemDateStr);
      }

      if (itemDateVal && !isNaN(itemDateVal.getTime())) {
        if (startDateFilter) {
          const startLimit = new Date(startDateFilter);
          startLimit.setHours(0, 0, 0, 0);
          if (itemDateVal < startLimit) matchDate = false;
        }
        if (endDateFilter) {
          const endLimit = new Date(endDateFilter);
          endLimit.setHours(23, 59, 59, 999);
          if (itemDateVal > endLimit) matchDate = false;
        }
      }
    } else if (startDateFilter || endDateFilter) {
      matchDate = false;
    }

    return matchSearch && matchLocation && matchMaterial && matchStatus && matchStory && matchDate;
  });

  window._lastFilteredPhotoCards = filtered;
  let filterParts = [];
  if (searchVal) filterParts.push(`Arama: "${searchVal}"`);
  if (locationFilter !== 'all') filterParts.push(`Lokasyon: ${locationFilter}`);
  if (materialFilter !== 'all') filterParts.push(`Malzeme: ${materialFilter}`);
  if (statusFilter !== 'all') filterParts.push(`Onay Durumu: ${statusFilter}`);
  if (storyFilter !== 'all') {
    filterParts.push(`Hikaye Durumu: ${storyFilter === 'has_story' ? 'Hikayesi Olanlar' : 'Hikayesi Olmayanlar'}`);
  }
  if (startDateFilter || endDateFilter) {
    filterParts.push(`Tarih: ${startDateFilter || '...'} - ${endDateFilter || '...'}`);
  }
  window._lastFilteredPhotoCardsFiltersStr = filterParts.length > 0 ? filterParts.join(', ') : 'Yok (Tümü)';

  // Toplam Bilgi Kartı Sayısını Göster
  const countLabel = document.getElementById('photocards-count-label');
  if (countLabel) {
    if (filtered.length === photoData.length) {
      countLabel.textContent = `Toplam: ${photoData.length} Bilgi Kartı`;
    } else {
      countLabel.textContent = `Filtrelenen: ${filtered.length} / ${photoData.length} Bilgi Kartı`;
    }
  }

  if (filtered.length === 0) {
    noData.classList.remove('hidden');
    return;
  }
  noData.classList.add('hidden');

  filtered.forEach(item => {
    const konu = getLitValue(item, ['Tür / Kategori', 'Tür', 'Kategori', 'Dosya Adı', 'Konu / Başlık', 'Konu', 'Başlık', 'Title', 'Konu / Kaynak Adı', 'Kaynak Adı', 'İşlem Konusu']) || 'Başlıksız Görsel';
    const yer = getLitValue(item, ['Ziyaret Edilen Yer / Kaynak Arşiv', 'Ziyaret Yeri', 'Kaynak Arşiv', 'Yer', 'Lokasyon', 'Ziyaret Edilen Yer', 'Arşiv', 'Çekildiği Yer']) || 'Lokasyon Belirtilmemiş';
    const tarih = getLitValue(item, ['Tarih', 'Date', 'Kayıt Tarihi', 'Zaman Damgası', 'Timestamp']);
    const aciklama = getLitValue(item, ['Yapay Zeka Hikayesi', 'Hikaye', 'Yapay Zeka', 'Hikayesi', 'Detaylı Açıklama', 'Açıklama', 'Description', 'Not', 'Detaylar', 'Notlar']) || 'Açıklama girilmemiş.';
    const malzeme = getLitValue(item, ['ürün cinsi', 'cins', 'Tür / Kategori', 'tür', 'kategori', 'malzeme', 'pismis toprak', 'tip']);

    const imageUrl = resolveImageUrl(item, 300);
    const dateFormatted = tarih ? tarih.split('T')[0] : 'Tarih Yok';
    const cleanYer = getCleanedLocation(yer, malzeme);

    const card = document.createElement('div');
    card.className = 'photo-card';
    card.addEventListener('click', () => openPhotoCardDetail(item));

    const imgHtml = imageUrl
      ? `<img src="${imageUrl}" loading="lazy" decoding="async" referrerpolicy="no-referrer" alt="${escapeHtml(konu)}" class="photo-card-img" data-fallback="placeholder">`
      : `<div class="photo-card-placeholder">🖼️</div>`;

    card.innerHTML = `
      <div class="photo-card-img-wrapper">
        ${imgHtml}
      </div>
      <div class="photo-card-content">
        <h3 class="photo-card-title">${konu}</h3>
        <p class="photo-card-desc">${aciklama}</p>
        <div class="photo-card-meta">
          <span class="photo-card-badge gold">${cleanYer}</span>
          ${malzeme ? `<span class="photo-card-badge">${malzeme}</span>` : ''}
          <span class="photo-card-badge">${dateFormatted}</span>
        </div>
      </div>
    `;

    grid.appendChild(card);
  });
}

// Görsel Bilgi Kartı Detay Modalını Aç
function openPhotoCardDetail(item) {
  if (!item) return;
  STATE.selectedPhotoCardItem = item;

  function getLitValue(item, candidates) {
    for (const c of candidates) {
      const cl = c.toLowerCase();
      for (const k of Object.keys(item)) {
        if (k === '_rowNum') continue;
        const kl = k.toLowerCase();
        if (kl === cl || kl.includes(cl) || cl.includes(kl)) {
          const val = item[k];
          if (val !== null && val !== undefined && String(val).trim() !== '') {
            return String(val);
          }
        }
      }
    }
    return '';
  }

  const id = getLitValue(item, ['ID', 'Kayıt ID', 'id', 'No']) || 'LIT';
  const konu = getLitValue(item, ['Tür / Kategori', 'Tür', 'Kategori', 'Dosya Adı', 'Konu / Başlık', 'Konu', 'Başlık', 'Title', 'Konu / Kaynak Adı', 'Kaynak Adı', 'İşlem Konusu']) || 'Başlıksız Araştırma';
  const yer = getLitValue(item, ['Ziyaret Edilen Yer / Kaynak Arşiv', 'Ziyaret Yeri', 'Kaynak Arşiv', 'Yer', 'Lokasyon', 'Ziyaret Edilen Yer', 'Arşiv', 'Çekildiği Yer']) || 'Belirtilmemiş';
  const tarih = getLitValue(item, ['Tarih', 'Date', 'Kayıt Tarihi', 'Zaman Damgası', 'Timestamp']) || 'Belirtilmemiş';
  const personel = getLitValue(item, ['Araştırmacı Personel', 'Personel', 'Sorumlu Personel', 'Araştırmacı', 'Kullanıcı', 'Person']) || 'Bilinmiyor';
  const aciklama = getLitValue(item, ['Yapay Zeka Hikayesi', 'Hikaye', 'Yapay Zeka', 'Hikayesi', 'Detaylı Açıklama', 'Açıklama', 'Description', 'Not', 'Detaylar', 'Notlar']) || 'Açıklama girilmemiş.';
  const malzeme = getLitValue(item, ['ürün cinsi', 'cins', 'Tür / Kategori', 'tür', 'kategori', 'malzeme', 'pismis toprak', 'tip']);

  const cleanYer = getCleanedLocation(yer, malzeme);
  const largeImageUrl = resolveImageUrl(item, 600);

  const imgEl = document.getElementById('photo-detail-image');
  const placeholderEl = document.getElementById('photo-detail-image-placeholder');

  if (largeImageUrl) {
    imgEl.src = largeImageUrl;
    imgEl.classList.remove('hidden');
    placeholderEl.classList.add('hidden');
  } else {
    imgEl.src = '';
    imgEl.classList.add('hidden');
    placeholderEl.classList.remove('hidden');
  }

  // Motif Görseli Durumu
  const driveId = getLitValueGlobal(item, ['Drive Dosya ID', 'Dosya ID', 'File ID']);
  const cardKey = driveId || id;
  const motifImgEl = document.getElementById('photo-detail-motif');
  const motifContainerEl = document.getElementById('photo-detail-motif-container');
  const removeBtnEl = document.getElementById('btn-remove-photo-motif');
  const fileInputEl = document.getElementById('input-photo-motif');

  if (fileInputEl) {
    fileInputEl.value = '';
  }

  if (STATE.motifs && STATE.motifs[cardKey]) {
    motifImgEl.src = STATE.motifs[cardKey];
    motifContainerEl.classList.remove('hidden');
    removeBtnEl.classList.remove('hidden');
  } else {
    motifImgEl.src = '';
    motifContainerEl.classList.add('hidden');
    removeBtnEl.classList.add('hidden');
  }

  document.getElementById('photo-detail-id').textContent = id;
  document.getElementById('photo-detail-subject').textContent = konu;
  document.getElementById('photo-detail-location').textContent = cleanYer;
  document.getElementById('photo-detail-date').textContent = tarih ? tarih.split('T')[0] : 'Belirtilmemiş';
  document.getElementById('photo-detail-researcher').textContent = personel;
  document.getElementById('photo-detail-story').textContent = aciklama;

  // PDF İndir butonu dinleyicisini yenile
  const pdfBtn = document.getElementById('btn-download-photo-pdf');
  const newPdfBtn = pdfBtn.cloneNode(true);
  pdfBtn.parentNode.replaceChild(newPdfBtn, pdfBtn);
  newPdfBtn.addEventListener('click', () => downloadCardAsPDF(item));

  // E-Posta Gönder butonu dinleyicisini yenile
  const emailBtn = document.getElementById('btn-send-photo-email');
  if (emailBtn) {
    const newEmailBtn = emailBtn.cloneNode(true);
    emailBtn.parentNode.replaceChild(newEmailBtn, emailBtn);
    newEmailBtn.addEventListener('click', () => sendPhotoCardEmail(item));
  }

  // Sil butonu dinleyicisini yenile
  const deleteBtn = document.getElementById('btn-delete-photocard');
  if (deleteBtn) {
    const newDeleteBtn = deleteBtn.cloneNode(true);
    deleteBtn.parentNode.replaceChild(newDeleteBtn, deleteBtn);
    newDeleteBtn.addEventListener('click', () => deletePhotoCard(item));
  }


  // Saha fotoğrafına veya motif görseline tıklanınca ilgili Drive linkini aç
  const detailImg = document.getElementById('photo-detail-image');
  if (detailImg) {
    const driveLink = getLitValue(item, ['Görsel Linkleri', 'Drive', 'Link', 'Dosya', 'Klasör', 'Arşiv Klasörü', 'Arşiv Link']);
    if (driveLink && driveLink.startsWith('http')) {
      detailImg.onclick = () => openExternal(driveLink);
    } else {
      detailImg.onclick = () => openExternal(largeImageUrl);
    }
  }

  const motifImg = document.getElementById('photo-detail-motif');
  if (motifImg) {
    motifImg.onclick = () => {
      const driveLink = getLitValue(item, ['Görsel Linkleri', 'Drive', 'Link', 'Dosya', 'Klasör', 'Arşiv Klasörü', 'Arşiv Link']);
      if (driveLink && driveLink.startsWith('http')) {
        openExternal(driveLink);
      }
    };
  }

  // Modalı Aç
  document.getElementById('dialog-photo-card-detail').showModal();
}

// Kartı PDF Olarak İndir (html2pdf.js ile)
async function downloadCardAsPDF(item) {
  if (!item) return;

  function getLitValue(item, candidates) {
    for (const c of candidates) {
      const cl = c.toLowerCase();
      for (const k of Object.keys(item)) {
        if (k === '_rowNum') continue;
        const kl = k.toLowerCase();
        if (kl === cl || kl.includes(cl) || cl.includes(kl)) {
          const val = item[k];
          if (val !== null && val !== undefined && String(val).trim() !== '') {
            return String(val);
          }
        }
      }
    }
    return '';
  }

  const driveId = getLitValue(item, ['Drive Dosya ID', 'Dosya ID', 'File ID']);
  const shortId = getLitValue(item, ['ID', 'Kayıt ID', 'id', 'No']) || 'LIT';
  const id = shortId;
  const konu = getLitValue(item, ['Tür / Kategori', 'Tür', 'Kategori', 'Dosya Adı', 'Konu / Başlık', 'Konu', 'Başlık', 'Title', 'Konu / Kaynak Adı', 'Kaynak Adı', 'İşlem Konusu']) || 'Başlıksız Görsel';
  const yer = getLitValue(item, ['Ziyaret Edilen Yer / Kaynak Arşiv', 'Ziyaret Yeri', 'Kaynak Arşiv', 'Yer', 'Lokasyon', 'Ziyaret Edilen Yer', 'Arşiv', 'Çekildiği Yer']) || 'Belirtilmemiş';
  const tarih = getLitValue(item, ['Tarih', 'Date', 'Kayıt Tarihi', 'Zaman Damgası', 'Timestamp']) || 'Belirtilmemiş';
  const personel = getLitValue(item, ['Araştırmacı Personel', 'Personel', 'Sorumlu Personel', 'Araştırmacı', 'Kullanıcı', 'Person']) || 'Bilinmiyor';
  const aciklama = getLitValue(item, ['Yapay Zeka Hikayesi', 'Hikaye', 'Yapay Zeka', 'Hikayesi', 'Detaylı Açıklama', 'Açıklama', 'Description', 'Not', 'Detaylar', 'Notlar']) || 'Açıklama girilmemiş.';
  const malzeme = getLitValue(item, ['ürün cinsi', 'cins', 'Tür / Kategori', 'tür', 'kategori', 'malzeme', 'pismis toprak', 'tip']) || 'Belirtilmemiş';

  const cleanYer = getCleanedLocation(yer, malzeme);
  const largeImageUrl = resolveImageUrl(item, 600);

  const cardKey = driveId || shortId;
  const motifBase64 = STATE.motifs[cardKey] || '';
  const hasMotif = !!motifBase64;

  // PDF Container oluştur
  const pdfContainer = document.createElement('div');
  pdfContainer.style.padding = '40px';
  pdfContainer.style.fontFamily = "'Outfit', 'Inter', sans-serif";
  pdfContainer.style.color = '#111111';
  pdfContainer.style.backgroundColor = '#ffffff';
  pdfContainer.style.width = '700px';

  let imagesAndInfoHtml = '';
  if (hasMotif) {
    imagesAndInfoHtml = `
      <!-- Görsel, Künye ve Motif (3-Kolonlu Düzen) -->
      <div style="display: flex; gap: 20px; margin-bottom: 25px; align-items: stretch;">
        <!-- Ana Görsel -->
        <div style="flex: 0 0 190px; text-align: center;">
          ${largeImageUrl ? `
            <img src="${largeImageUrl}" referrerpolicy="no-referrer" style="width: 190px; height: 190px; object-fit: cover; border-radius: 8px; border: 1px solid #eaeaea; box-shadow: 0 4px 12px rgba(0,0,0,0.06);" crossorigin="anonymous" />
          ` : `
            <div style="width: 190px; height: 190px; background-color: #f7f7f7; border-radius: 8px; border: 1px dashed #cccccc; display: flex; align-items: center; justify-content: center; color: #999999; font-size: 36px;">🖼️</div>
          `}
        </div>
        
        <!-- Künye Bilgileri -->
        <div style="flex: 1; display: flex; flex-direction: column; justify-content: center;">
          <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
            <tr style="border-bottom: 1px solid #f2f2f2;">
              <td style="padding: 7px 0; font-weight: 700; color: #555555; width: 100px;">Konu / Başlık:</td>
              <td style="padding: 7px 0; color: #111111; font-weight: 600;">${konu}</td>
            </tr>
            <tr style="border-bottom: 1px solid #f2f2f2;">
              <td style="padding: 7px 0; font-weight: 700; color: #555555;">Ziyaret Lokasyonu:</td>
              <td style="padding: 7px 0; color: #111111;">${cleanYer}</td>
            </tr>
            <tr style="border-bottom: 1px solid #f2f2f2;">
              <td style="padding: 7px 0; font-weight: 700; color: #555555;">Ürün Cinsi:</td>
              <td style="padding: 7px 0; color: #111111;">${malzeme}</td>
            </tr>
            <tr style="border-bottom: 1px solid #f2f2f2;">
              <td style="padding: 7px 0; font-weight: 700; color: #555555;">Tarih:</td>
              <td style="padding: 7px 0; color: #111111;">${tarih ? tarih.split('T')[0] : 'Belirtilmemiş'}</td>
            </tr>
            <tr style="border-bottom: 1px solid #f2f2f2;">
              <td style="padding: 7px 0; font-weight: 700; color: #555555;">Araştırmacı:</td>
              <td style="padding: 7px 0; color: #111111;">${personel}</td>
            </tr>
          </table>
        </div>
        
        <!-- Motif Görseli -->
        <div style="flex: 0 0 150px; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center;">
          <div style="width: 150px; height: 190px; background-color: #ffffff; border-radius: 8px; border: 1px solid #eaeaea; box-shadow: 0 4px 12px rgba(0,0,0,0.06); display: flex; align-items: center; justify-content: center; padding: 6px; box-sizing: border-box;">
            <img src="${motifBase64}" referrerpolicy="no-referrer" style="max-width: 100%; max-height: 100%; object-fit: contain;" />
          </div>
          <div style="font-size: 9px; color: #888888; margin-top: 4px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Ürün Motifi</div>
        </div>
      </div>
    `;
  } else {
    imagesAndInfoHtml = `
      <!-- Görsel ve Künye Bilgileri -->
      <div style="display: flex; gap: 30px; margin-bottom: 25px;">
        <div style="flex: 0 0 260px; text-align: center;">
          ${largeImageUrl ? `
            <img src="${largeImageUrl}" referrerpolicy="no-referrer" style="width: 260px; height: 260px; object-fit: cover; border-radius: 8px; border: 1px solid #eaeaea; box-shadow: 0 4px 12px rgba(0,0,0,0.06);" crossorigin="anonymous" />
          ` : `
            <div style="width: 260px; height: 260px; background-color: #f7f7f7; border-radius: 8px; border: 1px dashed #cccccc; display: flex; align-items: center; justify-content: center; color: #999999; font-size: 48px;">🖼️</div>
          `}
        </div>
        
        <div style="flex: 1; display: flex; flex-direction: column; justify-content: center;">
          <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
            <tr style="border-bottom: 1px solid #f2f2f2;">
              <td style="padding: 10px 0; font-weight: 700; color: #555555; width: 140px;">Konu / Başlık:</td>
              <td style="padding: 10px 0; color: #111111; font-weight: 600;">${konu}</td>
            </tr>
            <tr style="border-bottom: 1px solid #f2f2f2;">
              <td style="padding: 10px 0; font-weight: 700; color: #555555;">Ziyaret Lokasyonu:</td>
              <td style="padding: 10px 0; color: #111111;">${cleanYer}</td>
            </tr>
            <tr style="border-bottom: 1px solid #f2f2f2;">
              <td style="padding: 10px 0; font-weight: 700; color: #555555;">Ürün Cinsi / Malzeme:</td>
              <td style="padding: 10px 0; color: #111111;">${malzeme}</td>
            </tr>
            <tr style="border-bottom: 1px solid #f2f2f2;">
              <td style="padding: 10px 0; font-weight: 700; color: #555555;">Araştırma Tarihi:</td>
              <td style="padding: 10px 0; color: #111111;">${tarih ? tarih.split('T')[0] : 'Belirtilmemiş'}</td>
            </tr>
            <tr style="border-bottom: 1px solid #f2f2f2;">
              <td style="padding: 10px 0; font-weight: 700; color: #555555;">Araştırmacı Personel:</td>
              <td style="padding: 10px 0; color: #111111;">${personel}</td>
            </tr>
          </table>
        </div>
      </div>
    `;
  }

  pdfContainer.innerHTML = `
    <div style="border: 2px solid #d4af37; padding: 25px; border-radius: 12px; position: relative;">
      <!-- Kurumsal Üst Bilgi -->
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #f3effa; padding-bottom: 15px; margin-bottom: 25px;">
        <div>
          <h2 style="margin: 0; color: #5a128e; font-size: 20px; font-weight: 700; letter-spacing: 0.5px;">EDİRNE OLGUNLAŞMA ENSTİTÜSÜ</h2>
          <p style="margin: 2px 0 0 0; font-size: 11px; color: #666666; font-style: italic;">Saha Araştırması ve Görsel Bilgi Fişi</p>
        </div>
        <div style="text-align: right;">
          <span style="background-color: #fcfbf7; color: #d4af37; border: 1px solid #d4af37; padding: 5px 12px; border-radius: 20px; font-size: 11px; font-weight: 700; display: inline-block;">KAYIT: ${shortId}</span>
        </div>
      </div>
      
      ${imagesAndInfoHtml}
      
      <div style="margin-top: 15px;">
        <h3 style="color: #5a128e; border-bottom: 2px solid #d4af37; padding-bottom: 6px; margin-top: 0; margin-bottom: 12px; font-size: 15px; font-weight: 700; letter-spacing: 0.3px;">GÖRSEL ANALİZ VE HİKAYE</h3>
        <div style="margin: 0;">
          ${aciklama.split(/\n+/).map(pText => pText.trim()).filter(pText => pText.length > 0).map(pText => `<p style="font-size: 12px; line-height: 1.6; color: #2c2c2c; margin: 0 0 12px 0; text-align: justify; page-break-inside: avoid; break-inside: avoid;">${pText}</p>`).join('')}
        </div>
      </div>

      <div style="margin-top: 40px; text-align: center; border-top: 1px solid #f3effa; padding-top: 15px;">
        <span style="font-size: 9px; color: #aaaaaa; letter-spacing: 0.5px;">Bu bilgi kartı Edirne Olgunlaşma Enstitüsü Arşiv Otomasyon Sistemi tarafından otomatik üretilmiştir.</span>
      </div>
    </div>

    <!-- EK 1: SAHA FOTOĞRAFI -->
    <div style="page-break-before: always; break-before: page; padding: 10px 0; text-align: center; height: 960px; box-sizing: border-box; display: flex; flex-direction: column;">
      <div style="border: 2px solid #d4af37; padding: 25px; border-radius: 12px; box-sizing: border-box; display: flex; flex-direction: column; flex: 1; height: 100%;">
        <h3 style="color: #5a128e; border-bottom: 2px solid #d4af37; padding-bottom: 8px; margin-top: 0; margin-bottom: 20px; font-size: 16px; font-weight: 700; letter-spacing: 0.5px; text-align: left; text-transform: uppercase;">EK 1: SAHA FOTOĞRAFI</h3>
        <div style="flex: 1; display: flex; align-items: center; justify-content: center; border: 1px solid #eaeaea; border-radius: 8px; background-color: #fafafa; padding: 15px; box-sizing: border-box; overflow: hidden;">
          ${largeImageUrl ? `
            <img src="${largeImageUrl}" referrerpolicy="no-referrer" style="max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 4px;" crossorigin="anonymous" />
          ` : `
            <div style="color: #999999; font-size: 24px;">Görsel Bulunmuyor</div>
          `}
        </div>
      </div>
    </div>

    <!-- EK 2: ÜRÜN MOTİFİ (VARSA) -->
    ${hasMotif ? `
    <div style="page-break-before: always; break-before: page; padding: 10px 0; text-align: center; height: 960px; box-sizing: border-box; display: flex; flex-direction: column;">
      <div style="border: 2px solid #d4af37; padding: 25px; border-radius: 12px; box-sizing: border-box; display: flex; flex-direction: column; flex: 1; height: 100%;">
        <h3 style="color: #5a128e; border-bottom: 2px solid #d4af37; padding-bottom: 8px; margin-top: 0; margin-bottom: 20px; font-size: 16px; font-weight: 700; letter-spacing: 0.5px; text-align: left; text-transform: uppercase;">EK 2: ÜRÜN MOTİFİ</h3>
        <div style="flex: 1; display: flex; align-items: center; justify-content: center; border: 1px solid #eaeaea; border-radius: 8px; background-color: #ffffff; padding: 15px; box-sizing: border-box; overflow: hidden;">
          <img src="${motifBase64}" referrerpolicy="no-referrer" style="max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 4px;" />
        </div>
      </div>
    </div>
    ` : ''}
  `;

  const opt = {
    margin: 10,
    filename: `Bilgi_Karti_${id}_${konu.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, logging: false },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak: { mode: ['css', 'legacy'], avoid: ['p', 'tr'] }
  };

  // PDF motoru istek üzerine yüklenir (açılışı yavaşlatmasın diye).
  if (!(await pdfMotoruHazirla())) return;

  showToast('PDF belgesi oluşturuluyor, lütfen bekleyin...', 'info');

  html2pdf().set(opt).from(pdfContainer).save()
    .then(() => {
      showToast('PDF başarıyla indirildi.', 'success');
    })
    .catch(err => {
      console.error('PDF Hatası:', err);
      showToast('PDF oluşturulurken bir hata meydana geldi: ' + err.message, 'danger');
    });
}

// Görsel Bilgi Kartını E-Posta Olarak Gönder
async function sendPhotoCardEmail(item) {
  if (!item) return;

  function getLitValue(item, candidates) {
    for (const c of candidates) {
      const cl = c.toLowerCase();
      for (const k of Object.keys(item)) {
        if (k === '_rowNum') continue;
        const kl = k.toLowerCase();
        if (kl === cl || kl.includes(cl) || cl.includes(kl)) {
          const val = item[k];
          if (val !== null && val !== undefined && String(val).trim() !== '') {
            return String(val);
          }
        }
      }
    }
    return '';
  }

  const driveId = getLitValue(item, ['Drive Dosya ID', 'Dosya ID', 'File ID']);
  const shortId = getLitValue(item, ['ID', 'Kayıt ID', 'id', 'No']) || 'LIT';
  const konu = getLitValue(item, ['Tür / Kategori', 'Tür', 'Kategori', 'Dosya Adı', 'Konu / Başlık', 'Konu', 'Başlık', 'Title', 'Konu / Kaynak Adı', 'Kaynak Adı', 'İşlem Konusu']) || 'Başlıksız Görsel';
  const yer = getLitValue(item, ['Ziyaret Edilen Yer / Kaynak Arşiv', 'Ziyaret Yeri', 'Kaynak Arşiv', 'Yer', 'Lokasyon', 'Ziyaret Edilen Yer', 'Arşiv', 'Çekildiği Yer']) || 'Belirtilmemiş';
  const tarih = getLitValue(item, ['Tarih', 'Date', 'Kayıt Tarihi', 'Zaman Damgası', 'Timestamp']) || 'Belirtilmemiş';
  const personel = getLitValue(item, ['Araştırmacı Personel', 'Personel', 'Sorumlu Personel', 'Araştırmacı', 'Kullanıcı', 'Person']) || 'Bilinmiyor';
  const aciklama = getLitValue(item, ['Yapay Zeka Hikayesi', 'Hikaye', 'Yapay Zeka', 'Hikayesi', 'Detaylı Açıklama', 'Açıklama', 'Description', 'Not', 'Detaylar', 'Notlar']) || 'Açıklama girilmemiş.';
  const malzeme = getLitValue(item, ['ürün cinsi', 'cins', 'Tür / Kategori', 'tür', 'kategori', 'malzeme', 'pismis toprak', 'tip']) || 'Belirtilmemiş';

  const cleanYer = getCleanedLocation(yer, malzeme);
  const largeImageUrl = resolveImageUrl(item, 600);

  const cardKey = driveId || shortId;
  const motifBase64 = STATE.motifs[cardKey] || '';

  // E-Posta Alıcısını Sor
  const recipient = await showEmailPrompt('', 'Görsel Bilgi Fişi Gönder');
  if (recipient === null) return; // İptal edildi
  const emailToUse = recipient.trim();

  if (!emailToUse) {
    showToast('E-posta adresi boş olamaz.', 'warning');
    return;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(emailToUse)) {
    showToast('Lütfen geçerli bir e-posta adresi girin.', 'warning');
    return;
  }

  toggleLoading(true, 'E-posta gönderiliyor...');
  try {
    const res = await apiPost('send_photo_card_mail', {
      recipient: emailToUse,
      id: shortId,
      konu: konu,
      yer: cleanYer,
      tarih: tarih ? tarih.split('T')[0] : 'Belirtilmemiş',
      personel: personel,
      aciklama: aciklama,
      malzeme: malzeme,
      imageUrl: largeImageUrl,
      motifUrl: motifBase64
    });

    toggleLoading(false);
    if (res && res.success) {
      showToast('Görsel bilgi fişi başarıyla e-posta olarak gönderildi.', 'success');
    } else {
      showToast('Hata: ' + (res ? res.error : 'E-posta gönderilemedi.'), 'danger');
    }
  } catch (err) {
    toggleLoading(false);
    showToast('Hata: ' + err.message, 'danger');
  }
}

// Görsel Bilgi Kartını Sil
async function deletePhotoCard(item) {
  if (!item) return;

  function getLitValue(item, candidates) {
    for (const c of candidates) {
      const cl = c.toLowerCase();
      for (const k of Object.keys(item)) {
        if (k === '_rowNum') continue;
        const kl = k.toLowerCase();
        if (kl === cl || kl.includes(cl) || cl.includes(kl)) {
          const val = item[k];
          if (val !== null && val !== undefined && String(val).trim() !== '') {
            return String(val);
          }
        }
      }
    }
    return '';
  }

  let id = getLitValue(item, ['Drive Dosya ID', 'Dosya ID', 'ID', 'Kayıt ID', 'id', 'No']);
  if (!id) {
    const originalLink = getLitValue(item, ['Orijinal Görsel Linki', 'Görsel Linkleri', 'Link', 'Url']);
    if (originalLink) {
      const match = originalLink.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || originalLink.match(/[?&]id=([a-zA-Z0-9_-]+)/);
      if (match && match[1]) {
        id = match[1];
      }
    }
  }
  if (!id) {
    id = getLitValue(item, ['Dosya Adı', 'DosyaAdi', 'Filename', 'Name']);
  }
  if (!id) {
    id = 'LIT';
  }
  const konu = getLitValue(item, ['Tür / Kategori', 'Tür', 'Kategori', 'Dosya Adı', 'Konu / Başlık', 'Konu', 'Başlık', 'Title', 'Konu / Kaynak Adı', 'Kaynak Adı', 'İşlem Konusu']) || 'Başlıksız Görsel';

  if (!confirm(`"${konu}" isimli fotoğraf bilgi kartını tamamen silmek istediğinize emin misiniz?`)) {
    return;
  }

  toggleLoading(true, 'Fotoğraf bilgi kartı siliniyor...');
  try {
    let res;
    // Hangi kaynaktan geldiğini bul ve ilgili API'ye istek gönder
    const isSpecialPhotocard = STATE.photocards && STATE.photocards.includes(item);

    if (isSpecialPhotocard) {
      res = await apiPhotocardsPost('delete_literature', { id: id });
    } else {
      res = await apiLiteraturPost('delete_literature', { id: id });
    }

    toggleLoading(false);
    if (res && res.success) {
      showToast('Kayıt başarıyla silindi.', 'success');
      document.getElementById('dialog-photo-card-detail').close();
      // Verileri eşitle ve görünümleri güncelle
      await syncAllData(false);
    } else {
      const errorMsg = res ? res.error : 'Kayıt silinemedi.';
      const debugDetail = res && res.debug ? `\n\n[Hata Detayları]\n- Eşleşen ID: ${res.debug.matchedFileId}\n- Çalıştıran Hesap: ${res.debug.effectiveUser}\n- Dosya Sahibi: ${res.debug.fileOwner}\n- Drive Hatası: ${res.driveDetail || 'Yok'}` : '';
      alert(`Hata: ${errorMsg}${debugDetail}`);
    }
  } catch (err) {
    toggleLoading(false);
    console.error('Silme hatası:', err);
    showToast('Hata: ' + err.message, 'danger');
  }
}





// --- Modül 4: Raporlar ve Grafik Analizi ---
// --- Modül 4: Raporlar ve Grafik Analizi ---
function renderReports() {
  const inventory = STATE.inventory || [];
  const cash = STATE.magaza.cash || [];
  const expenses = STATE.magaza.expenses || [];

  // 1. Yönetici Özeti KPI Hesaplamaları
  // 1.1. Toplam Eser Sayısı
  const totalItems = inventory.length;
  document.getElementById('dashboard-total-items').textContent = totalItems;
  document.getElementById('summary-total-items').textContent = totalItems;
  document.getElementById('summary-literature-count').textContent = (STATE.literature || []).length;

  // 1.2. Fiş Tamamlanma/Onay Durumları
  let completed = 0;
  let pending = 0;

  const themeCounts = {};
  const statusCounts = {};
  const typeCounts = {};
  const personnelCounts = {};

  inventory.forEach(item => {
    const status = String(getValueByFuzzyKey(item, ['Arşive Eklendi / Fiş Tamam', 'Arşive Eklendi/Fiş Tamam', 'Durum', 'Arşiv Durumu', 'İşlem Durumu', 'Onay Durumu', 'Arşive Eklendi / Fiş Onayı', 'Arşive Eklendi / Onaylandı'])).trim();
    const statusLower = status.toLowerCase().replace(/[^a-z0-9ıışğüöç]/g, '');

    const isCompleted = statusLower.includes('arsiveeklendi') || statusLower.includes('fistamam') || statusLower.includes('onaylandi');
    const isPending = statusLower.includes('grafik') || statusLower.includes('bekleniyor') || statusLower.includes('gorsel');

    if (isCompleted) completed++;
    if (isPending) pending++;

    // Temalar
    const theme = String(getValueByFuzzyKey(item, ['Tema', 'Temalar'])).trim() || 'Belirtilmemiş';
    themeCounts[theme] = (themeCounts[theme] || 0) + 1;

    // Durumlar
    const statKey = (status && status !== 'undefined') ? status : 'Belirtilmemiş';
    statusCounts[statKey] = (statusCounts[statKey] || 0) + 1;

    // Ürün Cinsleri
    const type = String(getValueByFuzzyKey(item, ['Ürün Cinsi', 'Cinsi', 'Cins', 'Ürün Tipi'])).trim() || 'Belirtilmemiş';
    typeCounts[type] = (typeCounts[type] || 0) + 1;

    // Personel katkısı
    const pers = String(item.personel || '').trim();
    if (pers) {
      personnelCounts[pers] = (personnelCounts[pers] || 0) + 1;
    }
  });

  document.getElementById('summary-completed-items').textContent = completed;
  document.getElementById('summary-pending-items').textContent = pending;

  // Fiş Onay Oranı
  const completionRate = totalItems > 0 ? Math.round((completed / totalItems) * 100) : 0;
  document.getElementById('dashboard-completion-rate').textContent = completionRate + '%';

  // 1.3. Mağaza Mali Tablo Değerleri
  let totalRevenue = 0;
  let totalCashRevenue = 0;
  let totalCardRevenue = 0;
  let totalBeverageRevenue = 0;
  let totalInventoryRevenue = 0;
  let totalCustomRevenue = 0;

  cash.forEach(sale => {
    const saleId = String(sale["Satış ID"] || '');
    const isDevir = saleId.indexOf('DEVIR') === 0 || String(sale["Eser Adı"] || '').indexOf('Kasadan Devir') === 0;

    if (!isDevir) {
      const nakit = parseFloat(sale["Nakit Tahsilat (₺)"] || sale["Nakit Tahsilat"] || 0);
      const kart = parseFloat(sale["Kredi Kartı Tahsilat (₺)"] || sale["Kredi Kartı Tahsilat"] || 0);
      const tutar = parseFloat(sale["Satış Tutarı"] || sale["Tutar"] || 0);

      const totalSaleVal = (nakit || kart) ? (nakit + kart) : tutar;
      totalRevenue += totalSaleVal;

      totalCashRevenue += nakit;
      totalCardRevenue += kart;

      // Kategori bazlı ciro
      const category = String(sale["Kategori"] || sale["Tür"] || '').toLowerCase();
      const name = String(sale["Eser Adı"] || '').toLowerCase();
      if (category.includes('beverage') || category.includes('içecek') || name.includes('çay') || name.includes('kahve') || name.includes('soda') || name.includes('su')) {
        totalBeverageRevenue += totalSaleVal;
      } else if (category.includes('inventory') || category.includes('envanter') || sale["Envanter No"]) {
        totalInventoryRevenue += totalSaleVal;
      } else {
        totalCustomRevenue += totalSaleVal;
      }
    }
  });

  let totalExpenses = 0;
  expenses.forEach(exp => {
    totalExpenses += parseFloat(exp["Tutar"] || 0);
  });

  const netProfit = totalRevenue - totalExpenses;

  document.getElementById('dashboard-total-sales').textContent = totalRevenue.toLocaleString('tr-TR', { minimumFractionDigits: 2 }) + ' ₺';
  document.getElementById('dashboard-net-profit').textContent = netProfit.toLocaleString('tr-TR', { minimumFractionDigits: 2 }) + ' ₺';

  const netProfitEl = document.getElementById('dashboard-net-profit');
  if (netProfitEl) {
    netProfitEl.style.color = netProfit >= 0 ? '#2e7d32' : '#c62828';
  }

  // Mali Sekme KPIs
  document.getElementById('mali-stat-total-revenue').textContent = totalRevenue.toLocaleString('tr-TR', { minimumFractionDigits: 2 }) + ' ₺';
  document.getElementById('mali-stat-total-expenses').textContent = totalExpenses.toLocaleString('tr-TR', { minimumFractionDigits: 2 }) + ' ₺';
  document.getElementById('mali-stat-net-profit').textContent = netProfit.toLocaleString('tr-TR', { minimumFractionDigits: 2 }) + ' ₺';

  const netMaliProfitEl = document.getElementById('mali-stat-net-profit');
  if (netMaliProfitEl) {
    netMaliProfitEl.style.color = netProfit >= 0 ? '#2e7d32' : '#c62828';
  }

  // Nakit / Kasa Rezervi (Nakit Satışlar + Devirler - Giderler)
  let devirTotal = 0;
  cash.forEach(sale => {
    const saleId = String(sale["Satış ID"] || '');
    const isDevir = saleId.indexOf('DEVIR') === 0 || String(sale["Eser Adı"] || '').indexOf('Kasadan Devir') === 0;
    if (isDevir) {
      devirTotal += parseFloat(sale["Satış Tutarı"] || sale["Tutar"] || 0);
    }
  });
  const currentCashInSafe = (totalCashRevenue + devirTotal) - totalExpenses;
  document.getElementById('mali-stat-total-cash').textContent = Math.max(0, currentCashInSafe).toLocaleString('tr-TR', { minimumFractionDigits: 2 }) + ' ₺';

  // Grafikleri Çiz (Sadece Chart.js başarıyla yüklendiyse)
  if (!window.Chart) {
    showToast('Grafik kütüphanesi yüklenemedi (Çevrimdışı mod olabilir).', 'warning');
    return;
  }

  renderThemesChart(themeCounts);
  renderStatusChart(statusCounts);
  renderTypesChart(typeCounts);
  renderMaliCharts(cash, expenses, totalBeverageRevenue, totalInventoryRevenue, totalCustomRevenue, totalCashRevenue, totalCardRevenue);
}

// Rapor Grafik 1: Tema Dağılımı (Doughnut)
function renderThemesChart(counts) {
  if (STATE.charts.themes) STATE.charts.themes.destroy();
  const ctx = document.getElementById('chart-themes');
  if (!ctx) return;

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 7); // İlk 7 tema

  STATE.charts.themes = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: sorted.map(e => e[0]),
      datasets: [{
        data: sorted.map(e => e[1]),
        backgroundColor: ['#9c27b0', '#e91e63', '#d4af37', '#3f51b5', '#009688', '#ff9800', '#795548'],
        borderColor: '#191425',
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: { color: '#f3effa', font: { size: 10 } }
        }
      }
    }
  });
}

// Rapor Grafik 2: Durum Dağılımı (Pie)
function renderStatusChart(counts) {
  if (STATE.charts.status) STATE.charts.status.destroy();
  const ctx = document.getElementById('chart-status');
  if (!ctx) return;

  STATE.charts.status = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: Object.keys(counts),
      datasets: [{
        data: Object.values(counts),
        backgroundColor: ['#c62828', '#2e7d32', '#9c27b0', '#607d8b'],
        borderColor: '#191425',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#f3effa' }
        }
      }
    }
  });
}

// Rapor Grafik 3: Ürün Cinsi Dağılımı (Bar)
function renderTypesChart(counts) {
  if (STATE.charts.types) STATE.charts.types.destroy();
  const ctx = document.getElementById('chart-types');
  if (!ctx) return;

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10); // En çok 10 cins

  STATE.charts.types = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sorted.map(e => e[0]),
      datasets: [{
        label: 'Ürün Adeti',
        data: sorted.map(e => e[1]),
        backgroundColor: '#d4af37',
        borderColor: '#b38f24',
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { ticks: { color: '#a89ebc' } },
        y: { ticks: { color: '#a89ebc' } }
      },
      plugins: {
        legend: { display: false }
      }
    }
  });
}

// Rapor Mali Grafik ve Tablolar
function renderMaliCharts(cash, expenses, bevRev, envRev, custRev, cashRev, cardRev) {
  // 1. Satış Kategori Dağılımı (Doughnut)
  if (STATE.charts.salesCategories) STATE.charts.salesCategories.destroy();
  const ctxCat = document.getElementById('chart-sales-categories');
  if (ctxCat) {
    STATE.charts.salesCategories = new Chart(ctxCat, {
      type: 'doughnut',
      data: {
        labels: ['Envanter Eserleri', 'İçecek Satışları', 'Özel / Diğer'],
        datasets: [{
          data: [envRev, bevRev, custRev],
          backgroundColor: ['#9c27b0', '#d4af37', '#2196f3'],
          borderColor: '#191425',
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { color: '#f3effa', font: { size: 10 } } }
        }
      }
    });
  }

  // 2. Ödeme Yöntemi Dağılımı (Pie)
  if (STATE.charts.salesPaymentMethods) STATE.charts.salesPaymentMethods.destroy();
  const ctxPay = document.getElementById('chart-sales-payment-methods');
  if (ctxPay) {
    STATE.charts.salesPaymentMethods = new Chart(ctxPay, {
      type: 'pie',
      data: {
        labels: ['Nakit Tahsilat', 'Kredi Kartı'],
        datasets: [{
          data: [cashRev, cardRev],
          backgroundColor: ['#2e7d32', '#d4af37'],
          borderColor: '#191425',
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { color: '#f3effa', font: { size: 10 } } }
        }
      }
    });
  }

  // 3. Gelir Gider Mali Akış Grafiği (Aylık Bilanço)
  const monthlyBalance = {};

  cash.forEach(sale => {
    const saleId = String(sale["Satış ID"] || '');
    const isDevir = saleId.indexOf('DEVIR') === 0 || String(sale["Eser Adı"] || '').indexOf('Kasadan Devir') === 0;
    if (!isDevir) {
      const rawDate = sale["Tarih"];
      if (rawDate) {
        const d = new Date(rawDate);
        if (!isNaN(d.getTime())) {
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          const nakit = parseFloat(sale["Nakit Tahsilat (₺)"] || sale["Nakit Tahsilat"] || 0);
          const kart = parseFloat(sale["Kredi Kartı Tahsilat (₺)"] || sale["Kredi Kartı Tahsilat"] || 0);
          const tutar = parseFloat(sale["Satış Tutarı"] || sale["Tutar"] || 0);
          const val = (nakit || kart) ? (nakit + kart) : tutar;

          if (!monthlyBalance[key]) monthlyBalance[key] = { revenue: 0, expenses: 0 };
          monthlyBalance[key].revenue += val;
        }
      }
    }
  });

  expenses.forEach(exp => {
    const rawDate = exp["Tarih"];
    if (rawDate) {
      const d = new Date(rawDate);
      if (!isNaN(d.getTime())) {
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const val = parseFloat(exp["Tutar"] || 0);

        if (!monthlyBalance[key]) monthlyBalance[key] = { revenue: 0, expenses: 0 };
        monthlyBalance[key].expenses += val;
      }
    }
  });

  const sortedMonths = Object.keys(monthlyBalance).sort();
  const revData = [];
  const expData = [];
  const labels = [];

  if (sortedMonths.length === 0) {
    const today = new Date();
    for (let i = 4; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      labels.push(key);
      revData.push(0);
      expData.push(0);
    }
  } else {
    const monthNames = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
    sortedMonths.forEach(m => {
      const [year, month] = m.split('-');
      labels.push(`${monthNames[parseInt(month, 10) - 1]} ${year}`);
      revData.push(monthlyBalance[m].revenue);
      expData.push(monthlyBalance[m].expenses);
    });
  }

  if (STATE.charts.financialFlow) STATE.charts.financialFlow.destroy();
  const ctxFlow = document.getElementById('chart-financial-flow');
  if (ctxFlow) {
    STATE.charts.financialFlow = new Chart(ctxFlow, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Aylık Toplam Hasılat',
            data: revData,
            backgroundColor: 'rgba(46, 125, 50, 0.8)',
            borderColor: '#2e7d32',
            borderWidth: 1
          },
          {
            label: 'Aylık Toplam Gider',
            data: expData,
            backgroundColor: 'rgba(198, 40, 40, 0.8)',
            borderColor: '#c62828',
            borderWidth: 1
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { color: '#a89ebc' }, grid: { color: 'rgba(255,255,255,0.03)' } },
          y: { ticks: { color: '#a89ebc' }, grid: { color: 'rgba(255,255,255,0.03)' } }
        },
        plugins: {
          legend: { labels: { color: '#f3effa' } }
        }
      }
    });
  }

  // 4. En Çok Satılan 5 Ürün Grubu Listesi
  const productSales = {};
  cash.forEach(sale => {
    const name = sale["Eser Adı"] || 'Diğer / Açıklamasız';
    const rawVal = parseFloat(sale["Satış Tutarı"] || sale["Tutar"] || 0);
    const qty = parseInt(sale["Adet"] || 1, 10);

    const saleId = String(sale["Satış ID"] || '');
    const isDevir = saleId.indexOf('DEVIR') === 0 || String(sale["Eser Adı"] || '').indexOf('Kasadan Devir') === 0;

    if (!isDevir) {
      if (!productSales[name]) {
        productSales[name] = { qty: 0, revenue: 0 };
      }
      productSales[name].qty += qty;
      productSales[name].revenue += rawVal;
    }
  });

  const sortedProducts = Object.entries(productSales)
    .sort((a, b) => b[1].qty - a[1].qty)
    .slice(0, 5);

  const tbody = document.getElementById('top-selling-products-tbody');
  if (tbody) {
    if (sortedProducts.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="text-center" style="color:var(--text-muted); padding:1rem;">Satış kaydı bulunmamaktadır.</td></tr>`;
    } else {
      tbody.innerHTML = sortedProducts.map(([name, stat], idx) => {
        return `
          <tr>
            <td><strong>${idx + 1}</strong></td>
            <td>${name}</td>
            <td>${stat.qty} Adet</td>
            <td><strong>${stat.revenue.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺</strong></td>
          </tr>
        `;
      }).join('');
    }
  }
}

// Rapor Grafik 4: Personel ve Proje İstatistikleri & Tahmin Modellemesi
function renderPersonnelProjectCharts() {
  if (!window.Chart) return;

  const personnelCounts = {};
  const monthlyCounts = {};
  const totalProjects = STATE.inventory.length;

  STATE.inventory.forEach(item => {
    // Personel katkı sayımı
    const pers = String(item.personel || '').trim();
    if (pers) {
      personnelCounts[pers] = (personnelCounts[pers] || 0) + 1;
    }

    // Aylık veri sayımı
    const date = parseDateRobust(item.timestamp || item.tarihBaslangic);
    if (date) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const key = `${year}-${month}`;
      monthlyCounts[key] = (monthlyCounts[key] || 0) + 1;
    }
  });

  const uniquePersonnel = Object.keys(personnelCounts).length;

  const activeProjectsEl = document.getElementById('rapor-stat-active-projects');
  if (activeProjectsEl) activeProjectsEl.textContent = totalProjects;

  const productivePersonnelEl = document.getElementById('rapor-stat-productive-personnel');
  if (productivePersonnelEl) productivePersonnelEl.textContent = uniquePersonnel;

  // Aylık trend ve Lineer Regresyon modeli
  const sortedMonths = Object.keys(monthlyCounts).sort();
  const n = sortedMonths.length;
  let totalForecastNextYear = 0;

  const forecastLabels = [];
  const historicalData = [];
  const combinedForecastData = [];

  if (n > 0) {
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    sortedMonths.forEach((monthKey, index) => {
      const y = monthlyCounts[monthKey];
      sumX += index;
      sumY += y;
      sumXY += index * y;
      sumXX += index * index;
    });

    let m = 0;
    let c = sumY / n;
    if (n > 1) {
      const denom = (n * sumXX - sumX * sumX);
      if (denom !== 0) {
        m = (n * sumXY - sumX * sumY) / denom;
        c = (sumY - m * sumX) / n;
      }
    }

    // Geçmiş verileri doldur
    sortedMonths.forEach((monthKey) => {
      historicalData.push(monthlyCounts[monthKey]);
      const [year, month] = monthKey.split('-');
      const monthNames = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
      forecastLabels.push(`${monthNames[parseInt(month, 10) - 1]} ${year}`);
      combinedForecastData.push(null);
    });

    // Son geçmiş veriyi tahmin çizgisinin başlangıcına bağla (kesintisiz görünüm için)
    const lastHistVal = historicalData[historicalData.length - 1];
    combinedForecastData[historicalData.length - 1] = lastHistVal;

    // Gelecek 12 ayı tahmin et
    let lastParts = sortedMonths[n - 1].split('-');
    let lastYear = parseInt(lastParts[0], 10);
    let lastMonth = parseInt(lastParts[1], 10) - 1;

    for (let i = 0; i < 12; i++) {
      lastMonth++;
      if (lastMonth > 11) {
        lastMonth = 0;
        lastYear++;
      }
      const xIndex = n + i;
      const predictedVal = Math.max(0, Math.round(m * xIndex + c));
      totalForecastNextYear += predictedVal;

      const monthNames = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
      forecastLabels.push(`${monthNames[lastMonth]} ${lastYear} (Tahmin)`);
      combinedForecastData.push(predictedVal);
    }
  } else {
    // Eğer veri yoksa varsayılan 12 ay ekle
    const monthNames = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
    const currentYear = new Date().getFullYear();
    for (let i = 0; i < 12; i++) {
      forecastLabels.push(`${monthNames[i]} ${currentYear} (Tahmin)`);
      combinedForecastData.push(0);
    }
  }

  const forecastEl = document.getElementById('rapor-stat-next-year-forecast');
  if (forecastEl) forecastEl.textContent = totalForecastNextYear;

  // 1. Aylık Üretim & Tahmin Grafiği (Line)
  if (STATE.charts.monthlyForecast) STATE.charts.monthlyForecast.destroy();
  const ctxForecast = document.getElementById('chart-monthly-forecast');
  if (ctxForecast) {
    STATE.charts.monthlyForecast = new Chart(ctxForecast, {
      type: 'line',
      data: {
        labels: forecastLabels,
        datasets: [
          {
            label: 'Gerçekleşen Üretim',
            data: historicalData,
            borderColor: '#9c27b0',
            backgroundColor: 'rgba(156, 39, 176, 0.08)',
            borderWidth: 3,
            fill: true,
            tension: 0.3
          },
          {
            label: 'Gelecek Yıl Beklenti Tahmini (Linear Regression)',
            data: combinedForecastData,
            borderColor: '#d4af37',
            backgroundColor: 'rgba(212, 175, 55, 0.04)',
            borderWidth: 2.5,
            borderDash: [5, 5],
            fill: true,
            tension: 0.3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            ticks: { color: '#a89ebc', font: { size: 9 } },
            grid: { color: 'rgba(255,255,255,0.03)' }
          },
          y: {
            ticks: { color: '#a89ebc' },
            grid: { color: 'rgba(255,255,255,0.03)' }
          }
        },
        plugins: {
          legend: {
            labels: { color: '#f3effa', font: { size: 11 } },
            position: 'top'
          }
        }
      }
    });
  }

  // 2. Personel Katkı Grafiği (Horizontal Bar)
  if (STATE.charts.personnelContributions) STATE.charts.personnelContributions.destroy();
  const ctxPers = document.getElementById('chart-personnel-contributions');
  if (ctxPers) {
    const sortedPers = Object.entries(personnelCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
    STATE.charts.personnelContributions = new Chart(ctxPers, {
      type: 'bar',
      data: {
        labels: sortedPers.map(e => e[0]),
        datasets: [{
          label: 'Eser/Envanter Adeti',
          data: sortedPers.map(e => e[1]),
          backgroundColor: '#9c27b0',
          borderColor: '#7b1fa2',
          borderWidth: 1
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            ticks: { color: '#a89ebc' },
            grid: { color: 'rgba(255,255,255,0.03)' }
          },
          y: {
            ticks: { color: '#a89ebc' },
            grid: { color: 'rgba(255,255,255,0.03)' }
          }
        },
        plugins: {
          legend: { display: false }
        }
      }
    });
  }

  // 3. Proje Süreç Durum Dağılımı (Pie)
  let projTamam = 0;
  let projDevam = 0;
  let projGecik = 0;

  if (window._projeDataLoaded && window._allProjects && window._allProjects.length > 0) {
    window._allProjects.forEach(p => {
      const status = getProjeStatus(p);
      if (status === 'tamamlandi') projTamam++;
      else if (status === 'gecikti') projGecik++;
      else projDevam++;
    });
  } else {
    STATE.inventory.forEach(item => {
      const status = String(getValueByFuzzyKey(item, ['Arşive Eklendi / Fiş Tamam', 'Arşive Eklendi/Fiş Tamam', 'Durum', 'Arşiv Durumu'])).trim();
      const statusLower = status.toLowerCase().replace(/[^a-z0-9ıışğüöç]/g, '');
      const isCompleted = statusLower.includes('arsiveeklendi') || statusLower.includes('fistamam') || statusLower.includes('onaylandi');
      const isPending = statusLower.includes('grafik') || statusLower.includes('bekleniyor') || statusLower.includes('gorsel');
      if (isCompleted) projTamam++;
      else if (isPending) projGecik++;
      else projDevam++;
    });
  }

  if (STATE.charts.projectStatusDistribution) STATE.charts.projectStatusDistribution.destroy();
  const ctxProjStatus = document.getElementById('chart-project-status-distribution');
  if (ctxProjStatus) {
    STATE.charts.projectStatusDistribution = new Chart(ctxProjStatus, {
      type: 'pie',
      data: {
        labels: ['Tamamlanan Projeler', 'Devam Eden Projeler', 'Geciken / Bekleyenler'],
        datasets: [{
          data: [projTamam, projDevam, projGecik],
          backgroundColor: ['#2e7d32', '#2196f3', '#c62828'],
          borderColor: '#191425',
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { color: '#f3effa', font: { size: 10 } } }
        }
      }
    });
  }

  // 4. En Çok Üretim Yapan 5 Personel
  const sortedPersonnel = Object.entries(personnelCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const persRankingTbody = document.getElementById('personnel-ranking-tbody');
  if (persRankingTbody) {
    if (sortedPersonnel.length === 0) {
      persRankingTbody.innerHTML = `<tr><td colspan="4" class="text-center" style="color:var(--text-muted); padding:1rem;">Personel katkısı bulunmamaktadır.</td></tr>`;
    } else {
      persRankingTbody.innerHTML = sortedPersonnel.map(([name, count], idx) => {
        const ratio = totalProjects > 0 ? ((count / totalProjects) * 100).toFixed(1) : '0';
        return `
          <tr>
            <td><strong>${idx + 1}</strong></td>
            <td><strong>${name}</strong></td>
            <td>${count} Eser</td>
            <td>
              <div style="display:flex; align-items:center; gap:0.5rem;">
                <div style="flex-grow:1; background:rgba(255,255,255,0.05); height:6px; border-radius:3px; overflow:hidden;">
                  <div style="background:var(--accent-gold); width:${ratio}%; height:100%;"></div>
                </div>
                <span>${ratio}%</span>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }
  }
}

// Rapor Atölye Açılır Menüsünü Doldur
function populateReportAtolyeDropdown() {
  const select = document.getElementById('filter-report-atolye');
  if (!select) return;

  const atolyeSet = new Set();

  // Envanterden türleri al
  STATE.inventory.forEach(item => {
    const cins = getValueByFuzzyKey(item, ['Ürün Cinsi', 'Cinsi', 'Cins', 'Ürün Tipi']);
    if (cins && String(cins).trim() !== '') atolyeSet.add(String(cins).trim());
  });

  // Projelerden atölyeleri al
  if (window._allProjects) {
    window._allProjects.forEach(p => {
      if (p.atolye && String(p.atolye).trim() !== '') atolyeSet.add(String(p.atolye).trim());
    });
  }

  select.innerHTML = '<option value="all">Tüm Atölyeler / Türler</option>';
  [...atolyeSet].sort().forEach(a => {
    const opt = document.createElement('option');
    opt.value = a;
    opt.textContent = a;
    select.appendChild(opt);
  });
}

// Yönetici Raporunu Dinamik Olarak Oluştur
function generateExecutiveReport() {
  const startDate = document.getElementById('filter-report-start').value;
  const endDate = document.getElementById('filter-report-end').value;
  const reportType = document.getElementById('filter-report-type').value;
  const selectedAtolye = document.getElementById('filter-report-atolye').value;

  const previewSheet = document.getElementById('report-preview-sheet');
  if (!previewSheet) return;

  previewSheet.innerHTML = '<div style="padding:3rem; text-align:center;"><div class="spinner" style="margin: 0 auto 1rem;"></div><p>Rapor verileri derleniyor, lütfen bekleyin...</p></div>';

  const inventory = STATE.inventory || [];
  const cash = STATE.magaza.cash || [];
  const expenses = STATE.magaza.expenses || [];

  // 1. Envanter Verilerini Filtrele
  const filteredInventory = inventory.filter(item => {
    // Tarih Filtresi
    const rawDate = item.timestamp || item.tarihBaslangic;
    const itemDate = parseDateRobust(rawDate);
    if (itemDate) {
      const dateStr = itemDate.toISOString().split('T')[0];
      if (startDate && dateStr < startDate) return false;
      if (endDate && dateStr > endDate) return false;
    }
    // Atölye/Cins Filtresi
    if (selectedAtolye !== 'all') {
      const cins = String(getValueByFuzzyKey(item, ['Ürün Cinsi', 'Cinsi', 'Cins', 'Ürün Tipi'])).trim();
      const theme = String(getValueByFuzzyKey(item, ['Tema', 'Temalar'])).trim();
      if (cins !== selectedAtolye && theme !== selectedAtolye) return false;
    }
    return true;
  });

  // 2. Satış Verilerini Filtrele
  const filteredSales = cash.filter(sale => {
    const saleId = String(sale["Satış ID"] || '');
    const isDevir = saleId.indexOf('DEVIR') === 0 || String(sale["Eser Adı"] || '').indexOf('Kasadan Devir') === 0;
    if (isDevir) return false;

    // Tarih Filtresi
    const rawDate = sale["Tarih"];
    if (rawDate) {
      const d = new Date(rawDate);
      if (!isNaN(d.getTime())) {
        const dateStr = d.toISOString().split('T')[0];
        if (startDate && dateStr < startDate) return false;
        if (endDate && dateStr > endDate) return false;
      }
    }
    // Atölye/Cins Filtresi (Ürün adı veya Kategori eşleşmesi)
    if (selectedAtolye !== 'all') {
      const name = String(sale["Eser Adı"] || '').toLowerCase();
      const category = String(sale["Kategori"] || sale["Tür"] || '').toLowerCase();
      const atolyeLower = selectedAtolye.toLowerCase();
      if (!name.includes(atolyeLower) && !category.includes(atolyeLower)) return false;
    }
    return true;
  });

  // 3. Gider Verilerini Filtrele
  const filteredExpenses = expenses.filter(exp => {
    const rawDate = exp["Tarih"];
    if (rawDate) {
      const d = new Date(rawDate);
      if (!isNaN(d.getTime())) {
        const dateStr = d.toISOString().split('T')[0];
        if (startDate && dateStr < startDate) return false;
        if (endDate && dateStr > endDate) return false;
      }
    }
    return true;
  });

  // Hesaplamalar
  const totalInvCount = filteredInventory.length;
  let compCount = 0;
  let pendingCount = 0;

  filteredInventory.forEach(item => {
    const status = String(getValueByFuzzyKey(item, ['Arşive Eklendi / Fiş Tamam', 'Arşive Eklendi/Fiş Tamam', 'Durum', 'Arşiv Durumu'])).trim().toLowerCase();
    const isCompleted = status.includes('arsiv') || status.includes('tamam') || status.includes('onay');
    if (isCompleted) compCount++;
    else pendingCount++;
  });

  const compRate = totalInvCount > 0 ? Math.round((compCount / totalInvCount) * 100) : 0;

  let salesTotal = 0;
  filteredSales.forEach(s => {
    const nakit = parseFloat(s["Nakit Tahsilat (₺)"] || s["Nakit Tahsilat"] || 0);
    const kart = parseFloat(s["Kredi Kartı Tahsilat (₺)"] || s["Kredi Kartı Tahsilat"] || 0);
    const tutar = parseFloat(s["Satış Tutarı"] || s["Tutar"] || 0);
    salesTotal += (nakit || kart) ? (nakit + kart) : tutar;
  });

  let expensesTotal = 0;
  filteredExpenses.forEach(e => {
    expensesTotal += parseFloat(e["Tutar"] || 0);
  });

  const netBalance = salesTotal - expensesTotal;
  const dateRangeStr = (startDate && endDate)
    ? `${startDate.split('-').reverse().join('.')} - ${endDate.split('-').reverse().join('.')}`
    : (startDate ? `${startDate.split('-').reverse().join('.')} Sonrası` : (endDate ? `${endDate.split('-').reverse().join('.')} Öncesi` : 'Tüm Zamanlar'));

  let reportTitle = "KONSOLİDE ENSTİTÜ RAPORU";
  if (reportType === 'uretim') reportTitle = "DETAYLI ÜRETİM VE PERFORMANS RAPORU";
  else if (reportType === 'mali') reportTitle = "MALİ BİLANÇO VE MAĞAZA RAPORU";
  else if (reportType === 'arsiv') reportTitle = "ARŞİV VE TEMA DAĞILIM RAPORU";

  let html = `
    <div style="color: #111111; font-family: 'Inter', sans-serif;">
      <!-- Kurumsal Antet -->
      <div class="report-header-section">
        <h3 class="report-header-title-sm">T.C.</h3>
        <h3 class="report-header-title-md">MİLLÎ EĞİTİM BAKANLIĞI</h3>
        <h2 class="report-header-title-lg">EDİRNE OLGUNLAŞMA ENSTİTÜSÜ MÜDÜRLÜĞÜ</h2>
        <p class="report-header-title-sm" style="font-style: italic; margin-top: 5px;">Kurumsal Yönetim ve Karar Destek Sistemi</p>
      </div>

      <!-- Rapor Başlığı -->
      <h2 style="text-align: center; margin: 1.5rem 0; font-size: 1.25rem; font-weight: 700; color: #5a128e; border-bottom: 2px solid #d4af37; padding-bottom: 8px; text-transform: uppercase;">
        ${reportTitle}
      </h2>

      <!-- Bilgi Tablosu -->
      <table class="report-meta-table">
        <tr>
          <td class="label">Rapor Tarihi:</td>
          <td class="value">${new Date().toLocaleString('tr-TR')}</td>
          <td class="label">Filtre Kapsamı:</td>
          <td class="value">${selectedAtolye === 'all' ? 'Tüm Sınıflandırmalar' : selectedAtolye}</td>
        </tr>
        <tr>
          <td class="label">Dönem Aralığı:</td>
          <td class="value">${dateRangeStr}</td>
          <td class="label">Hazırlayan Yetkili:</td>
          <td class="value">${STATE.currentUser ? STATE.currentUser.name : 'Sistem Analisti'}</td>
        </tr>
      </table>

      <!-- KPI Kutuları -->
      <div class="report-section-title">TEMEL GÖSTERGELER (KPI)</div>
      <div class="report-summary-cards">
        <div class="report-sum-card">
          <div class="report-sum-card-val">${totalInvCount} Adet</div>
          <div class="report-sum-card-lbl">Kayıtlı Ürün</div>
        </div>
        <div class="report-sum-card">
          <div class="report-sum-card-val">${compRate}%</div>
          <div class="report-sum-card-lbl">Arşivlenme Oranı</div>
        </div>
        <div class="report-sum-card">
          <div class="report-sum-card-val" style="color: #2e7d32;">${salesTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺</div>
          <div class="report-sum-card-lbl">Toplam Gelir</div>
        </div>
        <div class="report-sum-card">
          <div class="report-sum-card-val" style="color: ${netBalance >= 0 ? '#2e7d32' : '#c62828'}">${netBalance.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺</div>
          <div class="report-sum-card-lbl">Dönem Dengesi</div>
        </div>
      </div>
  `;

  // Dinamik içerik
  if (reportType === 'konsolide') {
    html += `
      <div class="report-section-title">1. ÜRETİM VE ARŞİV DETAYLARI</div>
      <p style="font-size: 0.8rem; margin-bottom: 10px; text-align: justify;">Raporlanan dönem içinde enstitü bünyesinde kayıt altına alınan eser sayısı <strong>${totalInvCount}</strong> adettir. Bu eserlerden <strong>${compCount}</strong> tanesinin katalog fişleri, fotoğrafları ve sistem onayları tamamlanarak arşive çekilmiştir. Grafik tasarımı ve görsel düzenlemesi devam eden eser sayısı ise <strong>${pendingCount}</strong> adettir.</p>
      
      <table class="report-data-table">
        <thead>
          <tr>
            <th>Durum Tipi</th>
            <th>Eser Adeti</th>
            <th>Yüzde Oranı</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Tamamlanıp Arşive Alınanlar</td>
            <td>${compCount} Adet</td>
            <td>% ${totalInvCount > 0 ? Math.round((compCount / totalInvCount) * 100) : 0}</td>
          </tr>
          <tr>
            <td>Tasarım/Görsel Aşamasında Olanlar</td>
            <td>${pendingCount} Adet</td>
            <td>% ${totalInvCount > 0 ? Math.round((pendingCount / totalInvCount) * 100) : 0}</td>
          </tr>
        </tbody>
      </table>

      <div class="report-section-title">2. MAĞAZA GELİR VE GİDER TABLOSU</div>
      <p style="font-size: 0.8rem; margin-bottom: 10px; text-align: justify;">Bu dönemde mağaza satışları ve içecek gelirleri toplamı <strong>${salesTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺</strong> hasılata ulaşmıştır. Bu gelirin elde edilmesi ve enstitü operasyonlarının yürütülmesi için yapılan toplam harcama tutarı <strong>${expensesTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺</strong> olmuştur.</p>
      
      <table class="report-data-table">
        <thead>
          <tr>
            <th>Finansal Kalem</th>
            <th>Tutar</th>
            <th>Genel Durum / Açıklama</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="font-weight: 600; color: #2e7d32;">Mağaza Toplam Cirosu</td>
            <td style="font-weight: 600; color: #2e7d32;">${salesTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺</td>
            <td>Eser satışları, içecek tahsilatları ve özel siparişler</td>
          </tr>
          <tr>
            <td style="font-weight: 600; color: #c62828;">Toplam Gider Ödemeleri</td>
            <td style="font-weight: 600; color: #c62828;">${expensesTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺</td>
            <td>Atölye malzemeleri, sarf malzemeler ve diğer cari giderler</td>
          </tr>
          <tr style="background-color: #f8fafc; font-weight: 700; border-top: 2px solid #5a128e;">
            <td style="color: #5a128e;">Net Bilanço Farkı</td>
            <td style="color: ${netBalance >= 0 ? '#2e7d32' : '#c62828'}">${netBalance.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺</td>
            <td><strong>${netBalance >= 0 ? 'Dönem Net Karı Elde Edilmiştir' : 'Mali Bakiye Eksi Durumdadır'}</strong></td>
          </tr>
        </tbody>
      </table>
    `;
  } else if (reportType === 'uretim') {
    const personnelCountsFiltered = {};
    filteredInventory.forEach(item => {
      const pers = String(item.personel || '').trim();
      if (pers) {
        personnelCountsFiltered[pers] = (personnelCountsFiltered[pers] || 0) + 1;
      }
    });

    const sortedPers = Object.entries(personnelCountsFiltered)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    html += `
      <div class="report-section-title">USTA ÖĞRETİCİ PERFORMANS SIRALAMASI (İLK 10)</div>
      <p style="font-size: 0.8rem; margin-bottom: 10px;">Filtrelenen tarih aralığı ve ürün grubuna göre en fazla katkı veren personel listesidir.</p>
      
      <table class="report-data-table">
        <thead>
          <tr>
            <th style="width: 10%;">Sıra</th>
            <th style="width: 50%;">Usta Öğretici Adı Soyadı</th>
            <th style="width: 20%;">Kayıt Eser</th>
            <th style="width: 20%;">Katkı Oranı</th>
          </tr>
        </thead>
        <tbody>
          ${sortedPers.length === 0
        ? '<tr><td colspan="4" class="text-center">Kayıtlı performans verisi bulunamadı.</td></tr>'
        : sortedPers.map(([name, count], idx) => {
          const ratio = totalInvCount > 0 ? ((count / totalInvCount) * 100).toFixed(1) : '0';
          return `
                  <tr>
                    <td><strong>${idx + 1}</strong></td>
                    <td>${name}</td>
                    <td>${count} Adet</td>
                    <td>% ${ratio}</td>
                  </tr>
                `;
        }).join('')
      }
        </tbody>
      </table>
    `;
  } else if (reportType === 'mali') {
    html += `
      <div class="report-section-title">DÖNEM DETAYLI SATIŞ GELİR LİSTESİ</div>
      <table class="report-data-table">
        <thead>
          <tr>
            <th>Satış ID</th>
            <th>Eser Adı / Açıklama</th>
            <th>Adet</th>
            <th>Ödeme Şekli</th>
            <th>Tarih</th>
            <th>Tutar</th>
          </tr>
        </thead>
        <tbody>
          ${filteredSales.length === 0
        ? '<tr><td colspan="6" class="text-center">Döneme ait satış kaydı bulunmamaktadır.</td></tr>'
        : filteredSales.slice(0, 15).map(s => {
          const nakit = parseFloat(s["Nakit Tahsilat (₺)"] || s["Nakit Tahsilat"] || 0);
          const kart = parseFloat(s["Kredi Kartı Tahsilat (₺)"] || s["Kredi Kartı Tahsilat"] || 0);
          const tutar = parseFloat(s["Satış Tutarı"] || s["Tutar"] || 0);
          const price = (nakit || kart) ? (nakit + kart) : tutar;
          const date = s["Tarih"] ? s["Tarih"].split('T')[0] : '';
          return `
                  <tr>
                    <td><code>${s["Satış ID"] || ''}</code></td>
                    <td>${s["Eser Adı"] || ''}</td>
                    <td>${s["Adet"] || 1}</td>
                    <td>${s["Ödeme Yöntemi"] || 'Belirtilmemiş'}</td>
                    <td>${date}</td>
                    <td style="font-weight:600; color:#2e7d32;">${price.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺</td>
                  </tr>
                `;
        }).join('')
      }
          ${filteredSales.length > 15 ? `<tr><td colspan="6" class="text-center" style="font-style:italic; color:#666; font-size:11px;">... Toplam ${filteredSales.length} kayıttan ilk 15 tanesi listelenmiştir ...</td></tr>` : ''}
        </tbody>
      </table>

      <div class="report-section-title">DÖNEM DETAYLI GİDER KALEMLERİ LİSTESİ</div>
      <table class="report-data-table">
        <thead>
          <tr>
            <th>Gider ID</th>
            <th>Gider Açıklaması</th>
            <th>Ödeme Türü</th>
            <th>Ödeyen</th>
            <th>Tarih</th>
            <th>Tutar</th>
          </tr>
        </thead>
        <tbody>
          ${filteredExpenses.length === 0
        ? '<tr><td colspan="6" class="text-center">Döneme ait gider kaydı bulunmamaktadır.</td></tr>'
        : filteredExpenses.slice(0, 15).map(e => {
          const price = parseFloat(e["Tutar"] || 0);
          const date = e["Tarih"] ? e["Tarih"].split('T')[0] : '';
          return `
                  <tr>
                    <td><code>${e["Gider ID"] || ''}</code></td>
                    <td>${e["Açıklama"] || ''}</td>
                    <td>${e["Ödeme Yöntemi"] || 'Kasa Nakit'}</td>
                    <td>${e["Ödemeyi Yapan"] || ''}</td>
                    <td>${date}</td>
                    <td style="font-weight:600; color:#c62828;">${price.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺</td>
                  </tr>
                `;
        }).join('')
      }
          ${filteredExpenses.length > 15 ? `<tr><td colspan="6" class="text-center" style="font-style:italic; color:#666; font-size:11px;">... Toplam ${filteredExpenses.length} kayıttan ilk 15 tanesi listelenmiştir ...</td></tr>` : ''}
        </tbody>
      </table>
    `;
  } else if (reportType === 'arsiv') {
    const sortedThemes = Object.entries(themeCounts).sort((a, b) => b[1] - a[1]);
    const sortedTypes = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);

    html += `
      <div class="report-section-title">KÜLTÜREL TEMA DAĞILIM TABLOSU</div>
      <p style="font-size: 0.8rem; margin-bottom: 10px;">Enstitü bünyesinde çalışılmış ve arşiv kaydı girilmiş olan tarihi temaların dağılım durumudur.</p>
      <table class="report-data-table">
        <thead>
          <tr>
            <th>Sıra</th>
            <th>Tema Adı</th>
            <th>Eser Sayısı</th>
            <th>Yüzde Oranı</th>
          </tr>
        </thead>
        <tbody>
          ${sortedThemes.length === 0
        ? '<tr><td colspan="4" class="text-center">Tema kaydı bulunamadı.</td></tr>'
        : sortedThemes.map(([name, count], idx) => {
          const ratio = totalInvCount > 0 ? ((count / totalInvCount) * 100).toFixed(1) : '0';
          return `
                  <tr>
                    <td><strong>${idx + 1}</strong></td>
                    <td>${name}</td>
                    <td>${count} Adet</td>
                    <td>% ${ratio}</td>
                  </tr>
                `;
        }).join('')
      }
        </tbody>
      </table>

      <div class="report-section-title">ÜRÜN GRUPLARI VE ATÖLYE ÇEŞİTLİLİĞİ</div>
      <table class="report-data-table">
        <thead>
          <tr>
            <th>Sıra</th>
            <th>Ürün Cinsi / Atölye Branşı</th>
            <th>Eser Sayısı</th>
            <th>Yüzde Oranı</th>
          </tr>
        </thead>
        <tbody>
          ${sortedTypes.length === 0
        ? '<tr><td colspan="4" class="text-center">Ürün cinsi kaydı bulunamadı.</td></tr>'
        : sortedTypes.map(([name, count], idx) => {
          const ratio = totalInvCount > 0 ? ((count / totalInvCount) * 100).toFixed(1) : '0';
          return `
                  <tr>
                    <td><strong>${idx + 1}</strong></td>
                    <td>${name}</td>
                    <td>${count} Adet</td>
                    <td>% ${ratio}</td>
                  </tr>
                `;
        }).join('')
      }
        </tbody>
      </table>
    `;
  }

  // İmza ve Altbaşlık Bölümü
  html += `
      <div class="report-signatures">
        <div class="report-signature-block">
          <div class="report-signature-title">Raporlayan Yetkili</div>
          <div class="report-signature-name">${STATE.currentUser ? STATE.currentUser.name : 'Sistem Operatörü'}</div>
          <div class="report-signature-post">${STATE.currentUser ? translateRole(STATE.currentUser.role) : 'Veri Giriş Personeli'}</div>
        </div>
        <div class="report-signature-block">
          <div class="report-signature-title">Onaylayan Kurum Amiri</div>
          <div class="report-signature-name">Meltem ÜRETMEN</div>
          <div class="report-signature-post">Enstitü Müdürü</div>
        </div>
      </div>
      
      <div style="margin-top: 30px; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 10px; font-size: 0.6rem; color: #94a3b8;">
        Bu belge elektronik imza kanununa uygun olarak Edirne Olgunlaşma Enstitüsü Otomasyon Sistemi tarafından üretilmiştir. Doğrulama Kodu: ${Math.floor(100000 + Math.random() * 900000)}
      </div>
    </div>
  `;

  previewSheet.innerHTML = html;

  // PDF download data state setter
  window._generatedReportData = {
    title: reportTitle,
    html: html
  };
}

// Raporu Resmi PDF Olarak Kaydet (html2pdf ile)
async function exportExecutiveReportPDF() {
  if (!window._generatedReportData) {
    showToast('Öncelikle "Raporu Hazırla" butonu ile raporu oluşturmalısınız.', 'warning');
    return;
  }

  const opt = {
    margin: 15,
    filename: `${window._generatedReportData.title.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, logging: false },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  // PDF motoru istek üzerine yüklenir (açılışı yavaşlatmasın diye).
  if (!(await pdfMotoruHazirla())) return;

  showToast('Resmi PDF raporu oluşturuluyor, lütfen bekleyin...', 'info');

  const pdfContainer = document.createElement('div');
  pdfContainer.style.padding = '40px';
  pdfContainer.style.fontFamily = "'Inter', sans-serif";
  pdfContainer.style.color = '#111111';
  pdfContainer.style.backgroundColor = '#ffffff';
  pdfContainer.style.width = '700px';
  pdfContainer.innerHTML = window._generatedReportData.html;

  // CSS ekle (A4 içinde stillerin ezilmesini önlemek için inline'ları destekleyici stiller)
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    .report-header-section { text-align: center; border-bottom: 2px solid #5a128e; padding-bottom: 15px; margin-bottom: 25px; }
    .report-header-title-lg { font-size: 18px; font-weight: 700; color: #5a128e !important; margin: 4px 0; }
    .report-header-title-md { font-size: 13px; font-weight: 600; color: #555555; margin: 0; }
    .report-header-title-sm { font-size: 11px; color: #777777; margin: 0; }
    .report-meta-table { width: 100%; border-collapse: collapse; margin-bottom: 25px; font-size: 12px; }
    .report-meta-table td { padding: 6px 8px; border-bottom: 1px solid #f0f0f0; }
    .report-meta-table td.label { font-weight: 700; color: #555555; width: 25%; }
    .report-meta-table td.value { color: #111111; }
    .report-section-title { font-size: 14px; font-weight: 700; border-bottom: 2px solid #d4af37; padding-bottom: 5px; margin-top: 25px; margin-bottom: 12px; color: #5a128e !important; text-transform: uppercase; }
    .report-summary-cards { display: flex; gap: 15px; margin-bottom: 20px; }
    .report-sum-card { flex: 1; border: 1px solid #e2e8f0; background-color: #f8fafc; padding: 12px; border-radius: 6px; text-align: center; }
    .report-sum-card-val { font-size: 16px; font-weight: 700; color: #5a128e; margin-bottom: 4px; }
    .report-sum-card-lbl { font-size: 10px; color: #64748b; font-weight: 600; text-transform: uppercase; }
    .report-data-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 11px; }
    .report-data-table th, .report-data-table td { padding: 8px 10px; border: 1px solid #e2e8f0; text-align: left; }
    .report-data-table th { background-color: #f1f5f9; color: #334155; font-weight: 700; }
    .report-data-table tr:nth-child(even) td { background-color: #f8fafc; }
    .report-signatures { display: flex; justify-content: space-between; margin-top: 45px; padding-top: 15px; font-size: 12px; }
    .report-signature-block { text-align: center; width: 40%; }
    .report-signature-title { font-weight: 700; margin-bottom: 35px; color: #475569; }
    .report-signature-name { font-weight: 600; text-decoration: underline; color: #1e293b; }
    .report-signature-post { font-size: 11px; color: #64748b; }
  `;
  pdfContainer.insertBefore(styleEl, pdfContainer.firstChild);

  html2pdf().set(opt).from(pdfContainer).save()
    .then(() => {
      showToast('Kurumsal PDF Raporu başarıyla kaydedildi.', 'success');
    })
    .catch(err => {
      console.error('PDF Hatası:', err);
      showToast('PDF oluşturulurken bir hata meydana geldi: ' + err.message, 'danger');
    });
}

// Raporu Excel/CSV formatında dışa aktar
function exportExecutiveReportCSVNew() {
  if (!window._generatedReportData) {
    showToast('Öncelikle "Raporu Hazırla" butonu ile raporu oluşturmalısınız.', 'warning');
    return;
  }

  const reportType = document.getElementById('filter-report-type').value;
  const startDate = document.getElementById('filter-report-start').value;
  const endDate = document.getElementById('filter-report-end').value;

  let csvContent = "\ufeff"; // UTF-8 BOM
  csvContent += `EDİRNE OLGUNLAŞMA ENSTİTÜSÜ MÜDÜRLÜĞÜ - RESMİ YÖNETİCİ RAPORU\n`;
  csvContent += `Rapor Başlığı;${window._generatedReportData.title}\n`;
  csvContent += `Oluşturma Tarihi;${new Date().toLocaleString('tr-TR')}\n`;
  csvContent += `Tarih Filtre Aralığı;${startDate || 'Belirtilmemiş'} - ${endDate || 'Belirtilmemiş'}\n\n`;

  if (reportType === 'mali') {
    csvContent += "İşlem Tipi;Tarih;Açıklama;Ödeme Yöntemi;Tutar (₺)\n";

    // Satışlar
    const filteredSales = (STATE.magaza.cash || []).filter(sale => {
      const saleId = String(sale["Satış ID"] || '');
      const isDevir = saleId.indexOf('DEVIR') === 0 || String(sale["Eser Adı"] || '').indexOf('Kasadan Devir') === 0;
      if (isDevir) return false;

      const rawDate = sale["Tarih"];
      if (rawDate) {
        const d = new Date(rawDate);
        if (startDate && d.toISOString().split('T')[0] < startDate) return false;
        if (endDate && d.toISOString().split('T')[0] > endDate) return false;
      }
      return true;
    });

    filteredSales.forEach(s => {
      const nakit = parseFloat(s["Nakit Tahsilat (₺)"] || s["Nakit Tahsilat"] || 0);
      const kart = parseFloat(s["Kredi Kartı Tahsilat (₺)"] || s["Kredi Kartı Tahsilat"] || 0);
      const tutar = parseFloat(s["Satış Tutarı"] || s["Tutar"] || 0);
      const price = (nakit || kart) ? (nakit + kart) : tutar;
      csvContent += `GELİR;${s["Tarih"] ? s["Tarih"].split('T')[0] : ''};${s["Eser Adı"] || ''};${s["Ödeme Yöntemi"] || ''};${price}\n`;
    });

    // Giderler
    const filteredExpenses = (STATE.magaza.expenses || []).filter(exp => {
      const rawDate = exp["Tarih"];
      if (rawDate) {
        const d = new Date(rawDate);
        if (startDate && d.toISOString().split('T')[0] < startDate) return false;
        if (endDate && d.toISOString().split('T')[0] > endDate) return false;
      }
      return true;
    });

    filteredExpenses.forEach(e => {
      csvContent += `GİDER;${e["Tarih"] ? e["Tarih"].split('T')[0] : ''};${e["Açıklama"] || ''};${e["Ödeme Yöntemi"] || ''};${e["Tutar"] || 0}\n`;
    });
  } else {
    // Üretim Performansı
    csvContent += "Sıra;Usta Öğretici Personel;Eser Üretim Adeti\n";
    const personnelCounts = {};
    STATE.inventory.forEach(item => {
      const pers = String(item.personel || '').trim();
      if (pers) {
        personnelCounts[pers] = (personnelCounts[pers] || 0) + 1;
      }
    });
    const sorted = Object.entries(personnelCounts).sort((a, b) => b[1] - a[1]);
    sorted.forEach(([name, count], idx) => {
      csvContent += `${idx + 1};${name};${count}\n`;
    });
  }

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `Eo_Yonetici_Raporu_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('Rapor verisi CSV formatında başarıyla indirildi.', 'success');
}

// --- Modül 5: Kullanıcı Yönetimi (Admin) ---
function renderUsers() {
  const tbody = document.getElementById('users-tbody');
  tbody.innerHTML = '';

  STATE.users.forEach(u => {
    const tr = document.createElement('tr');
    const statusBadge = u.active
      ? '<span class="badge btn-success" style="padding:0.25rem 0.5rem;font-size:0.7rem;">Aktif</span>'
      : '<span class="badge btn-danger" style="padding:0.25rem 0.5rem;font-size:0.7rem;">Pasif</span>';

    tr.innerHTML = `
      <td data-label="Ad Soyad">${u.name}</td>
      <td data-label="Kullanıcı Adı">${u.username}</td>
      <td data-label="Rol"><strong>${translateRole(u.role)}</strong></td>
      <td data-label="Görevi">${u.duty || 'Diğer'}</td>
      <td data-label="Durum">${statusBadge}</td>
      <td>
        <button class="btn btn-outline-primary btn-sm btn-edit-user" data-user="${u.username}" data-row="${u._rowNum}">Düzenle</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Kullanıcı düzenleme butonları dinleyicileri
  document.querySelectorAll('.btn-edit-user').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const uname = e.target.getAttribute('data-user');
      const rNum = e.target.getAttribute('data-row');
      openEditUserModal(uname, rNum);
    });
  });
}

// --- Modül 6: İşlem Geçmişi (Logs - Admin) ---
function renderLogs() {
  const timeline = document.getElementById('log-timeline');
  timeline.innerHTML = '';

  if (STATE.logs.length === 0) {
    timeline.innerHTML = '<p class="settings-desc">Kayıtlı işlem geçmişi bulunamadı.</p>';
    return;
  }

  STATE.logs.forEach(l => {
    const item = document.createElement('div');

    // Sınıflandırma
    let typeClass = 'update';
    const type = String(l.actionType).toLowerCase();
    if (type.includes('giriş')) typeClass = 'login';
    else if (type.includes('ekleme')) typeClass = 'add';
    else if (type.includes('silme')) typeClass = 'delete';

    item.className = `timeline-item ${typeClass}`;

    // Format Zaman
    const dateStr = l.timestamp ? new Date(l.timestamp).toLocaleString('tr-TR') : 'Bilinmeyen Zaman';

    item.innerHTML = `
      <div class="timeline-time">${dateStr}</div>
      <div class="timeline-title">${l.actionType} (${l.username})</div>
      <div class="timeline-desc">${l.details || ''}</div>
    `;
    timeline.appendChild(item);
  });
}

// Düzenleme modalındaki Durum seçim kutusunun rengini günceller (Yeşil / Kırmızı / Standart)
function updateEditStatusStyle() {
  const select = document.getElementById('edit-durum');
  if (!select) return;
  const val = String(select.value).toLowerCase().replace(/[^a-z0-9ıışğüöç]/g, '');
  select.classList.remove('status-success', 'status-danger');
  const isCompleted = val.includes('arsiv') || val.includes('arşiv') || val.includes('tamam') || val.includes('onay');
  const isPending = val.includes('grafik') || val.includes('bekle') || val.includes('gorsel') || val.includes('görsel');
  if (isCompleted) {
    select.classList.add('status-success');
  } else if (isPending) {
    select.classList.add('status-danger');
  }
}

// ==========================================================================
// 6. Düzenleme Modal Form Kontrolleri (Modals / Actions)
// ==========================================================================

// Envanter Düzenleme Modalını Aç
function openEditInventoryModal(rowNum) {
  const item = STATE.inventory.find(i => String(i._rowNum) === String(rowNum));
  if (!item) return;
  STATE.selectedInventoryItem = item;

  const form = document.getElementById('edit-inventory-form');
  form.reset();

  // Temel Değerleri Form Alanlarına Doldur
  document.getElementById('edit-row-num').value = item._rowNum;
  document.getElementById('edit-envanter-no-display').textContent = item.envanterNo || 'Yok';
  const grafikKutu = document.getElementById('edit-grafik-foto');
  if (grafikKutu) {
    grafikKutu.checked = envanterGrafikFotoVar(item);
    grafikKutu.disabled = !muzeYazabilir();
  }

  const timestampVal = item.timestamp;
  document.getElementById('edit-timestamp-display').textContent = timestampVal ? new Date(timestampVal).toLocaleDateString('tr-TR') : 'Bilinmiyor';

  // input ve textarea alanlarını otomatik doldur
  const inputs = form.querySelectorAll('input[type="text"], input[type="email"], textarea, select');
  inputs.forEach(input => {
    if (input.id === 'edit-stok-select') return; // Özel doldurulacak
    const colName = input.getAttribute('name');
    if (colName) {
      const actualKey = getActualKey(item, colName);
      const originalObj = item._original || item;
      const val = originalObj[actualKey];
      input.value = val !== undefined && val !== null ? val : '';
    }
  });

  // Stok Durumu alanını özel doldur
  const stokSelect = document.getElementById('edit-stok-select');
  const stokOther = document.getElementById('edit-stok-other');
  if (stokSelect && stokOther) {
    const stokActualKey = getActualKey(item, 'Stok Durumu');
    const stokOriginalObj = item._original || item;
    const stokVal = (stokOriginalObj[stokActualKey] !== undefined && stokOriginalObj[stokActualKey] !== null) ? String(stokOriginalObj[stokActualKey]).trim() : '';
    const predefinedStokOptions = ['Konak', 'Devecihan', 'Satış için gönderildi', 'Bohça', 'Valilik', 'Hediyelik'];

    if (predefinedStokOptions.includes(stokVal)) {
      stokSelect.value = stokVal;
      stokOther.style.display = 'none';
      stokOther.value = '';
    } else if (stokVal === '') {
      stokSelect.value = 'Konak';
      stokOther.style.display = 'none';
      stokOther.value = '';
    } else {
      stokSelect.value = 'Diğer';
      stokOther.style.display = 'block';
      stokOther.value = stokVal;
    }
  }

  // Korumalı Google Drive Linklerini saklı inputlara koy
  const formLink = item.linkForm;
  const imageLink = item.linkImage;

  // Bilgi Fişi (W sütunu) düzenlenebilir alandır: hücrenin ham değeri (bilgi kartı metni
  // ya da üretilmiş fişin bağlantısı) olduğu gibi gösterilir. Boş gösterilirse kaydederken
  // hücredeki metin silinirdi.
  const infoLink = item.linkInfo;

  const webLink = item.linkWeb;

  document.getElementById('edit-link-form').value = formLink || '';
  document.getElementById('edit-link-image').value = imageLink || '';
  document.getElementById('edit-link-info').value = infoLink || '';
  document.getElementById('edit-link-web').value = webLink || '';
  bilgiFisiButonunuGuncelle();

  // Link Açma Butonları durumunu kur
  toggleDriveButtonState('btn-open-drive-form', formLink);
  toggleDriveButtonState('btn-open-drive-image', imageLink);
  toggleDriveButtonState('btn-send-inventory-mail', 'http://always-active');
  toggleDriveButtonState('btn-open-drive-web', webLink);

  // Ürün görselleri galerisi (Drive klasörü): önizleme, fiş görseli seçimi, yükleme/silme.
  envanterGaleriAc(item);

  // Edit durum (Arşiv durumu) alanı için seçenekleri kontrol et ve yükle
  const editDurumSelect = document.getElementById('edit-durum');
  if (editDurumSelect) {
    const durumActualKey = getActualKey(item, 'Arşive Eklendi / Fiş Tamam');
    const durumOriginalObj = item._original || item;
    const durumVal = (durumOriginalObj[durumActualKey] !== undefined && durumOriginalObj[durumActualKey] !== null) ? String(durumOriginalObj[durumActualKey]).trim() : '';

    // Mevcut seçenekleri kontrol edelim
    let optionExists = false;
    for (let i = 0; i < editDurumSelect.options.length; i++) {
      if (editDurumSelect.options[i].value === durumVal) {
        optionExists = true;
        break;
      }
    }

    // Eğer mevcut seçeneklerde yoksa ve boş değilse, yeni seçenek olarak ekleyelim
    if (!optionExists && durumVal !== '') {
      const newOpt = document.createElement('option');
      newOpt.value = durumVal;
      newOpt.textContent = durumVal;
      editDurumSelect.appendChild(newOpt);
    }

    editDurumSelect.value = durumVal || 'Grafik Birimi Görsel Bekleniyor...';
    updateEditStatusStyle();
  }

  // Gelişmiş etiketleri (motif, renk, dönem, materyal) e-tablodan yükle
  try {
    tumEtiketSecicileriKur();
    esereEtiketleriYukle(item);
  } catch (err) {
    console.error('Etiketler yüklenemedi:', err);
  }

  // Modalı Aç
  document.getElementById('dialog-edit-inventory').showModal();
}

// Grafik birimi görselini ürünün Drive klasörüne parçalı yükler (materyal yüklemesiyle
// aynı yol). Sunucu linki "Ürün Görseli - 1"e yazar ve iş akışını çalıştırır: durum
// Ar-Ge onayına geçer, kayıt zaten onaylıysa bilgi fişi yeni görselle yeniden üretilir.
let _envanterGorselYuklemeSuruyor = false;

// Fotoğraf makinesi dosyaları (15-25 MB) Apps Script üzerinden 3 MB'lık parçalarla
// gider; her parça ayrı bir sunucu çağrısıdır ve hem yavaş hem de geçici hatalara
// açıktır. Bilgi fişi 227 px, web görseli ~1200 px kullandığı için uzun kenar
// 3000 px'e indirilir: çoğu görsel tek parçaya sığar. Küçük dosyalara dokunulmaz.
const ENVANTER_GORSEL_UZUN_KENAR = 3000;
const ENVANTER_GORSEL_KUCULTME_ESIGI = 2 * 1024 * 1024;

async function envanterGorselKucult(dosya) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(dosya); // EXIF yönü Chromium'da uygulanır
  } catch (err) {
    return dosya; // çözülemeyen görsel olduğu gibi gönderilir, sunucu türü denetler
  }
  const oran = Math.min(1, ENVANTER_GORSEL_UZUN_KENAR / Math.max(bitmap.width, bitmap.height));
  if (oran === 1 && dosya.size <= ENVANTER_GORSEL_KUCULTME_ESIGI) {
    bitmap.close();
    return dosya;
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * oran);
  canvas.height = Math.round(bitmap.height * oran);
  const ctx = canvas.getContext('2d');
  const blobAl = (tur, kalite) => new Promise((coz) => canvas.toBlob(coz, tur, kalite));

  let sonuc = null;
  if (dosya.type === 'image/png') {
    // Şeffaf PNG (dekupe ürün) önce PNG olarak denenir; hâlâ büyükse beyaz zeminli JPEG'e döner.
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    sonuc = await blobAl('image/png');
    if (sonuc && sonuc.size > 3 * 1024 * 1024) sonuc = null;
  }
  if (!sonuc) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    sonuc = await blobAl('image/jpeg', 0.9);
  }
  bitmap.close();
  return (sonuc && sonuc.size < dosya.size) ? sonuc : dosya;
}

// Apps Script geçici olarak 404/5xx döndürebiliyor. Google'ın yönlendirmesi arada bir POST'u
// GET'e çevirir; o zaman sunucunun GET ucu "POST isteği ile yapılmalıdır" yanıtını verir ve
// istek hiç işlenmemiştir. Parça ucu sıra denetimi yaptığı için yeniden deneme güvenlidir:
// önceki deneme sunucuda işlenmişse "beklenen" konum döner.
async function envanterApiTekrarli(eylem, veri, deneme = 3) {
  let yanit;
  for (let i = 0; i < deneme; i++) {
    yanit = await apiPost(eylem, veri);
    if (yanit && (yanit.success || yanit.beklenen !== undefined)) return yanit;
    if (!/Status (404|429|5\d\d)|Bağlantı|Failed to fetch|POST isteği ile/i.test((yanit && yanit.error) || '')) return yanit;
    await new Promise((coz) => setTimeout(coz, 800 * (i + 1)));
  }
  return yanit;
}

// --------------------------------------------------------------------------
// Ürün görselleri galerisi: Drive klasöründeki görseller küçük önizleme olarak
// listelenir; ★ ile bilgi fişi görseli seçilir, 🗑 ile görsel çöp kutusuna taşınır.
// --------------------------------------------------------------------------
let _envanterGaleri = { envanterNo: '', gorseller: [], fisGorselId: '', istek: 0 };
// Kayıt başına son bilinen galeri: pencere yeniden açıldığında sunucu beklenmeden gösterilir.
const _envanterGaleriOnbellek = new Map();

// Tablodaki "Ürün Görseli - 1" hücresinden anında gösterilecek ön liste. Sunucu kuralıyla
// aynı: birden çok link varsa ikincisi bilgi fişi görselidir.
function envanterGaleriHucredenListe(hucre) {
  const idler = [...new Set(String(hucre || '').split(',').map((l) => driveDosyaId(l.trim())).filter(Boolean))];
  return {
    gorseller: idler.map((id, i) => ({ id, ad: 'Görsel ' + (i + 1) })),
    fisGorselId: idler.length > 1 ? idler[1] : (idler[0] || '')
  };
}

function envanterGaleriYazabilir() {
  return !!(STATE.currentUser && (STATE.currentUser.role === 'admin' || STATE.currentUser.role === 'editor'));
}

function envanterGaleriIlerleme(metin) {
  const el = document.getElementById('envanter-gorsel-ilerleme');
  if (!el) return;
  el.textContent = metin || '';
  el.classList.toggle('hidden', !metin);
}

// Sunucu yanıtındaki güncel hücre/durum/fiş bilgisi açık penceredeki gizli alanlara yazılır;
// yoksa sonradan "Kaydet"e basıldığında eski görsel linki, eski durum ve eski fiş linki geri yazılır.
function envanterFormAlanlariniGuncelle(yanit) {
  if (yanit.gorselLinki !== undefined) {
    document.getElementById('edit-link-image').value = yanit.gorselLinki || '';
    toggleDriveButtonState('btn-open-drive-image', yanit.gorselLinki);
  }
  const durumSelect = document.getElementById('edit-durum');
  if (durumSelect && yanit.durum) {
    if (![...durumSelect.options].some((o) => o.value === yanit.durum)) {
      durumSelect.appendChild(new Option(yanit.durum, yanit.durum));
    }
    durumSelect.value = yanit.durum;
    updateEditStatusStyle();
  }
  if (/Arşive Eklendi/.test(yanit.durum || '') && /^http/.test(yanit.bilgiFisi || '')) {
    document.getElementById('edit-link-info').value = yanit.bilgiFisi;
    bilgiFisiButonunuGuncelle();
  }
}

// "Fişi Aç" yalnızca Bilgi Fişi alanında bir bağlantı varken etkin olur.
function bilgiFisiButonunuGuncelle() {
  const deger = document.getElementById('edit-link-info').value.trim();
  toggleDriveButtonState('btn-open-bilgi-fisi', /^https?:\/\/\S+$/.test(deger) ? deger : '');
}

function envanterGaleriCiz(bekleyenler = []) {
  const kutu = document.getElementById('envanter-galeri');
  if (!kutu) return;
  const g = _envanterGaleri;
  const yazabilir = envanterGaleriYazabilir() && g.dogrulandi;

  const kayitli = g.gorseller.map((gorsel) => {
    const fis = gorsel.id === g.fisGorselId;
    const link = 'https://drive.google.com/open?id=' + gorsel.id;
    const araclar = yazabilir ? `
      <div class="galeri-araclar">
        ${fis ? '' : `<button type="button" class="galeri-arac" data-galeri-fis="${escapeHtml(gorsel.id)}" title="Bilgi fişi görseli yap" aria-label="Bilgi fişi görseli yap">★</button>`}
        <button type="button" class="galeri-arac sil" data-galeri-sil="${escapeHtml(gorsel.id)}" title="Görseli sil" aria-label="Görseli sil">🗑</button>
      </div>` : '';
    return `
      <div class="galeri-kutu ${fis ? 'fis' : ''}">
        <img src="${escapeHtml(getDriveThumbnailUrl(link).replace(/=w160$/, '=w320'))}" loading="lazy" decoding="async"
          referrerpolicy="no-referrer" alt="${escapeHtml(gorsel.ad)}" title="${escapeHtml(gorsel.ad)}"
          data-external-url="${escapeHtml(link)}" data-fallback="favicon">
        ${fis ? '<span class="galeri-rozet">★ Fiş görseli</span>' : ''}
        ${araclar}
      </div>`;
  });

  // Yüklenmekte olan görseller, sunucu yanıtını beklemeden yerel önizlemeyle gösterilir.
  const yukleniyor = bekleyenler.map((b) => `
    <div class="galeri-kutu bekliyor ${b.hata ? 'hata' : ''}" data-bekleyen="${b.anahtar}">
      <img src="${b.onizleme}" alt="${escapeHtml(b.ad)}" title="${escapeHtml(b.ad)}">
      <span class="galeri-ilerleme">${escapeHtml(b.durum)}</span>
    </div>`);

  if (!kayitli.length && !yukleniyor.length) {
    kutu.innerHTML = `<div class="galeri-bos">Bu ürün için henüz görsel yok.${yazabilir ? ' "Görsel Yükle" ile ekleyebilirsiniz.' : ''}</div>`;
    return;
  }
  kutu.innerHTML = kayitli.concat(yukleniyor).join('');
}

async function envanterGaleriAc(item) {
  const istek = ++_envanterGaleri.istek;
  _envanterGaleri.envanterNo = String(item.envanterNo || '').trim();
  const onceki = _envanterGaleri.envanterNo && _envanterGaleriOnbellek.get(_envanterGaleri.envanterNo);
  const onListe = onceki || envanterGaleriHucredenListe(item.linkImage);
  _envanterGaleri.gorseller = onListe.gorseller.slice();
  _envanterGaleri.fisGorselId = onListe.fisGorselId;
  // Ön liste sunucuda doğrulanana kadar ★/🗑 gösterilmez (hücredeki link klasörde olmayabilir).
  _envanterGaleri.dogrulandi = false;
  document.getElementById('btn-envanter-gorsel-yukle').classList.toggle('hidden', !envanterGaleriYazabilir());
  envanterGaleriIlerleme('');

  const kutu = document.getElementById('envanter-galeri');
  if (!_envanterGaleri.envanterNo) {
    kutu.innerHTML = '<div class="galeri-bos">Envanter numarası olmayan kayıtta görsel yönetilemez.</div>';
    return;
  }
  // Bilinen görseller hemen çizilir; Drive klasörünün tam listesi arka planda gelir.
  if (_envanterGaleri.gorseller.length) envanterGaleriCiz();
  else kutu.innerHTML = '<div class="galeri-iskelet">Görseller yükleniyor...</div>';
  envanterGaleriIlerleme(onceki ? '' : 'Drive klasörü denetleniyor...');

  const yanit = await envanterApiTekrarli('envanter_gorseller', { envanterNo: _envanterGaleri.envanterNo });
  if (istek !== _envanterGaleri.istek) return; // bu arada başka bir kayıt açıldı
  envanterGaleriIlerleme('');
  if (!yanit || !yanit.success) {
    const mesaj = escapeHtml((yanit && yanit.error) || 'bağlantı hatası');
    if (_envanterGaleri.gorseller.length) envanterGaleriIlerleme('Tam liste alınamadı: ' + (yanit && yanit.error || 'bağlantı hatası'));
    else kutu.innerHTML = `<div class="galeri-bos">Görseller alınamadı: ${mesaj}</div>`;
    return;
  }
  // Açılış listesi formu güncellemez: kullanıcı bu arada durumu değiştirmiş olabilir.
  envanterGaleriYanitiUygula(yanit, false);
  envanterGaleriCiz();
}

function envanterGaleriYanitiUygula(yanit, formuGuncelle = true) {
  if (Array.isArray(yanit.gorseller)) {
    _envanterGaleri.gorseller = yanit.gorseller;
    _envanterGaleri.dogrulandi = true;
  }
  if (yanit.fisGorselId !== undefined) _envanterGaleri.fisGorselId = yanit.fisGorselId || '';
  if (Array.isArray(yanit.gorseller) && _envanterGaleri.envanterNo) {
    _envanterGaleriOnbellek.set(_envanterGaleri.envanterNo, {
      gorseller: _envanterGaleri.gorseller.slice(), fisGorselId: _envanterGaleri.fisGorselId
    });
  }
  if (formuGuncelle) envanterFormAlanlariniGuncelle(yanit);
}

async function envanterGaleriFisYap(dosyaId, btn) {
  if (btn) btn.disabled = true;
  envanterGaleriIlerleme('Bilgi fişi görseli güncelleniyor...');
  const yanit = await apiPost('envanter_gorsel_birincil', { envanterNo: _envanterGaleri.envanterNo, dosyaId });
  if (!yanit || !yanit.success) {
    envanterGaleriIlerleme('');
    showToast('Fiş görseli değiştirilemedi: ' + ((yanit && yanit.error) || 'bağlantı hatası'), 'danger');
    if (btn) btn.disabled = false;
    return;
  }
  envanterGaleriYanitiUygula(yanit);
  envanterGaleriCiz();
  envanterGaleriIlerleme('');
  showToast(yanit.uyari || 'Bilgi fişi görseli güncellendi.', yanit.uyari ? 'warning' : 'success');
  syncAllData(true);
}

async function envanterGaleriSil(dosyaId, btn) {
  const gorsel = _envanterGaleri.gorseller.find((g) => g.id === dosyaId);
  const fis = dosyaId === _envanterGaleri.fisGorselId;
  const mesaj = `"${gorsel ? gorsel.ad : 'Görsel'}" silinsin mi?\n\nDosya Drive çöp kutusuna taşınır (30 gün içinde geri alınabilir).` +
    (fis ? '\n\nBu görsel bilgi fişinde kullanılıyor; yerine kalan görsellerden ilki geçecek.' : '');
  if (!confirm(mesaj)) return;
  if (btn) btn.disabled = true;
  envanterGaleriIlerleme('Görsel siliniyor...');
  const yanit = await apiPost('envanter_gorsel_sil', { envanterNo: _envanterGaleri.envanterNo, dosyaId });
  if (!yanit || !yanit.success) {
    envanterGaleriIlerleme('');
    showToast('Görsel silinemedi: ' + ((yanit && yanit.error) || 'bağlantı hatası'), 'danger');
    if (btn) btn.disabled = false;
    return;
  }
  envanterGaleriYanitiUygula(yanit);
  envanterGaleriCiz();
  envanterGaleriIlerleme('');
  showToast(yanit.uyari || 'Görsel silindi.', yanit.uyari ? 'warning' : 'success');
  syncAllData(true);
}

// --------------------------------------------------------------------------
// GRAFİK BİRİMİ FOTOĞRAFI BEKLEYENLER
// Görseli yalnızca ustanın formdan yüklediği fotoğraf olan eserler. Sunucudaki
// "Grafik Birimi Fotoğrafı" sütunu: EVET / HAYIR / boş. Boşsa "Ürün Görseli - 1"
// hücresinde birden çok link olması yeterlidir: Görsel Yükle, grafik görselini
// ustanın linkinden SONRA ekler.
// --------------------------------------------------------------------------
const ENV_GRAFIK_FOTO = 'Grafik Birimi Fotoğrafı';
const _envanterFotoSecili = new Set();
let _envanterFotoListelenen = [];

function envanterGrafikFotoVar(item) {
  const deger = String((item && item._original && item._original[ENV_GRAFIK_FOTO]) || '').trim().toUpperCase();
  if (deger === 'EVET') return true;
  if (deger === 'HAYIR') return false;
  return String(item.linkImage || '').split(',').filter((l) => driveDosyaId(l.trim())).length > 1;
}

// Onaylanmış ama amatör fotoğraflı eserler en üstte: en acil olanlar onlar.
function envanterFotoDurumu(item) {
  const durum = String(item.durum || '').trim().replace(/\.+$/, '');
  const d = durum.toLocaleLowerCase('tr');
  if (d.includes('onaylandı') || d.includes('fiş tamam')) return { sira: 0, metin: '✓ Onaylandı', sinif: 'badge-danger', durum };
  if (d.includes('ar-ge')) return { sira: 1, metin: 'AR-GE onayı bekliyor', sinif: 'badge-warning', durum };
  if (d.includes('revize')) return { sira: 2, metin: 'Revize gerekli', sinif: 'badge-warning', durum };
  if (d.includes('grafik')) return { sira: 3, metin: 'Grafik birimi bekleniyor', sinif: 'badge-role', durum };
  return { sira: 4, metin: durum || 'Durum yok', sinif: 'badge-role', durum: durum || 'Durum yok' };
}

function envanterFotoBekleyenler() {
  return (STATE.inventory || []).filter((i) => String(i.envanterNo || '').trim() && !envanterGrafikFotoVar(i));
}

function renderEnvanterFoto() {
  const bekleyen = envanterFotoBekleyenler();
  const sekme = document.getElementById('envanter-foto-sayi');
  if (sekme) sekme.textContent = bekleyen.length;
  const izgara = document.getElementById('envanter-foto-izgara');
  const gorunum = document.getElementById('envanter-foto-subview');
  if (!izgara || !gorunum || gorunum.classList.contains('hidden')) return;

  const bekleyenNolar = new Set(bekleyen.map((i) => String(i.envanterNo).trim()));
  [..._envanterFotoSecili].forEach((no) => { if (!bekleyenNolar.has(no)) _envanterFotoSecili.delete(no); });

  const atolyeSelect = document.getElementById('envanter-foto-atolye');
  const durumSelect = document.getElementById('envanter-foto-durum');
  const atolyeler = muzeAtolyeListesi().filter((a) => bekleyen.some((i) => muzeAtolyeAnahtari(i.atolye) === a.anahtar));
  const seciliAtolye = atolyeSelect.value;
  atolyeSelect.innerHTML = '<option value="all">Tüm Atölyeler</option>' + atolyeler.map((a) => {
    const n = bekleyen.filter((i) => muzeAtolyeAnahtari(i.atolye) === a.anahtar).length;
    return `<option value="${escapeHtml(a.anahtar)}">${escapeHtml(a.ad)} (${n})</option>`;
  }).join('');
  if (atolyeler.some((a) => a.anahtar === seciliAtolye)) atolyeSelect.value = seciliAtolye;
  const durumlar = new Map();
  bekleyen.forEach((i) => {
    const d = envanterFotoDurumu(i);
    const x = durumlar.get(d.metin) || { sira: d.sira, n: 0 };
    x.n++;
    durumlar.set(d.metin, x);
  });
  const seciliDurum = durumSelect.value;
  durumSelect.innerHTML = '<option value="all">Tümü</option>' + [...durumlar.entries()]
    .sort((a, b) => a[1].sira - b[1].sira)
    .map(([m, x]) => `<option value="${escapeHtml(m)}">${escapeHtml(m)} (${x.n})</option>`).join('');
  if (durumlar.has(seciliDurum)) durumSelect.value = seciliDurum;

  const arama = (document.getElementById('envanter-foto-arama')?.value || '').toLocaleLowerCase('tr').trim();
  const suzulmus = bekleyen
    .filter((i) => atolyeSelect.value === 'all' || muzeAtolyeAnahtari(i.atolye) === atolyeSelect.value)
    .filter((i) => durumSelect.value === 'all' || envanterFotoDurumu(i).metin === durumSelect.value)
    .filter((i) => !arama || [i.envanterNo, i.eserAdi, i.atolye].some((v) => String(v || '').toLocaleLowerCase('tr').includes(arama)))
    .sort((a, b) => envanterFotoDurumu(a).sira - envanterFotoDurumu(b).sira ||
      String(a.envanterNo).localeCompare(String(b.envanterNo), 'tr'));

  _envanterFotoListelenen = suzulmus.map((i) => String(i.envanterNo).trim());
  const sayac = document.getElementById('envanter-foto-sayac');
  sayac.textContent = suzulmus.length === bekleyen.length
    ? bekleyen.length + ' eser grafik birimi fotoğrafı bekliyor'
    : suzulmus.length + ' / ' + bekleyen.length + ' eser listeleniyor';
  document.getElementById('envanter-foto-bos')?.classList.toggle('hidden', suzulmus.length > 0);

  const yazabilir = muzeYazabilir();
  izgara.innerHTML = suzulmus.map((i) => {
    const no = String(i.envanterNo).trim();
    const d = envanterFotoDurumu(i);
    const secili = _envanterFotoSecili.has(no);
    return `
      <div class="muze-kart card${secili ? ' secili' : ''}">
        ${yazabilir ? `<label class="muze-kart-sec" title="Toplu işlem için seç">
          <input type="checkbox" data-foto-sec="${escapeHtml(no)}"${secili ? ' checked' : ''}>
        </label>` : ''}
        ${muzeKartGorseli(i)}
        <div class="muze-kart-govde">
          <div class="muze-kart-ust">
            <strong>${escapeHtml(i.eserAdi || 'İsimsiz eser')}</strong>
            <span class="badge ${d.sinif}" title="${escapeHtml(d.durum)}">${escapeHtml(d.metin)}</span>
          </div>
          <span class="muze-kart-meta"><code>${escapeHtml(no)}</code>${i.atolye ? ' · 🏛️ ' + escapeHtml(String(i.atolye)) : ''}</span>
        </div>
        ${yazabilir ? `<div class="muze-kart-islem envanter-foto-islem">
          <button class="btn btn-primary btn-sm" data-foto-yukle="${escapeHtml(String(i._rowNum))}">📷 Görsel Yükle</button>
          <button class="btn btn-outline-primary btn-sm" data-foto-profesyonel="${escapeHtml(no)}" title="Tek görseli zaten grafik biriminin çektiği profesyonel bir fotoğraf">✓ Profesyonel</button>
        </div>` : ''}
      </div>`;
  }).join('');
  envanterFotoCubugunuGuncelle();
}

function envanterFotoCubugunuGuncelle() {
  const n = _envanterFotoSecili.size;
  const sayac = document.getElementById('envanter-foto-secim-sayac');
  if (sayac) sayac.textContent = n ? n + ' eser seçili' : 'Seçim yok';
  const btn = document.getElementById('btn-envanter-foto-isaretle');
  if (btn) btn.disabled = n === 0;
  const hepsi = document.getElementById('envanter-foto-hepsi');
  if (hepsi) {
    const secilen = _envanterFotoListelenen.filter((no) => _envanterFotoSecili.has(no)).length;
    hepsi.checked = _envanterFotoListelenen.length > 0 && secilen === _envanterFotoListelenen.length;
    hepsi.indeterminate = secilen > 0 && secilen < _envanterFotoListelenen.length;
  }
  document.getElementById('envanter-foto-cubuk')?.classList.toggle('hidden', !muzeYazabilir());
}

// İşareti sunucuya yazar ve yerel kaydı hemen günceller (tam eşitleme beklenmez).
async function envanterGrafikFotoIsaretle(nolar, deger) {
  if (!muzeYazabilir() || !nolar.length) return false;
  toggleLoading(true, 'Grafik birimi fotoğrafı işaretleniyor...');
  const res = await apiPost('envanter_grafik_foto', { envanterNolar: nolar, deger });
  toggleLoading(false);
  if (!res || !res.success) {
    showToast('İşaretlenemedi: ' + muzeSunucuHatasi(res), 'danger');
    return false;
  }
  const guncellenen = new Set((res.guncellenen || []).map((n) => String(n).trim().toLowerCase()));
  (STATE.inventory || []).forEach((i) => {
    if (guncellenen.has(String(i.envanterNo || '').trim().toLowerCase()) && i._original) i._original[ENV_GRAFIK_FOTO] = res.deger;
  });
  guncellenen.forEach((no) => [..._envanterFotoSecili].forEach((s) => { if (s.toLowerCase() === no) _envanterFotoSecili.delete(s); }));
  showToast(deger
    ? guncellenen.size + ' eser grafik birimi fotoğrafı var olarak işaretlendi.'
    : 'Eser fotoğraf bekleyenler listesine alındı.', 'success');
  renderEnvanterFoto();
  return true;
}

async function envanterGorselYukle(dosyalar) {
  const item = STATE.selectedInventoryItem;
  dosyalar = Array.from(dosyalar || []);
  if (!item || !dosyalar.length || _envanterGorselYuklemeSuruyor) return;
  if (dosyalar.some((d) => ['image/jpeg', 'image/png'].indexOf(d.type) === -1)) {
    showToast('Yalnızca JPEG veya PNG görsel yüklenebilir.', 'warning');
    return;
  }
  if (dosyalar.length > 20) {
    showToast('Tek seferde en fazla 20 görsel yüklenebilir.', 'warning');
    return;
  }

  const btn = document.getElementById('btn-envanter-gorsel-yukle');
  _envanterGorselYuklemeSuruyor = true;
  btn.disabled = true;
  btn.textContent = 'Yükleniyor...';

  // Seçilen dosyalar hemen yerel önizlemeyle galeriye düşer; ilerleme her kutunun üzerinde görünür.
  const bekleyenler = dosyalar.map((d, i) => ({
    anahtar: 'b' + i, ad: d.name, onizleme: URL.createObjectURL(d), durum: 'Hazırlanıyor...', hata: false
  }));
  const durumYaz = (i, metin, hata) => {
    bekleyenler[i].durum = metin;
    if (hata) bekleyenler[i].hata = true;
    const el = document.querySelector(`[data-bekleyen="${bekleyenler[i].anahtar}"] .galeri-ilerleme`);
    if (el) el.textContent = metin; else envanterGaleriCiz(bekleyenler);
    if (hata) envanterGaleriCiz(bekleyenler);
  };
  envanterGaleriCiz(bekleyenler);

  // Görseller sırayla yüklenir, sonra tek bir "bitir" çağrısıyla kayda işlenir. Yarıda hata olursa o ana kadar
  // yüklenenler yine kayda işlenir; Drive'a çıkmış dosya kayıtsız kalmaz.
  const oturumIdler = [];
  let hata = null;
  try {
    // Önce tüm görseller küçültülür, sonra oturumlar TEK sunucu çağrısıyla açılır:
    // kimlik doğrulama ve Drive klasör araması her görsel için tekrarlanmaz.
    const hazir = [];
    for (let i = 0; i < dosyalar.length; i++) hazir.push(await envanterGorselKucult(dosyalar[i]));
    bekleyenler.forEach((b, i) => durumYaz(i, 'Sırada'));
    envanterGaleriIlerleme('Drive yükleme oturumu açılıyor...');
    const baslat = await envanterApiTekrarli('envanter_gorsel_baslat', {
      envanterNo: item.envanterNo,
      dosyalar: hazir.map((d) => ({ mimeType: d.type, toplamBayt: d.size }))
    });
    if (!baslat || !baslat.success) throw new Error((baslat && baslat.error) || 'Oturum açılamadı.');
    const oturumlar = baslat.oturumIdler || [baslat.oturumId];
    const parcaBayt = Number(baslat.parcaBayt) || (3 * 1024 * 1024);

    for (let i = 0; i < hazir.length; i++) {
      const dosya = hazir[i];
      envanterGaleriIlerleme(hazir.length > 1 ? `Yükleniyor: ${i + 1} / ${hazir.length}` : 'Yükleniyor...');
      try {
        let gonderilen = 0;
        let tamamlandi = false;
        durumYaz(i, '%0');
        while (gonderilen < dosya.size) {
          const bitis = Math.min(gonderilen + parcaBayt, dosya.size);
          const base64 = await blobBase64Oku(dosya.slice(gonderilen, bitis));
          const yanit = await envanterApiTekrarli('materyal_parca', {
            oturumId: oturumlar[i], baslangic: gonderilen, veri: base64
          });
          // Önceki deneme sunucuda işlenip yanıtı kaybolduysa sunucunun beklediği yerden devam edilir.
          if (yanit && !yanit.success && yanit.beklenen !== undefined && Number(yanit.beklenen) > gonderilen) {
            gonderilen = Number(yanit.beklenen);
            tamamlandi = gonderilen >= dosya.size;
            continue;
          }
          if (!yanit || !yanit.success) throw new Error((yanit && yanit.error) || 'Parça gönderilemedi.');
          gonderilen = Number(yanit.yazilan) || bitis;
          tamamlandi = !!yanit.tamamlandi;
          durumYaz(i, '%' + Math.round((gonderilen / dosya.size) * 100));
        }
        if (!tamamlandi) throw new Error('Yükleme tamamlanamadı, tekrar deneyin.');
        durumYaz(i, '✓ Yüklendi');
        oturumIdler.push(oturumlar[i]);
      } catch (err) {
        durumYaz(i, '✗ Hata', true);
        hata = new Error(dosyalar[i].name + ': ' + err.message);
        break;
      }
    }
    if (!oturumIdler.length) throw hata || new Error('Görsel yüklenemedi.');

    envanterGaleriIlerleme('Kayıt güncelleniyor...');
    const bitir = await envanterApiTekrarli('envanter_gorsel_bitir', { oturumIdler: oturumIdler });
    if (!bitir || !bitir.success) throw new Error((bitir && bitir.error) || 'Kayıt güncellenemedi.');

    envanterGaleriYanitiUygula(bitir);
    if (item._original) item._original[ENV_GRAFIK_FOTO] = 'EVET';
    const grafikKutu = document.getElementById('edit-grafik-foto');
    if (grafikKutu) grafikKutu.checked = true;
    renderEnvanterFoto();
    // Sunucu listesi dönmediyse (eski sunucu) galeri yeniden çekilir.
    if (!Array.isArray(bitir.gorseller)) await envanterGaleriAc(item);
    else envanterGaleriCiz(bekleyenler.filter((b) => b.hata));

    const adet = oturumIdler.length;
    envanterGaleriIlerleme(hata ? 'Kalan görseller yüklenemedi: ' + hata.message : '');
    if (hata) showToast(adet + ' görsel kaydedildi, sonrakiler yüklenemedi: ' + hata.message, 'warning');
    else if (bitir.uyari) showToast(bitir.uyari, 'warning');
    else showToast(adet + ' görsel yüklendi. Durum: ' + (bitir.durum || '-'), 'success');
    syncAllData(true);
  } catch (err) {
    envanterGaleriIlerleme('✗ ' + err.message);
    bekleyenler.forEach((b, i) => { if (!b.hata && b.durum !== '✓ Yüklendi') durumYaz(i, '✗ Hata', true); });
    showToast('Görsel yüklenemedi: ' + err.message, 'danger');
  } finally {
    _envanterGorselYuklemeSuruyor = false;
    btn.disabled = false;
    btn.textContent = 'Görsel Yükle ⬆️';
    // Önizleme adresleri galeri yeniden çizildikten sonra bırakılır.
    setTimeout(() => bekleyenler.forEach((b) => URL.revokeObjectURL(b.onizleme)), 60000);
  }
}

function toggleDriveButtonState(btnId, url) {
  const btn = document.getElementById(btnId);
  if (url && url.indexOf('http') === 0) {
    btn.removeAttribute('disabled');
    btn.className = 'btn btn-outline-primary btn-sm';
  } else {
    btn.setAttribute('disabled', 'true');
    btn.className = 'btn btn-secondary btn-sm';
  }
}

function showEmailPrompt(defaultEmail = '', title = 'E-Posta Gönder') {
  return new Promise((resolve) => {
    const dialog = document.getElementById('dialog-prompt-email');
    const input = document.getElementById('prompt-email-input');
    const headerTitle = dialog.querySelector('.dialog-header h2');
    if (headerTitle) headerTitle.textContent = title;

    input.value = defaultEmail;

    const cleanup = () => {
      document.getElementById('btn-confirm-prompt-email').removeEventListener('click', onConfirm);
      document.getElementById('btn-close-prompt-email').removeEventListener('click', onCancel);
      document.getElementById('btn-close-prompt-email-cross').removeEventListener('click', onCancel);
      dialog.removeEventListener('cancel', onCancel);
    };

    const onConfirm = () => {
      const val = input.value.trim();
      cleanup();
      dialog.close();
      resolve(val);
    };

    const onCancel = () => {
      cleanup();
      dialog.close();
      resolve(null);
    };

    document.getElementById('btn-confirm-prompt-email').addEventListener('click', onConfirm);
    document.getElementById('btn-close-prompt-email').addEventListener('click', onCancel);
    document.getElementById('btn-close-prompt-email-cross').addEventListener('click', onCancel);
    dialog.addEventListener('cancel', onCancel);

    dialog.showModal();
    setTimeout(() => {
      input.focus();
      input.select();
    }, 50);
  });
}

// Envanter Düzenleme Kaydet
async function saveInventoryEdit() {
  if (STATE.currentUser.role === 'okuyucu') {
    showToast('Okuyucu rolü veri kaydedemez!', 'warning');
    return;
  }

  const form = document.getElementById('edit-inventory-form');
  const rowNum = document.getElementById('edit-row-num').value;
  const item = STATE.inventory.find(i => String(i._rowNum) === String(rowNum));
  if (!item) return;

  const envNoKey = getActualKey(item, 'Envanter No');
  const payload = {
    _rowNum: rowNum
  };
  payload[envNoKey] = document.getElementById('edit-envanter-no-display').textContent;

  // Form verilerini payload içine al
  const formData = new FormData(form);
  for (let [key, value] of formData.entries()) {
    if (key !== '_rowNum' && key !== 'Stok Durumu') {
      const actualKey = getActualKey(item, key);
      payload[actualKey] = value;
    }
  }

  // Stok Durumu alanını özel ekle
  const stokSelect = document.getElementById('edit-stok-select');
  const stokOther = document.getElementById('edit-stok-other');
  const stokActualKey = getActualKey(item, 'Stok Durumu');
  if (stokSelect && stokOther) {
    if (stokSelect.value === 'Diğer') {
      payload[stokActualKey] = stokOther.value;
    } else {
      payload[stokActualKey] = stokSelect.value;
    }
  }

  toggleLoading(true, 'Değişiklikler Google E-Tabloya kaydediliyor...');
  const res = await apiPost('update_inventory', payload);
  toggleLoading(false);

  if (res && res.success) {
    showToast('Envanter başarıyla güncellendi.', 'success');
    document.getElementById('dialog-edit-inventory').close();
    // Tekrar eşitle
    syncAllData();
  } else {
    showToast('Hata: ' + (res ? res.error : 'İstek başarısız oldu.'), 'danger');
  }
}

// --- Literatür Kayıt Formu Kontrolleri ---
function openAddLiteratureModal() {
  document.getElementById('literature-form').reset();
  // Bugünü kur
  document.getElementById('lit-tarih').value = new Date().toISOString().split('T')[0];
  document.getElementById('dialog-literature').showModal();
}

async function saveLiterature() {
  const konu = document.getElementById('lit-konu').value.trim();
  const yer = document.getElementById('lit-yer').value.trim();
  const tarih = document.getElementById('lit-tarih').value;
  const aciklama = document.getElementById('lit-aciklama').value.trim();
  const gorseller = document.getElementById('lit-gorseller').value.trim();

  if (!konu || !tarih) {
    showToast('Lütfen Konu ve Tarih alanlarını doldurun.', 'warning');
    return;
  }

  const payload = {
    konu,
    ziyaret_yeri: yer,
    tarih,
    aciklama,
    gorseller
  };

  toggleLoading(true, 'Araştırma kaydı ekleniyor...');
  const res = await apiPost('add_literature', payload);
  toggleLoading(false);

  if (res && res.success) {
    showToast('Kayıt başarıyla eklendi.', 'success');
    document.getElementById('dialog-literature').close();
    syncAllData();
  } else {
    showToast('Hata: ' + (res ? res.error : 'Kayıt eklenemedi.'), 'danger');
  }
}

// =====================================================================
// EĞİTİM YÖNETİMİ (KVKK uyumlu — sivil vatandaş eğitim kayıtları)
// =====================================================================

// Sunucudan gelen (Türkçe başlıklı) kaydı sade bir nesneye çevirir
function normalizeEgitim(item) {
  const g = (k) => (item[k] !== undefined && item[k] !== null) ? item[k] : '';
  return {
    _rowNum: item._rowNum,
    id: g('ID'),
    kayitTarihi: g('Kayıt Tarihi'),
    egitimAdi: g('Eğitim Adı / Konusu'),
    atolye: g('Atölye / Dal'),
    egitimVeren: g('Eğitim Veren (Usta Öğretici)'),
    katilimciAd: g('Katılımcı Ad Soyad'),
    katilimciTel: g('Katılımcı Telefon'),
    katilimciEposta: g('Katılımcı E-posta'),
    egitimTarihi: g('Eğitim Tarihi'),
    sure: g('Süre (Saat)'),
    yer: g('Eğitim Yeri'),
    durum: g('Durum'),
    sertifika: g('Sertifika'),
    kvkkOnay: g('KVKK Onayı'),
    notlar: g('Notlar'),
    kaydiGiren: g('Kaydı Giren')
  };
}

function egitimYazabilir() {
  const r = STATE.currentUser && STATE.currentUser.role;
  return r === 'admin' || r === 'editor';
}

function egitimTarihGoster(v) {
  if (!v) return '-';
  const s = String(v).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  return s;
}

function egitimDurumClass(d) {
  const x = String(d || '').toLocaleLowerCase('tr-TR');
  if (x.indexOf('tamam') > -1) return 'egitim-durum-tamamlandi';
  if (x.indexOf('devam') > -1) return 'egitim-durum-devam';
  if (x.indexOf('iptal') > -1) return 'egitim-durum-iptal';
  return 'egitim-durum-planlandi';
}

function egitimKvkkOnayli(v) {
  const x = String(v || '').toLocaleLowerCase('tr-TR');
  return x.indexOf('alınd') > -1 || x.indexOf('alind') > -1 || x === 'evet' || x === 'var';
}

function renderEgitim() {
  const tbody = document.getElementById('egitim-tbody');
  const noData = document.getElementById('egitim-no-data');
  if (!tbody) return;

  const kayitlar = (STATE.egitim || []).map(normalizeEgitim);

  // Filtre açılır kutularını doldur
  egitimFiltreleriDoldur(kayitlar);

  // Filtre değerleri
  const arama = (document.getElementById('egitim-search')?.value || '').trim().toLocaleLowerCase('tr-TR');
  const fAtolye = document.getElementById('filter-egitim-atolye')?.value || 'all';
  const fVeren = document.getElementById('filter-egitim-veren')?.value || 'all';
  const fDurum = document.getElementById('filter-egitim-durum')?.value || 'all';

  let liste = kayitlar.filter(e => {
    if (fAtolye !== 'all' && e.atolye !== fAtolye) return false;
    if (fVeren !== 'all' && e.egitimVeren !== fVeren) return false;
    if (fDurum !== 'all' && String(e.durum || 'Planlandı') !== fDurum) return false;
    if (arama) {
      const hay = [e.egitimAdi, e.katilimciAd, e.egitimVeren, e.atolye, e.yer, e.notlar]
        .join(' ').toLocaleLowerCase('tr-TR');
      if (hay.indexOf(arama) === -1) return false;
    }
    return true;
  });

  // En yeni üstte (kayıt tarihine / satıra göre)
  liste.sort((a, b) => (b._rowNum || 0) - (a._rowNum || 0));

  // İstatistikler (filtreden bağımsız, tüm kayıtlar)
  egitimIstatistikGuncelle(kayitlar);

  if (liste.length === 0) {
    tbody.innerHTML = '';
    noData?.classList.remove('hidden');
    return;
  }
  noData?.classList.add('hidden');

  const yazabilir = egitimYazabilir();
  tbody.innerHTML = liste.map(e => {
    const durumTxt = e.durum || 'Planlandı';
    const kvkk = egitimKvkkOnayli(e.kvkkOnay)
      ? '<span class="egitim-kvkk-yes" title="Açık rıza alınmış">✓ Onaylı</span>'
      : '<span class="egitim-kvkk-no" title="Açık rıza kaydı yok">⚠ Yok</span>';
    const sureTxt = e.sure ? `${escapeHtml(String(e.sure))} sa` : '-';
    const mailBtn = (e.katilimciEposta && String(e.katilimciEposta).trim())
      ? `<button class="egitim-icon-btn" data-egitim-mail="${e._rowNum}" title="Katılımcıya bilgilendirme e-postası gönder">📧</button>`
      : `<button class="egitim-icon-btn" disabled title="E-posta adresi yok" style="opacity:0.35;cursor:not-allowed;">📧</button>`;
    // Bu eğitime bağlı materyal sayısı — kurs adı üzerinden eşleştirilir.
    const matSayisi = egitimMateryalSayisi(e.egitimAdi);
    const matBtn = `<button class="egitim-icon-btn" data-egitim-materyal="${escapeHtml(String(e.egitimAdi || ''))}" title="${matSayisi ? matSayisi + ' materyal — açmak için tıklayın' : 'Bu eğitime henüz materyal yüklenmemiş'}">📚${matSayisi ? `<span class="egitim-mat-rozet">${matSayisi}</span>` : ''}</button>`;
    const islem = yazabilir ? `
      <div class="egitim-row-actions">
        ${matBtn}
        <button class="egitim-icon-btn" data-egitim-pdf="${e._rowNum}" title="KVKK Açık Rıza Formu (PDF)">📄</button>
        ${mailBtn}
        <button class="egitim-icon-btn" data-egitim-edit="${e._rowNum}" title="Düzenle">✏️</button>
        <button class="egitim-icon-btn danger" data-egitim-del="${e._rowNum}" data-egitim-id="${escapeHtml(String(e.id))}" title="Sil">🗑️</button>
      </div>`
      : `<div class="egitim-row-actions">${matBtn}<button class="egitim-icon-btn" data-egitim-pdf="${e._rowNum}" title="KVKK Açık Rıza Formu (PDF)">📄</button></div>`;
    return `
      <tr>
        <td data-label="Tarih">${escapeHtml(egitimTarihGoster(e.egitimTarihi))}</td>
        <td data-label="Eğitim"><strong>${escapeHtml(String(e.egitimAdi || '-'))}</strong></td>
        <td data-label="Atölye">${escapeHtml(String(e.atolye || '-'))}</td>
        <td data-label="Eğitmen">${escapeHtml(String(e.egitimVeren || '-'))}</td>
        <td data-label="Katılımcı">${escapeHtml(String(e.katilimciAd || '-'))}</td>
        <td data-label="Süre">${sureTxt}</td>
        <td data-label="Durum"><span class="egitim-durum-badge ${egitimDurumClass(durumTxt)}">${escapeHtml(durumTxt)}</span></td>
        <td data-label="KVKK">${kvkk}</td>
        <td data-label="İşlem" style="text-align:right;">${islem}</td>
      </tr>`;
  }).join('');
}

function egitimIstatistikGuncelle(kayitlar) {
  const toplam = kayitlar.length;
  const katilimcilar = new Set(kayitlar.map(e => String(e.katilimciAd || '').trim().toLocaleLowerCase('tr-TR')).filter(Boolean));
  const devam = kayitlar.filter(e => String(e.durum || '').toLocaleLowerCase('tr-TR').indexOf('devam') > -1).length;
  const tamam = kayitlar.filter(e => String(e.durum || '').toLocaleLowerCase('tr-TR').indexOf('tamam') > -1).length;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('egitim-stat-toplam', toplam);
  set('egitim-stat-katilimci', katilimcilar.size);
  set('egitim-stat-devam', devam);
  set('egitim-stat-tamam', tamam);
}

function egitimFiltreleriDoldur(kayitlar) {
  const atolyeler = [...new Set(kayitlar.map(e => e.atolye).filter(Boolean))].sort((a, b) => String(a).localeCompare(b, 'tr'));
  const verenler = [...new Set(kayitlar.map(e => e.egitimVeren).filter(Boolean))].sort((a, b) => String(a).localeCompare(b, 'tr'));

  const doldur = (id, degerler, ilk) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const mevcut = sel.value;
    sel.innerHTML = `<option value="all">${ilk}</option>` +
      degerler.map(d => `<option value="${escapeHtml(String(d))}">${escapeHtml(String(d))}</option>`).join('');
    if (mevcut && (mevcut === 'all' || degerler.includes(mevcut))) sel.value = mevcut;
  };
  doldur('filter-egitim-atolye', atolyeler, 'Tüm Atölyeler');
  doldur('filter-egitim-veren', verenler, 'Tüm Eğitmenler');

  // Modal datalist'leri: atölye = personel dalları + mevcut; eğitmen = personel adları + mevcut
  const personelDallari = (STATE.personnel || []).map(p => {
    const alan = p['Alan / Dal'] || p.alan || p.dal || '';
    return String(alan).trim();
  }).filter(Boolean);
  const personelAdlari = (STATE.personnel || []).map(p => {
    const ad = [p['Adı'] || p.ad || '', p['Soyadı'] || p.soyad || ''].join(' ').trim();
    return ad;
  }).filter(Boolean);

  const dlAtolye = document.getElementById('egitim-atolye-list');
  if (dlAtolye) {
    const hepsi = [...new Set([...atolyeler, ...personelDallari])].sort((a, b) => String(a).localeCompare(b, 'tr'));
    dlAtolye.innerHTML = hepsi.map(d => `<option value="${escapeHtml(String(d))}">`).join('');
  }
  const dlVeren = document.getElementById('egitim-veren-list');
  if (dlVeren) {
    const hepsi = [...new Set([...verenler, ...personelAdlari])].sort((a, b) => String(a).localeCompare(b, 'tr'));
    dlVeren.innerHTML = hepsi.map(d => `<option value="${escapeHtml(String(d))}">`).join('');
  }
}

// --- Çoklu katılımcı satırı yönetimi ---
function egitimKatilimciRowHtml(k) {
  k = k || {};
  const ad = escapeHtml(String(k.ad || ''));
  const tel = escapeHtml(String(k.tel || ''));
  const eposta = escapeHtml(String(k.eposta || ''));
  const checked = k.kvkk ? 'checked' : '';
  return `
  <div class="egitim-katilimci-row">
    <div class="ek-fields">
      <input type="text" class="ek-ad" placeholder="Ad Soyad *" value="${ad}">
      <input type="tel" class="ek-tel" placeholder="Telefon (ops.)" value="${tel}">
      <input type="email" class="ek-eposta" placeholder="E-posta (ops.)" value="${eposta}">
    </div>
    <div class="ek-bottom">
      <label class="ek-consent"><input type="checkbox" class="ek-kvkk" ${checked}> <span>KVKK açık rızası alındı</span></label>
      <button type="button" class="ek-remove" title="Katılımcıyı çıkar">✕</button>
    </div>
  </div>`;
}

function egitimKatilimciEkle(k) {
  const list = document.getElementById('egitim-katilimci-list');
  if (!list) return;
  list.insertAdjacentHTML('beforeend', egitimKatilimciRowHtml(k));
  egitimKatilimciRemoveGorunurluk();
}

function egitimKatilimciRemoveGorunurluk() {
  const list = document.getElementById('egitim-katilimci-list');
  if (!list) return;
  const rows = list.querySelectorAll('.egitim-katilimci-row');
  rows.forEach(r => {
    const rm = r.querySelector('.ek-remove');
    if (rm) rm.style.visibility = rows.length > 1 ? 'visible' : 'hidden';
  });
}

function egitimKatilimcilariTopla() {
  const list = document.getElementById('egitim-katilimci-list');
  if (!list) return [];
  return [...list.querySelectorAll('.egitim-katilimci-row')].map(r => ({
    ad: (r.querySelector('.ek-ad').value || '').trim(),
    tel: (r.querySelector('.ek-tel').value || '').trim(),
    eposta: (r.querySelector('.ek-eposta').value || '').trim(),
    kvkk: r.querySelector('.ek-kvkk').checked
  })).filter(k => k.ad || k.tel || k.eposta);
}

function openAddEgitimModal() {
  if (!egitimYazabilir()) { showToast('Bu işlem için yetkiniz yok.', 'warning'); return; }
  const form = document.getElementById('egitim-form');
  form.reset();
  document.getElementById('egitim-row-num').value = '';
  document.getElementById('egitim-id').value = '';
  document.getElementById('egitim-modal-title').textContent = 'Yeni Eğitim Kaydı';
  document.getElementById('egitim-tarihi').value = new Date().toISOString().split('T')[0];
  document.getElementById('egitim-durum').value = 'Planlandı';
  document.getElementById('egitim-sertifika').value = 'Verilmedi';
  // Katılımcı listesi: tek boş satır, çoklu ekleme açık
  document.getElementById('egitim-katilimci-list').innerHTML = '';
  egitimKatilimciEkle({});
  document.getElementById('btn-egitim-add-katilimci').classList.remove('hidden');
  document.getElementById('btn-delete-egitim').classList.add('hidden');
  document.getElementById('dialog-egitim').showModal();
}

function openEditEgitimModal(rowNum) {
  if (!egitimYazabilir()) { showToast('Bu işlem için yetkiniz yok.', 'warning'); return; }
  const kayit = (STATE.egitim || []).map(normalizeEgitim).find(e => String(e._rowNum) === String(rowNum));
  if (!kayit) { showToast('Kayıt bulunamadı.', 'danger'); return; }

  document.getElementById('egitim-form').reset();
  document.getElementById('egitim-row-num').value = kayit._rowNum;
  document.getElementById('egitim-id').value = kayit.id;
  document.getElementById('egitim-modal-title').textContent = 'Eğitim Kaydını Düzenle';
  document.getElementById('egitim-adi').value = kayit.egitimAdi;
  document.getElementById('egitim-atolye').value = kayit.atolye;
  document.getElementById('egitim-veren').value = kayit.egitimVeren;
  document.getElementById('egitim-tarihi').value = (String(kayit.egitimTarihi).match(/^\d{4}-\d{2}-\d{2}/) || [''])[0];
  document.getElementById('egitim-sure').value = kayit.sure;
  document.getElementById('egitim-yer').value = kayit.yer;
  document.getElementById('egitim-durum').value = kayit.durum || 'Planlandı';
  document.getElementById('egitim-sertifika').value = kayit.sertifika || 'Verilmedi';
  document.getElementById('egitim-notlar').value = kayit.notlar;
  // Düzenlemede tek katılımcı (bu satır); çoklu ekleme kapalı
  document.getElementById('egitim-katilimci-list').innerHTML = '';
  egitimKatilimciEkle({ ad: kayit.katilimciAd, tel: kayit.katilimciTel, eposta: kayit.katilimciEposta, kvkk: egitimKvkkOnayli(kayit.kvkkOnay) });
  document.getElementById('btn-egitim-add-katilimci').classList.add('hidden');
  document.getElementById('btn-delete-egitim').classList.remove('hidden');
  document.getElementById('dialog-egitim').showModal();
}

async function saveEgitim() {
  const egitimAdi = document.getElementById('egitim-adi').value.trim();
  if (!egitimAdi) { showToast('Eğitim adı zorunludur.', 'warning'); return; }

  const katilimcilar = egitimKatilimcilariTopla().filter(k => k.ad);
  if (katilimcilar.length === 0) { showToast('En az bir katılımcı ad-soyadı girin.', 'warning'); return; }

  // KVKK: iletişim verisi olup açık rızası işaretlenmemiş katılımcılar için uyarı
  const rizasiz = katilimcilar.filter(k => (k.tel || k.eposta) && !k.kvkk);
  if (rizasiz.length) {
    const isim = rizasiz.map(k => k.ad).join(', ');
    const devam = confirm('KVKK Uyarısı:\n\nŞu katılımcı(lar) için telefon/e-posta gibi kişisel iletişim verisi girildi ancak "KVKK açık rızası alındı" işaretlenmedi:\n' + isim + '\n\nAçık rıza olmadan kişisel veri saklamak KVKK\'ya aykırıdır. Yine de kaydetmek istiyor musunuz?');
    if (!devam) return;
  }

  const paylasilan = {
    egitimAdi,
    atolye: document.getElementById('egitim-atolye').value.trim(),
    egitimVeren: document.getElementById('egitim-veren').value.trim(),
    egitimTarihi: document.getElementById('egitim-tarihi').value,
    sure: document.getElementById('egitim-sure').value.trim(),
    yer: document.getElementById('egitim-yer').value.trim(),
    durum: document.getElementById('egitim-durum').value,
    sertifika: document.getElementById('egitim-sertifika').value,
    notlar: document.getElementById('egitim-notlar').value.trim()
  };

  const rowNum = document.getElementById('egitim-row-num').value;
  const guncelleme = !!rowNum;

  let payload;
  if (guncelleme) {
    const k = katilimcilar[0];
    payload = Object.assign({}, paylasilan, {
      _rowNum: rowNum,
      id: document.getElementById('egitim-id').value,
      katilimciAd: k.ad, katilimciTel: k.tel, katilimciEposta: k.eposta,
      kvkkOnay: k.kvkk ? 'Alındı' : 'Alınmadı'
    });
  } else {
    payload = Object.assign({}, paylasilan, { katilimcilar });
  }

  toggleLoading(true, guncelleme ? 'Eğitim kaydı güncelleniyor...'
    : (katilimcilar.length > 1 ? katilimcilar.length + ' katılımcı ekleniyor...' : 'Eğitim kaydı ekleniyor...'));
  const res = await apiPost(guncelleme ? 'update_egitim' : 'add_egitim', payload);
  toggleLoading(false);

  if (res && res.success) {
    showToast(guncelleme ? 'Eğitim kaydı güncellendi.'
      : (res.count ? res.count + ' katılımcılı eğitim kaydı eklendi.' : 'Eğitim kaydı eklendi.'), 'success');
    document.getElementById('dialog-egitim').close();
    await syncAllData(true);
    renderEgitim();
  } else {
    showToast('Hata: ' + (res ? res.error : 'Kayıt işlenemedi.'), 'danger');
  }
}

// KVKK Açık Rıza Formu — katılımcı başına resmî PDF
async function generateEgitimConsentPdf(rowNum) {
  const e = (STATE.egitim || []).map(normalizeEgitim).find(x => String(x._rowNum) === String(rowNum));
  if (!e) { showToast('Kayıt bulunamadı.', 'danger'); return; }
  // PDF motoru istek üzerine yüklenir (açılışı yavaşlatmasın diye).
  if (!(await pdfMotoruHazirla())) return;

  const bugun = new Date().toLocaleDateString('tr-TR');
  const satir = (b, d) => `<tr>
    <td style="padding:6px 10px; border:1px solid #999; background:#f3f0f7; font-weight:bold; width:38%;">${escapeHtml(b)}</td>
    <td style="padding:6px 10px; border:1px solid #999;">${escapeHtml(d || '-')}</td></tr>`;

  const el = document.createElement('div');
  el.style.cssText = 'width:720px; padding:32px 40px; font-family:"Times New Roman",Georgia,serif; color:#111; background:#fff; line-height:1.55;';
  el.innerHTML = `
    <div style="text-align:center; border-bottom:2px solid #333; padding-bottom:10px; margin-bottom:16px;">
      <div style="font-size:14px; font-weight:bold;">T.C. MİLLÎ EĞİTİM BAKANLIĞI</div>
      <div style="font-size:17px; font-weight:bold; letter-spacing:0.5px;">EDİRNE OLGUNLAŞMA ENSTİTÜSÜ</div>
      <div style="font-size:13.5px; margin-top:8px; font-weight:bold;">KİŞİSEL VERİLERİN İŞLENMESİNE İLİŞKİN<br>AYDINLATMA VE AÇIK RIZA FORMU</div>
    </div>
    <p style="font-size:12px; text-align:justify; margin:8px 0;">
      6698 sayılı Kişisel Verilerin Korunması Kanunu (&ldquo;KVKK&rdquo;) uyarınca, veri sorumlusu sıfatıyla <b>Edirne Olgunlaşma Enstitüsü</b> tarafından, aşağıda kimliği belirtilen katılımcıya ait kişisel veriler; kurumumuz bünyesinde yürütülen eğitim/kurs faaliyetlerinin planlanması, yürütülmesi, katılımın ve başarının belgelendirilmesi (katılım belgesi/sertifika düzenlenmesi) ile ilgili mevzuattan doğan yükümlülüklerin yerine getirilmesi amaçlarıyla işlenmektedir.
    </p>
    <p style="font-size:12px; text-align:justify; margin:8px 0;">
      <b>İşlenen kişisel veriler:</b> ad-soyad, iletişim bilgileri (telefon, e-posta) ve eğitim katılım bilgileridir. Söz konusu veriler yalnızca belirtilen amaçlarla ve bu amaçla sınırlı olarak, ilgili mevzuatta öngörülen ya da işlendikleri amaç için gerekli olan süre kadar saklanır; amaç ortadan kalktığında silinir, yok edilir veya anonim hâle getirilir. Verileriniz, hukuken yetkili kamu kurum ve kuruluşları dışında üçüncü kişilerle paylaşılmaz.
    </p>
    <p style="font-size:12px; text-align:justify; margin:8px 0;">
      <b>Haklarınız:</b> KVKK&rsquo;nın 11. maddesi kapsamında; kişisel verilerinizin işlenip işlenmediğini öğrenme, işlenmişse buna ilişkin bilgi talep etme, işlenme amacını öğrenme, eksik veya yanlış işlenmişse düzeltilmesini, kanundaki şartlar çerçevesinde silinmesini/yok edilmesini isteme ve işlenmesine itiraz etme haklarına sahipsiniz.
    </p>
    <table style="width:100%; border-collapse:collapse; margin:14px 0; font-size:12px;">
      ${satir('Katılımcı Adı Soyadı', e.katilimciAd)}
      ${satir('Eğitim / Konu', e.egitimAdi)}
      ${satir('Atölye / Dal', e.atolye)}
      ${satir('Eğitim Veren', e.egitimVeren)}
      ${satir('Eğitim Tarihi', egitimTarihGoster(e.egitimTarihi))}
      ${satir('Süre', e.sure ? (e.sure + ' saat') : '-')}
      ${satir('Eğitim Yeri', e.yer)}
    </table>
    <p style="font-size:12px; text-align:justify; margin:10px 0;">
      <b>AÇIK RIZA BEYANI:</b> Yukarıdaki aydınlatma metnini okudum ve anladım. Kişisel verilerimin, belirtilen amaçlarla ve yalnızca bu amaçlarla sınırlı olarak Edirne Olgunlaşma Enstitüsü tarafından işlenmesine <b>açık rızamla onay veriyorum.</b>
    </p>
    <table style="width:100%; margin-top:36px; font-size:12px;">
      <tr>
        <td style="width:46%; vertical-align:bottom;">Katılımcı Adı Soyadı:<br><br>&#46;&#46;&#46;&#46;&#46;&#46;&#46;&#46;&#46;&#46;&#46;&#46;&#46;&#46;&#46;&#46;&#46;&#46;&#46;&#46;&#46;&#46;&#46;&#46;&#46;&#46;</td>
        <td style="width:27%; vertical-align:bottom;">Tarih:<br><br>&#46;&#46;&#46;/&#46;&#46;&#46;/&#46;&#46;&#46;&#46;&#46;</td>
        <td style="width:27%; vertical-align:bottom;">İmza:<br><br>&#46;&#46;&#46;&#46;&#46;&#46;&#46;&#46;&#46;&#46;&#46;&#46;&#46;&#46;&#46;&#46;</td>
      </tr>
    </table>
    <div style="margin-top:22px; font-size:9.5px; color:#777; border-top:1px solid #ccc; padding-top:6px; text-align:center;">
      Bu form Edirne Olgunlaşma Enstitüsü eğitim faaliyetleri kapsamında düzenlenmiştir. Belge No: ${escapeHtml(String(e.id || '-'))} &middot; Düzenlenme: ${bugun}
    </div>`;

  const guvenliAd = String(e.katilimciAd || 'katilimci').replace(/[^\wğüşıöçĞÜŞİÖÇ]+/g, '_');
  const opt = {
    margin: [12, 12, 14, 12],
    filename: `Acik_Riza_Formu_${guvenliAd}_${e.id || ''}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak: { mode: ['css', 'legacy'] }
  };
  showToast('Açık rıza formu hazırlanıyor...', 'info');
  window.html2pdf().set(opt).from(el).save();
}

// Katılımcıya profesyonel eğitim bilgilendirme e-postası (sunucu üzerinden)
async function sendEgitimKatilimciMail(rowNum) {
  if (!egitimYazabilir()) { showToast('Bu işlem için yetkiniz yok.', 'warning'); return; }
  const e = (STATE.egitim || []).map(normalizeEgitim).find(x => String(x._rowNum) === String(rowNum));
  if (!e) { showToast('Kayıt bulunamadı.', 'danger'); return; }
  if (!e.katilimciEposta || !e.katilimciEposta.trim()) {
    showToast('Bu katılımcının e-posta adresi tanımlı değil.', 'warning'); return;
  }
  const onay = confirm('"' + e.katilimciAd + '" adlı katılımcıya (' + e.katilimciEposta + ')\n"' + e.egitimAdi + '" eğitimi hakkında bilgilendirme e-postası gönderilecek.\n\nGönderilsin mi?');
  if (!onay) return;

  toggleLoading(true, 'E-posta gönderiliyor...');
  const res = await apiPost('send_egitim_mail', {
    recipient: e.katilimciEposta,
    katilimciAd: e.katilimciAd,
    egitimAdi: e.egitimAdi,
    atolye: e.atolye,
    egitimVeren: e.egitimVeren,
    egitimTarihi: egitimTarihGoster(e.egitimTarihi),
    sure: e.sure,
    yer: e.yer,
    durum: e.durum
  });
  toggleLoading(false);
  if (res && res.success) showToast('Bilgilendirme e-postası gönderildi.', 'success');
  else showToast('E-posta gönderilemedi: ' + (res ? res.error : 'bağlantı hatası'), 'danger');
}

async function deleteEgitim(rowNum, id) {
  if (!egitimYazabilir()) { showToast('Bu işlem için yetkiniz yok.', 'warning'); return; }
  const onay = confirm('Bu eğitim kaydını silmek üzeresiniz.\n\nKVKK "unutulma hakkı" gereği, kayıt ve içindeki katılımcı kişisel verisi KALICI olarak silinecektir. Bu işlem geri alınamaz.\n\nDevam edilsin mi?');
  if (!onay) return;

  toggleLoading(true, 'Eğitim kaydı siliniyor...');
  const res = await apiPost('delete_egitim', { _rowNum: rowNum, id: id });
  toggleLoading(false);

  if (res && res.success) {
    showToast('Eğitim kaydı silindi.', 'success');
    document.getElementById('dialog-egitim')?.close();
    await syncAllData(true);
    renderEgitim();
  } else {
    showToast('Hata: ' + (res ? res.error : 'Kayıt silinemedi.'), 'danger');
  }
}

async function exportEgitimPdf() {
  const kayitlar = (STATE.egitim || []).map(normalizeEgitim);
  if (kayitlar.length === 0) { showToast('Dışa aktarılacak eğitim kaydı yok.', 'warning'); return; }
  // PDF motoru istek üzerine yüklenir (açılışı yavaşlatmasın diye).
  if (!(await pdfMotoruHazirla())) return;

  const bugun = new Date().toLocaleDateString('tr-TR');
  const satirlar = kayitlar
    .sort((a, b) => (a.egitimTarihi > b.egitimTarihi ? -1 : 1))
    .map(e => `
      <tr>
        <td>${escapeHtml(egitimTarihGoster(e.egitimTarihi))}</td>
        <td>${escapeHtml(String(e.egitimAdi || '-'))}</td>
        <td>${escapeHtml(String(e.atolye || '-'))}</td>
        <td>${escapeHtml(String(e.egitimVeren || '-'))}</td>
        <td>${escapeHtml(String(e.katilimciAd || '-'))}</td>
        <td>${escapeHtml(String(e.sure || '-'))}</td>
        <td>${escapeHtml(String(e.durum || '-'))}</td>
      </tr>`).join('');

  const el = document.createElement('div');
  el.style.cssText = 'width:760px;padding:24px;font-family:Arial,sans-serif;color:#1e1633;background:#fff;';
  el.innerHTML = `
    <div style="text-align:center;border-bottom:3px solid #4b1478;padding-bottom:12px;margin-bottom:8px;">
      <h2 style="margin:0;color:#4b1478;">EDİRNE OLGUNLAŞMA ENSTİTÜSÜ</h2>
      <div style="color:#8a6d00;font-weight:700;letter-spacing:1px;">EĞİTİM FAALİYETLERİ RAPORU</div>
      <div style="font-size:12px;color:#666;margin-top:4px;">Rapor Tarihi: ${bugun} · Toplam Kayıt: ${kayitlar.length}</div>
    </div>
    <div style="font-size:10px;color:#777;margin:8px 0 12px;padding:8px;background:#f6f2fb;border-radius:6px;border:1px solid #e3d8f2;">
      🔐 Bu belge kişisel veri içerir. KVKK gereği yalnızca kurum içi ve eğitim amacıyla kullanılmalı, yetkisiz kişilerle paylaşılmamalıdır.
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:11px;">
      <thead>
        <tr style="background:#4b1478;color:#fff;">
          <th style="padding:7px;text-align:left;">Tarih</th>
          <th style="padding:7px;text-align:left;">Eğitim Adı</th>
          <th style="padding:7px;text-align:left;">Atölye</th>
          <th style="padding:7px;text-align:left;">Eğitmen</th>
          <th style="padding:7px;text-align:left;">Katılımcı</th>
          <th style="padding:7px;text-align:left;">Süre</th>
          <th style="padding:7px;text-align:left;">Durum</th>
        </tr>
      </thead>
      <tbody>${satirlar}</tbody>
    </table>
    <div style="margin-top:18px;font-size:10px;color:#999;text-align:center;border-top:1px solid #eee;padding-top:8px;">
      Edirne Olgunlaşma Enstitüsü Yönetim Sistemi tarafından üretilmiştir · Gizli / Kuruma Özel
    </div>`;

  const opt = {
    margin: [10, 10, 12, 10],
    filename: `Egitim_Faaliyetleri_${new Date().toISOString().split('T')[0]}.pdf`,
    image: { type: 'jpeg', quality: 0.95 },
    html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
    pagebreak: { mode: ['css', 'legacy'] }
  };
  showToast('PDF hazırlanıyor...', 'info');
  window.html2pdf().set(opt).from(el).save();
}

// =====================================================================
// PROFİL AVATARI (kullanıcı kendi simgesini seçer; tüm cihazlarda kalıcı)
// =====================================================================
const AVATAR_SET = [
  '🧑‍🏫','👩‍🏫','👨‍🏫','🧑‍🎨','👩‍🎨','👨‍🎨','🧵','🪡','🧶','🎨','🖌️','✂️',
  '🏛️','📚','📖','✒️','🕊️','🌸','🌷','🌿','🍀','🌺','☕','🫖',
  '⭐','🌟','🔷','🎭','🎼','🏺','💎','🦋','🧿','👑','🌙','🔆'
];

function updateProfileBadgeAvatar() {
  const el = document.getElementById('user-avatar-initial');
  if (!el || !STATE.currentUser) return;
  const av = (STATE.currentUser.avatar || '').trim();
  if (av) {
    el.textContent = av;
    el.style.fontSize = '1.25rem';
  } else {
    el.textContent = (STATE.currentUser.name || '?').charAt(0).toLocaleUpperCase('tr-TR');
    el.style.fontSize = '';
  }
}

function updateAvatarPreview() {
  const prev = document.getElementById('avatar-preview');
  if (!prev) return;
  const d = STATE._avatarDraft;
  if (d) { prev.textContent = d; prev.style.fontSize = '2rem'; }
  else {
    prev.textContent = ((STATE.currentUser && STATE.currentUser.name) || '?').charAt(0).toLocaleUpperCase('tr-TR');
    prev.style.fontSize = '2rem';
  }
}

function openAvatarModal() {
  if (!STATE.currentUser) return;
  const grid = document.getElementById('avatar-grid');
  const cur = (STATE.currentUser.avatar || '').trim();
  STATE._avatarDraft = cur;
  if (grid) {
    grid.innerHTML = AVATAR_SET.map(e =>
      `<button type="button" class="avatar-option${e === cur ? ' selected' : ''}" data-emoji="${e}">${e}</button>`
    ).join('');
  }
  const nameEl = document.getElementById('avatar-preview-name');
  if (nameEl) nameEl.textContent = STATE.currentUser.name || '';
  updateAvatarPreview();
  document.getElementById('dialog-avatar').showModal();
}

async function saveAvatar() {
  const yeni = STATE._avatarDraft || '';
  toggleLoading(true, 'Profil simgesi kaydediliyor...');
  const res = await apiPost('update_avatar', { avatar: yeni });
  toggleLoading(false);
  if (res && res.success) {
    STATE.currentUser.avatar = yeni;
    updateProfileBadgeAvatar();
    document.getElementById('dialog-avatar').close();
    showToast('Profil simgen güncellendi.', 'success');
  } else {
    showToast('Simge kaydedilemedi: ' + (res ? res.error : 'bağlantı hatası'), 'danger');
  }
}

// =====================================================================
// YEDEKLEME (yalnızca admin) — Ayarlar → Yedekleme kartı
// =====================================================================
function yedekAdminMi() {
  return STATE.currentUser && STATE.currentUser.role === 'admin';
}

// Kart görünürlüğü + durum yükleme (giriş sonrası ve panel açılışında)
async function yedekKartiHazirla() {
  const kart = document.getElementById('yedek-karti');
  if (!kart) return;
  if (!yedekAdminMi()) { kart.style.display = 'none'; return; }
  kart.style.display = '';
  await yedekDurumYukle();
}

async function yedekDurumYukle() {
  const el = document.getElementById('yedek-durum');
  if (!el || !yedekAdminMi()) return;
  const res = await apiPost('get_backup_status');
  if (res && res.success) {
    if (!res.klasorTanimli) {
      el.innerHTML = '⚠️ Yedek klasörü henüz tanımlı değil. Sunucu tarafında <strong>YEDEK_KLASOR_ID</strong> girilmeli.';
      return;
    }
    if (res.sonYedek) {
      const t = new Date(res.sonYedek);
      const tarih = isNaN(t.getTime()) ? res.sonYedek : t.toLocaleString('tr-TR');
      el.innerHTML = `Son yedek: <strong>${escapeHtml(tarih)}</strong> · ${escapeHtml(String(res.kaynakSayisi || 0))} kaynak` +
        (res.ozet ? `<br><span style="opacity:0.8">${escapeHtml(res.ozet)}</span>` : '');
    } else {
      el.textContent = 'Henüz otomatik yedek alınmadı. "Şimdi Yedek Al" ile başlatabilirsiniz.';
    }
  } else {
    el.textContent = 'Yedek durumu alınamadı: ' + (res ? res.error : 'bağlantı hatası');
  }
}

async function yedekSimdiAl() {
  if (!yedekAdminMi()) { showToast('Bu işlem için yetkiniz yok.', 'warning'); return; }
  const onay = confirm('Tüm e-tablolar ve atölye fotoğraf/fişleri için yedekleme başlatılacak.\n\nYalnızca değişen veriler yazılır (aynı veri tekrar kopyalanmaz). Devam edilsin mi?');
  if (!onay) return;
  toggleLoading(true, 'Yedekleme yapılıyor... (fotoğraflar dahil biraz sürebilir)');
  const res = await apiPost('run_backup_now');
  toggleLoading(false);
  if (res && res.success) {
    showToast('Yedekleme tamamlandı.', 'success');
    await yedekDurumYukle();
  } else {
    showToast('Yedekleme hatası: ' + (res ? res.error : 'bağlantı hatası'), 'danger');
  }
}

async function yedekBilgisayaraIndir() {
  if (!yedekAdminMi()) { showToast('Bu işlem için yetkiniz yok.', 'warning'); return; }
  toggleLoading(true, 'Yedek paketi hazırlanıyor...');
  const res = await apiPost('export_backup');
  toggleLoading(false);
  if (!res || !res.success || !res.paket) {
    showToast('Yedek indirilemedi: ' + (res ? res.error : 'bağlantı hatası'), 'danger');
    return;
  }
  try {
    const metin = JSON.stringify(res.paket, null, 2);
    const blob = new Blob([metin], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `EO_Yedek_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    const tabloSay = res.paket.etablolar ? Object.keys(res.paket.etablolar).length : 0;
    const fotoSay = res.paket.fotoManifest ? res.paket.fotoManifest.length : 0;
    showToast(`Yedek bilgisayara indirildi (${tabloSay} e-tablo, ${fotoSay} foto/fiş linki).`, 'success');
  } catch (e) {
    showToast('İndirme sırasında hata: ' + e.message, 'danger');
  }
}

// --- Kullanıcı Kayıt/Düzenleme Formu Kontrolleri (Admin) ---
function openAddUserModal() {
  const form = document.getElementById('user-form');
  form.reset();
  document.getElementById('user-row-num').value = '';
  document.getElementById('user-modal-title').textContent = 'Yeni Kullanıcı Ekle';
  document.getElementById('user-username').removeAttribute('readonly');
  document.getElementById('btn-delete-user').classList.add('hidden');
  document.getElementById('user-password').setAttribute('required', 'true');
  document.getElementById('user-pwd-help').textContent = 'Kullanıcı şifresi zorunludur.';
  document.getElementById('user-gender').value = 'erkek';
  document.getElementById('user-role').value = 'okuyucu'; // default role
  document.getElementById('user-duty').value = 'Diğer'; // default duty

  // İzinleri varsayılan olarak hepsini seçili ve aktif getir
  document.querySelectorAll('.permissions-checklist input[type="checkbox"]').forEach(cb => {
    cb.checked = true;
    cb.disabled = false;
  });

  document.getElementById('dialog-user').showModal();
}

function openEditUserModal(username, rowNum) {
  const user = STATE.users.find(u => u.username === username);
  if (!user) return;

  const form = document.getElementById('user-form');
  form.reset();

  document.getElementById('user-row-num').value = rowNum;
  document.getElementById('user-modal-title').textContent = `Kullanıcıyı Düzenle: ${username}`;
  document.getElementById('user-username').value = username;
  document.getElementById('user-username').setAttribute('readonly', 'true'); // Kullanıcı adı değiştirilemez
  document.getElementById('user-fullname').value = user.name;
  document.getElementById('user-role').value = user.role;
  document.getElementById('user-active').checked = user.active;
  document.getElementById('user-gender').value = user.gender || 'erkek';
  document.getElementById('user-duty').value = user.duty || 'Diğer';

  document.getElementById('user-password').removeAttribute('required');
  document.getElementById('user-pwd-help').textContent = 'Şifreyi değiştirmek istemiyorsanız boş bırakın.';

  // İzinleri doldur - boşlukları temizleyerek
  let permissions = user.permissions || [];
  if (typeof permissions === 'string') {
    permissions = permissions.split(',').map(p => p.trim()).filter(Boolean);
  } else if (Array.isArray(permissions)) {
    permissions = permissions.map(p => String(p).trim()).filter(Boolean);
  }

  const isUserAdmin = user.role === 'admin';

  // Önce tüm checkbox'ları sıfırla
  document.querySelectorAll('.permissions-checklist input[type="checkbox"]').forEach(cb => {
    cb.disabled = false;
    cb.checked = false;
  });
  // Sonra izinlere göre işaretle
  document.querySelectorAll('.permissions-checklist input[type="checkbox"]').forEach(cb => {
    if (isUserAdmin) {
      cb.checked = true;
      cb.disabled = true;
    } else {
      // Sadece kaydedilmiş izinleri işaretle (boş dizi = hiçbiri işaretli değil)
      cb.checked = permissions.length > 0 ? checkUserPermission(permissions, cb.value) : false;
    }
  });

  // Ana admin silinemez
  if (username === 'admin' || username === STATE.currentUser.username) {
    document.getElementById('btn-delete-user').classList.add('hidden');
  } else {
    document.getElementById('btn-delete-user').classList.remove('hidden');
  }

  document.getElementById('dialog-user').showModal();
}

async function saveUser() {
  const rowNum = document.getElementById('user-row-num').value;
  const username = document.getElementById('user-username').value.trim();
  const fullname = document.getElementById('user-fullname').value.trim();
  const password = document.getElementById('user-password').value;
  const role = document.getElementById('user-role').value;
  const active = document.getElementById('user-active').checked;
  const gender = document.getElementById('user-gender').value;
  const duty = document.getElementById('user-duty').value;

  if (!username || !fullname) {
    showToast('Lütfen gerekli alanları doldurun.', 'warning');
    return;
  }

  const isNew = rowNum === '';

  if (isNew && !password) {
    showToast('Yeni kullanıcı şifresi girilmelidir.', 'warning');
    return;
  }

  // Seçilen izinleri topla. "yetki-v2", sunucuya yeni sekmelerin de bu formdan
  // geldiğini bildirir; eski istemcinin göndermediği sekmeler böylece kapanmaz.
  const selectedPermissions = ['yetki-v2'];
  document.querySelectorAll('.permissions-checklist input[type="checkbox"]:checked').forEach(cb => {
    selectedPermissions.push(cb.value);
  });

  const payload = {
    username,
    name: fullname,
    role,
    active: active,
    gender,
    duty,
    permissions: selectedPermissions.join(','), // Comma-separated list for column 6
    _rowNum: rowNum
  };

  if (password) {
    payload.password = password; // google apps script bunu hashlerecek
  }

  toggleLoading(true, 'Kullanıcı kaydediliyor...');
  const res = await apiPost('manage_user', payload, isNew ? 'add' : 'update');

  // Eğer mağaza entegrasyonu da varsa, kullanıcıyı mağaza veritabanına da eşitleyelim
  if (res && res.success && STATE.magazaSheetUrl) {
    try {
      // Mağaza scriptinde de 'manage_user' tetikle
      // Not: Mağaza tarafında rowNum farklı olabileceği için _rowNum gönderilmez, mağaza scripti kendisi username ile bulur.
      const storePayload = { ...payload };
      delete storePayload._rowNum;
      await apiMagazaPost('manage_user', storePayload, isNew ? 'add' : 'update');
    } catch (err) {
      console.warn('Kullanıcı mağaza veritabanına eşitlenemedi:', err);
    }
  }

  toggleLoading(false);

  if (res && res.success) {
    showToast('Kullanıcı hesabı kaydedildi.', 'success');
    document.getElementById('dialog-user').close();

    // STATE'i anlık güncelle - syncAllData bitmeden tekrar açılırsa doğru görünsün
    const savedPerms = selectedPermissions; // yukarıda toplanan dizi
    const savedUsername = username;
    const stateUser = STATE.users.find(u => u.username === savedUsername);
    if (stateUser) {
      stateUser.permissions = savedPerms;
      stateUser.role = role;
      stateUser.name = fullname;
      stateUser.active = active;
      stateUser.gender = gender;
      stateUser.duty = duty;
    }

    syncAllData();
  } else {
    showToast('Hata: ' + (res ? res.error : 'İşlem başarısız.'), 'danger');
  }
}

async function deleteUser() {
  const username = document.getElementById('user-username').value;
  const rowNum = document.getElementById('user-row-num').value;

  if (!confirm(`${username} adlı kullanıcıyı tamamen silmek istediğinize emin misiniz?`)) {
    return;
  }

  toggleLoading(true, 'Kullanıcı siliniyor...');
  const res = await apiPost('manage_user', { username, _rowNum: rowNum }, 'delete');

  // Mağaza veritabanından da sil
  if (res && res.success && STATE.magazaSheetUrl) {
    try {
      await apiMagazaPost('manage_user', { username }, 'delete');
    } catch (err) {
      console.warn('Kullanıcı mağaza veritabanından silinemedi:', err);
    }
  }

  toggleLoading(false);

  if (res && res.success) {
    showToast('Kullanıcı başarıyla silindi.', 'success');
    document.getElementById('dialog-user').close();
    syncAllData();
  } else {
    showToast('Hata: ' + (res ? res.error : 'İşlem başarısız.'), 'danger');
  }
}

// --- Excel / CSV Dışa Aktarım (Reports Export) ---
function exportInventoryToCSV() {
  if (STATE.inventory.length === 0) {
    showToast('Dışa aktarılacak envanter kaydı bulunmamaktadır.', 'warning');
    return;
  }

  // CSV Sütunları
  const cols = [
    'Envanter No', 'Arşive Eklendi / Fiş Tamam', 'Eser Adı', 'Giriş Yapan Personel',
    'Tema', 'Ürün Cinsi', 'Ölçüleri', 'Kullanılan Teknik', 'Üretim Tarihi', 'Üretim Yeri',
    'Cinsi (Kullanılan Malzeme)', 'Kökeni (Kaynak)', 'Stok Durumu', 'E-posta Adresi'
  ];

  let csvContent = '\uFEFF'; // Excel Türkçe karakter problemi için BOM ekle

  // Başlıklar
  csvContent += cols.map(c => `"${c.replace(/"/g, '""')}"`).join(',') + '\r\n';

  // Satırlar
  STATE.inventory.forEach(item => {
    const row = cols.map(c => {
      const actualKey = getActualKey(item, c);
      const val = item._original && item._original[actualKey] !== undefined
        ? String(item._original[actualKey]).trim()
        : (item[c] !== undefined ? String(item[c]).trim() : '');
      return `"${val.replace(/"/g, '""')}"`;
    });
    csvContent += row.join(',') + '\r\n';
  });

  // Download Blob oluştur
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `Edirne_Olgunlasma_Envanter_Raporu_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  showToast('Envanter listesi başarıyla CSV olarak indirildi.', 'success');
}

// ==========================================================================
// 6.6 Mağaza Satış Sistemi Mantığı (Store Sales System Logic)
// ==========================================================================

// Mağaza API Ortak POST İsteği
async function apiMagazaPost(action, payload = {}, subAction = '') {
  if (!STATE.magazaSheetUrl) {
    showToast('Mağaza Apps Script Web App URL tanımlanmamış. Ayarlardan kurun.', 'danger');
    return { success: false, error: 'Mağaza URL Eksik' };
  }

  const authPayload = {
    action: action,
    subAction: subAction,
    payload: payload,
    auth: STATE.currentUser ? {
      username: STATE.currentUser.username,
      passwordHash: STATE.currentUser.passwordHash
    } : null
  };

  try {
    const response = await fetch(STATE.magazaSheetUrl, {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'text/plain'
      },
      body: JSON.stringify(authPayload)
    });

    if (!response.ok) {
      throw new Error(`Mağaza API hatası: Status ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (err) {
    console.error('Mağaza API Error:', err);
    return { success: false, error: err.message || 'Bağlantı hatası' };
  }
}

// Canlı Verileri Mağaza E-Tablosundan Güncelle
async function syncMagazaData(isBackground = false) {
  if (!STATE.magazaSheetUrl) return; // URL yoksa senkronize etme

  // Önce önbellekteki verilerle hemen render et ki kullanıcıyı bekletmeyelim
  renderMagazaDashboard();

  if (!isBackground) {
    toggleLoading(true, 'Mağaza verileri çekiliyor...');
  }
  try {
    const res = await apiMagazaPost('get_magaza_data');
    if (!isBackground) {
      toggleLoading(false);
    }
    if (res && res.success) {
      const filterEmptyRows = row => {
        if (!row) return false;
        return Object.keys(row).some(k => k !== '_rowNum' && String(row[k]).trim() !== '');
      };

      STATE.magaza = {
        stock: (res.stock || []).map(standardizeMagazaStockItem).filter(item => item && (item.envanterNo || item.eserAdi)),
        cash: (res.cash || []).filter(filterEmptyRows),
        expenses: (res.expenses || []).filter(filterEmptyRows),
        needs: (res.needs || []).filter(filterEmptyRows)
      };

      // Çevrimdışı önbelleğe kaydet
      if (window.api && window.api.isElectron) {
        await window.api.writeLocalCache('magaza_cache.json', STATE.magaza);
      } else {
        localStorage.setItem('eo_magaza_cache', JSON.stringify(STATE.magaza));
      }

      _modulDamga['magaza'] = Date.now();
      renderMagazaDashboard();
      updateHomeNotifications();
      if (!isBackground) {
        showToast('Mağaza verileri başarıyla senkronize edildi.', 'success');
      }
    } else {
      if (!isBackground) {
        showToast('Mağaza verileri çekilemedi: ' + (res ? res.error : ''), 'danger');
      }
    }
  } catch (err) {
    if (!isBackground) {
      toggleLoading(false);
      showToast('Mağaza bağlantı hatası: ' + err.message, 'danger');
    }
  }
}

async function loadMagazaDataFromCache() {
  let cache = null;
  if (window.api && window.api.isElectron) {
    cache = await window.api.readLocalCache('magaza_cache.json');
  } else {
    const raw = localStorage.getItem('eo_magaza_cache');
    if (raw) cache = JSON.parse(raw);
  }

  if (cache) {
    const filterEmptyRows = row => {
      if (!row) return false;
      return Object.keys(row).some(k => k !== '_rowNum' && String(row[k]).trim() !== '');
    };

    STATE.magaza = {
      stock: (cache.stock || []).map(standardizeMagazaStockItem).filter(item => item && (item.envanterNo || item.eserAdi)),
      cash: (cache.cash || []).filter(filterEmptyRows),
      expenses: (cache.expenses || []).filter(filterEmptyRows),
      needs: (cache.needs || []).filter(filterEmptyRows)
    };
    return true;
  }
  return false;
}

// Google Drive Linkinden Büyük Resim / Thumbnail URL'si Üretme (Farklı boyutlarda)
function getNormalizedImageUrl(src) {
  if (!src || typeof src !== 'string' || src.indexOf('http') !== 0) return '';
  const id = driveDosyaId(src);
  if (id) return `https://lh3.googleusercontent.com/d/${id}=w300`;
  return src;
}

// Mağaza Paneli Verilerini Arayüze Yazdır
function renderMagazaDashboard() {
  const stock = STATE.magaza.stock || [];
  const cash = STATE.magaza.cash || [];
  const expenses = STATE.magaza.expenses || [];
  const needs = STATE.magaza.needs || [];

  // 1. İstatistikleri hesapla
  const totalItems = stock.length;
  const sellingItems = stock.filter(item => {
    const statusVal = String(item.durum || '').trim().toLowerCase();
    return statusVal === 'satışta' || statusVal.indexOf('reyonda') > -1;
  }).length;
  const pendingPrice = stock.filter(item => {
    const statusVal = String(item.durum || '').trim().toLowerCase();
    return statusVal === 'fiyat bekliyor';
  }).length;

  // Bugünkü Kasa Cirosu (tarih bugünün tarihi ile eşleşen satışların toplamı)
  const todayStr = new Date().toISOString().split('T')[0];
  let todayCash = 0;
  cash.forEach(sale => {
    let saleDate = '';
    if (sale["Tarih"]) {
      if (typeof sale["Tarih"] === 'string') {
        saleDate = sale["Tarih"].split('T')[0];
      } else {
        try {
          const d = new Date(sale["Tarih"]);
          if (!isNaN(d.getTime())) {
            saleDate = d.toISOString().split('T')[0];
          }
        } catch (e) { }
      }
    }
    if (saleDate === todayStr) {
      const nakit = parseFloat(sale["Nakit Tahsilat (₺)"] || sale["Nakit Tahsilat"] || 0);
      const kart = parseFloat(sale["Kredi Kartı Tahsilat (₺)"] || sale["Kredi Kartı Tahsilat"] || 0);
      const tutar = parseFloat(sale["Satış Tutarı"] || sale["Tutar"] || 0);

      const saleId = String(sale["Satış ID"] || '');
      const isDevir = saleId.indexOf('DEVIR') === 0 || String(sale["Eser Adı"] || '').indexOf('Kasadan Devir') === 0;

      if (!isDevir) {
        if (nakit || kart) {
          todayCash += (nakit + kart);
        } else {
          todayCash += tutar;
        }
      }
    }
  });

  document.getElementById('stat-magaza-total-items').textContent = totalItems;
  document.getElementById('stat-magaza-selling-items').textContent = sellingItems;
  document.getElementById('stat-magaza-pending-price').textContent = pendingPrice;
  document.getElementById('stat-magaza-cash-today').textContent = todayCash.toLocaleString('tr-TR', { minimumFractionDigits: 2 }) + ' ₺';

  // 2. Stok Tablosunu Çiz
  renderMagazaStockTable();

  // 3. Günlük Kasa Tablosunu Filtreli Çiz
  renderMagazaCashTable();

  // 3.1. Hızlı Satış Açık ise Listeleri Güncelle
  const quickSaleTab = document.getElementById('magaza-quick-sale-tab');
  if (quickSaleTab) {
    populateSalespersonsDropdown('quick-sale-person');
    populateQuickSaleInventoryDropdown();
    updateQuickSaleTotalPrice();
  }

  // 4. Giderler Tablosunu Çiz
  const expenseTbody = document.getElementById('magaza-expense-tbody');
  if (expenses.length === 0) {
    expenseTbody.innerHTML = `<tr><td colspan="7" class="text-center">Gider kaydı bulunmamaktadır.</td></tr>`;
  } else {
    const sortedExpenses = [...expenses].reverse();
    expenseTbody.innerHTML = sortedExpenses.map(exp => {
      const formattedPrice = parseFloat(exp["Tutar"] || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 }) + ' ₺';
      const rawDate = exp["Tarih"] ? (typeof exp["Tarih"] === 'string' ? exp["Tarih"].split('T')[0] : new Date(exp["Tarih"]).toISOString().split('T')[0]) : '';
      return `
        <tr>
          <td data-label="Gider ID"><code>${exp["Gider ID"] || ''}</code></td>
          <td data-label="Açıklama">${exp["Açıklama"] || ''}</td>
          <td data-label="Tutar" class="text-danger font-semibold">${formattedPrice}</td>
          <td data-label="Ödeme Şekli">${exp["Ödeme Yöntemi"] || 'Kasadan Nakit'}</td>
          <td data-label="Ödemeyi Yapan">${exp["Ödemeyi Yapan"] || ''}</td>
          <td data-label="Tarih">${rawDate}</td>
          <td data-label="Ekleyen Personel">${exp["Personel"] || ''}</td>
        </tr>
      `;
    }).join('');
  }

  // 5. İhtiyaçlar Tablosunu Çiz (Bekleyenler vs Temin Edilenler olarak ayır)
  const pendingNeeds = needs.filter(need => need["Durum"] !== 'Alındı');
  const acquiredNeeds = needs.filter(need => need["Durum"] === 'Alındı');

  const needsTbody = document.getElementById('magaza-needs-tbody');
  if (pendingNeeds.length === 0) {
    needsTbody.innerHTML = `<tr><td colspan="8" class="text-center font-semibold py-4" style="color: var(--text-muted);">Şuan için ihtiyaç bulunmamaktadır</td></tr>`;
  } else {
    const sortedNeeds = [...pendingNeeds].reverse();
    needsTbody.innerHTML = sortedNeeds.map(need => {
      const status = need["Durum"] || 'Beklemede';
      let statusBadge = 'badge-pending';
      if (status === 'İptal') statusBadge = 'badge-passive';

      const urgency = need["Öncelik"] || 'Normal';
      const urgencyBadge = urgency === 'Acil' ? 'badge-danger' : 'badge-role';

      const rawDate = need["Tarih"] ? (typeof need["Tarih"] === 'string' ? need["Tarih"].split('T')[0] : new Date(need["Tarih"]).toISOString().split('T')[0]) : '';
      const writePermission = STATE.currentUser && (STATE.currentUser.role === 'admin' || STATE.currentUser.role === 'editor');
      const actionBtn = (writePermission && status === 'Beklemede') ? `
        <button class="btn btn-sm btn-outline-success btn-need-complete" data-row="${need._rowNum}">Alındı Yap</button>
        <button class="btn btn-sm btn-outline-danger btn-need-cancel" data-row="${need._rowNum}">İptal Et</button>
      ` : '';

      return `
        <tr>
          <td data-label="İhtiyaç ID"><code>${need["İhtiyaç ID"] || ''}</code></td>
          <td data-label="Açıklama">${need["Açıklama"] || ''}</td>
          <td data-label="Miktar">${need["Miktar"] || '1'}</td>
          <td data-label="Öncelik"><span class="badge ${urgencyBadge}">${urgency}</span></td>
          <td data-label="Durum"><span class="badge ${statusBadge}">${status}</span></td>
          <td data-label="Tarih">${rawDate}</td>
          <td data-label="Ekleyen">${need["Personel"] || ''}</td>
          <td data-label="İşlemler" class="write-permission">${actionBtn}</td>
        </tr>
      `;
    }).join('');
  }

  // 6. Temin Edilenler Tablosunu Çiz
  const acquiredTbody = document.getElementById('magaza-acquired-tbody');
  if (acquiredNeeds.length === 0) {
    acquiredTbody.innerHTML = `<tr><td colspan="8" class="text-center font-semibold py-4" style="color: var(--text-muted);">Şuan için ihtiyaç bulunmamaktadır</td></tr>`;
  } else {
    const sortedAcquired = [...acquiredNeeds].reverse();
    acquiredTbody.innerHTML = sortedAcquired.map(need => {
      const urgency = need["Öncelik"] || 'Normal';
      const urgencyBadge = urgency === 'Acil' ? 'badge-danger' : 'badge-role';
      const rawDate = need["Tarih"] ? (typeof need["Tarih"] === 'string' ? need["Tarih"].split('T')[0] : new Date(need["Tarih"]).toISOString().split('T')[0]) : '';
      return `
        <tr>
          <td data-label="İhtiyaç ID"><code>${need["İhtiyaç ID"] || ''}</code></td>
          <td data-label="Açıklama">${need["Açıklama"] || ''}</td>
          <td data-label="Miktar">${need["Miktar"] || '1'}</td>
          <td data-label="Öncelik"><span class="badge ${urgencyBadge}">${urgency}</span></td>
          <td data-label="Durum"><span class="badge badge-completed">${need["Durum"] || 'Alındı'}</span></td>
          <td data-label="Tarih">${rawDate}</td>
          <td data-label="Ekleyen">${need["Personel"] || ''}</td>
          <td data-label="Temin Eden İdareci">${need["Temin Eden İdareci"] || ''}</td>
        </tr>
      `;
    }).join('');
  }
}

// Mağaza Stok Tablosunu Filtreleyip Çiz
function renderMagazaStockTable() {
  const stock = STATE.magaza.stock || [];
  const searchVal = document.getElementById('magaza-stock-search').value.toLowerCase().trim();
  const filterStatus = document.getElementById('magaza-stock-filter-status').value;

  const filtered = stock.filter(item => {
    if (filterStatus && item.durum !== filterStatus) return false;

    if (searchVal) {
      const matchEnv = String(item.envanterNo || '').toLowerCase().includes(searchVal);
      const matchName = String(item.eserAdi || '').toLowerCase().includes(searchVal);
      const matchType = String(item.cins || '').toLowerCase().includes(searchVal);
      return matchEnv || matchName || matchType;
    }

    return true;
  });

  const tbody = document.getElementById('magaza-stock-tbody');
  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center">Aranan kriterlere uygun stok kaydı bulunamadı.</td></tr>`;
    return;
  }

  const sortedStock = [...filtered].reverse();

  tbody.innerHTML = sortedStock.map(item => {
    const priceVal = parseFloat(item.satisFiyati || 0);
    const formattedPrice = priceVal > 0 ? priceVal.toLocaleString('tr-TR', { minimumFractionDigits: 2 }) + ' ₺' : '<span class="text-muted">Fiyat Belirlenmedi</span>';

    const status = item.durum || 'Fiyat Bekliyor';
    const statusLower = status.toLowerCase();
    let statusClass = 'badge-pending';
    if (statusLower === 'satışta' || statusLower.indexOf('reyonda') > -1) statusClass = 'badge-active';
    if (statusLower === 'pasif') statusClass = 'badge-passive';
    if (statusLower.indexOf('satıldı') > -1) statusClass = 'badge-completed';

    let imgHtml = '<div class="table-thumb-placeholder">🖼️</div>';
    const src = getNormalizedImageUrl(item.gorselLinki);
    if (src) {
      imgHtml = `<img src="${src}" loading="lazy" decoding="async" referrerpolicy="no-referrer" alt="${escapeHtml(item.eserAdi || '')}" class="table-thumb" data-fallback="thumb">`;
    }

    const writePermission = STATE.currentUser && (STATE.currentUser.role === 'admin' || STATE.currentUser.role === 'editor');
    let actionBtnHtml = '';

    const isSold = statusLower.indexOf('satıldı') > -1;
    if (writePermission && !isSold) {
      const canSell = statusLower === 'satışta' || statusLower.indexOf('reyonda') > -1;
      actionBtnHtml = `
        <button class="btn btn-sm btn-outline-primary btn-magaza-edit-item" data-row="${item._rowNum}">⚙️ Fiyat/Durum</button>
        ${canSell ? `<button class="btn btn-sm btn-success btn-magaza-sell-item" data-row="${item._rowNum}">💸 Satış Yap</button>` : ''}
      `;
    }

    return `
      <tr data-row="${item._rowNum}">
        <td data-label="Görsel" class="clickable-cell">${imgHtml}</td>
        <td data-label="Envanter No" class="clickable-cell"><code>${item.envanterNo || ''}</code></td>
        <td data-label="Eser Adı" class="font-semibold clickable-cell">${item.eserAdi || ''}</td>
        <td data-label="Ürün Cinsi">${item.cins || ''}</td>
        <td data-label="Ölçüler">${item.olculeri || ''}</td>
        <td data-label="Fiyat">${formattedPrice}</td>
        <td data-label="Durum"><span class="badge ${statusClass}">${status}</span></td>
        <td data-label="İşlemler" class="write-permission">${actionBtnHtml}</td>
      </tr>
    `;
  }).join('');
}

// Yeni Gelen Onaylı Envanterleri Mağaza Stoğuna Çek
async function pullNewInventoryToStock() {
  if (!STATE.magazaSheetUrl) {
    showToast('Lütfen öncelikle Ayarlar sekmesinden Mağaza Apps Script URL adresini kaydedin.', 'warning');
    return;
  }

  const approvedInventory = STATE.inventory.filter(item => {
    const statusVal = String(item.durum || '').trim().toLowerCase();
    return statusVal.indexOf('arşive eklendi') > -1 || statusVal.indexOf('onaylandı') > -1;
  });

  if (approvedInventory.length === 0) {
    showToast('Ana envanterde "Arşive Eklendi" veya "Onaylandı" durumunda ürün bulunamadı.', 'warning');
    return;
  }

  const existingStockNos = new Set((STATE.magaza.stock || []).map(item => String(item.envanterNo || '').trim()));

  const newItems = approvedInventory.filter(item => {
    const envNo = String(item.envanterNo || '').trim();
    return envNo && !existingStockNos.has(envNo);
  });

  if (newItems.length === 0) {
    showToast('Tüm onaylı envanter ürünleri zaten mağaza stoğunda mevcut.', 'info');
    return;
  }

  const payloadItems = newItems.map(item => ({
    envanterNo: item.envanterNo,
    name: item.eserAdi || '',
    size: item.olculeri || '',
    theme: item.tema || '',
    type: item.cins || '',
    imageUrl: item.linkImage || item.linkWeb || '',
    price: 0,
    status: 'Fiyat Bekliyor'
  }));

  toggleLoading(true, `${payloadItems.length} yeni ürün mağaza stoğuna aktarılıyor...`);
  try {
    const res = await apiMagazaPost('add_magaza_stock_items', { items: payloadItems });
    toggleLoading(false);
    if (res && res.success) {
      showToast(`${payloadItems.length} yeni ürün başarıyla stoğa çekildi!`, 'success');
      await syncMagazaData();
    } else {
      showToast('Stoğa çekme işlemi başarısız: ' + (res ? res.error : ''), 'danger');
    }
  } catch (err) {
    toggleLoading(false);
    showToast('Bağlantı hatası: ' + err.message, 'danger');
  }
}

function populateSalespersonsDropdown(selectId) {
  const select = document.getElementById(selectId);
  if (!select) return;
  select.innerHTML = '';
  let salespersons = (STATE.users || []).filter(u => u.active && u.duty === 'Satış Personeli');
  if (salespersons.length === 0) {
    salespersons = (STATE.users || []).filter(u => u.active && (u.role === 'editor' || u.role === 'admin'));
  }
  if (salespersons.length === 0) {
    salespersons = (STATE.users || []).filter(u => u.active);
  }
  salespersons.forEach(u => {
    const opt = document.createElement('option');
    opt.value = u.name;
    opt.textContent = u.name;
    select.appendChild(opt);
  });
}

function selectQuickSaleInventoryItem(value, name, price, rowNum) {
  const hiddenInput = document.getElementById('quick-sale-inventory-item');
  if (hiddenInput) {
    hiddenInput.value = value;
    hiddenInput.dataset.row = rowNum;
  }

  const selectedText = document.getElementById('quick-sale-selected-text');
  if (selectedText) {
    if (value) {
      selectedText.textContent = `${name} (${value})`;
    } else {
      selectedText.textContent = 'Seçiniz...';
    }
  }

  // Close dropdown
  const dropdown = document.getElementById('quick-sale-inventory-dropdown-options');
  if (dropdown) dropdown.classList.add('hidden');

  const arrow = document.querySelector('#quick-sale-inventory-trigger .arrow');
  if (arrow) arrow.style.transform = 'rotate(0deg)';

  // Set price input
  const unitPriceInput = document.getElementById('quick-sale-unit-price');
  if (unitPriceInput) {
    unitPriceInput.value = value ? price : '';
  }

  // Re-highlight options in container
  const container = document.getElementById('quick-sale-inventory-dropdown-options');
  if (container) {
    container.querySelectorAll('.custom-select-item').forEach(el => {
      if (el.dataset.value === value) {
        el.classList.add('selected');
      } else {
        el.classList.remove('selected');
      }
    });
  }

  updateQuickSaleTotalPrice();
}

function populateQuickSaleInventoryDropdown() {
  const container = document.getElementById('quick-sale-inventory-dropdown-options');
  if (!container) return;
  container.innerHTML = '';

  const stock = STATE.magaza.stock || [];
  const inStockItems = stock.filter(item => {
    const statusVal = String(item.durum || '').trim().toLowerCase();
    return statusVal === 'satışta' || statusVal.indexOf('reyonda') > -1;
  });

  if (inStockItems.length === 0) {
    container.innerHTML = '<div style="padding: 0.75rem 1rem; color: var(--text-muted); font-size: 0.85rem; text-align: center;">Satışta ürün bulunmamaktadır</div>';
    return;
  }

  const hiddenInput = document.getElementById('quick-sale-inventory-item');
  const currentVal = hiddenInput ? hiddenInput.value : '';

  inStockItems.forEach(item => {
    const priceVal = parseFloat(item.satisFiyati || 0);
    const src = getNormalizedImageUrl(item.gorselLinki);
    const itemDiv = document.createElement('div');
    itemDiv.className = 'custom-select-item';
    itemDiv.dataset.value = item.envanterNo;
    itemDiv.dataset.price = priceVal;
    itemDiv.dataset.row = item._rowNum;
    itemDiv.dataset.name = item.eserAdi;

    if (currentVal === item.envanterNo) {
      itemDiv.classList.add('selected');
    }

    let imgHtml = '';
    if (src) {
      imgHtml = `<img src="${src}" loading="lazy" decoding="async" referrerpolicy="no-referrer" style="width: 36px; height: 36px; border-radius: 4px; object-fit: cover;" data-fallback="small">`;
    } else {
      imgHtml = `<div style="width: 36px; height: 36px; border-radius: 4px; background: rgba(255, 255, 255, 0.05); display: flex; align-items: center; justify-content: center; font-size: 1.1rem; border: 1px solid var(--border-color);">🖼️</div>`;
    }

    itemDiv.innerHTML = `
      ${imgHtml}
      <div style="flex-grow: 1; min-width: 0; display: flex; flex-direction: column;">
        <span style="font-weight: 500; font-size: 0.85rem; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; line-height: 1.2;">${item.eserAdi || 'İsimsiz Ürün'}</span>
        <span style="font-size: 0.75rem; color: var(--text-muted); display: block; margin-top: 0.15rem;">No: ${item.envanterNo}</span>
      </div>
      <div style="font-weight: 600; font-size: 0.85rem; color: var(--accent-gold); white-space: nowrap; margin-left: 0.5rem;">
        ${priceVal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺
      </div>
    `;

    itemDiv.addEventListener('click', (e) => {
      e.stopPropagation();
      selectQuickSaleInventoryItem(item.envanterNo, item.eserAdi, priceVal, item._rowNum);
    });

    container.appendChild(itemDiv);
  });
}

function updateQuickSaleTotalPrice() {
  const unitPriceInput = document.getElementById('quick-sale-unit-price');
  const quantityInput = document.getElementById('quick-sale-quantity');
  const totalPriceDisplay = document.getElementById('quick-sale-total-price');

  if (!unitPriceInput || !quantityInput || !totalPriceDisplay) return;

  let unitPrice = parseFloat(unitPriceInput.value) || 0;
  let quantity = parseInt(quantityInput.value) || 1;
  if (quantity < 1) {
    quantity = 1;
    quantityInput.value = 1;
  }

  const total = unitPrice * quantity;
  totalPriceDisplay.textContent = total.toLocaleString('tr-TR', { minimumFractionDigits: 2 }) + ' ₺';
  totalPriceDisplay.dataset.total = total;
}

function initQuickSaleHandlers() {
  const categorySelect = document.getElementById('quick-sale-category');
  if (categorySelect) {
    categorySelect.addEventListener('change', (e) => {
      const cat = e.target.value;
      const grpInventory = document.getElementById('quick-sale-group-inventory');
      const grpBeverage = document.getElementById('quick-sale-group-beverage');
      const grpCustom = document.getElementById('quick-sale-group-custom');
      const grpEticaret = document.getElementById('quick-sale-group-eticaret');

      const unitPriceInput = document.getElementById('quick-sale-unit-price');
      const quantityInput = document.getElementById('quick-sale-quantity');

      // Reset selections and values
      const bevSelect = document.getElementById('quick-sale-beverage-item');
      const custName = document.getElementById('quick-sale-custom-name');

      selectQuickSaleInventoryItem('', '', 0, '');

      if (bevSelect) bevSelect.value = '';
      if (custName) custName.value = '';
      if (unitPriceInput) {
        unitPriceInput.value = '';
        unitPriceInput.readOnly = (cat === 'inventory');
      }
      if (quantityInput) {
        quantityInput.value = '1';
        quantityInput.readOnly = (cat === 'inventory');
      }

      // E-Ticaret siparişinde de ürün envanterden seçilir; farkı müşteri ve
      // teslimat bilgilerinin de alınması ve kaydın kasaya değil sipariş
      // listesine düşmesidir.
      const gorunurluk = {
        inventory: { envanter: true,  icecek: false, ozel: false, eticaret: false },
        eticaret:  { envanter: true,  icecek: false, ozel: false, eticaret: true  },
        beverage:  { envanter: false, icecek: true,  ozel: false, eticaret: false },
        custom:    { envanter: false, icecek: false, ozel: true,  eticaret: false }
      }[cat] || { envanter: false, icecek: false, ozel: true, eticaret: false };

      if (grpInventory) grpInventory.classList.toggle('hidden', !gorunurluk.envanter);
      if (grpBeverage)  grpBeverage.classList.toggle('hidden', !gorunurluk.icecek);
      if (grpCustom)    grpCustom.classList.toggle('hidden', !gorunurluk.ozel);
      if (grpEticaret)  grpEticaret.classList.toggle('hidden', !gorunurluk.eticaret);

      const kaydetBtn = document.getElementById('btn-save-quick-sale');
      if (kaydetBtn) {
        kaydetBtn.innerHTML = gorunurluk.eticaret
          ? '<span>🚚 Siparişi Oluştur</span>'
          : '<span>💾 Satışı Kaydet</span>';
      }
      // Ödeme yöntemi kutusu kargolu siparişte anlamsızdır (tahsilat sipariş
      // ekranından yönetilir); şaşırtmasın diye gizlenir.
      const odemeGrubu = document.getElementById('quick-sale-payment-method');
      if (odemeGrubu && odemeGrubu.closest('.form-group')) {
        odemeGrubu.closest('.form-group').classList.toggle('hidden', gorunurluk.eticaret);
      }

      if (gorunurluk.eticaret) {
        etSecenekleriDoldur();
        sekmeTazele('eticaret', () => syncEticaret(true).then(etSecenekleriDoldur));
      }

      updateQuickSaleTotalPrice();
    });
  }

  // Toggle inventory dropdown picker
  const trigger = document.getElementById('quick-sale-inventory-trigger');
  const dropdown = document.getElementById('quick-sale-inventory-dropdown-options');
  if (trigger && dropdown) {
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = dropdown.classList.contains('hidden');
      dropdown.classList.toggle('hidden');
      const arrow = trigger.querySelector('.arrow');
      if (arrow) {
        arrow.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
      }
    });
  }

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('quick-sale-inventory-dropdown-options');
    const trigger = document.getElementById('quick-sale-inventory-trigger');
    if (dropdown && !dropdown.classList.contains('hidden')) {
      if (!dropdown.contains(e.target) && (!trigger || !trigger.contains(e.target))) {
        dropdown.classList.add('hidden');
        const arrow = trigger ? trigger.querySelector('.arrow') : null;
        if (arrow) arrow.style.transform = 'rotate(0deg)';
      }
    }
  });

  const beverageItemSelect = document.getElementById('quick-sale-beverage-item');
  if (beverageItemSelect) {
    beverageItemSelect.addEventListener('change', (e) => {
      const opt = e.target.options[e.target.selectedIndex];
      const unitPriceInput = document.getElementById('quick-sale-unit-price');
      if (unitPriceInput) {
        if (opt && opt.value) {
          unitPriceInput.value = opt.dataset.price || '';
          if (opt.value === 'Diğer İçecek') {
            unitPriceInput.focus();
          }
        } else {
          unitPriceInput.value = '';
        }
      }
      updateQuickSaleTotalPrice();
    });
  }

  const unitPriceInput = document.getElementById('quick-sale-unit-price');
  if (unitPriceInput) {
    unitPriceInput.addEventListener('input', updateQuickSaleTotalPrice);
  }
  const quantityInput = document.getElementById('quick-sale-quantity');
  if (quantityInput) {
    quantityInput.addEventListener('input', updateQuickSaleTotalPrice);
  }

  const btnSaveQuickSale = document.getElementById('btn-save-quick-sale');
  if (btnSaveQuickSale) {
    btnSaveQuickSale.addEventListener('click', async () => {
      if (!STATE.magazaSheetUrl) {
        showToast('Lütfen öncelikle Ayarlar sekmesinden Mağaza Apps Script URL adresini kaydedin.', 'warning');
        return;
      }

      const category = document.getElementById('quick-sale-category').value;
      const salesperson = document.getElementById('quick-sale-person').value;
      const paymentMethod = document.getElementById('quick-sale-payment-method').value;
      const quantity = parseInt(document.getElementById('quick-sale-quantity').value) || 1;
      const unitPrice = parseFloat(document.getElementById('quick-sale-unit-price').value) || 0;

      if (!salesperson) {
        showToast('Lütfen satış yapan personeli seçiniz.', 'warning');
        return;
      }
      if (unitPrice <= 0) {
        showToast('Lütfen geçerli bir birim fiyatı giriniz.', 'warning');
        return;
      }

      let payload = {
        category: category === 'inventory' ? 'Envanter' : (category === 'beverage' ? 'İçecek' : 'Diğer'),
        salesperson: salesperson,
        paymentMethod: paymentMethod,
        quantity: quantity,
        unitPrice: unitPrice,
        totalPrice: unitPrice * quantity
      };

      // E-Ticaret: kasaya satış yazılmaz, sipariş kaydı açılır.
      if (category === 'eticaret') {
        const hiddenInput = document.getElementById('quick-sale-inventory-item');
        if (!hiddenInput || !hiddenInput.value) {
          showToast('Lütfen siparişe konu envanterli ürünü seçiniz.', 'warning');
          return;
        }
        const secilen = {
          envanterNo: hiddenInput.value,
          rowNum: parseInt(hiddenInput.dataset.row, 10) || 0,
          ad: (document.getElementById('quick-sale-selected-text')?.textContent || hiddenInput.value).trim()
        };
        const olustu = await etHizliSiparisKaydet(secilen, quantity, unitPrice);
        if (olustu) {
          const form = document.getElementById('quick-sale-form');
          if (form) form.reset();
          const catSelect = document.getElementById('quick-sale-category');
          if (catSelect) catSelect.dispatchEvent(new Event('change'));
        }
        return;
      }

      let endpoint = '';
      if (category === 'inventory') {
        const hiddenInput = document.getElementById('quick-sale-inventory-item');
        if (!hiddenInput || !hiddenInput.value) {
          showToast('Lütfen satılacak envanterli ürünü seçiniz.', 'warning');
          return;
        }
        payload.envanterNo = hiddenInput.value;
        payload.rowNum = hiddenInput.dataset.row;
        payload.price = unitPrice;
        endpoint = 'add_magaza_sale';
      } else if (category === 'beverage') {
        const bevSelect = document.getElementById('quick-sale-beverage-item');
        if (!bevSelect.value) {
          showToast('Lütfen içecek türünü seçiniz.', 'warning');
          return;
        }
        payload.name = bevSelect.value;
        payload.envanterNo = 'İÇECEK';
        endpoint = 'add_magaza_custom_sale';
      } else {
        const customName = document.getElementById('quick-sale-custom-name').value.trim();
        if (!customName) {
          showToast('Lütfen satış açıklamasını giriniz.', 'warning');
          return;
        }
        payload.name = customName;
        payload.envanterNo = 'DİĞER';
        endpoint = 'add_magaza_custom_sale';
      }

      toggleLoading(true, 'Satış kaydediliyor...');
      try {
        const res = await apiMagazaPost(endpoint, payload);
        toggleLoading(false);
        if (res && res.success) {
          showToast('Satış başarıyla kaydedildi!', 'success');
          // Reset form
          const form = document.getElementById('quick-sale-form');
          if (form) form.reset();
          const catSelect = document.getElementById('quick-sale-category');
          if (catSelect) catSelect.dispatchEvent(new Event('change'));
          // Sync magaza data
          await syncMagazaData();
        } else {
          showToast('Satış kaydedilemedi: ' + (res ? res.error : ''), 'danger');
        }
      } catch (err) {
        toggleLoading(false);
        showToast('Bağlantı hatası: ' + err.message, 'danger');
      }
    });
  }
}

function populateManagersDropdown(selectId) {
  const select = document.getElementById(selectId);
  if (!select) return;
  select.innerHTML = '';
  let managers = (STATE.users || []).filter(u => u.active && u.duty === 'Yönetici');
  if (managers.length === 0) {
    managers = (STATE.users || []).filter(u => u.active && u.role === 'admin');
  }
  if (managers.length === 0) {
    managers = (STATE.users || []).filter(u => u.active);
  }
  managers.forEach(u => {
    const opt = document.createElement('option');
    opt.value = u.name;
    opt.textContent = u.name;
    select.appendChild(opt);
  });
}

function populateAllPersonnelDropdown(selectId) {
  const select = document.getElementById(selectId);
  if (!select) return;
  select.innerHTML = '';
  const personnel = (STATE.users || []).filter(u => u.active);
  personnel.forEach(u => {
    const opt = document.createElement('option');
    opt.value = u.name;
    opt.textContent = u.name + (u.duty ? ` (${u.duty})` : '');
    select.appendChild(opt);
  });
}

function openMagazaProductDetailModal(rowNum) {
  const item = STATE.magaza.stock.find(i => String(i._rowNum) === String(rowNum));
  if (!item) return;

  document.getElementById('magaza-detail-env-no').textContent = item.envanterNo || 'Belirtilmemiş';
  document.getElementById('magaza-detail-name').textContent = item.eserAdi || 'Belirtilmemiş';
  document.getElementById('magaza-detail-type').textContent = item.cins || 'Belirtilmemiş';
  document.getElementById('magaza-detail-size').textContent = item.olculeri || 'Belirtilmemiş';
  document.getElementById('magaza-detail-theme').textContent = item.tema || 'Belirtilmemiş';

  const priceVal = parseFloat(item.satisFiyati || 0);
  document.getElementById('magaza-detail-price').textContent = priceVal > 0 ? priceVal.toLocaleString('tr-TR', { minimumFractionDigits: 2 }) + ' ₺' : 'Fiyat Belirlenmedi';

  document.getElementById('magaza-detail-status').textContent = item.durum || 'Fiyat Bekliyor';

  let rawDate = '';
  if (item.eklenmeTarihi) {
    rawDate = typeof item.eklenmeTarihi === 'string' ? item.eklenmeTarihi.split('T')[0] : new Date(item.eklenmeTarihi).toISOString().split('T')[0];
  }
  document.getElementById('magaza-detail-date').textContent = rawDate || 'Bilinmiyor';

  // Image loading
  const placeholder = document.getElementById('magaza-detail-image-placeholder');
  const img = document.getElementById('magaza-detail-image');
  const src = getNormalizedImageUrl(item.gorselLinki);

  if (src) {
    img.src = src;
    img.classList.remove('hidden');
    placeholder.classList.add('hidden');
  } else {
    img.src = '';
    img.classList.add('hidden');
    placeholder.classList.remove('hidden');
  }

  document.getElementById('dialog-magaza-product-detail').showModal();
}

function renderMagazaCashTable() {
  const cash = STATE.magaza.cash || [];
  const searchVal = document.getElementById('magaza-cash-search') ? document.getElementById('magaza-cash-search').value.toLowerCase().trim() : '';
  const filterPayment = document.getElementById('magaza-cash-filter-payment') ? document.getElementById('magaza-cash-filter-payment').value : '';
  const filterType = document.getElementById('magaza-cash-filter-type') ? document.getElementById('magaza-cash-filter-type').value : '';
  const startDateVal = document.getElementById('magaza-cash-start-date') ? document.getElementById('magaza-cash-start-date').value : '';
  const endDateVal = document.getElementById('magaza-cash-end-date') ? document.getElementById('magaza-cash-end-date').value : '';

  const filtered = cash.filter(sale => {
    // Payment Method filter
    const payment = sale["Ödeme Yöntemi"] || '';
    if (filterPayment && payment !== filterPayment) return false;

    // Date filter
    const dateStr = sale["Tarih"] ? (typeof sale["Tarih"] === 'string' ? sale["Tarih"].split('T')[0] : new Date(sale["Tarih"]).toISOString().split('T')[0]) : '';
    if (startDateVal && dateStr < startDateVal) return false;
    if (endDateVal && dateStr > endDateVal) return false;

    // Type filter (Sale vs Devir)
    const saleId = String(sale["Satış ID"] || '');
    const isDevir = saleId.indexOf('DEVIR') === 0 || String(sale["Eser Adı"] || '').indexOf('Kasadan Devir') === 0;
    if (filterType === 'sale' && isDevir) return false;
    if (filterType === 'devir' && !isDevir) return false;

    // Search filter
    if (searchVal) {
      const matchId = String(sale["Satış ID"] || '').toLowerCase().includes(searchVal);
      const matchEnv = String(sale["Envanter No"] || '').toLowerCase().includes(searchVal);
      const matchName = String(sale["Eser Adı"] || '').toLowerCase().includes(searchVal);
      const matchPerson = String(sale["Satan Personel"] || '').toLowerCase().includes(searchVal);
      return matchId || matchEnv || matchName || matchPerson;
    }

    return true;
  });

  // Calculate sums
  let totalSales = 0;
  let totalCash = 0;
  let totalCard = 0;
  let totalDevir = 0;

  filtered.forEach(sale => {
    const saleId = String(sale["Satış ID"] || '');
    const isDevir = saleId.indexOf('DEVIR') === 0 || String(sale["Eser Adı"] || '').indexOf('Kasadan Devir') === 0;

    // Support either Nakit/Kart columns or Satış Tutarı
    const nakit = parseFloat(sale["Nakit Tahsilat (₺)"] || sale["Nakit Tahsilat"] || 0);
    const kart = parseFloat(sale["Kredi Kartı Tahsilat (₺)"] || sale["Kredi Kartı Tahsilat"] || 0);
    const tutar = parseFloat(sale["Satış Tutarı"] || sale["Tutar"] || 0);
    const amount = (nakit || kart) ? (nakit + kart) : tutar;

    if (isDevir) {
      // Devir is written as a negative cash flow in spreadsheet, but let's sum it as positive for display
      totalDevir += Math.abs(amount);
    } else {
      totalSales += amount;
      if (sale["Ödeme Yöntemi"] === 'Nakit' || nakit > 0) {
        totalCash += nakit || amount;
      }
      if (sale["Ödeme Yöntemi"] === 'Kredi Kartı' || kart > 0) {
        totalCard += kart || amount;
      }
    }
  });

  const netKasa = totalSales - totalDevir;

  if (document.getElementById('magaza-cash-report-sales')) {
    document.getElementById('magaza-cash-report-sales').textContent = totalSales.toLocaleString('tr-TR', { minimumFractionDigits: 2 }) + ' ₺';
    document.getElementById('magaza-cash-report-cash').textContent = totalCash.toLocaleString('tr-TR', { minimumFractionDigits: 2 }) + ' ₺';
    document.getElementById('magaza-cash-report-card').textContent = totalCard.toLocaleString('tr-TR', { minimumFractionDigits: 2 }) + ' ₺';
    document.getElementById('magaza-cash-report-devir').textContent = totalDevir.toLocaleString('tr-TR', { minimumFractionDigits: 2 }) + ' ₺';
    document.getElementById('magaza-cash-report-net').textContent = netKasa.toLocaleString('tr-TR', { minimumFractionDigits: 2 }) + ' ₺';
  }

  const cashTbody = document.getElementById('magaza-cash-tbody');
  if (!cashTbody) return;

  if (filtered.length === 0) {
    cashTbody.innerHTML = `<tr><td colspan="7" class="text-center">Kasa kaydı bulunmamaktadır.</td></tr>`;
  } else {
    const sortedCash = [...filtered].reverse();
    cashTbody.innerHTML = sortedCash.map(sale => {
      const nakit = parseFloat(sale["Nakit Tahsilat (₺)"] || sale["Nakit Tahsilat"] || 0);
      const kart = parseFloat(sale["Kredi Kartı Tahsilat (₺)"] || sale["Kredi Kartı Tahsilat"] || 0);
      const tutar = parseFloat(sale["Satış Tutarı"] || sale["Tutar"] || 0);
      const amount = (nakit || kart) ? (nakit + kart) : tutar;

      const saleId = String(sale["Satış ID"] || '');
      const isDevir = saleId.indexOf('DEVIR') === 0 || String(sale["Eser Adı"] || '').indexOf('Kasadan Devir') === 0;

      const formattedPrice = Math.abs(amount).toLocaleString('tr-TR', { minimumFractionDigits: 2 }) + ' ₺';
      const rawDate = sale["Tarih"] ? (typeof sale["Tarih"] === 'string' ? sale["Tarih"].split('T')[0] : new Date(sale["Tarih"]).toISOString().split('T')[0]) : '';

      let badgeClass = 'badge-completed';
      if (isDevir) badgeClass = 'badge-pending';
      else if (sale["Ödeme Yöntemi"] === 'Nakit' || nakit > 0) badgeClass = 'badge-active';

      return `
        <tr>
          <td data-label="İşlem ID"><code>${sale["Satış ID"] || sale["Sıra No"] || ''}</code></td>
          <td data-label="Envanter No"><code>${sale["Envanter No"] || ''}</code></td>
          <td data-label="Açıklama / Eser Adı">${sale["Eser Adı"] || sale["Satılan Kategori (İçecek, Yiyecek, Hediyelik vb.)"] || ''}</td>
          <td data-label="Tutar" class="${isDevir ? 'text-danger' : 'text-success'} font-semibold">${isDevir ? '-' : ''}${formattedPrice}</td>
          <td data-label="İşlem / Ödeme"><span class="badge ${badgeClass}">${isDevir ? 'Devir' : (sale["Ödeme Yöntemi"] || (nakit > 0 ? 'Nakit' : 'Kredi Kartı'))}</span></td>
          <td data-label="Tarih">${rawDate}</td>
          <td data-label="Satan / Alan">${sale["Satan Personel"] || sale["Personel"] || ''}</td>
        </tr>
      `;
    }).join('');
  }
}

function openMagazaSaleModal(rowNum) {
  const item = STATE.magaza.stock.find(i => String(i._rowNum) === String(rowNum));
  if (!item) return;

  STATE.currentSaleItemOriginalPrice = parseFloat(item.satisFiyati || 0);

  document.getElementById('magaza-sale-env-no').value = item.envanterNo || '';
  document.getElementById('magaza-sale-row-num').value = rowNum;
  document.getElementById('magaza-sale-name').value = item.eserAdi || '';
  document.getElementById('magaza-sale-price').value = item.satisFiyati || '';
  document.getElementById('magaza-sale-payment').value = 'Nakit';

  const saleTypeSelect = document.getElementById('magaza-sale-type');
  if (saleTypeSelect) {
    saleTypeSelect.value = 'tam-fiyat';
  }

  populateSalespersonsDropdown('magaza-sale-person');

  document.getElementById('dialog-magaza-sale').showModal();
}

async function submitMagazaSale() {
  const envNo = document.getElementById('magaza-sale-env-no').value;
  const rowNum = document.getElementById('magaza-sale-row-num').value;
  const price = document.getElementById('magaza-sale-price').value;
  const paymentMethod = document.getElementById('magaza-sale-payment').value;
  const salesperson = document.getElementById('magaza-sale-person').value;

  if (!price || price <= 0) {
    showToast('Lütfen geçerli bir satış fiyatı girin.', 'warning');
    return;
  }

  toggleLoading(true, 'Satış işlemi kaydediliyor...');
  try {
    const res = await apiMagazaPost('add_magaza_sale', {
      envanterNo: envNo,
      rowNum: rowNum,
      price: price,
      paymentMethod: paymentMethod,
      salesperson: salesperson
    });
    toggleLoading(false);
    if (res && res.success) {
      showToast('Satış başarıyla gerçekleştirildi!', 'success');
      document.getElementById('dialog-magaza-sale').close();
      await syncMagazaData();
    } else {
      showToast('Satış kaydedilemedi: ' + (res ? res.error : ''), 'danger');
    }
  } catch (err) {
    toggleLoading(false);
    showToast('Bağlantı hatası: ' + err.message, 'danger');
  }
}

function openMagazaStockEditModal(rowNum) {
  const item = STATE.magaza.stock.find(i => String(i._rowNum) === String(rowNum));
  if (!item) return;

  document.getElementById('magaza-stock-edit-row-num').value = rowNum;
  document.getElementById('magaza-stock-edit-name').value = item.eserAdi || '';
  document.getElementById('magaza-stock-edit-price').value = item.satisFiyati || '';
  document.getElementById('magaza-stock-edit-status').value = item.durum || 'Fiyat Bekliyor';

  document.getElementById('dialog-magaza-stock-edit').showModal();
}

async function submitMagazaStockEdit() {
  const rowNum = document.getElementById('magaza-stock-edit-row-num').value;
  const price = document.getElementById('magaza-stock-edit-price').value;
  const status = document.getElementById('magaza-stock-edit-status').value;

  if (price === '') {
    showToast('Fiyat alanını boş bırakamazsınız.', 'warning');
    return;
  }

  toggleLoading(true, 'Stok bilgileri güncelleniyor...');
  try {
    const res = await apiMagazaPost('update_magaza_stock', {
      _rowNum: rowNum,
      price: price,
      status: status
    });
    toggleLoading(false);
    if (res && res.success) {
      showToast('Stok başarıyla güncellendi!', 'success');
      document.getElementById('dialog-magaza-stock-edit').close();
      await syncMagazaData();
    } else {
      showToast('Güncelleme başarısız: ' + (res ? res.error : ''), 'danger');
    }
  } catch (err) {
    toggleLoading(false);
    showToast('Bağlantı hatası: ' + err.message, 'danger');
  }
}

async function submitMagazaExpense() {
  const desc = document.getElementById('magaza-expense-desc').value.trim();
  const amount = document.getElementById('magaza-expense-amount').value;
  const paymentMethod = document.getElementById('magaza-expense-payment-method').value;
  const payer = document.getElementById('magaza-expense-payer').value;

  if (!desc || !amount || amount <= 0) {
    showToast('Lütfen geçerli bir açıklama ve tutar girin.', 'warning');
    return;
  }

  toggleLoading(true, 'Gider kaydı ekleniyor...');
  try {
    const res = await apiMagazaPost('add_magaza_expense', {
      description: desc,
      amount: amount,
      paymentMethod: paymentMethod,
      payer: payer
    });
    toggleLoading(false);
    if (res && res.success) {
      showToast('Gider kaydı başarıyla eklendi!', 'success');
      document.getElementById('dialog-magaza-expense').close();
      await syncMagazaData();
    } else {
      showToast('Gider eklenemedi: ' + (res ? res.error : ''), 'danger');
    }
  } catch (err) {
    toggleLoading(false);
    showToast('Bağlantı hatası: ' + err.message, 'danger');
  }
}

async function submitMagazaNeed() {
  const desc = document.getElementById('magaza-need-desc').value.trim();
  const amount = document.getElementById('magaza-need-amount').value.trim();
  const urgency = document.getElementById('magaza-need-urgency').value;

  if (!desc || !amount) {
    showToast('Lütfen açıklama ve miktar belirtin.', 'warning');
    return;
  }

  toggleLoading(true, 'İhtiyaç kaydı ekleniyor...');
  try {
    const res = await apiMagazaPost('add_magaza_need', {
      description: desc,
      amount: amount,
      urgency: urgency,
      status: 'Beklemede'
    });
    toggleLoading(false);
    if (res && res.success) {
      showToast('İhtiyaç kaydı başarıyla eklendi!', 'success');
      document.getElementById('dialog-magaza-need').close();
      await syncMagazaData();
    } else {
      showToast('İhtiyaç eklenemedi: ' + (res ? res.error : ''), 'danger');
    }
  } catch (err) {
    toggleLoading(false);
    showToast('Bağlantı hatası: ' + err.message, 'danger');
  }
}

async function submitMagazaCashFlow() {
  const type = document.getElementById('magaza-cash-flow-type').value;
  const amount = document.getElementById('magaza-cash-flow-amount').value;
  const manager = document.getElementById('magaza-cash-flow-manager').value;
  const desc = document.getElementById('magaza-cash-flow-desc').value.trim();
  const date = document.getElementById('magaza-cash-flow-date').value;

  if (!amount || amount <= 0) {
    showToast('Lütfen geçerli bir tutar girin.', 'warning');
    return;
  }

  toggleLoading(true, 'Kasa işlemi kaydediliyor...');
  try {
    const res = await apiMagazaPost('add_magaza_cash_flow', {
      type: type,
      amount: amount,
      manager: type === "Kasadan Devir" ? manager : "",
      description: desc,
      date: date
    });
    toggleLoading(false);
    if (res && res.success) {
      showToast('Kasa işlemi başarıyla kaydedildi!', 'success');
      document.getElementById('dialog-magaza-cash-flow').close();
      await syncMagazaData();
    } else {
      showToast('İşlem kaydedilemedi: ' + (res ? res.error : ''), 'danger');
    }
  } catch (err) {
    toggleLoading(false);
    showToast('Bağlantı hatası: ' + err.message, 'danger');
  }
}

// ==========================================================================
// 7. Event Dinleyicileri & Başlangıç (Event Listeners & Initialization)
// ==========================================================================

function initEventListeners() {
  // Giriş Formu Gönderimi
  document.getElementById('login-form').addEventListener('submit', handleLogin);

  // Çıkış Butonları
  document.getElementById('btn-logout').addEventListener('click', handleLogout);
  document.getElementById('btn-drawer-logout').addEventListener('click', handleLogout);

  // Bağlantı URL Ayar Modalı Aç (Giriş Ekranında)
  document.getElementById('btn-login-settings')?.addEventListener('click', () => {
    document.getElementById('modal-script-url').value = STATE.sheetUrl || DEFAULT_SHEET_URL;
    document.getElementById('dialog-connection-settings').showModal();
  });

  // Varsayılan URL'yi Yükle
  document.getElementById('btn-reset-default-url')?.addEventListener('click', () => {
    document.getElementById('modal-script-url').value = DEFAULT_SHEET_URL;
    showToast('Varsayılan Google Apps Script URL\'si yüklendi.', 'info');
  });

  // Ayarları Kaydet (Giriş Ekranındaki Modal)
  document.getElementById('btn-save-conn-modal').addEventListener('click', async () => {
    const urlInput = document.getElementById('modal-script-url').value.trim();
    if (!urlInput) {
      showToast('Lütfen geçerli bir URL girin.', 'warning');
      return;
    }
    await saveConfig(urlInput);
    document.getElementById('dialog-connection-settings').close();
    showToast('Bağlantı ayarları güncellendi.', 'success');
  });

  // Bağlantı modalından çık
  document.getElementById('btn-close-conn-modal').addEventListener('click', () => {
    document.getElementById('dialog-connection-settings').close();
  });

  // Navigasyon Yönlendirme Dinleyicileri (Sidebar & Drawer & Mobile)
  const navItems = document.querySelectorAll('.nav-item, .drawer-nav-item, .mobile-nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      const target = e.currentTarget.getAttribute('data-target');
      showSection(target);
    });
  });

  // Mobil Menü Hamburger Aç/Kapa
  const drawer = document.getElementById('mobile-drawer');
  document.getElementById('mobile-menu-toggle').addEventListener('click', () => {
    drawer.classList.remove('hidden');
  });
  document.getElementById('drawer-close').addEventListener('click', () => {
    drawer.classList.add('hidden');
  });

  // Envanter Sekmesi Filtreleri ve Arama Dinleyicileri
  document.getElementById('inventory-search').addEventListener('input', debounce(renderInventory, 150));
  document.getElementById('filter-status').addEventListener('change', renderInventory);
  document.getElementById('filter-theme').addEventListener('change', renderInventory);
  document.getElementById('filter-type').addEventListener('change', renderInventory);

  // Envanter Gelişmiş Filtreleri Açma/Kapatma Dinleyicisi
  document.getElementById('btn-toggle-advanced-filters')?.addEventListener('click', () => {
    const advancedRow = document.getElementById('advanced-filters-row');
    const toggleBtn = document.getElementById('btn-toggle-advanced-filters');
    if (advancedRow && toggleBtn) {
      const isHidden = advancedRow.classList.contains('hidden');
      if (isHidden) {
        advancedRow.classList.remove('hidden');
        toggleBtn.textContent = '⚙️ Gelişmiş Filtreleri Gizle';
      } else {
        advancedRow.classList.add('hidden');
        toggleBtn.textContent = '⚙️ Gelişmiş Filtreleri Göster';
      }
    }
  });

  // Envanter Gelişmiş Filtre Dinleyicileri
  document.getElementById('filter-workshop')?.addEventListener('change', renderInventory);
  document.getElementById('filter-personnel')?.addEventListener('change', renderInventory);
  document.getElementById('filter-technique')?.addEventListener('change', renderInventory);
  document.getElementById('filter-material')?.addEventListener('change', renderInventory);
  document.getElementById('filter-stock')?.addEventListener('change', renderInventory);
  document.getElementById('filter-start-date')?.addEventListener('change', renderInventory);



  // Filtrelenmiş Envanter PDF ve E-posta Buton Dinleyicileri
  document.getElementById('btn-filtered-inventory-pdf')?.addEventListener('click', printFilteredInventoryReport);
  document.getElementById('btn-filtered-inventory-mail')?.addEventListener('click', sendFilteredInventoryReportMail);

  const sortSelect = document.getElementById('sort-inventory');
  if (sortSelect) {
    sortSelect.addEventListener('change', renderInventory);
  }

  // Envanter Tablosu Tıklama Delegasyonu (Edit butonu ve tıklanabilir hücreler)
  document.getElementById('inventory-tbody').addEventListener('click', (e) => {
    const editBtn = e.target.closest('.btn-edit');
    const clickableCell = e.target.closest('.clickable-cell');
    if (editBtn || clickableCell) {
      const tr = e.target.closest('tr');
      if (tr) {
        const rowNum = tr.getAttribute('data-row');
        if (rowNum) {
          openEditInventoryModal(rowNum);
        }
      }
    }
  });

  // Envanter Canlı Eşitle Butonu
  document.getElementById('btn-sync-inventory').addEventListener('click', syncAllData);

  // Fotoğraf Kartları Eşitle Butonu
  document.getElementById('btn-sync-photocards').addEventListener('click', syncAllData);

  // Fotoğraf Kartları Arama ve Filtre Dinleyicileri
  document.getElementById('photocards-search').addEventListener('input', debounce(renderPhotoCards, 150));
  document.getElementById('filter-photo-location').addEventListener('change', renderPhotoCards);
  document.getElementById('filter-photo-material').addEventListener('change', renderPhotoCards);

  // Fotoğraf Kartları Gelişmiş Filtreleri Açma/Kapatma Dinleyicisi
  document.getElementById('btn-toggle-photo-advanced-filters')?.addEventListener('click', () => {
    const advancedRow = document.getElementById('photo-advanced-filters-row');
    const toggleBtn = document.getElementById('btn-toggle-photo-advanced-filters');
    if (advancedRow && toggleBtn) {
      const isHidden = advancedRow.classList.contains('hidden');
      if (isHidden) {
        advancedRow.classList.remove('hidden');
        toggleBtn.textContent = '⚙️ Gelişmiş Filtreleri Gizle';
      } else {
        advancedRow.classList.add('hidden');
        toggleBtn.textContent = '⚙️ Gelişmiş Filtreleri Göster';
      }
    }
  });

  // Fotoğraf Kartları Gelişmiş Filtre Dinleyicileri
  document.getElementById('filter-photo-status')?.addEventListener('change', renderPhotoCards);
  document.getElementById('filter-photo-story')?.addEventListener('change', renderPhotoCards);
  document.getElementById('filter-photo-start-date')?.addEventListener('change', renderPhotoCards);
  document.getElementById('filter-photo-end-date')?.addEventListener('change', renderPhotoCards);

  // Fotoğraf Kartı Detay Modal Kapatıcıları
  document.getElementById('btn-close-photo-detail').addEventListener('click', () => document.getElementById('dialog-photo-card-detail').close());
  document.getElementById('btn-close-photo-detail-cross').addEventListener('click', () => document.getElementById('dialog-photo-card-detail').close());

  // Motif Yükleme ve Kaldırma Dinleyicileri
  const uploadMotifBtn = document.getElementById('btn-upload-photo-motif');
  const fileInputMotif = document.getElementById('input-photo-motif');
  const removeMotifBtn = document.getElementById('btn-remove-photo-motif');

  if (uploadMotifBtn && fileInputMotif) {
    uploadMotifBtn.addEventListener('click', () => fileInputMotif.click());
  }

  if (fileInputMotif) {
    fileInputMotif.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const item = STATE.selectedPhotoCardItem;
      if (!item) return;

      const driveId = getLitValueGlobal(item, ['Drive Dosya ID', 'Dosya ID', 'File ID']);
      const shortId = getLitValueGlobal(item, ['ID', 'Kayıt ID', 'id', 'No']) || 'LIT';
      const cardKey = driveId || shortId;

      const motifImgEl = document.getElementById('photo-detail-motif');
      const motifContainerEl = document.getElementById('photo-detail-motif-container');
      const removeBtnEl = document.getElementById('btn-remove-photo-motif');

      // Resim Sıkıştırma & Kayıt
      const reader = new FileReader();
      reader.onload = function (evt) {
        const img = new Image();
        img.onload = function () {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          const maxDim = 600;
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          const base64 = canvas.toDataURL('image/png');

          STATE.motifs[cardKey] = base64;
          saveMotifs().then(() => {
            motifImgEl.src = base64;
            motifContainerEl.classList.remove('hidden');
            removeBtnEl.classList.remove('hidden');
            showToast('Motif görseli başarıyla yüklendi.', 'success');
          }).catch(err => {
            console.error(err);
            showToast('Motif kaydedilirken hata oluştu.', 'danger');
          });
        };
        img.src = evt.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  if (removeMotifBtn) {
    removeMotifBtn.addEventListener('click', () => {
      const item = STATE.selectedPhotoCardItem;
      if (!item) return;

      const driveId = getLitValueGlobal(item, ['Drive Dosya ID', 'Dosya ID', 'File ID']);
      const shortId = getLitValueGlobal(item, ['ID', 'Kayıt ID', 'id', 'No']) || 'LIT';
      const cardKey = driveId || shortId;

      const motifImgEl = document.getElementById('photo-detail-motif');
      const motifContainerEl = document.getElementById('photo-detail-motif-container');
      const removeBtnEl = document.getElementById('btn-remove-photo-motif');
      const fileInputEl = document.getElementById('input-photo-motif');

      delete STATE.motifs[cardKey];
      saveMotifs().then(() => {
        motifImgEl.src = '';
        motifContainerEl.classList.add('hidden');
        removeBtnEl.classList.add('hidden');
        if (fileInputEl) fileInputEl.value = '';
        showToast('Motif kaldırıldı.', 'info');
      }).catch(err => {
        console.error(err);
        showToast('Motif kaldırılırken hata oluştu.', 'danger');
      });
    });
  }

  // Atölye & Personel Dinleyicileri
  document.getElementById('atolye-personnel-search').addEventListener('input', debounce(renderAtolyePersonel, 150));
  document.getElementById('btn-clear-atolye-filter').addEventListener('click', () => {
    STATE.selectedAtolye = null;
    renderAtolyePersonel();
  });
  document.getElementById('btn-sync-atolye-personel').addEventListener('click', syncAllData);
  document.getElementById('btn-close-personnel-detail').addEventListener('click', () => document.getElementById('dialog-personnel-card').close());
  document.getElementById('btn-close-personnel-detail-cross').addEventListener('click', () => document.getElementById('dialog-personnel-card').close());

  // Envanter Düzenleme Buton Kapatıcıları
  document.getElementById('btn-close-edit-inventory').addEventListener('click', () => {
    document.getElementById('dialog-edit-inventory').close();
  });
  document.getElementById('btn-close-edit-inventory-cross').addEventListener('click', () => {
    document.getElementById('dialog-edit-inventory').close();
  });
  document.getElementById('btn-save-inventory').addEventListener('click', saveInventoryEdit);

  // İşlem Durumu rengini değiştirme dinleyicisi
  const editDurumSelect = document.getElementById('edit-durum');
  if (editDurumSelect) {
    editDurumSelect.addEventListener('change', updateEditStatusStyle);
  }

  // Stok Durumu açılır pencere / Diğer seçilince metin kutusu göster/gizle
  const editStokSelect = document.getElementById('edit-stok-select');
  const editStokOther = document.getElementById('edit-stok-other');
  if (editStokSelect && editStokOther) {
    editStokSelect.addEventListener('change', () => {
      if (editStokSelect.value === 'Diğer') {
        editStokOther.style.display = 'block';
        editStokOther.focus();
      } else {
        editStokOther.style.display = 'none';
        editStokOther.value = '';
      }
    });
  }

  // Düzenleme Modalı Drive Link Butonları (Korumalı alanları harici açar)
  document.getElementById('btn-open-drive-form').addEventListener('click', () => {
    const url = document.getElementById('edit-link-form').value;
    openExternal(url);
  });
  document.getElementById('btn-open-drive-image').addEventListener('click', () => {
    const url = document.getElementById('edit-link-image').value;
    openExternal(url);
  });
  document.getElementById('btn-open-bilgi-fisi').addEventListener('click', () => {
    openExternal(document.getElementById('edit-link-info').value.trim());
  });
  document.getElementById('edit-link-info').addEventListener('input', bilgiFisiButonunuGuncelle);
  document.getElementById('btn-envanter-kayit-pdf').addEventListener('click', envanterKaydiPdfKaydet);
  const envanterGorselDosya = document.getElementById('envanter-gorsel-dosya');
  document.getElementById('btn-envanter-gorsel-yukle').addEventListener('click', () => envanterGorselDosya.click());
  document.getElementById('envanter-galeri').addEventListener('click', (e) => {
    const fisBtn = e.target.closest('[data-galeri-fis]');
    if (fisBtn) { envanterGaleriFisYap(fisBtn.dataset.galeriFis, fisBtn); return; }
    const silBtn = e.target.closest('[data-galeri-sil]');
    if (silBtn) envanterGaleriSil(silBtn.dataset.galeriSil, silBtn);
    // Görsele tıklama, genel [data-external-url] dinleyicisiyle Drive'da açılır.
  });
  envanterGorselDosya.addEventListener('change', () => {
    const dosyalar = Array.from(envanterGorselDosya.files);
    envanterGorselDosya.value = ''; // Aynı dosya tekrar seçilebilsin
    envanterGorselYukle(dosyalar);
  });
  document.getElementById('btn-send-inventory-mail').addEventListener('click', async () => {
    const item = STATE.selectedInventoryItem;
    if (!item) {
      showToast('Gönderilecek ürün bilgisi bulunamadı.', 'warning');
      return;
    }

    // Formdaki güncel veya kayıtlı e-postayı varsayılan e-posta olarak belirle
    const inputEmail = document.getElementById('edit-eposta') ? document.getElementById('edit-eposta').value.trim() : '';
    const defaultEmail = inputEmail || item.eposta || '';

    // Her zaman e-posta adresi iste
    const recipient = await showEmailPrompt(defaultEmail, 'Bilgi Fişi Gönder');
    if (recipient === null) return; // Kullanıcı iptal etti
    const emailToUse = recipient.trim();

    if (!emailToUse) {
      showToast('E-posta adresi boş olamaz.', 'warning');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailToUse)) {
      showToast('Lütfen geçerli bir e-posta adresi girin.', 'warning');
      return;
    }

    // Formdaki güncel değerleri çek (kaydetmeden önce gönderilirse güncel veriler gitsin)
    const eserAdiVal = document.getElementById('edit-eser-adi') ? document.getElementById('edit-eser-adi').value.trim() : '';
    const atolyeVal = document.getElementById('edit-atolye') ? document.getElementById('edit-atolye').value.trim() : '';
    const personelVal = document.getElementById('edit-personel') ? document.getElementById('edit-personel').value.trim() : '';
    const malzemeVal = document.getElementById('edit-malzeme') ? document.getElementById('edit-malzeme').value.trim() : '';
    const teknikVal = document.getElementById('edit-teknik') ? document.getElementById('edit-teknik').value.trim() : '';
    const aciklamaVal = document.getElementById('edit-aciklama') ? document.getElementById('edit-aciklama').value.trim() : '';
    const hikayeVal = document.getElementById('edit-hikaye') ? document.getElementById('edit-hikaye').value.trim() : '';

    toggleLoading(true, 'E-posta gönderiliyor...');
    try {
      const res = await apiPost('send_envanter_mail', {
        recipient: emailToUse,
        envanterNo: item.envanterNo || '',
        eserAdi: eserAdiVal || item.eserAdi || '',
        atolye: atolyeVal || item.atolye || '',
        personel: personelVal || item.personel || '',
        linkInfo: item.linkInfo || '',
        linkImage: item.linkImage || '',
        malzeme: malzemeVal || item.malzeme || '',
        teknik: teknikVal || item.teknik || '',
        aciklama: aciklamaVal || item.aciklama || '',
        hikaye: hikayeVal || item.hikaye || ''
      });

      toggleLoading(false);
      if (res && res.success) {
        showToast('Bilgi fişi başarıyla e-posta olarak gönderildi.', 'success');
      } else {
        showToast('Hata: ' + (res ? res.error : 'E-posta gönderilemedi.'), 'danger');
      }
    } catch (err) {
      toggleLoading(false);
      showToast('Hata: ' + err.message, 'danger');
    }
  });
  document.getElementById('btn-open-drive-web').addEventListener('click', () => {
    const url = document.getElementById('edit-link-web').value;
    openExternal(url);
  });

  // Personel Arama Filtresi
  document.getElementById('personnel-search').addEventListener('input', debounce(renderPersonnel, 150));

  // Personel Sekmesi Tarih Filtreleri
  const startFilter = document.getElementById('personnel-filter-start');
  const endFilter = document.getElementById('personnel-filter-end');
  const clearDateBtn = document.getElementById('btn-clear-personnel-date');
  if (startFilter && endFilter) {
    startFilter.addEventListener('change', renderPersonnel);
    endFilter.addEventListener('change', renderPersonnel);
  }
  if (clearDateBtn) {
    clearDateBtn.addEventListener('click', () => {
      if (startFilter) startFilter.value = '';
      if (endFilter) endFilter.value = '';
      renderPersonnel();
    });
  }

  // Personel Ürünleri Tablosu Tıklama Delegasyonu (Envanter numarasına tıklanıldığında modal açar)
  const personnelProductsTbody = document.getElementById('personnel-products-tbody');
  if (personnelProductsTbody) {
    personnelProductsTbody.addEventListener('click', (e) => {
      const clickableCell = e.target.closest('.clickable-cell');
      if (clickableCell) {
        const rowNum = clickableCell.getAttribute('data-row');
        if (rowNum) {
          openEditInventoryModal(rowNum);
        }
      }
    });
  }

  // Personel İçi Sekme Geçişi
  document.querySelectorAll('.tab-mini').forEach(tab => {
    tab.addEventListener('click', (e) => {
      const parent = e.target.parentElement;
      parent.querySelectorAll('.tab-mini').forEach(t => t.classList.remove('active'));
      e.target.classList.add('active');

      const tabTarget = e.target.getAttribute('data-tab');
      const container = e.target.closest('#personnel-details-card');
      container.querySelectorAll('.tab-mini-content').forEach(c => c.classList.remove('active'));
      container.querySelector(`#tab-${tabTarget}`).classList.add('active');
    });
  });

  // Raporlar Sekmesi Butonları
  document.getElementById('btn-export-csv').addEventListener('click', exportInventoryToCSV);

  // Literatür Sekmesi Ekleme Butonu (Google Form Yönlendirmesi)
  document.getElementById('btn-add-literature').addEventListener('click', () => {
    if (STATE.literaturFormUrl) {
      openExternal(STATE.literaturFormUrl);
    } else {
      showToast('Literatür kayıt form linki ayarlanmamış. Lütfen Ayarlar sekmesinden tanımlayın.', 'warning');
    }
  });
  document.getElementById('btn-close-literature').addEventListener('click', () => {
    document.getElementById('dialog-literature').close();
  });
  document.getElementById('btn-close-literature-cross').addEventListener('click', () => {
    document.getElementById('dialog-literature').close();
  });
  document.getElementById('btn-save-literature').addEventListener('click', saveLiterature);
  document.getElementById('literature-search').addEventListener('input', debounce(renderLiterature, 150));

  // ---- EĞİTİM YÖNETİMİ dinleyicileri ----
  document.getElementById('btn-add-egitim')?.addEventListener('click', openAddEgitimModal);
  document.getElementById('btn-sync-egitim')?.addEventListener('click', async () => {
    toggleLoading(true, 'Eğitim kayıtları yenileniyor...');
    await syncAllData(true);
    toggleLoading(false);
    renderEgitim();
    showToast('Eğitim kayıtları güncellendi.', 'success');
  });
  document.getElementById('btn-export-egitim-pdf')?.addEventListener('click', exportEgitimPdf);
  document.getElementById('btn-save-egitim')?.addEventListener('click', saveEgitim);
  document.getElementById('btn-close-egitim')?.addEventListener('click', () => document.getElementById('dialog-egitim').close());
  document.getElementById('btn-close-egitim-cross')?.addEventListener('click', () => document.getElementById('dialog-egitim').close());
  document.getElementById('btn-delete-egitim')?.addEventListener('click', () => {
    const rn = document.getElementById('egitim-row-num').value;
    const id = document.getElementById('egitim-id').value;
    if (rn) deleteEgitim(rn, id);
  });
  document.getElementById('egitim-search')?.addEventListener('input', debounce(renderEgitim, 150));
  document.getElementById('filter-egitim-atolye')?.addEventListener('change', renderEgitim);
  document.getElementById('filter-egitim-veren')?.addEventListener('change', renderEgitim);
  document.getElementById('filter-egitim-durum')?.addEventListener('change', renderEgitim);
  // Çoklu katılımcı: ekle butonu + satır çıkarma (delege)
  document.getElementById('btn-egitim-add-katilimci')?.addEventListener('click', () => egitimKatilimciEkle({}));
  document.getElementById('egitim-katilimci-list')?.addEventListener('click', (e) => {
    const rm = e.target.closest('.ek-remove');
    if (rm) { rm.closest('.egitim-katilimci-row')?.remove(); egitimKatilimciRemoveGorunurluk(); }
  });
  // Tablo satır aksiyonları (delege)
  document.getElementById('egitim-tbody')?.addEventListener('click', (e) => {
    // 📚 Bu eğitimin materyalleri: Materyaller sekmesini o kursa süzülmüş açar
    const matBtn = e.target.closest('[data-egitim-materyal]');
    if (matBtn) { egitimMateryalleriniAc(matBtn.getAttribute('data-egitim-materyal')); return; }
    const pdfBtn = e.target.closest('[data-egitim-pdf]');
    if (pdfBtn) { generateEgitimConsentPdf(pdfBtn.getAttribute('data-egitim-pdf')); return; }
    const mailBtn = e.target.closest('[data-egitim-mail]');
    if (mailBtn) { sendEgitimKatilimciMail(mailBtn.getAttribute('data-egitim-mail')); return; }
    const editBtn = e.target.closest('[data-egitim-edit]');
    if (editBtn) { openEditEgitimModal(editBtn.getAttribute('data-egitim-edit')); return; }
    const delBtn = e.target.closest('[data-egitim-del]');
    if (delBtn) { deleteEgitim(delBtn.getAttribute('data-egitim-del'), delBtn.getAttribute('data-egitim-id') || ''); return; }
  });

  // ---- PROFİL AVATARI dinleyicileri ----
  document.getElementById('user-avatar-initial')?.addEventListener('click', openAvatarModal);
  document.getElementById('btn-save-avatar')?.addEventListener('click', saveAvatar);
  document.getElementById('btn-close-avatar')?.addEventListener('click', () => document.getElementById('dialog-avatar').close());
  document.getElementById('btn-close-avatar-cross')?.addEventListener('click', () => document.getElementById('dialog-avatar').close());
  document.getElementById('btn-avatar-clear')?.addEventListener('click', () => {
    STATE._avatarDraft = '';
    document.querySelectorAll('#avatar-grid .avatar-option.selected').forEach(o => o.classList.remove('selected'));
    updateAvatarPreview();
  });
  document.getElementById('avatar-grid')?.addEventListener('click', (e) => {
    const opt = e.target.closest('.avatar-option');
    if (!opt) return;
    STATE._avatarDraft = opt.getAttribute('data-emoji') || '';
    document.querySelectorAll('#avatar-grid .avatar-option.selected').forEach(o => o.classList.remove('selected'));
    opt.classList.add('selected');
    updateAvatarPreview();
  });

  // ---- YEDEKLEME dinleyicileri ----
  document.getElementById('btn-yedek-simdi')?.addEventListener('click', yedekSimdiAl);
  document.getElementById('btn-yedek-indir')?.addEventListener('click', yedekBilgisayaraIndir);

  document.getElementById('btn-open-literature-sheet')?.addEventListener('click', () => {
    if (STATE.settings && STATE.settings.literaturTableUrl) {
      openExternal(STATE.settings.literaturTableUrl);
    } else {
      showToast('E-Tablo linki Ayarlar sekmesinde tanımlanmamış.', 'warning');
    }
  });

  document.getElementById('btn-sync-literature')?.addEventListener('click', () => syncAllData(false));

  document.getElementById('btn-toggle-literature-advanced-filters')?.addEventListener('click', () => {
    const advancedRow = document.getElementById('literature-advanced-filters-row');
    const toggleBtn = document.getElementById('btn-toggle-literature-advanced-filters');
    if (advancedRow && toggleBtn) {
      const isHidden = advancedRow.classList.contains('hidden');
      if (isHidden) {
        advancedRow.classList.remove('hidden');
        toggleBtn.textContent = '⚙️ Filtreleme Seçeneklerini Gizle';
      } else {
        advancedRow.classList.add('hidden');
        toggleBtn.textContent = '⚙️ Filtreleme Seçeneklerini Göster';
      }
    }
  });

  document.getElementById('filter-lit-location')?.addEventListener('change', renderLiterature);
  document.getElementById('filter-lit-personnel')?.addEventListener('change', renderLiterature);
  document.getElementById('filter-lit-start-date')?.addEventListener('change', renderLiterature);
  document.getElementById('filter-lit-end-date')?.addEventListener('change', renderLiterature);

  // Kullanıcı Yönetimi Butonları
  document.getElementById('btn-add-user').addEventListener('click', openAddUserModal);
  document.getElementById('btn-close-user').addEventListener('click', () => {
    document.getElementById('dialog-user').close();
  });
  document.getElementById('btn-close-user-cross').addEventListener('click', () => {
    document.getElementById('dialog-user').close();
  });
  document.getElementById('btn-save-user').addEventListener('click', saveUser);
  document.getElementById('btn-delete-user').addEventListener('click', deleteUser);

  // Rol Değişimi Dinleyicisi
  document.getElementById('user-role').addEventListener('change', (e) => {
    const selectedRole = e.target.value;
    const checkboxes = document.querySelectorAll('.permissions-checklist input[type="checkbox"]');
    if (selectedRole === 'admin') {
      checkboxes.forEach(cb => {
        cb.checked = true;
        cb.disabled = true;
      });
    } else {
      checkboxes.forEach(cb => {
        cb.disabled = false;
      });
    }
  });

  // Ayarlar Sekmesi Butonları
  document.getElementById('btn-save-settings').addEventListener('click', async () => {
    // Form STATE'ten hic doldurulmadiysa kaydetme: bos alanlar kayitli linkleri silerdi.
    if (!settingsFormPopulated) {
      showToast('Ayarlar henüz yüklenmedi. Kayıtlı bağlantıların silinmemesi için kaydetme iptal edildi. Lütfen uygulamayı yeniden başlatın.', 'danger');
      return;
    }

    // Kullanicinin kasitli olarak bosalttigi, ONCEDEN DOLU olan alanlari tespit et.
    const clearedFields = SETTINGS_FIELD_MAP.filter(({ id, key }) => {
      const el = document.getElementById(id);
      return el && !el.value.trim() && STATE[key];
    });
    if (clearedFields.length) {
      const names = clearedFields.map(f => '• ' + f.label).join('\n');
      if (!confirm('Aşağıdaki kayıtlı bağlantılar silinecek:\n\n' + names + '\n\nDevam edilsin mi?')) {
        return;
      }
    }
    STATE.clearedConfigFields = clearedFields.map(f => f.key);

    const url = document.getElementById('settings-script-url').value.trim();
    const magazaUrl = document.getElementById('settings-magaza-script-url').value.trim();
    const envUrl = document.getElementById('settings-envanter-table-url').value.trim();
    const litUrl = document.getElementById('settings-literatur-table-url').value.trim();
    const magTableUrl = document.getElementById('settings-magaza-table-url').value.trim();
    const litFormUrl = document.getElementById('settings-literatur-form-url').value.trim();
    const litScriptUrl = document.getElementById('settings-literatur-script-url').value.trim();
    const photocardsTableUrl = document.getElementById('settings-photocards-table-url').value.trim();
    const photocardsScriptUrl = document.getElementById('settings-photocards-script-url').value.trim();
    // Alan arayüzde yoksa undefined gönderilir; aksi halde kayıtlı URL sessizce silinir
    const projeTableUrl = (document.getElementById('settings-proje-table-url') ? document.getElementById('settings-proje-table-url').value.trim() : undefined);
    const projeScriptUrl = (document.getElementById('settings-proje-script-url') ? document.getElementById('settings-proje-script-url').value.trim() : undefined);
    const mesajlarScriptUrl = (document.getElementById('settings-mesajlar-script-url') ? document.getElementById('settings-mesajlar-script-url').value.trim() : undefined);
    const soundTheme = document.getElementById('settings-sound-theme') ? document.getElementById('settings-sound-theme').value : 'modern';
    const soundVolume = document.getElementById('settings-sound-volume') ? parseInt(document.getElementById('settings-sound-volume').value, 10) : 60;

    if (!url) {
      showToast('Lütfen geçerli bir URL girin.', 'warning');
      return;
    }

    // Google Sheets ve Apps Script URL'lerinin yanlış girilmesini önleme doğrulaması
    const scriptUrls = [
      { name: 'Ana Envanter', url: url },
      { name: 'Mağaza', url: magazaUrl },
      { name: 'Literatür', url: litScriptUrl },
      { name: 'Fotoğraf Kartları', url: photocardsScriptUrl },
      { name: 'Proje Takip', url: projeScriptUrl },
      { name: 'Mesajlaşma', url: mesajlarScriptUrl }
    ];
    for (const item of scriptUrls) {
      if (item.url && (item.url.includes('docs.google.com') || item.url.includes('spreadsheets'))) {
        showToast(`HATA: "${item.name} Apps Script Web App URL" alanına doğrudan E-Tablo linki girilmiş! Buraya script.google.com ile başlayan Web Uygulaması Dağıtım linkini girmelisiniz.`, 'danger');
        return;
      }
    }

    await saveConfig(url, magazaUrl, envUrl, litUrl, magTableUrl, litFormUrl, litScriptUrl, photocardsTableUrl, photocardsScriptUrl, projeTableUrl, projeScriptUrl, soundTheme, soundVolume, { mesajlarSheetUrl: mesajlarScriptUrl });
    showToast('Ayarlar başarıyla kaydedildi.', 'success');
  });

  document.getElementById('btn-test-connection').addEventListener('click', async () => {
    const url = document.getElementById('settings-script-url').value.trim();
    if (!url) {
      showToast('Öncelikle bir URL girin.', 'warning');
      return;
    }

    toggleLoading(true, 'Google Apps Script bağlantısı test ediliyor...');
    try {
      const res = await fetch(`${url}?action=test`);
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (jsonErr) {
        if (text.includes('doGet') || text.includes('Komut dosyası işlevi bulunamadı') || text.includes('Script function not found')) {
          throw new Error('Google Apps Script web uygulamasında "doGet" fonksiyonu bulunamadı. Lütfen kodları kaydedip "Dağıtımları Yönet" kısmından YENİ SÜRÜM (New Version) olarak tekrar dağıtın.');
        }
        throw new Error('Sunucu JSON yerine HTML/Hata sayfası döndürdü. Apps Script web uygulamasının doğru dağıtıldığından emin olun.');
      }
      toggleLoading(false);
      if (data && data.success) {
        showToast('Bağlantı Başarılı! E-Tablo entegrasyonu kuruldu.', 'success');
      } else {
        showToast('Bağlantı hatası: Geçersiz yanıt.', 'danger');
      }
    } catch (err) {
      toggleLoading(false);
      showToast('Bağlantı testi başarısız oldu: ' + err.message, 'danger');
    }
  });

  document.getElementById('btn-clear-cache').addEventListener('click', async () => {
    if (!confirm('Yerel önbellek verileri ve bağlantı ayarları silinsin mi?')) return;

    if (window.api && window.api.isElectron) {
      await window.api.writeLocalCache('config.json', null);
      await window.api.writeLocalCache('data_cache.json', null);
    } else {
      localStorage.clear();
    }

    showToast('Önbellek temizlendi. Uygulama yeniden başlatılıyor.', 'success');
    setTimeout(() => window.location.reload(), 1500);
  });

  // Entegrasyon Yardım Kılavuzu Butonları
  document.getElementById('btn-show-help').addEventListener('click', () => {
    document.getElementById('dialog-script-help').showModal();
  });
  document.getElementById('btn-close-script-help').addEventListener('click', () => {
    document.getElementById('dialog-script-help').close();
  });
  document.getElementById('btn-close-script-help-ok').addEventListener('click', () => {
    document.getElementById('dialog-script-help').close();
  });

  // Literatür Alt Sekme Geçişleri
  document.querySelectorAll('#literatur-view .btn-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      document.querySelectorAll('#literatur-view .btn-tab').forEach(t => t.classList.remove('active'));
      e.currentTarget.classList.add('active');

      const targetSub = e.currentTarget.getAttribute('data-subtarget');
      document.querySelectorAll('#literatur-view .literatur-sub-view').forEach(view => {
        view.classList.add('hidden');
        view.classList.remove('active');
      });
      const targetView = document.getElementById(targetSub);
      if (targetView) {
        targetView.classList.remove('hidden');
        targetView.classList.add('active');
      }

      // Eğer fotoğraf kartları alt sekmesi açılıyorsa render et
      if (targetSub === 'literatur-photocards-subview') {
        renderPhotoCards();
      }
      if (targetSub === 'literatur-prototip-subview') {
        syncPrototipler(true);
      }
      if (targetSub === 'literatur-koruma-subview') {
        renderKoruma();
        syncKoruma(true);
      }
    });
  });

  // ==========================================
  // MAĞAZA EVENT DINLEYICILERI
  // ==========================================
  // Mağaza Alt Sekme Geçişleri
  document.querySelectorAll('#magaza-view .btn-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      document.querySelectorAll('#magaza-view .btn-tab').forEach(t => t.classList.remove('active'));
      e.currentTarget.classList.add('active');

      const targetSub = e.currentTarget.getAttribute('data-subtarget');
      document.querySelectorAll('#magaza-view .magaza-sub-view').forEach(view => {
        view.classList.add('hidden');
        view.classList.remove('active');
      });
      const targetView = document.getElementById(targetSub);
      if (targetView) {
        targetView.classList.remove('hidden');
        targetView.classList.add('active');
      }

      if (targetSub === 'magaza-quick-sale-tab') {
        populateSalespersonsDropdown('quick-sale-person');
        populateQuickSaleInventoryDropdown();
        updateQuickSaleTotalPrice();
      }
      if (targetSub === 'magaza-eticaret-tab') {
        renderEticaret();
        sekmeTazele('eticaret', () => syncEticaret(true));
        if (STATE.currentUser && STATE.currentUser.role === 'admin') renderKargoAyarlari();
      }
    });
  });

  // Initialize Quick Sale handlers
  initQuickSaleHandlers();

  // E-Ticaret ve lojistik modülü; hata verirse mağaza dinleyicileri bozulmasın
  try {
    initEticaret();
  } catch (err) {
    console.error('E-Ticaret modulu baslatilamadi:', err);
  }  // Arama & Filtreleme Dinleyicileri
  document.getElementById('magaza-stock-search').addEventListener('input', debounce(renderMagazaStockTable, 150));
  document.getElementById('magaza-stock-filter-status').addEventListener('change', renderMagazaStockTable);

  // Daily Cash Filtreleri Dinleyicileri
  document.getElementById('magaza-cash-search').addEventListener('input', debounce(renderMagazaCashTable, 150));
  document.getElementById('magaza-cash-filter-payment').addEventListener('change', renderMagazaCashTable);
  document.getElementById('magaza-cash-filter-type').addEventListener('change', renderMagazaCashTable);
  document.getElementById('magaza-cash-start-date').addEventListener('change', renderMagazaCashTable);
  document.getElementById('magaza-cash-end-date').addEventListener('change', renderMagazaCashTable);

  // Buton Dinleyicileri (Sync & Stoğa Çek)
  document.getElementById('btn-sync-magaza').addEventListener('click', syncMagazaData);
  document.getElementById('btn-magaza-pull-stock').addEventListener('click', pullNewInventoryToStock);

  // Stok Tablosu Tıklama Delegasyonu (Satış Yap, Düzenle, ve Detay Modalı)
  document.getElementById('magaza-stock-tbody').addEventListener('click', (e) => {
    const sellBtn = e.target.closest('.btn-magaza-sell-item');
    const editBtn = e.target.closest('.btn-magaza-edit-item');
    const clickableCell = e.target.closest('.clickable-cell');

    if (sellBtn) {
      const rowNum = sellBtn.getAttribute('data-row');
      openMagazaSaleModal(rowNum);
    } else if (editBtn) {
      const rowNum = editBtn.getAttribute('data-row');
      openMagazaStockEditModal(rowNum);
    } else if (clickableCell) {
      const tr = e.target.closest('tr');
      if (tr) {
        const rowNum = tr.getAttribute('data-row');
        if (rowNum) {
          const writePermission = STATE.currentUser && (STATE.currentUser.role === 'admin' || STATE.currentUser.role === 'editor');
          if (writePermission) {
            openMagazaStockEditModal(rowNum);
          } else {
            openMagazaProductDetailModal(rowNum);
          }
        }
      }
    }
  });

  // Kasa Satış Modalı Dinleyicileri
  document.getElementById('btn-close-magaza-sale').addEventListener('click', () => document.getElementById('dialog-magaza-sale').close());
  document.getElementById('btn-close-magaza-sale-cross').addEventListener('click', () => document.getElementById('dialog-magaza-sale').close());
  document.getElementById('btn-confirm-magaza-sale').addEventListener('click', submitMagazaSale);

  const magazaSaleTypeSelect = document.getElementById('magaza-sale-type');
  if (magazaSaleTypeSelect) {
    magazaSaleTypeSelect.addEventListener('change', () => {
      const saleType = magazaSaleTypeSelect.value;
      const originalPrice = parseFloat(STATE.currentSaleItemOriginalPrice || 0);
      const priceInput = document.getElementById('magaza-sale-price');
      const paymentSelect = document.getElementById('magaza-sale-payment');

      if (saleType === 'tam-fiyat') {
        priceInput.value = originalPrice || '';
      } else if (saleType === 'nakit-10-indirim') {
        priceInput.value = originalPrice ? (originalPrice * 0.9).toFixed(2) : '0.00';
        paymentSelect.value = 'Nakit';
      } else if (saleType === 'indirimli') {
        priceInput.value = originalPrice || '';
        priceInput.focus();
        priceInput.select();
      }
    });
  }

  // Stok Düzenleme Modalı Dinleyicileri
  document.getElementById('btn-close-magaza-stock-edit').addEventListener('click', () => document.getElementById('dialog-magaza-stock-edit').close());
  document.getElementById('btn-close-magaza-stock-edit-cross').addEventListener('click', () => document.getElementById('dialog-magaza-stock-edit').close());
  document.getElementById('btn-save-magaza-stock-edit').addEventListener('click', submitMagazaStockEdit);

  // Gider Modalı Dinleyicileri
  document.getElementById('btn-magaza-add-expense').addEventListener('click', () => {
    document.getElementById('magaza-expense-form').reset();
    populateAllPersonnelDropdown('magaza-expense-payer');
    document.getElementById('dialog-magaza-expense').showModal();
  });
  document.getElementById('btn-close-magaza-expense').addEventListener('click', () => document.getElementById('dialog-magaza-expense').close());
  document.getElementById('btn-close-magaza-expense-cross').addEventListener('click', () => document.getElementById('dialog-magaza-expense').close());
  document.getElementById('btn-save-magaza-expense').addEventListener('click', submitMagazaExpense);

  // İhtiyaç Modalı Dinleyicileri
  document.getElementById('btn-magaza-add-need').addEventListener('click', () => {
    document.getElementById('magaza-need-form').reset();
    document.getElementById('dialog-magaza-need').showModal();
  });
  document.getElementById('btn-close-magaza-need').addEventListener('click', () => document.getElementById('dialog-magaza-need').close());
  document.getElementById('btn-close-magaza-need-cross').addEventListener('click', () => document.getElementById('dialog-magaza-need').close());
  document.getElementById('btn-save-magaza-need').addEventListener('click', submitMagazaNeed);

  // Kasa İşlem / Devir Modalı Dinleyicileri
  document.getElementById('btn-magaza-add-cash-flow').addEventListener('click', () => {
    document.getElementById('magaza-cash-flow-form').reset();
    document.getElementById('magaza-cash-flow-date').value = new Date().toISOString().split('T')[0];
    populateManagersDropdown('magaza-cash-flow-manager');
    document.getElementById('group-cash-flow-manager').style.display = 'block';
    document.getElementById('dialog-magaza-cash-flow').showModal();
  });
  document.getElementById('btn-close-magaza-cash-flow').addEventListener('click', () => document.getElementById('dialog-magaza-cash-flow').close());
  document.getElementById('btn-close-magaza-cash-flow-cross').addEventListener('click', () => document.getElementById('dialog-magaza-cash-flow').close());
  document.getElementById('btn-save-magaza-cash-flow').addEventListener('click', submitMagazaCashFlow);
  document.getElementById('magaza-cash-flow-type').addEventListener('change', (e) => {
    const mgrGroup = document.getElementById('group-cash-flow-manager');
    if (e.target.value === 'Kasadan Devir') {
      mgrGroup.style.display = 'block';
    } else {
      mgrGroup.style.display = 'none';
    }
  });

  // Ürün Detay Modalı Dinleyicileri
  document.getElementById('btn-close-magaza-detail').addEventListener('click', () => document.getElementById('dialog-magaza-product-detail').close());
  document.getElementById('btn-close-magaza-detail-cross').addEventListener('click', () => document.getElementById('dialog-magaza-product-detail').close());

  // İhtiyaç Tablosu Tıklama Delegasyonu (Alındı / İptal)
  document.getElementById('magaza-needs-tbody').addEventListener('click', async (e) => {
    const completeBtn = e.target.closest('.btn-need-complete');
    const cancelBtn = e.target.closest('.btn-need-cancel');
    if (!completeBtn && !cancelBtn) return;

    const rowNum = (completeBtn || cancelBtn).getAttribute('data-row');
    const newStatus = completeBtn ? 'Alındı' : 'İptal';

    toggleLoading(true, 'İhtiyaç durumu güncelleniyor...');
    try {
      const res = await apiMagazaPost('update_magaza_need', {
        _rowNum: rowNum,
        status: newStatus
      });
      toggleLoading(false);
      if (res && res.success) {
        showToast(`İhtiyaç durumu '${newStatus}' olarak güncellendi.`, 'success');
        await syncMagazaData();
      } else {
        showToast('Güncelleme başarısız: ' + (res ? res.error : ''), 'danger');
      }
    } catch (err) {
      toggleLoading(false);
      showToast('Bağlantı hatası: ' + err.message, 'danger');
    }
  });

  // Mağaza Bağlantı Testi Butonu
  document.getElementById('btn-test-magaza-connection').addEventListener('click', async () => {
    const url = document.getElementById('settings-magaza-script-url').value.trim();
    if (!url) {
      showToast('Öncelikle Mağaza Apps Script URL girin.', 'warning');
      return;
    }

    toggleLoading(true, 'Mağaza Google Apps Script bağlantısı test ediliyor...');
    try {
      const res = await fetch(`${url}?action=test`);
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (jsonErr) {
        if (text.includes('doGet') || text.includes('Komut dosyası işlevi bulunamadı') || text.includes('Script function not found')) {
          throw new Error('Google Apps Script web uygulamasında "doGet" fonksiyonu bulunamadı. Lütfen kodları kaydedip "Dağıtımları Yönet" kısmından YENİ SÜRÜM (New Version) olarak tekrar dağıtın.');
        }
        throw new Error('Sunucu JSON yerine HTML/Hata sayfası döndürdü. Apps Script web uygulamasının doğru dağıtıldığından emin olun.');
      }
      toggleLoading(false);
      if (data && data.success) {
        showToast('Mağaza bağlantısı Başarılı! E-Tablo entegrasyonu kuruldu.', 'success');
      } else {
        showToast('Mağaza bağlantı hatası: Geçersiz yanıt.', 'danger');
      }
    } catch (err) {
      toggleLoading(false);
      showToast('Mağaza bağlantı testi başarısız oldu: ' + err.message, 'danger');
    }
  });

  // Literatür Bağlantı Testi Butonu
  document.getElementById('btn-test-literatur-connection').addEventListener('click', async () => {
    const url = document.getElementById('settings-literatur-script-url').value.trim();
    if (!url) {
      showToast('Öncelikle Literatür Apps Script URL girin.', 'warning');
      return;
    }

    toggleLoading(true, 'Literatür Google Apps Script bağlantısı test ediliyor...');
    try {
      const res = await fetch(`${url}?action=test`);
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (jsonErr) {
        if (text.includes('doGet') || text.includes('Komut dosyası işlevi bulunamadı') || text.includes('Script function not found')) {
          throw new Error('Google Apps Script web uygulamasında "doGet" fonksiyonu bulunamadı. Lütfen kodları kaydedip "Dağıtımları Yönet" kısmından YENİ SÜRÜM (New Version) olarak tekrar dağıtın.');
        }
        throw new Error('Sunucu JSON yerine HTML/Hata sayfası döndürdü. Apps Script web uygulamasının doğru dağıtıldığından emin olun.');
      }
      toggleLoading(false);
      if (data && data.success) {
        showToast('Literatür bağlantısı Başarılı! E-Tablo entegrasyonu kuruldu.', 'success');
      } else {
        showToast('Literatür bağlantı hatası: Geçersiz yanıt.', 'danger');
      }
    } catch (err) {
      toggleLoading(false);
      showToast('Literatür bağlantı testi başarısız oldu: ' + err.message, 'danger');
    }
  });

  // Fotoğraf Kartları Bağlantı Testi Butonu
  document.getElementById('btn-test-photocards-connection').addEventListener('click', async () => {
    const url = document.getElementById('settings-photocards-script-url').value.trim();
    if (!url) {
      showToast('Öncelikle Fotoğraf Kartları Apps Script URL girin.', 'warning');
      return;
    }

    toggleLoading(true, 'Fotoğraf Kartları Google Apps Script bağlantısı test ediliyor...');
    try {
      const res = await fetch(`${url}?action=test`);
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (jsonErr) {
        if (text.includes('doGet') || text.includes('Komut dosyası işlevi bulunamadı') || text.includes('Script function not found')) {
          throw new Error('Google Apps Script web uygulamasında "doGet" fonksiyonu bulunamadı. Lütfen kodları kaydedip "Dağıtımları Yönet" kısmından YENİ SÜRÜM (New Version) olarak tekrar dağıtın.');
        }
        throw new Error('Sunucu JSON yerine HTML/Hata sayfası döndürdü. Apps Script web uygulamasının doğru dağıtıldığından emin olun.');
      }
      toggleLoading(false);
      if (data && data.success) {
        showToast('Fotoğraf Kartları bağlantısı Başarılı! E-Tablo entegrasyonu kuruldu.', 'success');
      } else {
        showToast('Fotoğraf Kartları bağlantı hatası: Geçersiz yanıt.', 'danger');
      }
    } catch (err) {
      toggleLoading(false);
      showToast('Fotoğraf Kartları bağlantı testi başarısız oldu: ' + err.message, 'danger');
    }
  });

  // Proje Takip Bağlantı Testi Butonu
  document.getElementById('btn-test-proje-connection')?.addEventListener('click', async () => {
    const url = document.getElementById('settings-proje-script-url').value.trim();
    if (!url) {
      showToast('Öncelikle Proje Takip Apps Script URL girin.', 'warning');
      return;
    }

    toggleLoading(true, 'Proje Takip Google Apps Script bağlantısı test ediliyor...');
    try {
      const res = await fetch(`${url}?action=test`);
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (jsonErr) {
        if (text.includes('doGet') || text.includes('Komut dosyası işlevi bulunamadı') || text.includes('Script function not found')) {
          throw new Error('Google Apps Script web uygulamasında "doGet" fonksiyonu bulunamadı. Lütfen kodları kaydedip "Dağıtımları Yönet" kısmından YENİ SÜRÜM (New Version) olarak tekrar dağıtın.');
        }
        throw new Error('Sunucu JSON yerine HTML/Hata sayfası döndürdü. Apps Script web uygulamasının doğru dağıtıldığından emin olun.');
      }
      toggleLoading(false);
      if (data && data.success) {
        showToast('Proje Takip bağlantısı Başarılı! E-Tablo entegrasyonu kuruldu.', 'success');
      } else {
        showToast('Proje Takip bağlantı hatası: Geçersiz yanıt.', 'danger');
      }
    } catch (err) {
      toggleLoading(false);
      showToast('Proje Takip bağlantı testi başarısız oldu: ' + err.message, 'danger');
    }
  });

  // Mesajlaşma Bağlantı Testi Butonu
  document.getElementById('btn-test-mesajlar-connection')?.addEventListener('click', async () => {
    const url = document.getElementById('settings-mesajlar-script-url').value.trim();
    if (!url) {
      showToast('Öncelikle Mesajlaşma Apps Script URL girin.', 'warning');
      return;
    }

    toggleLoading(true, 'Mesajlaşma Google Apps Script bağlantısı test ediliyor...');
    try {
      const res = await fetch(`${url}?action=test`);
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (jsonErr) {
        if (text.includes('doGet') || text.includes('Komut dosyası işlevi bulunamadı') || text.includes('Script function not found')) {
          throw new Error('Google Apps Script web uygulamasında "doGet" fonksiyonu bulunamadı. Lütfen kodları kaydedip "Dağıtımları Yönet" kısmından YENİ SÜRÜM (New Version) olarak tekrar dağıtın.');
        }
        throw new Error('Sunucu JSON yerine HTML/Hata sayfası döndürdü. Apps Script web uygulamasının doğru dağıtıldığından emin olun.');
      }
      toggleLoading(false);
      if (data && data.success) {
        // Sayılar, kullanıcının doğru e-tabloya bağlandığını görmesi için
        const detay = (data.messageCount !== undefined)
          ? ` ${data.messageCount} mesaj, ${data.onlineCount || 0} kullanıcı çevrim içi.`
          : '';
        showToast('Mesajlaşma bağlantısı Başarılı!' + detay, 'success');
      } else {
        showToast('Mesajlaşma bağlantı hatası: ' + ((data && data.error) || 'Geçersiz yanıt.'), 'danger');
      }
    } catch (err) {
      toggleLoading(false);
      showToast('Mesajlaşma bağlantı testi başarısız oldu: ' + err.message, 'danger');
    }
  });


  // ==========================================
  // AYARLAR ALT SEKMELERİ + SİBER GÜVENLİK PANELİ
  // ==========================================
  document.querySelectorAll('#ayarlar-view .btn-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      document.querySelectorAll('#ayarlar-view .btn-tab').forEach(t => t.classList.remove('active'));
      e.currentTarget.classList.add('active');

      const hedef = e.currentTarget.getAttribute('data-subtarget');
      document.querySelectorAll('#ayarlar-view .ayarlar-sub-view').forEach(v => {
        v.classList.add('hidden');
        v.classList.remove('active');
      });
      const gorunum = document.getElementById(hedef);
      if (gorunum) {
        gorunum.classList.remove('hidden');
        gorunum.classList.add('active');
      }

      // Güvenlik sekmesi ilk kez açıldığında denetimi kendiliğinden başlat
      if (hedef === 'ayarlar-guvenlik-subview') {
        guvenlikAnahtarFormuDoldur();
        const liste = document.getElementById('guvenlik-liste');
        if (liste && liste.querySelector('.guvenlik-bos')) guvenlikDenetimiCalistir();
      }
    });
  });

  document.getElementById('btn-guvenlik-tara')?.addEventListener('click', guvenlikDenetimiCalistir);
  document.getElementById('btn-guvenlik-rapor')?.addEventListener('click', guvenlikPdfRaporOlustur);

  // Rastgele anahtar üret: kriptografik olarak güvenli
  document.getElementById('btn-guvenlik-anahtar-uret')?.addEventListener('click', () => {
    if (!guvenlikYoneticiMi()) return;
    const bayt = new Uint8Array(24);
    crypto.getRandomValues(bayt);
    const anahtar = Array.from(bayt).map(b => b.toString(16).padStart(2, '0')).join('');
    ['settings-literatur-token', 'settings-photocards-token', 'settings-mesajlar-token'].forEach(id => {
      const el = document.getElementById(id);
      if (el && !el.value.trim()) el.value = anahtar;
    });
    showToast('Boş alanlara rastgele anahtar yazıldı. Kaydedip Apps Script tarafına da aynısını girin.', 'info');
  });

  document.getElementById('btn-guvenlik-kaydet')?.addEventListener('click', async () => {
    if (!guvenlikYoneticiMi()) {
      showToast('Anahtarları yalnızca yönetici değiştirebilir.', 'danger');
      return;
    }
    const oku = (id) => {
      const el = document.getElementById(id);
      return el ? el.value.trim() : undefined;
    };
    await saveConfig(
      STATE.sheetUrl, undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined, undefined,
      {
        literaturToken: oku('settings-literatur-token'),
        photocardsToken: oku('settings-photocards-token'),
        mesajlarToken: oku('settings-mesajlar-token')
      }
    );
    showToast('Erişim anahtarları kaydedildi. Apps Script tarafını da güncelleyip yeniden dağıtın.', 'success');
    guvenlikDenetimiCalistir();
  });

  // Anasayfa Hızlı Yönlendirme Kart Butonları
  document.getElementById('btn-quick-envanter').addEventListener('click', () => showSection('envanter-view'));
  document.getElementById('btn-quick-personel').addEventListener('click', () => showSection('personel-view'));
  document.getElementById('btn-quick-literatur').addEventListener('click', () => showSection('literatur-view'));
  document.getElementById('btn-quick-photocards').addEventListener('click', () => {
    showSection('literatur-view');
    const tabBtn = document.querySelector('.btn-tab[data-subtarget="literatur-photocards-subview"]');
    if (tabBtn) tabBtn.click();
  });
  document.getElementById('btn-quick-magaza').addEventListener('click', () => showSection('magaza-view'));

  // E-Tablo Hızlı Bağlantı Butonları
  document.getElementById('btn-open-envanter-sheet').addEventListener('click', () => {
    if (STATE.envanterTableUrl) {
      openExternal(STATE.envanterTableUrl);
    } else {
      showToast('Envanter E-Tablo bağlantısı ayarlanmamış. Lütfen Ayarlar sekmesinden tanımlayın.', 'warning');
    }
  });
  document.getElementById('btn-open-literatur-sheet').addEventListener('click', () => {
    if (STATE.literaturTableUrl) {
      openExternal(STATE.literaturTableUrl);
    } else {
      showToast('Literatür E-Tablo bağlantısı ayarlanmamış. Lütfen Ayarlar sekmesinden tanımlayın.', 'warning');
    }
  });
  document.getElementById('btn-open-magaza-sheet').addEventListener('click', () => {
    if (STATE.magazaTableUrl) {
      openExternal(STATE.magazaTableUrl);
    } else {
      showToast('Mağaza E-Tablo bağlantısı ayarlanmamış. Lütfen Ayarlar sekmesinden tanımlayın.', 'warning');
    }
  });

  // Fotoğraf Bilgi Kartları E-Tablo Aç Butonu
  document.getElementById('btn-open-photocards-sheet').addEventListener('click', () => {
    if (STATE.photocardsTableUrl) {
      openExternal(STATE.photocardsTableUrl);
    } else {
      showToast('Fotoğraf Bilgi Kartları E-Tablo bağlantısı ayarlanmamış. Lütfen Ayarlar sekmesinden tanımlayın.', 'warning');
    }
  });

  // Bildirim Sesleri Test ve Kontrol Dinleyicileri
  const volumeSlider = document.getElementById('settings-sound-volume');
  if (volumeSlider) {
    volumeSlider.addEventListener('input', (e) => {
      const valSpan = document.getElementById('sound-volume-val');
      if (valSpan) valSpan.textContent = e.target.value + '%';
    });
  }

  document.getElementById('btn-test-sound-success')?.addEventListener('click', () => {
    STATE.soundTheme = document.getElementById('settings-sound-theme').value;
    STATE.soundVolume = parseInt(document.getElementById('settings-sound-volume').value, 10);
    playNotificationSound('success');
  });

  document.getElementById('btn-test-sound-warning')?.addEventListener('click', () => {
    STATE.soundTheme = document.getElementById('settings-sound-theme').value;
    STATE.soundVolume = parseInt(document.getElementById('settings-sound-volume').value, 10);
    playNotificationSound('warning');
  });

  document.getElementById('btn-test-sound-error')?.addEventListener('click', () => {
    STATE.soundTheme = document.getElementById('settings-sound-theme').value;
    STATE.soundVolume = parseInt(document.getElementById('settings-sound-volume').value, 10);
    playNotificationSound('error');
  });

  document.getElementById('btn-test-sound-info')?.addEventListener('click', () => {
    STATE.soundTheme = document.getElementById('settings-sound-theme').value;
    STATE.soundVolume = parseInt(document.getElementById('settings-sound-volume').value, 10);
    playNotificationSound('info');
  });

  // Rapor Alt Sekme Geçişleri
  document.querySelectorAll('#rapor-view .btn-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      document.querySelectorAll('#rapor-view .btn-tab').forEach(t => t.classList.remove('active'));
      e.currentTarget.classList.add('active');

      const targetSub = e.currentTarget.getAttribute('data-subtarget');
      document.querySelectorAll('#rapor-view .rapor-sub-view').forEach(view => {
        view.classList.add('hidden');
        view.classList.remove('active');
      });
      const targetView = document.getElementById(targetSub);
      if (targetView) {
        targetView.classList.remove('hidden');
        targetView.classList.add('active');
      }

      if (targetSub === 'rapor-bi-subview') {
        renderBI();
        syncBI(true);
      } else if (targetSub === 'rapor-surdurulebilirlik-subview') {
        renderSurdurulebilirlikRapor();
        syncSurdurulebilirlik(true, _suFiltre);
      } else if (targetSub === 'rapor-genel-subview' || targetSub === 'rapor-mali-subview') {
        renderReports();
      } else if (targetSub === 'rapor-personel-proje-subview') {
        renderPersonnelProjectCharts();
      } else if (targetSub === 'rapor-dinamik-subview') {
        populateReportAtolyeDropdown();
      } else if (targetSub === 'rapor-katalog-subview') {
        initOrRenderCatalogView();
      }
    });
  });

  // Katalog Oluşturucu Butonlar ve Kontroller
  // Her modul ayri ayri korunur: biri hata verirse digerleri ve sonraki
  // dinleyiciler (rapor butonlari vb.) kurulmaya devam eder.
  [
    ['Katalog', initCatalogEventListeners],
    ['Logo', initLogoCustomizationListeners],
    ['Mesajlaşma', initMessagingModule],
    ['Sanal Müze', initSanalMuze],
    ['Sürdürülebilirlik', initSurdurulebilirlik],
    ['Koruma/Bülten/İş Zekâsı', initKorumaBultenBI]
  ].forEach(([ad, fn]) => {
    try {
      fn();
    } catch (err) {
      console.error(ad + ' modulu baslatilamadi:', err);
    }
  });

  // Yönetici Raporu Oluşturma Butonları
  document.getElementById('btn-generate-report')?.addEventListener('click', generateExecutiveReport);
  document.getElementById('btn-export-report-pdf')?.addEventListener('click', exportExecutiveReportPDF);
  document.getElementById('btn-export-report-csv-new')?.addEventListener('click', exportExecutiveReportCSVNew);
}

// Ayarlar formundaki alan <-> STATE anahtar eslesmesi.
const SETTINGS_FIELD_MAP = [
  { id: 'settings-script-url', key: 'sheetUrl', label: 'Ana Envanter Apps Script' },
  { id: 'settings-magaza-script-url', key: 'magazaSheetUrl', label: 'Mağaza Apps Script' },
  { id: 'settings-literatur-script-url', key: 'literaturSheetUrl', label: 'Literatür Apps Script' },
  { id: 'settings-photocards-script-url', key: 'photocardsSheetUrl', label: 'Fotoğraf Kartları Apps Script' },
  { id: 'settings-proje-script-url', key: 'projeSheetUrl', label: 'Proje Takip Apps Script' },
  { id: 'settings-mesajlar-script-url', key: 'mesajlarSheetUrl', label: 'Mesajlaşma Apps Script' },
  { id: 'settings-envanter-table-url', key: 'envanterTableUrl', label: 'Envanter E-Tablo' },
  { id: 'settings-literatur-table-url', key: 'literaturTableUrl', label: 'Literatür E-Tablo' },
  { id: 'settings-magaza-table-url', key: 'magazaTableUrl', label: 'Mağaza E-Tablo' },
  { id: 'settings-proje-table-url', key: 'projeTableUrl', label: 'Proje E-Tablo' },
  { id: 'settings-literatur-form-url', key: 'literaturFormUrl', label: 'Literatür Form' },
  { id: 'settings-photocards-table-url', key: 'photocardsTableUrl', label: 'Fotoğraf Kartları E-Tablo' }
];

// Ayarlar formu STATE'ten dolduruldu mu? Doldurulmadiysa "Kaydet" calismaz,
// aksi halde bos form tum kayitli linkleri silebilir.
let settingsFormPopulated = false;

function populateSettingsForm() {
  // GÜVENLİK: Apps Script adresleri pratikte birer kimlik bilgisidir - adresi
  // bilen herkes e-tablo verisine erişebilir. Ayarlar ekranı her kullanıcıya
  // açık olduğu için bu adresler yönetici olmayanlara MASKELENİR ve alanlar
  // salt okunur yapılır.
  const yonetici = !!STATE.currentUser && STATE.currentUser.role === 'admin';

  SETTINGS_FIELD_MAP.forEach(({ id, key }) => {
    const el = document.getElementById(id);
    if (!el) return;
    const deger = STATE[key] || '';
    if (yonetici) {
      el.value = deger;
      el.disabled = false;
      el.title = '';
    } else {
      el.value = deger ? '•••••••••• (yönetici yetkisi gerekir)' : '';
      el.disabled = true;
      el.title = 'Bu alanı yalnızca yönetici görüntüleyebilir ve değiştirebilir.';
    }
  });

  // Kaydetme ve bağlantı testi butonları da kilitlenir
  ['btn-save-settings', 'btn-test-connection', 'btn-test-magaza-connection',
   'btn-test-literatur-connection', 'btn-test-photocards-connection',
   'btn-test-proje-connection', 'btn-test-mesajlar-connection',
   'btn-clear-cache'].forEach(bid => {
    const b = document.getElementById(bid);
    if (b) b.disabled = !yonetici;
  });

  // Maskeli değerin yanlışlıkla kaydedilip gerçek adresi bozmasını engelle
  settingsFormPopulated = yonetici;
}

// Uygulama Başlangıç Akışı
async function initApp() {
  // CSP nedeniyle satır içi işleyici kullanılamıyor; delege dinleyiciler
  // her şeyden önce kurulmalı ki ilk render'daki görseller de yakalansın.
  try {
    initGlobalSafeHandlers();
  } catch (err) {
    console.error('Global guvenli isleyiciler kurulamadi:', err);
  }

  // Ayarları Önbellekten Oku
  await loadConfig();

  // Arayüz Ayarlar Alanını Doldur.
  // DIKKAT: Bu adim olay dinleyicilerinden ONCE calisir. Aksi halde
  // initEventListeners() icindeki tek bir hata (ornegin tanimsiz bir fonksiyon)
  // ayar alanlarinin bos kalmasina, kullanicinin da "Kaydet"e basip kayitli
  // Apps Script linklerini silmesine yol aciyordu.
  try {
    populateSettingsForm();
  } catch (err) {
    console.error('Ayar formu doldurulamadi:', err);
  }

  // Olay dinleyicileri: biri patlarsa uygulamanin geri kalani ayakta kalsin.
  try {
    initEventListeners();
  } catch (err) {
    console.error('initEventListeners hatasi:', err);
    showToast('Bazı arayüz kontrolleri yüklenemedi: ' + err.message, 'danger');
  }

  try {
    updatePlatformIndicator();
  } catch (err) {
    console.error('Platform gostergesi guncellenemedi:', err);
  }

  try {
    initUpdateUI();
  } catch (err) {
    console.error('Guncelleme arayuzu baslatilamadi:', err);
  }

  try {
    initSatisModu();
  } catch (err) {
    console.error('Satış ekranı başlatılamadı:', err);
  }

  try {
    initEgitimEOgrenme();
  } catch (err) {
    console.error('E-öğrenme bölümü başlatılamadı:', err);
  }

  try {
    tumEtiketSecicileriKur();
    initPrototipArsivi();
    initTedarikAgi();
  } catch (err) {
    console.error('Prototip arşivi / tedarik ağı başlatılamadı:', err);
  }

  try {
    girisKilidiUygula();
  } catch (err) {
    console.error('Giriş kilidi uygulanamadı:', err);
  }

  if (document.getElementById('settings-sound-theme')) {
    document.getElementById('settings-sound-theme').value = STATE.soundTheme || 'modern';
  }
  if (document.getElementById('settings-sound-volume')) {
    document.getElementById('settings-sound-volume').value = STATE.soundVolume !== undefined ? STATE.soundVolume : 60;
    const valSpan = document.getElementById('sound-volume-val');
    if (valSpan) valSpan.textContent = (STATE.soundVolume !== undefined ? STATE.soundVolume : 60) + '%';
  }

  // Önbellekten mağaza verilerini de yükleyelim
  await loadMagazaDataFromCache();

  // Oturum Açık Kullanıcı Var mı?
  if (STATE.currentUser) {
    setupAppView();
  } else {
    // Giriş Ekranını Göster
    document.getElementById('app-layout').classList.add('hidden');
    document.getElementById('login-view').classList.remove('hidden');

    // Eğer Google Sheets URL tanımlanmamışsa hemen ayarlar modalını aç
    if (!STATE.sheetUrl) {
      document.getElementById('dialog-connection-settings').showModal();
    }
  }
}


// ==========================================================================
// 6.7 SATIŞ EKRANI (Satış Modu) — Personel & Mobil
// --------------------------------------------------------------------------
// Mağaza panelinin sadeleştirilmiş, dokunmatik öncelikli hâli. Aynı kod hem
// masaüstünde hem telefonda (PWA) çalışır; veri yine mağaza Apps Script'ine
// gider, yani masaüstü ve mobil tek sistemdir.
//
// YETKİ: Ayrı bir rol tanımlanmaz. Kullanıcı tablosunda yalnızca "Mağaza"
// sütunu TRUE olan (envanter/personel/literatür/rapor kapalı) bir kullanıcı
// giriş yaptığında uygulama otomatik olarak bu ekrana kilitlenir. Böylece
// Apps Script tarafında hiçbir değişiklik/yeniden dağıtım gerekmez.
// ==========================================================================

const SM_BEVERAGES = [
  { name: 'Çay', price: 10, icon: '🍵' },
  { name: 'Türk Kahvesi', price: 30, icon: '☕' },
  { name: 'Filtre Kahve', price: 40, icon: '☕' },
  { name: 'Bitki Çayı', price: 20, icon: '🌿' },
  { name: 'Su', price: 10, icon: '💧' },
  { name: 'Soda', price: 15, icon: '🥤' },
  { name: 'Diğer İçecek', price: 0, icon: '🧃' }
];

const SM = {
  category: 'inventory',   // inventory | beverage | custom
  item: null,              // seçili envanter ürünü ya da içecek
  payment: 'Nakit',
  urgency: 'Normal',
  bound: false
};

// Yalnızca mağaza yetkisi olan (başka modüle erişemeyen) kullanıcı mı?
function isSalesOnlyUser() {
  const u = STATE.currentUser;
  if (!u) return false;
  if (u.role === 'admin') return false;
  const perms = u.permissions || [];
  if (!checkUserPermission(perms, 'magaza-view')) return false;
  const digerModuller = [
    'envanter-view', 'personel-view', 'atolye-personel-view',
    'literatur-view', 'rapor-view', 'kullanici-view', 'log-view'
  ];
  return !digerModuller.some(t => checkUserPermission(perms, t));
}

// Satış personeli için kabuğu (kenar çubuğu, mobil menü) tamamen gizler.
function applySalesOnlyMode() {
  const yalnizSatis = isSalesOnlyUser();
  document.body.classList.toggle('sales-only', yalnizSatis);

  const exitBtn = document.getElementById('sm-btn-exit');
  if (exitBtn) exitBtn.classList.toggle('hidden', yalnizSatis);

  if (yalnizSatis) {
    showSection('satis-modu-view');
  }
  return yalnizSatis;
}

function smParaFormat(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺';
}

function smBugununTarihi() {
  const d = new Date();
  const ay = String(d.getMonth() + 1).padStart(2, '0');
  const gun = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${ay}-${gun}`;
}

function smSatirTarihi(row) {
  const raw = row && row["Tarih"];
  if (!raw) return '';
  if (typeof raw === 'string') return raw.split('T')[0].trim();
  try { return new Date(raw).toISOString().split('T')[0]; } catch (e) { return ''; }
}

function smSatirTutari(row) {
  const nakit = parseFloat(row["Nakit Tahsilat (₺)"] || row["Nakit Tahsilat"] || 0) || 0;
  const kart = parseFloat(row["Kredi Kartı Tahsilat (₺)"] || row["Kredi Kartı Tahsilat"] || 0) || 0;
  const tutar = parseFloat(row["Satış Tutarı"] || row["Tutar"] || 0) || 0;
  return (nakit || kart) ? (nakit + kart) : tutar;
}

function smDevirMi(row) {
  const id = String(row["Satış ID"] || '');
  return id.indexOf('DEVIR') === 0 || String(row["Eser Adı"] || '').indexOf('Kasadan Devir') === 0;
}

// --- Olay dinleyicileri (bir kez kurulur) -------------------------------
function initSatisModu() {
  if (SM.bound) return;
  SM.bound = true;

  // Sekmeler
  document.querySelectorAll('.sm-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const hedef = tab.getAttribute('data-sm-tab');
      document.querySelectorAll('.sm-tab').forEach(t => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.sm-panel').forEach(p => {
        p.classList.toggle('hidden', p.id !== hedef);
        p.classList.toggle('active', p.id === hedef);
      });
    });
  });

  // Kategori seçimi
  document.querySelectorAll('#sm-category-seg .sm-seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      SM.category = btn.getAttribute('data-sm-cat');
      document.querySelectorAll('#sm-category-seg .sm-seg-btn')
        .forEach(b => b.classList.toggle('active', b === btn));
      document.getElementById('sm-block-inventory').classList.toggle('hidden', SM.category !== 'inventory');
      document.getElementById('sm-block-beverage').classList.toggle('hidden', SM.category !== 'beverage');
      document.getElementById('sm-block-custom').classList.toggle('hidden', SM.category !== 'custom');
      smAdetKilidiGuncelle();
      smSecimiTemizle();
    });
  });

  // Ödeme yöntemi
  document.querySelectorAll('#sm-payment-seg .sm-seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      SM.payment = btn.getAttribute('data-sm-pay');
      document.querySelectorAll('#sm-payment-seg .sm-seg-btn')
        .forEach(b => b.classList.toggle('active', b === btn));
    });
  });

  // İhtiyaç önceliği
  document.querySelectorAll('#sm-need-urgency-seg .sm-seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      SM.urgency = btn.getAttribute('data-sm-urg');
      document.querySelectorAll('#sm-need-urgency-seg .sm-seg-btn')
        .forEach(b => b.classList.toggle('active', b === btn));
    });
  });

  // Arama
  const arama = document.getElementById('sm-stock-search');
  if (arama) arama.addEventListener('input', () => smUrunIzgarasiCiz());

  // Adet sayacı
  const qty = document.getElementById('sm-qty');
  const eksi = document.getElementById('sm-qty-minus');
  const arti = document.getElementById('sm-qty-plus');
  if (eksi) eksi.addEventListener('click', () => {
    qty.value = Math.max(1, (parseInt(qty.value, 10) || 1) - 1);
    smToplamGuncelle();
  });
  if (arti) arti.addEventListener('click', () => {
    qty.value = (parseInt(qty.value, 10) || 1) + 1;
    smToplamGuncelle();
  });
  if (qty) qty.addEventListener('input', smToplamGuncelle);

  const fiyat = document.getElementById('sm-unit-price');
  if (fiyat) fiyat.addEventListener('input', smToplamGuncelle);

  const ozelAd = document.getElementById('sm-custom-name');
  if (ozelAd) ozelAd.addEventListener('input', () => {
    const baslik = document.getElementById('sm-sel-title');
    if (baslik) baslik.textContent = ozelAd.value.trim() || 'Ürün seçilmedi';
  });

  const temizle = document.getElementById('sm-btn-clear');
  if (temizle) temizle.addEventListener('click', smSecimiTemizle);

  const kaydet = document.getElementById('sm-btn-save');
  if (kaydet) kaydet.addEventListener('click', smSatisKaydet);

  const ihtiyacKaydet = document.getElementById('sm-btn-need-save');
  if (ihtiyacKaydet) ihtiyacKaydet.addEventListener('click', smIhtiyacKaydet);

  const yenile = document.getElementById('sm-btn-refresh');
  if (yenile) yenile.addEventListener('click', async () => {
    yenile.classList.add('is-busy');
    await syncMagazaData(true);
    renderSatisModu();
    yenile.classList.remove('is-busy');
    showToast('Veriler yenilendi.', 'success');
  });

  const cikis = document.getElementById('sm-btn-exit');
  if (cikis) cikis.addEventListener('click', () => showSection('magaza-view'));

  const oturumKapat = document.getElementById('sm-btn-logout');
  if (oturumKapat) oturumKapat.addEventListener('click', handleLogout);

  // Çevrimdışı göstergesi
  window.addEventListener('online', smBaglantiDurumu);
  window.addEventListener('offline', smBaglantiDurumu);
}

function smBaglantiDurumu() {
  const banner = document.getElementById('sm-offline-banner');
  const kaydet = document.getElementById('sm-btn-save');
  const cevrimdisi = (typeof navigator.onLine === 'boolean') && !navigator.onLine;
  if (banner) banner.classList.toggle('hidden', !cevrimdisi);
  if (kaydet) kaydet.disabled = cevrimdisi;
}

// --- Çizim ---------------------------------------------------------------
function renderSatisModu() {
  const bolum = document.getElementById('satis-modu-view');
  if (!bolum) return;

  // Başlık
  const adEl = document.getElementById('sm-user-name');
  if (adEl) adEl.textContent = STATE.currentUser ? STATE.currentUser.name : 'Satış Ekranı';
  const tarihEl = document.getElementById('sm-date');
  if (tarihEl) {
    tarihEl.textContent = new Date().toLocaleDateString('tr-TR',
      { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  smPersonelDoldur();
  smUrunIzgarasiCiz();
  smIcecekIzgarasiCiz();
  smIhtiyacListesiCiz();
  smBugunCiz();
  smAdetKilidiGuncelle();
  smToplamGuncelle();
  smBaglantiDurumu();
}

// Satışı yapan personel listesi. Kullanıcı listesi (yalnızca yöneticiye gelir)
// boş olsa bile giriş yapan kişinin adı her zaman seçenek olarak bulunur;
// aksi halde satış personeli hiçbir isim seçemiyor olurdu.
function smPersonelDoldur() {
  const select = document.getElementById('sm-person');
  if (!select) return;
  const mevcutSecim = select.value;
  const benimAdim = STATE.currentUser ? (STATE.currentUser.name || STATE.currentUser.username) : '';

  const isimler = [];
  if (benimAdim) isimler.push(benimAdim);
  (STATE.users || [])
    .filter(u => u.active)
    .forEach(u => { if (u.name && isimler.indexOf(u.name) === -1) isimler.push(u.name); });

  select.innerHTML = isimler
    .map(ad => `<option value="${escapeHtml(ad)}">${escapeHtml(ad)}</option>`)
    .join('');

  if (mevcutSecim && isimler.indexOf(mevcutSecim) > -1) select.value = mevcutSecim;
  else if (benimAdim) select.value = benimAdim;
}

// Mağaza stoğunda görsel bağlantısı boşsa, aynı envanter numarasına sahip
// envanter kaydındaki görseli kullanır. Böylece stoğa çekilirken görsel sütunu
// dolmamış ürünler de satış ekranında resimli görünür.
function smEnvanterGorseli(envanterNo) {
  const no = String(envanterNo || '').trim().toLowerCase();
  if (!no) return '';
  const kayit = (STATE.inventory || []).find(
    (i) => String(i.envanterNo || '').trim().toLowerCase() === no
  );
  if (!kayit) return '';
  return kayit.linkWeb || kayit.linkImage || '';
}

function smUrunIzgarasiCiz() {
  const grid = document.getElementById('sm-stock-grid');
  if (!grid) return;

  const aramaEl = document.getElementById('sm-stock-search');
  const arama = aramaEl ? aramaEl.value.toLowerCase().trim() : '';

  const satilabilir = (STATE.magaza.stock || []).filter(item => {
    const durum = String(item.durum || '').toLowerCase();
    if (durum.indexOf('satıldı') > -1 || durum === 'pasif') return false;
    if (!arama) return true;
    return String(item.envanterNo || '').toLowerCase().includes(arama)
      || String(item.eserAdi || '').toLowerCase().includes(arama)
      || String(item.cins || '').toLowerCase().includes(arama);
  });

  if (satilabilir.length === 0) {
    grid.innerHTML = `<div class="sm-empty">${arama ? 'Aramanıza uygun ürün bulunamadı.' : 'Mağaza stoğunda satılabilir ürün yok.'}</div>`;
    return;
  }

  grid.innerHTML = satilabilir.slice(0, 300).map(item => {
    const fiyat = parseFloat(item.satisFiyati || 0) || 0;
    const fiyatHtml = fiyat > 0
      ? `<span class="sm-item-price">${smParaFormat(fiyat)}</span>`
      : `<span class="sm-item-price pending">Fiyat girilmemiş</span>`;
    const secili = SM.category === 'inventory' && SM.item && SM.item.envanterNo === item.envanterNo;

    // Görsel, satış personelinin ürünü isimden değil BAKARAK tanıyabilmesi için
    // eklendi. Kaynak öncelikle mağaza stoğundaki görsel, yoksa aynı envanter
    // numarasına sahip envanter kaydının web/ürün görselidir — mağaza satırında
    // görsel sütunu boş kalmış ürünler de kartsız kalmasın.
    const gorselKaynagi = item.gorselLinki || smEnvanterGorseli(item.envanterNo);
    const thumb = getDriveThumbnailUrl(gorselKaynagi) || getNormalizedImageUrl(gorselKaynagi);
    const gorselHtml = thumb
      ? `<img src="${escapeHtml(thumb)}" alt="" class="sm-item-img" loading="lazy"
             referrerpolicy="no-referrer" data-fallback="favicon">`
      : `<span class="sm-item-img sm-item-img--bos">🎨</span>`;

    return `
      <button type="button" class="sm-item${secili ? ' selected' : ''}"
        data-sm-stock="${escapeHtml(String(item.envanterNo || ''))}">
        ${gorselHtml}
        <span class="sm-item-code">${escapeHtml(String(item.envanterNo || '—'))}</span>
        <span class="sm-item-name">${escapeHtml(String(item.eserAdi || 'İsimsiz ürün'))}</span>
        ${fiyatHtml}
      </button>`;
  }).join('');

  grid.querySelectorAll('[data-sm-stock]').forEach(btn => {
    btn.addEventListener('click', () => {
      const no = btn.getAttribute('data-sm-stock');
      const urun = (STATE.magaza.stock || []).find(i => String(i.envanterNo) === no);
      if (urun) smUrunSec(urun);
    });
  });
}

function smIcecekIzgarasiCiz() {
  const grid = document.getElementById('sm-beverage-grid');
  if (!grid) return;
  grid.innerHTML = SM_BEVERAGES.map((b, i) => {
    const secili = SM.category === 'beverage' && SM.item && SM.item.name === b.name;
    return `
      <button type="button" class="sm-item${secili ? ' selected' : ''}" data-sm-bev="${i}">
        <span class="sm-item-code">${b.icon}</span>
        <span class="sm-item-name">${escapeHtml(b.name)}</span>
        <span class="sm-item-price${b.price ? '' : ' pending'}">${b.price ? smParaFormat(b.price) : 'Fiyatı siz girin'}</span>
      </button>`;
  }).join('');

  grid.querySelectorAll('[data-sm-bev]').forEach(btn => {
    btn.addEventListener('click', () => {
      const b = SM_BEVERAGES[parseInt(btn.getAttribute('data-sm-bev'), 10)];
      if (!b) return;
      SM.item = { name: b.name, price: b.price };
      document.getElementById('sm-sel-title').textContent = b.name;
      document.getElementById('sm-btn-clear').classList.remove('hidden');
      const fiyatInput = document.getElementById('sm-unit-price');
      if (b.price > 0) fiyatInput.value = b.price;
      else { fiyatInput.value = ''; fiyatInput.focus(); }
      smIcecekIzgarasiCiz();
      smToplamGuncelle();
    });
  });
}

function smUrunSec(item) {
  SM.item = item;
  document.getElementById('sm-sel-title').textContent =
    (item.eserAdi || 'İsimsiz ürün') + (item.envanterNo ? ` · ${item.envanterNo}` : '');
  document.getElementById('sm-btn-clear').classList.remove('hidden');

  const fiyat = parseFloat(item.satisFiyati || 0) || 0;
  const fiyatInput = document.getElementById('sm-unit-price');
  if (fiyat > 0) {
    fiyatInput.value = fiyat;
  } else {
    fiyatInput.value = '';
    showToast('Bu ürünün fiyatı tanımlı değil, lütfen fiyatı girin.', 'warning');
    fiyatInput.focus();
  }
  // Envanterli ürün tek nüshadır; adet daima 1.
  const qty = document.getElementById('sm-qty');
  if (qty) qty.value = 1;

  smUrunIzgarasiCiz();
  smToplamGuncelle();
}

function smSecimiTemizle() {
  SM.item = null;
  const baslik = document.getElementById('sm-sel-title');
  if (baslik) baslik.textContent = 'Ürün seçilmedi';
  const temizleBtn = document.getElementById('sm-btn-clear');
  if (temizleBtn) temizleBtn.classList.add('hidden');
  const fiyat = document.getElementById('sm-unit-price');
  if (fiyat) fiyat.value = '';
  const qty = document.getElementById('sm-qty');
  if (qty) qty.value = 1;
  const ozel = document.getElementById('sm-custom-name');
  if (ozel && SM.category !== 'custom') ozel.value = '';
  smAdetKilidiGuncelle();
  smUrunIzgarasiCiz();
  smIcecekIzgarasiCiz();
  smToplamGuncelle();
}

// Envanterli ürün e-tabloda tek nüshadır ve satılınca "Satıldı" işaretlenir;
// bu yüzden adet 1'e kilitlenir. İçecek/diğer satışlarda adet serbesttir.
function smAdetKilidiGuncelle() {
  const envanterli = SM.category === 'inventory';
  const qty = document.getElementById('sm-qty');
  const eksi = document.getElementById('sm-qty-minus');
  const arti = document.getElementById('sm-qty-plus');
  if (!qty) return;
  if (envanterli) qty.value = 1;
  qty.disabled = envanterli;
  if (eksi) eksi.disabled = envanterli;
  if (arti) arti.disabled = envanterli;
  const alan = qty.closest('.sm-field');
  if (alan) alan.classList.toggle('sm-disabled', envanterli);
}

function smToplamGuncelle() {
  const fiyat = parseFloat(document.getElementById('sm-unit-price').value) || 0;
  const adet = parseInt(document.getElementById('sm-qty').value, 10) || 1;
  const toplamEl = document.getElementById('sm-total');
  if (toplamEl) toplamEl.textContent = smParaFormat(fiyat * adet);
}

function smIhtiyacListesiCiz() {
  const liste = document.getElementById('sm-need-list');
  if (!liste) return;
  const bekleyen = (STATE.magaza.needs || []).filter(n => {
    const durum = String(n["Durum"] || 'Beklemede');
    return durum === 'Beklemede';
  });

  if (bekleyen.length === 0) {
    liste.innerHTML = `<div class="sm-empty">Bekleyen ihtiyaç kaydı yok.</div>`;
    return;
  }

  liste.innerHTML = [...bekleyen].reverse().slice(0, 50).map(n => {
    const acil = String(n["Öncelik"] || '') === 'Acil';
    return `
      <div class="sm-list-item">
        <div class="sm-li-main">
          <span class="sm-li-title">${escapeHtml(String(n["Açıklama"] || ''))}</span>
          <span class="sm-li-sub">${escapeHtml(String(n["Miktar"] || '1'))} · ${escapeHtml(String(n["Personel"] || ''))}</span>
        </div>
        <span class="sm-li-badge${acil ? ' urgent' : ''}">${acil ? 'ACİL' : 'Normal'}</span>
      </div>`;
  }).join('');
}

function smBugunCiz() {
  const bugun = smBugununTarihi();
  const satirlar = (STATE.magaza.cash || [])
    .filter(r => !smDevirMi(r) && smSatirTarihi(r) === bugun);

  let toplam = 0, nakit = 0, kart = 0;
  satirlar.forEach(r => {
    const tutar = smSatirTutari(r);
    toplam += tutar;
    const yontem = String(r["Ödeme Yöntemi"] || '');
    const nakitSutun = parseFloat(r["Nakit Tahsilat (₺)"] || r["Nakit Tahsilat"] || 0) || 0;
    const kartSutun = parseFloat(r["Kredi Kartı Tahsilat (₺)"] || r["Kredi Kartı Tahsilat"] || 0) || 0;
    if (kartSutun > 0 || yontem === 'Kredi Kartı') kart += kartSutun || tutar;
    else if (nakitSutun > 0 || yontem === 'Nakit') nakit += nakitSutun || tutar;
  });

  const yaz = (id, deger) => { const el = document.getElementById(id); if (el) el.textContent = deger; };
  yaz('sm-today-total', smParaFormat(toplam));
  yaz('sm-stat-total', smParaFormat(toplam));
  yaz('sm-stat-cash', smParaFormat(nakit));
  yaz('sm-stat-card', smParaFormat(kart));
  yaz('sm-stat-count', String(satirlar.length));

  const liste = document.getElementById('sm-today-list');
  if (!liste) return;
  if (satirlar.length === 0) {
    liste.innerHTML = `<div class="sm-empty">Bugün henüz satış kaydedilmedi.</div>`;
    return;
  }
  liste.innerHTML = [...satirlar].reverse().map(r => `
    <div class="sm-list-item">
      <div class="sm-li-main">
        <span class="sm-li-title">${escapeHtml(String(r["Eser Adı"] || r["Envanter No"] || 'Satış'))}</span>
        <span class="sm-li-sub">${escapeHtml(String(r["Ödeme Yöntemi"] || ''))} · ${escapeHtml(String(r["Satan Personel"] || ''))}</span>
      </div>
      <span class="sm-li-amount">${smParaFormat(smSatirTutari(r))}</span>
    </div>`).join('');
}

// --- Kaydetme ------------------------------------------------------------
async function smSatisKaydet() {
  if (!STATE.magazaSheetUrl) {
    showToast('Mağaza bağlantısı tanımlı değil. Yöneticinize başvurun.', 'danger');
    return;
  }
  if (typeof navigator.onLine === 'boolean' && !navigator.onLine) {
    showToast('İnternet bağlantısı yok. Satış kaydedilemedi.', 'danger');
    return;
  }

  const personel = document.getElementById('sm-person').value;
  const adet = parseInt(document.getElementById('sm-qty').value, 10) || 1;
  const birimFiyat = parseFloat(document.getElementById('sm-unit-price').value) || 0;

  if (!personel) { showToast('Satışı yapan personeli seçin.', 'warning'); return; }
  if (birimFiyat <= 0) { showToast('Geçerli bir birim fiyat girin.', 'warning'); return; }

  const payload = {
    category: SM.category === 'inventory' ? 'Envanter' : (SM.category === 'beverage' ? 'İçecek' : 'Diğer'),
    salesperson: personel,
    paymentMethod: SM.payment,
    quantity: adet,
    unitPrice: birimFiyat,
    totalPrice: birimFiyat * adet
  };

  let endpoint;
  if (SM.category === 'inventory') {
    if (!SM.item || !SM.item.envanterNo) { showToast('Satılacak ürünü seçin.', 'warning'); return; }
    payload.envanterNo = SM.item.envanterNo;
    payload.rowNum = SM.item._rowNum;
    payload.price = birimFiyat;
    endpoint = 'add_magaza_sale';
  } else if (SM.category === 'beverage') {
    if (!SM.item || !SM.item.name) { showToast('İçecek türünü seçin.', 'warning'); return; }
    payload.name = SM.item.name;
    payload.envanterNo = 'İÇECEK';
    endpoint = 'add_magaza_custom_sale';
  } else {
    const ad = document.getElementById('sm-custom-name').value.trim();
    if (!ad) { showToast('Satış açıklamasını yazın.', 'warning'); return; }
    payload.name = ad;
    payload.envanterNo = 'DİĞER';
    endpoint = 'add_magaza_custom_sale';
  }

  const btn = document.getElementById('sm-btn-save');
  btn.disabled = true;
  toggleLoading(true, 'Satış kaydediliyor...');
  try {
    const res = await apiMagazaPost(endpoint, payload);
    toggleLoading(false);
    if (res && res.success) {
      showToast(`Satış kaydedildi: ${smParaFormat(birimFiyat * adet)}`, 'success');
      const ozel = document.getElementById('sm-custom-name');
      if (ozel) ozel.value = '';
      smSecimiTemizle();
      await syncMagazaData(true);
      renderSatisModu();
    } else {
      showToast('Satış kaydedilemedi: ' + (res ? res.error : 'bilinmeyen hata'), 'danger');
    }
  } catch (err) {
    toggleLoading(false);
    showToast('Bağlantı hatası: ' + err.message, 'danger');
  } finally {
    btn.disabled = false;
    smBaglantiDurumu();
  }
}

async function smIhtiyacKaydet() {
  const aciklama = document.getElementById('sm-need-desc').value.trim();
  const miktar = document.getElementById('sm-need-amount').value.trim() || '1';

  if (!aciklama) { showToast('İhtiyacı yazın.', 'warning'); return; }
  if (!STATE.magazaSheetUrl) { showToast('Mağaza bağlantısı tanımlı değil.', 'danger'); return; }

  const btn = document.getElementById('sm-btn-need-save');
  btn.disabled = true;
  toggleLoading(true, 'İhtiyaç bildiriliyor...');
  try {
    const res = await apiMagazaPost('add_magaza_need', {
      description: aciklama,
      amount: miktar,
      urgency: SM.urgency,
      status: 'Beklemede'
    });
    toggleLoading(false);
    if (res && res.success) {
      showToast('İhtiyaç bildirildi. Yöneticiye iletildi.', 'success');
      document.getElementById('sm-need-desc').value = '';
      document.getElementById('sm-need-amount').value = '';
      await syncMagazaData(true);
      renderSatisModu();
    } else {
      showToast('İhtiyaç kaydedilemedi: ' + (res ? res.error : 'bilinmeyen hata'), 'danger');
    }
  } catch (err) {
    toggleLoading(false);
    showToast('Bağlantı hatası: ' + err.message, 'danger');
  } finally {
    btn.disabled = false;
  }
}


// ==========================================================================
// 6.8 E-ÖĞRENME ve DİJİTAL SERTİFİKASYON
// --------------------------------------------------------------------------
// İki bölümden oluşur:
//   1) Eğitim Materyalleri — eğitmenler ders notu (PDF) ve video (MP4) yükler.
//      Dosya, Apps Script üzerinden Google Drive'a parça parça aktarılır;
//      bağlantısı e-tabloya yazılır. Doğrudan tarayıcıdan Drive REST API'sine
//      gidilmez: arayüzün güvenlik politikası yalnızca script.google.com'a
//      izin verir ve doğrudan erişim her kullanıcı için ayrı OAuth onayı ister.
//   2) Katılım Belgesi — tamamlanmış bir eğitim kaydından ad-soyad, kurs adı ve
//      bitiş tarihi çekilerek belge üretilir, benzersiz doğrulama kodu (UUID) ve
//      QR kod basılır, PDF olarak indirilir.
// ==========================================================================

// Belgedeki QR kodun işaret ettiği doğrulama sayfası. Mobil sürümün yayınlandığı
// adreste barınır; yapılandırmadan değiştirilebilir.
const SERTIFIKA_DOGRULAMA_ADRESI_VARSAYILAN =
  'https://anilacartr.github.io/edirne-olgunlasma-mobil/dogrula.html';

function sertifikaDogrulamaAdresi() {
  if (STATE.dogrulamaUrl) return STATE.dogrulamaUrl;
  if (window.EO_PUBLIC_CONFIG && window.EO_PUBLIC_CONFIG.dogrulamaUrl) {
    return window.EO_PUBLIC_CONFIG.dogrulamaUrl;
  }
  return SERTIFIKA_DOGRULAMA_ADRESI_VARSAYILAN;
}

const MATERYAL_MAX_BAYT = 200 * 1024 * 1024;
const MATERYAL_TUR_IKON = { 'PDF': '📕', 'Video': '🎬' };

// Bir eğitim kaydına bağlı materyaller, KURS ADI üzerinden eşleştirilir.
// Kayıt numarasıyla değil: bir kursun her katılımcısı ayrı satırdır, oysa ders
// notu/video kursun tamamına aittir. Karşılaştırma Türkçe yerel ayarına göre
// harf duyarsız yapılır ("İĞNE" ile "iğne" eşleşsin diye).
function _kursAnahtari(ad) {
  return String(ad || '').trim().toLocaleLowerCase('tr-TR');
}

function egitimMateryalSayisi(egitimAdi) {
  const anahtar = _kursAnahtari(egitimAdi);
  if (!anahtar) return 0;
  return (STATE.materyaller || []).filter(
    (m) => _kursAnahtari(m['Eğitim / Kurs Adı']) === anahtar).length;
}

// Materyal sekmesinde etkin kurs süzgeci (eğitim satırındaki 📚 ile ayarlanır)
let _materyalKursFiltresi = '';

function egitimMateryalleriniAc(egitimAdi) {
  _materyalKursFiltresi = String(egitimAdi || '').trim();

  const sekme = document.querySelector('#egitim-view [data-subtarget="egitim-materyal-subview"]');
  if (sekme) sekme.click();

  // Yükleme formu da o kursla dolsun: yeni materyal doğrudan eşleşmiş gelir.
  const kursAlani = document.getElementById('materyal-egitim-adi');
  if (kursAlani) kursAlani.value = _materyalKursFiltresi;

  const arama = document.getElementById('materyal-arama');
  if (arama) arama.value = '';

  renderMateryaller();
  const liste = document.getElementById('materyal-liste');
  if (liste) liste.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function materyalKursFiltresiniTemizle() {
  _materyalKursFiltresi = '';
  renderMateryaller();
}

let _secilenMateryalDosya = null;
let _materyalYuklemeSuruyor = false;
let _aktifSertifika = null;

function baytOku(bayt) {
  const b = Number(bayt) || 0;
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

// --- Alt sekmeler + olay dinleyicileri -----------------------------------
function initEgitimEOgrenme() {
  document.querySelectorAll('#egitim-view .btn-tab').forEach((tab) => {
    tab.addEventListener('click', (e) => {
      document.querySelectorAll('#egitim-view .btn-tab').forEach((t) => t.classList.remove('active'));
      e.currentTarget.classList.add('active');
      const hedef = e.currentTarget.getAttribute('data-subtarget');
      document.querySelectorAll('#egitim-view .egitim-sub-view').forEach((v) => {
        v.classList.toggle('hidden', v.id !== hedef);
        v.classList.toggle('active', v.id === hedef);
      });
      if (hedef === 'egitim-materyal-subview') {
        onbellektenCiz('materyaller', renderMateryaller);
        sekmeTazele('materyaller', () => syncMateryaller(true));
      }
      if (hedef === 'egitim-sertifika-subview') {
        onbellektenCiz('sertifikalar', () => {
          renderSertifikaAdaylari();
          renderSertifikalar();
        });
        sekmeTazele('sertifikalar', () => syncSertifikalar(true));
      }
    });
  });

  // --- Dosya seçimi ---
  const dosyaInput = document.getElementById('materyal-dosya');
  const alan = document.getElementById('materyal-dosya-alani');
  if (alan && dosyaInput) {
    alan.addEventListener('click', (e) => {
      if (e.target.closest('#materyal-dosya-kaldir')) return;
      dosyaInput.click();
    });
    dosyaInput.addEventListener('change', () => {
      if (dosyaInput.files && dosyaInput.files[0]) materyalDosyaSec(dosyaInput.files[0]);
    });
    // Sürükle-bırak
    ['dragenter', 'dragover'].forEach((olay) => {
      alan.addEventListener(olay, (e) => { e.preventDefault(); alan.classList.add('surukleniyor'); });
    });
    ['dragleave', 'drop'].forEach((olay) => {
      alan.addEventListener(olay, (e) => { e.preventDefault(); alan.classList.remove('surukleniyor'); });
    });
    alan.addEventListener('drop', (e) => {
      const d = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (d) materyalDosyaSec(d);
    });
  }

  const kaldir = document.getElementById('materyal-dosya-kaldir');
  if (kaldir) kaldir.addEventListener('click', (e) => { e.stopPropagation(); materyalDosyaTemizle(); });

  const yukleBtn = document.getElementById('btn-materyal-yukle');
  if (yukleBtn) yukleBtn.addEventListener('click', materyalYukle);

  const yenileBtn = document.getElementById('btn-materyal-yenile');
  if (yenileBtn) yenileBtn.addEventListener('click', () => syncMateryaller(false));

  const cipTemizle = document.getElementById('btn-materyal-cip-temizle');
  if (cipTemizle) cipTemizle.addEventListener('click', materyalKursFiltresiniTemizle);

  const arama = document.getElementById('materyal-arama');
  if (arama) arama.addEventListener('input', renderMateryaller);

  const sertYenile = document.getElementById('btn-sertifika-yenile');
  if (sertYenile) sertYenile.addEventListener('click', () => syncSertifikalar(false));

  const sertArama = document.getElementById('sertifika-arama');
  if (sertArama) sertArama.addEventListener('input', renderSertifikalar);

  // Liste içi işlemler (olay devri)
  const liste = document.getElementById('materyal-liste');
  if (liste) {
    liste.addEventListener('click', (e) => {
      const sil = e.target.closest('[data-materyal-sil]');
      if (sil) materyalSil(sil.getAttribute('data-materyal-sil'), sil.getAttribute('data-ad'));
    });
  }

  const adayTbody = document.getElementById('sertifika-aday-tbody');
  if (adayTbody) {
    adayTbody.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-sertifika-olustur]');
      if (btn) sertifikaOlustur(btn.getAttribute('data-sertifika-olustur'));
    });
  }

  const sertTbody = document.getElementById('sertifika-tbody');
  if (sertTbody) {
    sertTbody.addEventListener('click', (e) => {
      const goster = e.target.closest('[data-sertifika-goster]');
      if (goster) {
        const kayit = (STATE.sertifikalar || []).find(
          (x) => String(x['Doğrulama Kodu']) === goster.getAttribute('data-sertifika-goster'));
        if (kayit) sertifikaOnizle(sertifikaKaydiNormalize(kayit));
      }
    });
  }

  const pdfBtn = document.getElementById('btn-sertifika-pdf');
  if (pdfBtn) pdfBtn.addEventListener('click', sertifikaPdfIndir);

  const kopyalaBtn = document.getElementById('btn-sertifika-link-kopyala');
  if (kopyalaBtn) {
    kopyalaBtn.addEventListener('click', async () => {
      if (!_aktifSertifika) return;
      const adres = sertifikaDogrulamaAdresi() + '?kod=' + encodeURIComponent(_aktifSertifika.dogrulamaKodu);
      try {
        await navigator.clipboard.writeText(adres);
        showToast('Doğrulama bağlantısı panoya kopyalandı.', 'success');
      } catch (err) {
        showToast('Kopyalanamadı: ' + adres, 'warning');
      }
    });
  }

  const kapatBtn = document.getElementById('btn-sertifika-kapat');
  if (kapatBtn) {
    kapatBtn.addEventListener('click', () => document.getElementById('dialog-sertifika').close());
  }
}

// --- Materyal: dosya seçimi ---------------------------------------------
function materyalDosyaSec(dosya) {
  const izinli = ['application/pdf', 'video/mp4'];
  const uzanti = (dosya.name.split('.').pop() || '').toLowerCase();
  const turTamam = izinli.indexOf(dosya.type) > -1 || uzanti === 'pdf' || uzanti === 'mp4';
  if (!turTamam) {
    showToast('Yalnızca PDF ders notu veya MP4 video yükleyebilirsiniz.', 'warning');
    return;
  }
  if (dosya.size > MATERYAL_MAX_BAYT) {
    showToast('Dosya çok büyük (' + baytOku(dosya.size) + '). Üst sınır 200 MB.', 'danger');
    return;
  }

  _secilenMateryalDosya = dosya;
  document.getElementById('materyal-dosya-bos').classList.add('hidden');
  document.getElementById('materyal-dosya-secili').classList.remove('hidden');
  document.getElementById('materyal-dosya-ad').textContent = dosya.name;
  document.getElementById('materyal-dosya-boyut').textContent =
    baytOku(dosya.size) + ' · ' + (uzanti === 'mp4' ? 'Video' : 'Ders Notu');
  document.getElementById('materyal-dosya-tur-icon').textContent = uzanti === 'mp4' ? '🎬' : '📕';
  document.getElementById('btn-materyal-yukle').disabled = false;

  const adAlani = document.getElementById('materyal-adi');
  if (adAlani && !adAlani.value.trim()) adAlani.value = dosya.name.replace(/\.[^.]+$/, '');
}

function materyalDosyaTemizle() {
  _secilenMateryalDosya = null;
  const input = document.getElementById('materyal-dosya');
  if (input) input.value = '';
  document.getElementById('materyal-dosya-bos').classList.remove('hidden');
  document.getElementById('materyal-dosya-secili').classList.add('hidden');
  document.getElementById('btn-materyal-yukle').disabled = true;
}

// Bir Blob parçasını base64'e çevirir (bellek dostu: parça parça okunur)
function blobBase64Oku(blob) {
  return new Promise((coz, hata) => {
    const okuyucu = new FileReader();
    okuyucu.onload = () => {
      const sonuc = String(okuyucu.result || '');
      const virgul = sonuc.indexOf(',');
      coz(virgul > -1 ? sonuc.slice(virgul + 1) : sonuc);
    };
    okuyucu.onerror = () => hata(new Error('Dosya parçası okunamadı.'));
    okuyucu.readAsDataURL(blob);
  });
}

function materyalIlerleme(yuzde, metin) {
  const kutu = document.getElementById('materyal-ilerleme');
  const dolu = document.getElementById('materyal-ilerleme-dolu');
  const yazi = document.getElementById('materyal-ilerleme-metin');
  if (kutu) kutu.classList.remove('hidden');
  if (dolu) dolu.style.width = Math.max(0, Math.min(100, yuzde)) + '%';
  if (yazi) yazi.textContent = metin;
}

// --- Materyal: parçalı yükleme -------------------------------------------
async function materyalYukle() {
  if (_materyalYuklemeSuruyor) return;
  if (!_secilenMateryalDosya) { showToast('Önce bir dosya seçin.', 'warning'); return; }

  const egitimAdi = document.getElementById('materyal-egitim-adi').value.trim();
  if (!egitimAdi) {
    showToast('Materyalin bağlı olduğu eğitim/kurs adını yazın.', 'warning');
    document.getElementById('materyal-egitim-adi').focus();
    return;
  }

  const dosya = _secilenMateryalDosya;
  const uzanti = (dosya.name.split('.').pop() || '').toLowerCase();
  const mimeType = uzanti === 'mp4' ? 'video/mp4' : 'application/pdf';

  _materyalYuklemeSuruyor = true;
  const btn = document.getElementById('btn-materyal-yukle');
  btn.disabled = true;
  btn.textContent = 'Yükleniyor...';

  try {
    materyalIlerleme(0, 'Drive yükleme oturumu açılıyor...');
    const baslat = await apiPost('materyal_yukle_baslat', {
      dosyaAdi: dosya.name,
      mimeType: mimeType,
      toplamBayt: dosya.size,
      egitimAdi: egitimAdi,
      materyalAdi: document.getElementById('materyal-adi').value.trim(),
      aciklama: document.getElementById('materyal-aciklama').value.trim()
    });
    if (!baslat || !baslat.success) throw new Error((baslat && baslat.error) || 'Oturum açılamadı.');

    // Parça boyutu Drive kuralı gereği 256 KB'ın katı olmalıdır.
    const parcaBayt = Number(baslat.parcaBayt) || (3 * 1024 * 1024);
    let gonderilen = 0;
    let tamamlandi = false;

    while (gonderilen < dosya.size) {
      const bitis = Math.min(gonderilen + parcaBayt, dosya.size);
      const parca = dosya.slice(gonderilen, bitis);
      const base64 = await blobBase64Oku(parca);

      const yanit = await apiPost('materyal_parca', {
        oturumId: baslat.oturumId,
        baslangic: gonderilen,
        veri: base64
      });
      if (!yanit || !yanit.success) throw new Error((yanit && yanit.error) || 'Parça gönderilemedi.');

      gonderilen = Number(yanit.yazilan) || bitis;
      tamamlandi = !!yanit.tamamlandi;
      const yuzde = Math.round((gonderilen / dosya.size) * 100);
      materyalIlerleme(yuzde, 'Yükleniyor... %' + yuzde +
        '  (' + baytOku(gonderilen) + ' / ' + baytOku(dosya.size) + ')');
    }

    if (!tamamlandi) throw new Error('Yükleme tamamlanamadı, lütfen tekrar deneyin.');

    materyalIlerleme(100, 'E-tabloya kaydediliyor...');
    const bitir = await apiPost('materyal_bitir', { oturumId: baslat.oturumId });
    if (!bitir || !bitir.success) throw new Error((bitir && bitir.error) || 'Kayıt yazılamadı.');

    materyalIlerleme(100, '✓ Yükleme tamamlandı.');
    showToast("Materyal Drive\u0027a yüklendi ve kaydedildi.", "success");
    materyalDosyaTemizle();
    document.getElementById('materyal-adi').value = '';
    document.getElementById('materyal-aciklama').value = '';
    await syncMateryaller(true);
    setTimeout(() => document.getElementById('materyal-ilerleme').classList.add('hidden'), 2500);
  } catch (err) {
    materyalIlerleme(0, '✗ ' + err.message);
    showToast('Yükleme başarısız: ' + err.message, 'danger');
  } finally {
    _materyalYuklemeSuruyor = false;
    btn.textContent = "⬆️ Drive\u0027a Yükle";
    btn.disabled = !_secilenMateryalDosya;
  }
}

let _matSyncIslemi = null;
async function syncMateryaller(sessiz) {
  if (_matSyncIslemi) return _matSyncIslemi;
  if (!sessiz) toggleLoading(true, 'Materyaller yükleniyor...');
  _matSyncIslemi = (async () => {
    const res = await apiPost('get_materyaller');
    if (res && res.success) {
      STATE.materyaller = res.materyaller || [];
      modulOnbellegeYaz('materyaller');
      renderMateryaller();
    } else if (!sessiz) {
      showToast('Materyaller alınamadı: ' + ((res && res.error) || ''), 'danger');
    }
    return res;
  })();
  try {
    return await _matSyncIslemi;
  } finally {
    _matSyncIslemi = null;
    if (!sessiz) toggleLoading(false);
  }
}

function renderMateryaller() {
  const liste = document.getElementById('materyal-liste');
  if (!liste) return;

  const aramaEl = document.getElementById('materyal-arama');
  const arama = aramaEl ? aramaEl.value.toLowerCase().trim() : '';
  const hepsi = STATE.materyaller || [];
  const kursAnahtari = _kursAnahtari(_materyalKursFiltresi);

  const suzulmus = hepsi.filter((m) => {
    // Önce kurs eşleştirmesi (bir eğitim kaydından gelindiyse)
    if (kursAnahtari && _kursAnahtari(m['Eğitim / Kurs Adı']) !== kursAnahtari) return false;
    if (!arama) return true;
    return String(m['Materyal Adı'] || '').toLowerCase().includes(arama)
      || String(m['Eğitim / Kurs Adı'] || '').toLowerCase().includes(arama)
      || String(m['Dosya Adı'] || '').toLowerCase().includes(arama);
  });

  // Etkin kurs süzgeci rozeti
  const cip = document.getElementById('materyal-kurs-cip');
  if (cip) {
    if (_materyalKursFiltresi) {
      cip.classList.remove('hidden');
      const ad = cip.querySelector('.materyal-cip-ad');
      if (ad) ad.textContent = _materyalKursFiltresi;
    } else {
      cip.classList.add('hidden');
    }
  }

  const sayac = document.getElementById('materyal-sayac');
  if (sayac) {
    sayac.textContent = _materyalKursFiltresi
      ? suzulmus.length + ' materyal (bu eğitim) · toplam ' + hepsi.length
      : 'Toplam: ' + hepsi.length + ' materyal';
  }

  // Eğitim adı önerileri (yükleme formundaki datalist)
  const dl = document.getElementById('materyal-egitim-listesi');
  if (dl) {
    const adlar = new Set();
    (STATE.egitim || []).map(normalizeEgitim).forEach((e) => { if (e.egitimAdi) adlar.add(e.egitimAdi); });
    hepsi.forEach((m) => { if (m['Eğitim / Kurs Adı']) adlar.add(String(m['Eğitim / Kurs Adı'])); });
    dl.innerHTML = [...adlar].map((a) => `<option value="${escapeHtml(a)}"></option>`).join('');
  }

  if (suzulmus.length === 0) {
    let bosMetin;
    if (_materyalKursFiltresi) {
      bosMetin = `“${escapeHtml(_materyalKursFiltresi)}” eğitimine henüz materyal yüklenmemiş. Yukarıdaki form bu kurs için hazır — ders notu veya video ekleyebilirsiniz.`;
    } else if (arama) {
      bosMetin = 'Aramanıza uygun materyal bulunamadı.';
    } else {
      bosMetin = 'Henüz materyal yüklenmemiş. Yukarıdaki formdan ders notu veya video ekleyebilirsiniz.';
    }
    liste.innerHTML = `<div class="materyal-bos">${bosMetin}</div>`;
    return;
  }

  const yazabilir = STATE.currentUser &&
    (STATE.currentUser.role === 'admin' || STATE.currentUser.role === 'editor');

  liste.innerHTML = [...suzulmus].reverse().map((m) => {
    const tur = String(m['Tür'] || 'PDF');
    const ikon = MATERYAL_TUR_IKON[tur] || '📄';
    const link = String(m['Görüntüleme Linki'] || '');
    const indir = String(m['İndirme Linki'] || '');
    return `
      <div class="materyal-kart">
        <div class="materyal-kart-ikon ${tur === 'Video' ? 'video' : 'pdf'}">${ikon}</div>
        <div class="materyal-kart-govde">
          <strong class="materyal-kart-ad">${escapeHtml(String(m['Materyal Adı'] || m['Dosya Adı'] || ''))}</strong>
          <span class="materyal-kart-kurs">${escapeHtml(String(m['Eğitim / Kurs Adı'] || ''))}</span>
          <span class="materyal-kart-meta">${tur} · ${escapeHtml(String(m['Boyut (MB)'] || '0'))} MB · ${escapeHtml(String(m['Yükleme Tarihi'] || ''))} · ${escapeHtml(String(m['Yükleyen'] || ''))}</span>
          ${m['Açıklama'] ? `<span class="materyal-kart-aciklama">${escapeHtml(String(m['Açıklama']))}</span>` : ''}
        </div>
        <div class="materyal-kart-islem">
          ${link ? `<button class="btn btn-sm btn-secondary" data-external-url="${escapeHtml(link)}">👁️ Aç</button>` : ''}
          ${indir ? `<button class="btn btn-sm btn-text" data-external-url="${escapeHtml(indir)}">⬇️ İndir</button>` : ''}
          ${yazabilir ? `<button class="btn btn-sm btn-text materyal-sil-btn" data-materyal-sil="${m._rowNum}" data-ad="${escapeHtml(String(m['Materyal Adı'] || ''))}">🗑️</button>` : ''}
        </div>
      </div>`;
  }).join('');
}

async function materyalSil(rowNum, ad) {
  // Kod tabanının geri kalanı gibi yerleşik confirm() kullanılır.
  const onay = confirm('“' + (ad || 'Bu materyal') + '” hem listeden hem Google Drive\u0027dan kaldırılacak.\n\nBu işlem geri alınamaz. Devam edilsin mi?');
  if (!onay) return;
  toggleLoading(true, 'Materyal siliniyor...');
  const res = await apiPost('materyal_sil', { rowNum: rowNum });
  toggleLoading(false);
  if (res && res.success) {
    showToast('Materyal silindi.', 'success');
    await syncMateryaller(true);
  } else {
    showToast('Silinemedi: ' + ((res && res.error) || ''), 'danger');
  }
}

// ==========================================================================
// KATILIM BELGESİ (Dijital Sertifika)
// ==========================================================================

function sertifikaKaydiNormalize(k) {
  return {
    sertifikaNo: String(k['Sertifika No'] || ''),
    dogrulamaKodu: String(k['Doğrulama Kodu'] || ''),
    katilimci: String(k['Katılımcı Ad Soyad'] || ''),
    egitimAdi: String(k['Eğitim / Kurs Adı'] || ''),
    atolye: String(k['Atölye / Dal'] || ''),
    egitimVeren: String(k['Eğitim Veren'] || ''),
    bitisTarihi: String(k['Bitiş Tarihi'] || ''),
    sure: String(k['Süre (Saat)'] || ''),
    verilisTarihi: String(k['Veriliş Tarihi'] || ''),
    duzenleyen: String(k['Düzenleyen'] || ''),
    durum: String(k['Durum'] || 'Geçerli'),
    _rowNum: k._rowNum
  };
}

let _sertSyncIslemi = null;
async function syncSertifikalar(sessiz) {
  if (_sertSyncIslemi) return _sertSyncIslemi;
  if (!sessiz) toggleLoading(true, 'Belgeler yükleniyor...');
  _sertSyncIslemi = (async () => {
    const res = await apiPost('get_sertifikalar');
    if (res && res.success) {
      STATE.sertifikalar = res.sertifikalar || [];
      modulOnbellegeYaz('sertifikalar');
    } else if (!sessiz) {
      showToast('Belgeler alınamadı: ' + ((res && res.error) || ''), 'danger');
    }
    renderSertifikaAdaylari();
    renderSertifikalar();
    return res;
  })();
  try {
    return await _sertSyncIslemi;
  } finally {
    _sertSyncIslemi = null;
    if (!sessiz) toggleLoading(false);
  }
}

// Durumu "Tamamlandı" olan eğitim kayıtları belge adayıdır.
function renderSertifikaAdaylari() {
  const tbody = document.getElementById('sertifika-aday-tbody');
  if (!tbody) return;

  const adaylar = (STATE.egitim || []).map(normalizeEgitim)
    .filter((e) => String(e.durum).trim() === 'Tamamlandı' && String(e.katilimciAd).trim());

  if (adaylar.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center">Belge düzenlenebilecek eğitim yok. Bir eğitimin durumu “Tamamlandı” yapıldığında burada görünür.</td></tr>`;
    return;
  }

  const verilmisKodlar = new Set(
    (STATE.sertifikalar || [])
      .filter((s) => String(s['Durum']) !== 'İptal')
      .map((s) => String(s['Eğitim Kayıt ID']))
  );
  const yazabilir = STATE.currentUser &&
    (STATE.currentUser.role === 'admin' || STATE.currentUser.role === 'editor');

  tbody.innerHTML = adaylar.map((e) => {
    const belgeVar = verilmisKodlar.has(String(e.id));
    return `
      <tr>
        <td data-label="Katılımcı"><strong>${escapeHtml(e.katilimciAd)}</strong></td>
        <td data-label="Eğitim / Kurs">${escapeHtml(e.egitimAdi)}</td>
        <td data-label="Atölye">${escapeHtml(e.atolye)}</td>
        <td data-label="Bitiş Tarihi">${escapeHtml(e.egitimTarihi)}</td>
        <td data-label="Belge">${belgeVar
          ? '<span class="badge badge-success">Düzenlendi</span>'
          : '<span class="badge badge-pending">Bekliyor</span>'}</td>
        <td data-label="İşlem" style="text-align:right;">
          ${yazabilir
            ? `<button class="btn btn-sm ${belgeVar ? 'btn-secondary' : 'btn-primary'}" data-sertifika-olustur="${e._rowNum}">${belgeVar ? '📄 Belgeyi Aç' : '🏅 Belge Düzenle'}</button>`
            : '<span class="text-muted">—</span>'}
        </td>
      </tr>`;
  }).join('');
}

function renderSertifikalar() {
  const tbody = document.getElementById('sertifika-tbody');
  if (!tbody) return;

  const aramaEl = document.getElementById('sertifika-arama');
  const arama = aramaEl ? aramaEl.value.toLowerCase().trim() : '';
  const liste = (STATE.sertifikalar || []).filter((s) => {
    if (!arama) return true;
    return String(s['Katılımcı Ad Soyad'] || '').toLowerCase().includes(arama)
      || String(s['Eğitim / Kurs Adı'] || '').toLowerCase().includes(arama)
      || String(s['Sertifika No'] || '').toLowerCase().includes(arama);
  });

  if (liste.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center">Henüz belge düzenlenmemiş.</td></tr>`;
    return;
  }

  tbody.innerHTML = [...liste].reverse().map((s) => {
    const iptal = String(s['Durum']) === 'İptal';
    return `
      <tr>
        <td data-label="Belge No"><code>${escapeHtml(String(s['Sertifika No'] || ''))}</code></td>
        <td data-label="Katılımcı"><strong>${escapeHtml(String(s['Katılımcı Ad Soyad'] || ''))}</strong></td>
        <td data-label="Eğitim / Kurs">${escapeHtml(String(s['Eğitim / Kurs Adı'] || ''))}</td>
        <td data-label="Veriliş">${escapeHtml(String(s['Veriliş Tarihi'] || ''))}</td>
        <td data-label="Durum"><span class="badge ${iptal ? 'badge-danger' : 'badge-success'}">${escapeHtml(String(s['Durum'] || 'Geçerli'))}</span></td>
        <td data-label="İşlem" style="text-align:right;">
          <button class="btn btn-sm btn-secondary" data-sertifika-goster="${escapeHtml(String(s['Doğrulama Kodu'] || ''))}">📄 Görüntüle / PDF</button>
        </td>
      </tr>`;
  }).join('');
}

// Belgeyi üretir (ya da zaten varsa mevcut olanı getirir) ve önizlemeyi açar.
async function sertifikaOlustur(rowNum) {
  toggleLoading(true, 'Katılım belgesi hazırlanıyor...');
  const res = await apiPost('sertifika_olustur', { rowNum: rowNum });
  toggleLoading(false);

  if (!res || !res.success) {
    showToast('Belge düzenlenemedi: ' + ((res && res.error) || 'bilinmeyen hata'), 'danger');
    return;
  }
  if (res.zatenVar) showToast('Bu katılımcı için belge zaten düzenlenmişti, mevcut belge açılıyor.', 'info');
  else showToast('Katılım belgesi düzenlendi.', 'success');

  await syncSertifikalar(true);
  await syncAllData(true);   // eğitim kaydındaki "Sertifika: Verildi" güncellensin
  sertifikaOnizle(res.sertifika);
}

// --- QR kod --------------------------------------------------------------
// qrcode-generator kütüphanesi yerel olarak paketlenir (vendor/qrcode.js);
// güvenlik politikası dış script yüklenmesine izin vermez.
function sertifikaQrDataUrl(icerik) {
  if (typeof qrcode === 'undefined') return '';
  try {
    // Tip 0 = otomatik sürüm seçimi, 'M' = %15 hata düzeltme (baskıda çizilse
    // bile okunabilir). Hücre 5px, kenar boşluğu 2 hücre.
    const qr = qrcode(0, 'M');
    qr.addData(icerik);
    qr.make();
    return qr.createDataURL(5, 2);
  } catch (err) {
    console.error('QR üretilemedi:', err);
    return '';
  }
}

// --- Belge tasarımı ------------------------------------------------------
function sertifikaHtmlUret(s) {
  const dogrulamaAdresi = sertifikaDogrulamaAdresi() + '?kod=' + encodeURIComponent(s.dogrulamaKodu);
  const qr = sertifikaQrDataUrl(dogrulamaAdresi);
  const tarihYaz = (t) => {
    if (!t) return '—';
    const d = new Date(t);
    if (isNaN(d.getTime())) return t;
    return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
  };
  const kurumLogo = STATE.institutionLogo
    ? `<img src="${STATE.institutionLogo}" alt="Kurum Logosu" class="sertifika-kurum-logo">` : '';

  return `
    <div class="sertifika-sayfa" id="sertifika-yazdirilabilir">
      <div class="sertifika-cerceve">
        <div class="sertifika-ust">
          ${kurumLogo}
          <div class="sertifika-kurum">
            <div class="sertifika-kurum-ad">T.C. MİLLÎ EĞİTİM BAKANLIĞI</div>
            <div class="sertifika-kurum-alt">Edirne Olgunlaşma Enstitüsü</div>
          </div>
        </div>

        <div class="sertifika-baslik">KATILIM BELGESİ</div>
        <div class="sertifika-ayrac"><span></span>❖<span></span></div>

        <div class="sertifika-govde">
          <p class="sertifika-giris">Bu belge,</p>
          <p class="sertifika-isim">${escapeHtml(s.katilimci)}</p>
          <p class="sertifika-metin">
            adlı katılımcının, enstitümüz bünyesinde düzenlenen
            <strong>${escapeHtml(s.egitimAdi)}</strong>
            ${s.atolye ? `(${escapeHtml(s.atolye)} Atölyesi)` : ''} programını
            ${s.sure ? `<strong>${escapeHtml(s.sure)} saat</strong> süreyle` : ''}
            başarıyla tamamladığını belgelemek üzere düzenlenmiştir.
          </p>
          <p class="sertifika-tarih">Eğitim Bitiş Tarihi: <strong>${tarihYaz(s.bitisTarihi)}</strong></p>
        </div>

        <div class="sertifika-alt">
          <div class="sertifika-imza">
            <div class="sertifika-imza-cizgi"></div>
            <div class="sertifika-imza-ad">${escapeHtml(s.egitimVeren || '—')}</div>
            <div class="sertifika-imza-unvan">Eğitim Veren / Usta Öğretici</div>
          </div>

          <div class="sertifika-qr-kutu">
            ${qr ? `<img src="${qr}" alt="Doğrulama QR Kodu" class="sertifika-qr">` : '<div class="sertifika-qr-yok">QR üretilemedi</div>'}
            <div class="sertifika-qr-metin">Belgeyi doğrulamak için<br>QR kodu okutun</div>
          </div>

          <div class="sertifika-imza">
            <div class="sertifika-imza-cizgi"></div>
            <div class="sertifika-imza-ad">Kurum Müdürü</div>
            <div class="sertifika-imza-unvan">Edirne Olgunlaşma Enstitüsü</div>
          </div>
        </div>

        <div class="sertifika-dipnot">
          <div><span class="sertifika-etiket">Belge No:</span> ${escapeHtml(s.sertifikaNo)}</div>
          <div><span class="sertifika-etiket">Veriliş:</span> ${tarihYaz(s.verilisTarihi)}</div>
          <div class="sertifika-kod"><span class="sertifika-etiket">Doğrulama Kodu:</span> ${escapeHtml(s.dogrulamaKodu)}</div>
        </div>
      </div>
    </div>`;
}

function sertifikaOnizle(s) {
  if (!s) return;
  _aktifSertifika = s;
  const kap = document.getElementById('sertifika-onizleme');
  if (!kap) return;
  kap.innerHTML = sertifikaHtmlUret(s);

  const bilgi = document.getElementById('sertifika-dialog-bilgi');
  if (bilgi) {
    bilgi.textContent = s.katilimci + ' · ' + s.egitimAdi + ' · Belge No: ' + s.sertifikaNo;
  }
  document.getElementById('dialog-sertifika').showModal();
}

async function sertifikaPdfIndir() {
  if (!_aktifSertifika) return;
  const element = document.getElementById('sertifika-yazdirilabilir');
  if (!element) return;

  // PDF motoru istek üzerine yüklenir (açılışı yavaşlatmasın diye).
  if (!(await pdfMotoruHazirla())) return;

  const temizAd = String(_aktifSertifika.katilimci || 'katilimci')
    .replace(/[^\wğüşıöçĞÜŞİÖÇ ]/g, '').trim().replace(/\s+/g, '_');

  const opt = {
    margin: 0,
    filename: `Katilim_Belgesi_${temizAd}_${_aktifSertifika.sertifikaNo}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, letterRendering: true, backgroundColor: '#ffffff' },
    // Katılım belgesi yatay (landscape) A4 olarak basılır
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
  };

  showToast('Belge PDF olarak hazırlanıyor...', 'info');
  html2pdf().set(opt).from(element).save()
    .then(() => showToast('Katılım belgesi indirildi.', 'success'))
    .catch((err) => {
      console.error('Sertifika PDF hatası:', err);
      showToast('PDF oluşturulamadı: ' + err.message, 'danger');
    });
}


// ==========================================================================
// 6.9 GELİŞMİŞ ETİKETLEME (çoklu seçim) — YAPAY ZEKÂ HAZIRLIĞI
// --------------------------------------------------------------------------
// Eser ve prototip kayıtlarına, makine tarafından çözümlenebilir yapılandırılmış
// etiketler eklenir. Değerler e-tabloya VİRGÜLLE AYRILMIŞ metin olarak yazılır:
// e-tabloda okunabilir kalır, ileride bir modele beslenirken kolayca ayrışır.
//
// Sözlükler başlangıç önerisidir; kullanıcı listede olmayan bir değeri yazıp
// Enter'a basarak ekleyebilir (kapalı liste değildir — alan zamanla zenginleşir).
// ==========================================================================
const ETIKET_SOZLUKLERI = {
  motif: [
    'Rumi', 'Hatayi', 'Penç', 'Şemse', 'Zencerek', 'Münhani', 'Palmet',
    'Lale', 'Karanfil', 'Gül', 'Sümbül', 'Nar Çiçeği', 'Bahar Dalı', 'Selvi',
    'Çintemani (Bulut)', 'Elibelinde', 'Koçboynuzu', 'Bereket', 'Yıldız',
    'Su Yolu', 'Geometrik Geçme', 'Kırkbudak', 'Aşk Merdiveni'
  ],
  renk: [
    'Osmanlı Kırmızısı #A31F34', 'Selçuklu Turkuazı #1BA1A1', 'Hatai Lacivert #1F3A93',
    'Altın Sarısı #D4AF37', 'Zümrüt Yeşili #0F7B6C', 'Gül Kurusu #B76E79',
    'Vişne Çürüğü #6E1423', 'Fildişi #F5F0E1', 'Çivit Mavisi #3A5BA0',
    'Safran #F0A202', 'Patlıcan Moru #4B0082', 'Bakır #B87333'
  ],
  donem: [
    'Selçuklu (11-13. yy)', 'Beylikler (13-15. yy)', 'Erken Osmanlı (14-15. yy)',
    'Klasik Osmanlı (16-17. yy)', 'Lale Devri (18. yy)',
    'Geç Osmanlı / Batılılaşma (19. yy)', 'Cumhuriyet (20. yy)', 'Çağdaş (21. yy)'
  ],
  materyal: [
    'İpek', 'Pamuk', 'Yün', 'Keten', 'Keçe', 'Kadife', 'Atlas', 'Tül',
    'Deri', 'Ahşap', 'Sedef', 'Bakır', 'Gümüş', 'Altın Sim', 'Gümüş Sim',
    'Cam', 'Seramik / Çini', 'Kâğıt', 'Boncuk', 'Tel Kırma', 'Sırma', 'Bambu'
  ],
  kategori: [
    'Kumaş ve Tekstil', 'İplik ve Sim', 'Boya ve Kimyasal', 'Ahşap ve Kereste',
    'Metal ve Tel', 'Seramik ve Kil', 'Cam Malzeme', 'Deri ve Kösele',
    'Boncuk ve Aksesuar', 'Kâğıt ve Karton', 'Ambalaj ve Poşet',
    'Atölye Sarf Malzemesi', 'Makine ve Ekipman', 'Diğer'
  ]
};

// Etiket dizisini e-tabloya yazılacak metne çevirir (ve tersi)
function etiketleriMetne(dizi) {
  return (dizi || []).filter(Boolean).join(', ');
}
function metniEtiketlere(metin) {
  return String(metin || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

// Bir .etiket-secici kabuğunu kurar. data-sozluk: ETIKET_SOZLUKLERI anahtarı,
// data-hedef: değerin yazılacağı gizli input id'si.
function etiketSeciciKur(kok) {
  if (!kok || kok.dataset.kurulu === '1') return;
  kok.dataset.kurulu = '1';

  const sozlukAdi = kok.getAttribute('data-sozluk') || '';
  const secenekler = ETIKET_SOZLUKLERI[sozlukAdi] || [];
  const listeId = 'etiket-liste-' + sozlukAdi + '-' + Math.random().toString(36).slice(2, 8);

  kok.innerHTML = `
    <div class="etiket-cipler"></div>
    <div class="etiket-girdi-satiri">
      <input type="text" class="etiket-girdi" list="${listeId}" placeholder="Seçin veya yazıp Enter'a basın..." autocomplete="off">
      <datalist id="${listeId}">${secenekler.map((o) => `<option value="${escapeHtml(o)}"></option>`).join('')}</datalist>
      <button type="button" class="etiket-ekle-btn" title="Ekle">＋</button>
    </div>
    <div class="etiket-hizli">${secenekler.slice(0, 6).map((o) =>
      `<button type="button" class="etiket-hizli-btn" data-deger="${escapeHtml(o)}">${escapeHtml(o)}</button>`).join('')}</div>
  `;

  const girdi = kok.querySelector('.etiket-girdi');
  const ekleBtn = kok.querySelector('.etiket-ekle-btn');

  const ekle = (deger) => {
    const temiz = String(deger || '').trim();
    if (!temiz) return;
    const mevcut = etiketDegerAl(kok);
    // Aynı etiket iki kez eklenmesin (Türkçe harf duyarsız)
    if (mevcut.some((x) => x.toLocaleLowerCase('tr-TR') === temiz.toLocaleLowerCase('tr-TR'))) {
      girdi.value = '';
      return;
    }
    mevcut.push(temiz);
    etiketDegerYaz(kok, mevcut);
    girdi.value = '';
  };

  girdi.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); ekle(girdi.value); }
    // Boş girdide geri tuşu son etiketi siler
    if (e.key === 'Backspace' && !girdi.value) {
      const mevcut = etiketDegerAl(kok);
      if (mevcut.length) { mevcut.pop(); etiketDegerYaz(kok, mevcut); }
    }
  });
  // Listeden seçim yapıldığında da eklensin
  girdi.addEventListener('change', () => { if (girdi.value) ekle(girdi.value); });
  ekleBtn.addEventListener('click', () => ekle(girdi.value));

  kok.querySelectorAll('.etiket-hizli-btn').forEach((b) => {
    b.addEventListener('click', () => ekle(b.getAttribute('data-deger')));
  });

  kok.querySelector('.etiket-cipler').addEventListener('click', (e) => {
    const sil = e.target.closest('[data-etiket-sil]');
    if (!sil) return;
    const mevcut = etiketDegerAl(kok);
    mevcut.splice(parseInt(sil.getAttribute('data-etiket-sil'), 10), 1);
    etiketDegerYaz(kok, mevcut);
  });

  etiketDegerYaz(kok, etiketDegerAl(kok));   // ilk çizim
}

function _etiketHedefi(kok) {
  const id = kok.getAttribute('data-hedef');
  return id ? document.getElementById(id) : null;
}

function etiketDegerAl(kok) {
  const hedef = _etiketHedefi(kok);
  return metniEtiketlere(hedef ? hedef.value : '');
}

function etiketDegerYaz(kok, dizi) {
  const hedef = _etiketHedefi(kok);
  const metin = etiketleriMetne(dizi);
  if (hedef) hedef.value = metin;

  const kutu = kok.querySelector('.etiket-cipler');
  if (!kutu) return;
  const liste = metniEtiketlere(metin);
  if (liste.length === 0) {
    kutu.innerHTML = '<span class="etiket-bos">Henüz etiket eklenmedi</span>';
    return;
  }
  kutu.innerHTML = liste.map((e, i) => {
    // "Ad #RRGGBB" biçimindeki renk etiketlerinde küçük bir renk noktası göster
    const renk = e.match(/#([0-9a-fA-F]{6})\b/);
    const nokta = renk ? `<span class="etiket-renk-nokta" style="background:#${renk[1]}"></span>` : '';
    return `<span class="etiket-cip">${nokta}${escapeHtml(e)}<button type="button" data-etiket-sil="${i}" title="Kaldır">×</button></span>`;
  }).join('');
}

// Sayfadaki tüm etiket seçicileri kurar (yeni eklenenler dahil)
function tumEtiketSecicileriKur() {
  document.querySelectorAll('.etiket-secici').forEach(etiketSeciciKur);
}

// Eser düzenleme modalı açıldığında etiketleri e-tablo değerlerinden doldurur
function esereEtiketleriYukle(item) {
  const eslesme = [
    ['edit-etiket-motif', 'Geleneksel Motif'],
    ['edit-etiket-renk', 'Renk Paleti Kodu'],
    ['edit-etiket-donem', 'Dönem / Yüzyıl'],
    ['edit-etiket-materyal', 'Materyal Tipi']
  ];
  eslesme.forEach(([inputId, sutun]) => {
    const hedef = document.getElementById(inputId);
    if (!hedef) return;
    const anahtar = getActualKey(item, sutun);
    hedef.value = String((item && item[anahtar]) || '');
    const kok = document.querySelector(`.etiket-secici[data-hedef="${inputId}"]`);
    if (kok) etiketDegerYaz(kok, metniEtiketlere(hedef.value));
  });
}

// ==========================================================================
// 6.10 DİJİTAL PROTOTİP ARŞİVİ (3D model meta verisi)
// --------------------------------------------------------------------------
// Dosyanın kendisi Drive'a, meta verisi e-tabloya gider. Yükleme, eğitim
// materyalleriyle AYNI parçalı yolu kullanır (materyal_parca ucu dosya
// türünden bağımsızdır); yalnızca başlangıç ve bitiş eylemleri farklıdır.
// ==========================================================================
const PROTOTIP_IZINLI_UZANTILAR = ['obj', 'stl', 'cad', 'step', 'stp', '3mf', 'glb'];
const PROTOTIP_MAX_BAYT = 200 * 1024 * 1024;
const PROTOTIP_FORMAT_IKON = {
  'OBJ': '🧊', 'STL': '🖨️', 'CAD': '📐', 'STEP': '⚙️', '3MF': '🧱', 'glTF': '✨'
};

let _secilenPrototipDosya = null;
let _prototipYuklemeSuruyor = false;

function initPrototipArsivi() {
  const dosyaInput = document.getElementById('prototip-dosya');
  const alan = document.getElementById('prototip-dosya-alani');
  if (alan && dosyaInput) {
    alan.addEventListener('click', (e) => {
      if (e.target.closest('#prototip-dosya-kaldir')) return;
      dosyaInput.click();
    });
    dosyaInput.addEventListener('change', () => {
      if (dosyaInput.files && dosyaInput.files[0]) prototipDosyaSec(dosyaInput.files[0]);
    });
    ['dragenter', 'dragover'].forEach((o) =>
      alan.addEventListener(o, (e) => { e.preventDefault(); alan.classList.add('surukleniyor'); }));
    ['dragleave', 'drop'].forEach((o) =>
      alan.addEventListener(o, (e) => { e.preventDefault(); alan.classList.remove('surukleniyor'); }));
    alan.addEventListener('drop', (e) => {
      const d = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (d) prototipDosyaSec(d);
    });
  }

  const kaldir = document.getElementById('prototip-dosya-kaldir');
  if (kaldir) kaldir.addEventListener('click', (e) => { e.stopPropagation(); prototipDosyaTemizle(); });

  const yukleBtn = document.getElementById('btn-prototip-yukle');
  if (yukleBtn) yukleBtn.addEventListener('click', prototipYukle);

  const yenile = document.getElementById('btn-prototip-yenile');
  if (yenile) yenile.addEventListener('click', () => syncPrototipler(false));

  const arama = document.getElementById('prototip-arama');
  if (arama) arama.addEventListener('input', renderPrototipler);
  const formatFiltre = document.getElementById('prototip-format-filtre');
  if (formatFiltre) formatFiltre.addEventListener('change', renderPrototipler);

  const liste = document.getElementById('prototip-liste');
  if (liste) {
    liste.addEventListener('click', (e) => {
      const sil = e.target.closest('[data-prototip-sil]');
      if (sil) { prototipSil(sil.getAttribute('data-prototip-sil'), sil.getAttribute('data-ad')); return; }
    });
  }
}

function prototipDosyaSec(dosya) {
  // 3D dosyalarda tarayıcı MIME üretmez; denetim UZANTIYA göre yapılır.
  const uzanti = (dosya.name.split('.').pop() || '').toLowerCase();
  if (PROTOTIP_IZINLI_UZANTILAR.indexOf(uzanti) === -1) {
    showToast('Desteklenmeyen dosya türü (.' + uzanti + '). İzinli: ' +
      PROTOTIP_IZINLI_UZANTILAR.map((u) => '.' + u).join(', '), 'warning');
    return;
  }
  if (dosya.size > PROTOTIP_MAX_BAYT) {
    showToast('Dosya çok büyük (' + baytOku(dosya.size) + '). Üst sınır 200 MB.', 'danger');
    return;
  }

  _secilenPrototipDosya = dosya;
  document.getElementById('prototip-dosya-bos').classList.add('hidden');
  document.getElementById('prototip-dosya-secili').classList.remove('hidden');
  document.getElementById('prototip-dosya-ad').textContent = dosya.name;
  document.getElementById('prototip-dosya-boyut').textContent =
    baytOku(dosya.size) + ' · ' + uzanti.toUpperCase() + ' modeli';
  document.getElementById('btn-prototip-yukle').disabled = false;

  const adAlani = document.getElementById('prototip-adi');
  if (adAlani && !adAlani.value.trim()) adAlani.value = dosya.name.replace(/\.[^.]+$/, '');
}

function prototipDosyaTemizle() {
  _secilenPrototipDosya = null;
  const input = document.getElementById('prototip-dosya');
  if (input) input.value = '';
  document.getElementById('prototip-dosya-bos').classList.remove('hidden');
  document.getElementById('prototip-dosya-secili').classList.add('hidden');
  document.getElementById('btn-prototip-yukle').disabled = true;
}

function prototipIlerleme(yuzde, metin) {
  const kutu = document.getElementById('prototip-ilerleme');
  const dolu = document.getElementById('prototip-ilerleme-dolu');
  const yazi = document.getElementById('prototip-ilerleme-metin');
  if (kutu) kutu.classList.remove('hidden');
  if (dolu) dolu.style.width = Math.max(0, Math.min(100, yuzde)) + '%';
  if (yazi) yazi.textContent = metin;
}

async function prototipYukle() {
  if (_prototipYuklemeSuruyor) return;
  if (!_secilenPrototipDosya) { showToast('Önce bir 3D dosya seçin.', 'warning'); return; }

  const ad = document.getElementById('prototip-adi').value.trim();
  if (!ad) {
    showToast('Prototip adı zorunludur.', 'warning');
    document.getElementById('prototip-adi').focus();
    return;
  }

  const dosya = _secilenPrototipDosya;
  _prototipYuklemeSuruyor = true;
  const btn = document.getElementById('btn-prototip-yukle');
  btn.disabled = true;
  btn.textContent = 'Yükleniyor...';

  const deger = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };

  try {
    prototipIlerleme(0, 'Drive yükleme oturumu açılıyor...');
    const baslat = await apiPost('prototip_yukle_baslat', {
      dosyaAdi: dosya.name,
      toplamBayt: dosya.size,
      prototipAdi: ad,
      envanterNo: deger('prototip-envanter'),
      tasarimci: deger('prototip-tasarimci'),
      varyasyon: deger('prototip-varyasyon'),
      motif: deger('prototip-etiket-motif'),
      renkPaleti: deger('prototip-etiket-renk'),
      donem: deger('prototip-etiket-donem'),
      materyalTipi: deger('prototip-etiket-materyal'),
      notlar: deger('prototip-notlar')
    });
    if (!baslat || !baslat.success) throw new Error((baslat && baslat.error) || 'Oturum açılamadı.');

    const parcaBayt = Number(baslat.parcaBayt) || (3 * 1024 * 1024);
    let gonderilen = 0;
    let tamamlandi = false;

    while (gonderilen < dosya.size) {
      const bitis = Math.min(gonderilen + parcaBayt, dosya.size);
      const base64 = await blobBase64Oku(dosya.slice(gonderilen, bitis));
      // Parça ucu materyallerle ortaktır: oturum kimliğiyle çalışır, tür bilmez.
      const yanit = await apiPost('materyal_parca', {
        oturumId: baslat.oturumId, baslangic: gonderilen, veri: base64
      });
      if (!yanit || !yanit.success) throw new Error((yanit && yanit.error) || 'Parça gönderilemedi.');
      gonderilen = Number(yanit.yazilan) || bitis;
      tamamlandi = !!yanit.tamamlandi;
      const yuzde = Math.round((gonderilen / dosya.size) * 100);
      prototipIlerleme(yuzde, 'Yükleniyor... %' + yuzde +
        '  (' + baytOku(gonderilen) + ' / ' + baytOku(dosya.size) + ')');
    }
    if (!tamamlandi) throw new Error('Yükleme tamamlanamadı, tekrar deneyin.');

    prototipIlerleme(100, 'Meta veri kaydediliyor...');
    const bitir = await apiPost('prototip_bitir', { oturumId: baslat.oturumId });
    if (!bitir || !bitir.success) throw new Error((bitir && bitir.error) || 'Kayıt yazılamadı.');

    prototipIlerleme(100, '✓ Prototip arşive eklendi.');
    showToast('3D prototip arşive eklendi.', 'success');
    prototipFormuTemizle();
    await syncPrototipler(true);
    setTimeout(() => document.getElementById('prototip-ilerleme').classList.add('hidden'), 2500);
  } catch (err) {
    prototipIlerleme(0, '✗ ' + err.message);
    showToast('Yükleme başarısız: ' + err.message, 'danger');
  } finally {
    _prototipYuklemeSuruyor = false;
    btn.textContent = '⬆️ Arşive Yükle';
    btn.disabled = !_secilenPrototipDosya;
  }
}

function prototipFormuTemizle() {
  prototipDosyaTemizle();
  ['prototip-adi', 'prototip-envanter', 'prototip-tasarimci', 'prototip-varyasyon', 'prototip-notlar']
    .forEach((id) => { const el = document.getElementById(id); if (el) el.value = ''; });
  ['prototip-etiket-motif', 'prototip-etiket-renk', 'prototip-etiket-donem', 'prototip-etiket-materyal']
    .forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
      const kok = document.querySelector(`.etiket-secici[data-hedef="${id}"]`);
      if (kok) etiketDegerYaz(kok, []);
    });
}

let _protoSyncIslemi = null;
async function syncPrototipler(sessiz) {
  if (_protoSyncIslemi) return _protoSyncIslemi;
  if (!sessiz) toggleLoading(true, 'Prototip arşivi yükleniyor...');
  _protoSyncIslemi = (async () => {
    const res = await apiPost('get_prototipler');
    if (res && res.success) {
      STATE.prototipler = res.prototipler || [];
      modulOnbellegeYaz('prototipler');
      renderPrototipler();
    } else if (!sessiz) {
      showToast('Prototipler alınamadı: ' + ((res && res.error) || ''), 'danger');
    }
    return res;
  })();
  try {
    return await _protoSyncIslemi;
  } finally {
    _protoSyncIslemi = null;
    if (!sessiz) toggleLoading(false);
  }
}

function renderPrototipler() {
  const liste = document.getElementById('prototip-liste');
  if (!liste) return;

  const aramaEl = document.getElementById('prototip-arama');
  const arama = aramaEl ? aramaEl.value.toLowerCase().trim() : '';
  const formatEl = document.getElementById('prototip-format-filtre');
  const format = formatEl ? formatEl.value : '';

  const hepsi = STATE.prototipler || [];
  const suzulmus = hepsi.filter((p) => {
    if (format && String(p['Format']) !== format) return false;
    if (!arama) return true;
    // Etiketler de aranabilir: motif/dönem/materyal üzerinden arşiv taranabilsin
    return ['Prototip Adı', 'İlişkili Envanter No', 'Tasarımcı', 'Varyasyon',
            'Geleneksel Motif', 'Renk Paleti Kodu', 'Dönem / Yüzyıl', 'Materyal Tipi', 'Dosya Adı']
      .some((k) => String(p[k] || '').toLowerCase().includes(arama));
  });

  const sayac = document.getElementById('prototip-sayac');
  if (sayac) {
    sayac.textContent = (arama || format)
      ? suzulmus.length + ' / ' + hepsi.length + ' prototip'
      : 'Toplam: ' + hepsi.length + ' prototip';
  }

  // Öneri listeleri: envanter numaraları ve tasarımcılar
  const envDl = document.getElementById('prototip-envanter-listesi');
  if (envDl) {
    const nolar = (STATE.inventory || [])
      .map((i) => String(i[getActualKey(i, 'Envanter No')] || '').trim())
      .filter(Boolean).slice(0, 400);
    envDl.innerHTML = [...new Set(nolar)].map((n) => `<option value="${escapeHtml(n)}"></option>`).join('');
  }
  const tasDl = document.getElementById('prototip-tasarimci-listesi');
  if (tasDl) {
    const adlar = new Set();
    (STATE.users || []).forEach((u) => { if (u.name) adlar.add(u.name); });
    hepsi.forEach((p) => { if (p['Tasarımcı']) adlar.add(String(p['Tasarımcı'])); });
    tasDl.innerHTML = [...adlar].map((a) => `<option value="${escapeHtml(a)}"></option>`).join('');
  }

  if (suzulmus.length === 0) {
    liste.innerHTML = `<div class="materyal-bos">${(arama || format)
      ? 'Aramanıza uygun prototip bulunamadı.'
      : 'Arşiv henüz boş. Yukarıdaki formdan .obj, .stl veya .cad dosyası yükleyebilirsiniz.'}</div>`;
    return;
  }

  const yazabilir = STATE.currentUser &&
    (STATE.currentUser.role === 'admin' || STATE.currentUser.role === 'editor');

  const etiketSatiri = (p) => {
    const gruplar = [
      ['Motif', p['Geleneksel Motif']],
      ['Dönem', p['Dönem / Yüzyıl']],
      ['Materyal', p['Materyal Tipi']],
      ['Renk', p['Renk Paleti Kodu']]
    ].filter(([, v]) => String(v || '').trim());
    if (!gruplar.length) return '';
    return `<div class="prototip-etiketler">` + gruplar.map(([ad, v]) =>
      metniEtiketlere(v).map((e) => {
        const renk = e.match(/#([0-9a-fA-F]{6})\b/);
        const nokta = renk ? `<span class="etiket-renk-nokta" style="background:#${renk[1]}"></span>` : '';
        return `<span class="prototip-etiket" title="${escapeHtml(ad)}">${nokta}${escapeHtml(e)}</span>`;
      }).join('')).join('') + `</div>`;
  };

  liste.innerHTML = [...suzulmus].reverse().map((p) => {
    const fmt = String(p['Format'] || '');
    const link = String(p['Görüntüleme Linki'] || '');
    const indir = String(p['İndirme Linki'] || '');
    return `
      <div class="prototip-kart">
        <div class="prototip-kart-ust">
          <div class="prototip-format">${PROTOTIP_FORMAT_IKON[fmt] || '🧊'}<span>${escapeHtml(fmt)}</span></div>
          <div class="prototip-kart-bilgi">
            <strong>${escapeHtml(String(p['Prototip Adı'] || p['Dosya Adı'] || ''))}</strong>
            <span class="prototip-meta">
              ${p['İlişkili Envanter No'] ? `<code>${escapeHtml(String(p['İlişkili Envanter No']))}</code> · ` : ''}
              ${escapeHtml(String(p['Boyut (MB)'] || '0'))} MB
              ${p['Varyasyon'] ? ` · ${escapeHtml(String(p['Varyasyon']))}` : ''}
            </span>
            <span class="prototip-meta2">
              ${p['Tasarımcı'] ? `👤 ${escapeHtml(String(p['Tasarımcı']))} · ` : ''}
              ${escapeHtml(String(p['Kayıt Tarihi'] || ''))}
            </span>
          </div>
          <div class="prototip-islem">
            ${link ? `<button class="btn btn-sm btn-secondary" data-external-url="${escapeHtml(link)}">👁️ Aç</button>` : ''}
            ${indir ? `<button class="btn btn-sm btn-text" data-external-url="${escapeHtml(indir)}">⬇️</button>` : ''}
            ${yazabilir ? `<button class="btn btn-sm btn-text materyal-sil-btn" data-prototip-sil="${p._rowNum}" data-ad="${escapeHtml(String(p['Prototip Adı'] || ''))}">🗑️</button>` : ''}
          </div>
        </div>
        ${etiketSatiri(p)}
        ${p['Notlar'] ? `<div class="prototip-not">${escapeHtml(String(p['Notlar']))}</div>` : ''}
      </div>`;
  }).join('');
}

async function prototipSil(rowNum, ad) {
  const onay = confirm('“' + (ad || 'Bu prototip') + '” arşivden ve Google Drive\u0027dan kaldırılacak.\n\nBu işlem geri alınamaz. Devam edilsin mi?');
  if (!onay) return;
  toggleLoading(true, 'Prototip siliniyor...');
  const res = await apiPost('prototip_sil', { rowNum: rowNum });
  toggleLoading(false);
  if (res && res.success) {
    showToast('Prototip arşivden kaldırıldı.', 'success');
    await syncPrototipler(true);
  } else {
    showToast('Silinemedi: ' + ((res && res.error) || ''), 'danger');
  }
}

// ==========================================================================
// 6.11 TEDARİK ZİNCİRİ ve DIŞ PAYDAŞ (B2B) AĞI
// --------------------------------------------------------------------------
// Firma rehberi + atölye hammadde talepleri + alım raporu.
// Talep e-postası iki yolla gönderilebilir:
//   1) Kurum adına, Apps Script (MailApp) üzerinden — kayıtla birlikte gider,
//      denetim günlüğüne düşer. Varsayılan yol budur.
//   2) mailto: ile kullanıcının kendi e-posta programında taslak olarak açılır —
//      yanıtların kişisel kutuya düşmesi istendiğinde kullanılır.
// ==========================================================================
const TEDARIK_DURUM_SINIF = {
  'Talep': 'badge-pending',
  'Sipariş Verildi': 'badge-role',
  'Teslim Alındı': 'badge-success',
  'İptal': 'badge-danger'
};

// Pasta grafiklerde kullanılan palet (dataviz ile tutarlı, koyu zeminde okunur)
const TEDARIK_PALET = [
  '#9c27b0', '#d4af37', '#009688', '#3f51b5', '#e91e63',
  '#ff9800', '#4caf50', '#795548', '#00bcd4', '#8bc34a',
  '#ff5722', '#607d8b'
];

function initTedarikAgi() {
  // Alt sekmeler (Rehber / Siparişler / Rapor)
  document.querySelectorAll('[data-tedarik-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      const hedef = tab.getAttribute('data-tedarik-tab');
      document.querySelectorAll('[data-tedarik-tab]').forEach((t) => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.tedarik-panel').forEach((p) => {
        p.classList.toggle('hidden', p.id !== hedef);
        p.classList.toggle('active', p.id === hedef);
      });
      if (hedef === 'tedarik-rapor') renderTedarikRaporu();
    });
  });

  const yenile = document.getElementById('btn-tedarik-yenile');
  if (yenile) yenile.addEventListener('click', () => syncTedarik(false));

  const ekle = document.getElementById('btn-tedarikci-ekle');
  if (ekle) ekle.addEventListener('click', () => tedarikciModaliAc(null));

  ['tedarikci-arama', 'tedarikci-tur-filtre'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', renderTedarikciler);
    if (el) el.addEventListener('change', renderTedarikciler);
  });
  ['siparis-arama', 'siparis-durum-filtre'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', renderSiparisler);
    if (el) el.addEventListener('change', renderSiparisler);
  });

  const liste = document.getElementById('tedarikci-liste');
  if (liste) {
    liste.addEventListener('click', (e) => {
      const duzenle = e.target.closest('[data-tedarikci-duzenle]');
      if (duzenle) { tedarikciModaliAc(duzenle.getAttribute('data-tedarikci-duzenle')); return; }
      const sil = e.target.closest('[data-tedarikci-sil]');
      if (sil) { tedarikciSil(sil.getAttribute('data-tedarikci-sil'), sil.getAttribute('data-ad')); return; }
      const siparis = e.target.closest('[data-tedarikci-siparis]');
      if (siparis) { siparisModaliAc(siparis.getAttribute('data-tedarikci-siparis')); return; }
    });
  }

  const siparisTbody = document.getElementById('siparis-tbody');
  if (siparisTbody) {
    siparisTbody.addEventListener('change', (e) => {
      const sec = e.target.closest('[data-siparis-durum]');
      if (sec) siparisDurumGuncelle(sec.getAttribute('data-siparis-durum'), sec.value);
    });
  }

  const yeniSiparis = document.getElementById('btn-siparis-olustur');
  if (yeniSiparis) yeniSiparis.addEventListener('click', () => siparisModaliAc(null));

  // Tedarikçi penceresi
  ['btn-tedarikci-kapat-x', 'btn-tedarikci-vazgec'].forEach((id) => {
    const b = document.getElementById(id);
    if (b) b.addEventListener('click', () => document.getElementById('dialog-tedarikci').close());
  });
  const kaydet = document.getElementById('btn-tedarikci-kaydet');
  if (kaydet) kaydet.addEventListener('click', tedarikciKaydet);

  // Sipariş penceresi
  ['btn-siparis-kapat-x', 'btn-siparis-vazgec'].forEach((id) => {
    const b = document.getElementById(id);
    if (b) b.addEventListener('click', () => document.getElementById('dialog-siparis').close());
  });
  const sipKaydet = document.getElementById('btn-siparis-kaydet');
  if (sipKaydet) sipKaydet.addEventListener('click', siparisKaydet);
  const mailto = document.getElementById('btn-siparis-mailto');
  if (mailto) mailto.addEventListener('click', siparisMailtoAc);

  const sipSecim = document.getElementById('siparis-tedarikci');
  if (sipSecim) sipSecim.addEventListener('change', siparisTedarikciBilgisiGoster);
}

let _tedSyncIslemi = null;
async function syncTedarik(sessiz) {
  if (_tedSyncIslemi) return _tedSyncIslemi;
  if (!sessiz) toggleLoading(true, 'Tedarik verileri yükleniyor...');
  _tedSyncIslemi = (async () => {
    const res = await apiPost('get_tedarik_verileri');
    if (res && res.success) {
      STATE.tedarikciler = res.tedarikciler || [];
      STATE.siparisler = res.siparisler || [];
      modulOnbellegeYaz('tedarik');
    } else if (!sessiz) {
      showToast('Tedarik verileri alınamadı: ' + ((res && res.error) || ''), 'danger');
    }
    renderTedarikciler();
    renderSiparisler();
    renderTedarikRaporu();
    return res;
  })();
  try {
    return await _tedSyncIslemi;
  } finally {
    _tedSyncIslemi = null;
    if (!sessiz) toggleLoading(false);
  }
}

// --- Firma Rehberi -------------------------------------------------------
function renderTedarikciler() {
  const liste = document.getElementById('tedarikci-liste');
  if (!liste) return;

  const aramaEl = document.getElementById('tedarikci-arama');
  const arama = aramaEl ? aramaEl.value.toLowerCase().trim() : '';
  const turEl = document.getElementById('tedarikci-tur-filtre');
  const tur = turEl ? turEl.value : '';

  const hepsi = STATE.tedarikciler || [];
  const suzulmus = hepsi.filter((t) => {
    if (tur && String(t['Kurum Türü']) !== tur) return false;
    if (!arama) return true;
    return ['Firma / Kurum Adı', 'Tedarik Kategorisi', 'Yetkili Kişi', 'E-posta', 'Adres']
      .some((k) => String(t[k] || '').toLowerCase().includes(arama));
  });

  const sayac = document.getElementById('tedarikci-sayac');
  if (sayac) {
    sayac.textContent = (arama || tur)
      ? suzulmus.length + ' / ' + hepsi.length + ' tedarikçi'
      : 'Toplam: ' + hepsi.length + ' tedarikçi';
  }

  if (suzulmus.length === 0) {
    liste.innerHTML = `<div class="materyal-bos">${(arama || tur)
      ? 'Aramanıza uygun tedarikçi bulunamadı.'
      : 'Rehber henüz boş. “Tedarikçi Ekle” ile hammadde sağlayan kurumları kaydedin.'}</div>`;
    return;
  }

  const yazabilir = STATE.currentUser &&
    (STATE.currentUser.role === 'admin' || STATE.currentUser.role === 'editor');
  const yonetici = STATE.currentUser && STATE.currentUser.role === 'admin';

  liste.innerHTML = suzulmus.map((t) => {
    const pasif = String(t['Durum']) === 'Pasif';
    const kategoriler = metniEtiketlere(t['Tedarik Kategorisi']);
    return `
      <div class="tedarikci-kart${pasif ? ' pasif' : ''}">
        <div class="tedarikci-ust">
          <div class="tedarikci-avatar">${escapeHtml(String(t['Firma / Kurum Adı'] || '?').trim().charAt(0).toLocaleUpperCase('tr-TR'))}</div>
          <div class="tedarikci-baslik">
            <strong>${escapeHtml(String(t['Firma / Kurum Adı'] || ''))}</strong>
            <span class="tedarikci-tur">${escapeHtml(String(t['Kurum Türü'] || 'Diğer'))}${pasif ? ' · <em>Pasif</em>' : ''}</span>
          </div>
          <div class="tedarikci-islem">
            ${yazabilir ? `<button class="btn btn-sm btn-primary" data-tedarikci-siparis="${t._rowNum}" title="Bu firmaya hammadde talebi oluştur">🧾 Sipariş</button>` : ''}
            ${yazabilir ? `<button class="btn btn-sm btn-text" data-tedarikci-duzenle="${t._rowNum}" title="Düzenle">✏️</button>` : ''}
            ${yonetici ? `<button class="btn btn-sm btn-text materyal-sil-btn" data-tedarikci-sil="${t._rowNum}" data-ad="${escapeHtml(String(t['Firma / Kurum Adı'] || ''))}" title="Sil">🗑️</button>` : ''}
          </div>
        </div>

        ${kategoriler.length ? `<div class="tedarikci-kategoriler">${kategoriler.map((k) =>
          `<span class="prototip-etiket">${escapeHtml(k)}</span>`).join('')}</div>` : ''}

        <div class="tedarikci-iletisim">
          ${t['Yetkili Kişi'] ? `<span>👤 ${escapeHtml(String(t['Yetkili Kişi']))}</span>` : ''}
          ${t['Telefon'] ? `<a href="tel:${escapeHtml(String(t['Telefon']).replace(/\s/g, ''))}">📞 ${escapeHtml(String(t['Telefon']))}</a>` : ''}
          ${t['E-posta'] ? `<a href="mailto:${escapeHtml(String(t['E-posta']))}">✉️ ${escapeHtml(String(t['E-posta']))}</a>` : ''}
          ${t['Web Sitesi'] ? `<button class="tedarikci-link" data-external-url="${escapeHtml(String(t['Web Sitesi']))}">🌐 Web</button>` : ''}
        </div>
        ${t['Adres'] ? `<div class="tedarikci-adres">📍 ${escapeHtml(String(t['Adres']))}</div>` : ''}
        ${t['Notlar'] ? `<div class="prototip-not">${escapeHtml(String(t['Notlar']))}</div>` : ''}
      </div>`;
  }).join('');
}

function tedarikciModaliAc(rowNum) {
  const kayit = rowNum
    ? (STATE.tedarikciler || []).find((t) => String(t._rowNum) === String(rowNum))
    : null;

  document.getElementById('tedarikci-dialog-baslik').textContent =
    kayit ? '✏️ Tedarikçi Düzenle' : '🏢 Tedarikçi Ekle';
  document.getElementById('tedarikci-row-num').value = kayit ? kayit._rowNum : '';

  const yaz = (id, deger) => { const el = document.getElementById(id); if (el) el.value = deger || ''; };
  yaz('tedarikci-firma', kayit && kayit['Firma / Kurum Adı']);
  yaz('tedarikci-tur', (kayit && kayit['Kurum Türü']) || 'Diğer');
  yaz('tedarikci-yetkili', kayit && kayit['Yetkili Kişi']);
  yaz('tedarikci-telefon', kayit && kayit['Telefon']);
  yaz('tedarikci-eposta', kayit && kayit['E-posta']);
  yaz('tedarikci-web', kayit && kayit['Web Sitesi']);
  yaz('tedarikci-adres', kayit && kayit['Adres']);
  yaz('tedarikci-notlar', kayit && kayit['Notlar']);
  yaz('tedarikci-durum', (kayit && kayit['Durum']) || 'Aktif');

  const gizli = document.getElementById('tedarikci-kategori');
  if (gizli) gizli.value = (kayit && kayit['Tedarik Kategorisi']) || '';
  const kok = document.querySelector('.etiket-secici[data-hedef="tedarikci-kategori"]');
  if (kok) {
    etiketSeciciKur(kok);
    etiketDegerYaz(kok, metniEtiketlere(gizli ? gizli.value : ''));
  }

  document.getElementById('dialog-tedarikci').showModal();
}

async function tedarikciKaydet() {
  const al = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  const firmaAdi = al('tedarikci-firma');
  if (!firmaAdi) {
    showToast('Firma / kurum adı zorunludur.', 'warning');
    document.getElementById('tedarikci-firma').focus();
    return;
  }

  const rowNum = al('tedarikci-row-num');
  toggleLoading(true, 'Tedarikçi kaydediliyor...');
  const res = await apiPost('tedarikci_kaydet', {
    rowNum: rowNum || undefined,
    firmaAdi: firmaAdi,
    kurumTuru: al('tedarikci-tur'),
    kategori: al('tedarikci-kategori'),
    yetkili: al('tedarikci-yetkili'),
    telefon: al('tedarikci-telefon'),
    eposta: al('tedarikci-eposta'),
    adres: al('tedarikci-adres'),
    web: al('tedarikci-web'),
    notlar: al('tedarikci-notlar'),
    durum: al('tedarikci-durum')
  });
  toggleLoading(false);

  if (res && res.success) {
    showToast(res.message || 'Kaydedildi.', 'success');
    document.getElementById('dialog-tedarikci').close();
    await syncTedarik(true);
  } else {
    showToast('Kaydedilemedi: ' + ((res && res.error) || ''), 'danger');
  }
}

async function tedarikciSil(rowNum, ad) {
  const onay = confirm('“' + (ad || 'Bu tedarikçi') + '” rehberden silinecek.\n\nGeçmiş sipariş kayıtları silinmez. Devam edilsin mi?');
  if (!onay) return;
  toggleLoading(true, 'Siliniyor...');
  const res = await apiPost('tedarikci_sil', { rowNum: rowNum });
  toggleLoading(false);
  if (res && res.success) { showToast('Tedarikçi silindi.', 'success'); await syncTedarik(true); }
  else showToast('Silinemedi: ' + ((res && res.error) || ''), 'danger');
}

// --- Talep / Sipariş -----------------------------------------------------
function siparisModaliAc(tedarikciRowNum) {
  const secim = document.getElementById('siparis-tedarikci');
  const aktifler = (STATE.tedarikciler || []).filter((t) => String(t['Durum']) !== 'Pasif');
  secim.innerHTML = '<option value="">Seçiniz...</option>' + aktifler.map((t) =>
    `<option value="${t._rowNum}">${escapeHtml(String(t['Firma / Kurum Adı'] || ''))}${t['Kurum Türü'] ? ' — ' + escapeHtml(String(t['Kurum Türü'])) : ''}</option>`).join('');

  if (tedarikciRowNum) secim.value = String(tedarikciRowNum);

  // Atölye önerileri envanterdeki üretim yerlerinden gelir
  const dl = document.getElementById('siparis-atolye-listesi');
  if (dl) {
    const atolyeler = new Set();
    (STATE.inventory || []).forEach((i) => {
      const v = String(i[getActualKey(i, 'Üretim Yeri')] || '').trim();
      if (v) atolyeler.add(v);
    });
    dl.innerHTML = [...atolyeler].slice(0, 100).map((a) => `<option value="${escapeHtml(a)}"></option>`).join('');
  }

  ['siparis-urun', 'siparis-miktar', 'siparis-tutar', 'siparis-notlar', 'siparis-atolye']
    .forEach((id) => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('siparis-durum').value = 'Talep';
  document.getElementById('siparis-mail-gonder').checked = true;

  siparisTedarikciBilgisiGoster();
  document.getElementById('dialog-siparis').showModal();
}

function _secilenTedarikci() {
  const secim = document.getElementById('siparis-tedarikci');
  if (!secim || !secim.value) return null;
  return (STATE.tedarikciler || []).find((t) => String(t._rowNum) === String(secim.value)) || null;
}

function siparisTedarikciBilgisiGoster() {
  const kutu = document.getElementById('siparis-tedarikci-bilgi');
  const t = _secilenTedarikci();
  const mailKutu = document.getElementById('siparis-mail-gonder');
  if (!kutu) return;

  if (!t) { kutu.classList.add('hidden'); return; }
  const eposta = String(t['E-posta'] || '').trim();
  kutu.classList.remove('hidden');
  kutu.innerHTML = `
    <div><strong>${escapeHtml(String(t['Firma / Kurum Adı'] || ''))}</strong> · ${escapeHtml(String(t['Kurum Türü'] || ''))}</div>
    <div>${t['Yetkili Kişi'] ? '👤 ' + escapeHtml(String(t['Yetkili Kişi'])) + ' · ' : ''}${eposta ? '✉️ ' + escapeHtml(eposta) : '<em>E-posta adresi kayıtlı değil — talep yalnızca kaydedilir</em>'}</div>
    ${t['Tedarik Kategorisi'] ? `<div class="tedarikci-kategoriler">${metniEtiketlere(t['Tedarik Kategorisi']).map((k) => `<span class="prototip-etiket">${escapeHtml(k)}</span>`).join('')}</div>` : ''}
  `;
  // E-posta yoksa gönderme seçeneği kapanır
  if (mailKutu) {
    mailKutu.disabled = !eposta;
    if (!eposta) mailKutu.checked = false;
  }
}

function _siparisFormVerisi() {
  const al = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  const t = _secilenTedarikci();
  return {
    tedarikciKaydi: t,
    tedarikci: t ? String(t['Firma / Kurum Adı'] || '') : '',
    tedarikciId: t ? String(t['ID'] || '') : '',
    kategori: t ? String(t['Tedarik Kategorisi'] || '') : '',
    eposta: t ? String(t['E-posta'] || '') : '',
    yetkili: t ? String(t['Yetkili Kişi'] || '') : '',
    atolye: al('siparis-atolye'),
    urun: al('siparis-urun'),
    miktar: al('siparis-miktar'),
    birim: al('siparis-birim'),
    tutar: al('siparis-tutar'),
    durum: al('siparis-durum'),
    notlar: al('siparis-notlar')
  };
}

async function siparisKaydet() {
  const v = _siparisFormVerisi();
  if (!v.tedarikciKaydi) { showToast('Tedarikçi seçin.', 'warning'); return; }
  if (!v.urun) {
    showToast('Ürün / hammadde bilgisi zorunludur.', 'warning');
    document.getElementById('siparis-urun').focus();
    return;
  }

  const mailIstendi = document.getElementById('siparis-mail-gonder').checked && !!v.eposta;
  toggleLoading(true, mailIstendi ? 'Talep kaydediliyor ve gönderiliyor...' : 'Talep kaydediliyor...');
  const res = await apiPost('siparis_olustur', Object.assign({}, v, {
    tedarikciKaydi: undefined,
    mailGonder: mailIstendi
  }));
  toggleLoading(false);

  if (res && res.success) {
    showToast(res.message || 'Talep kaydedildi.', 'success');
    document.getElementById('dialog-siparis').close();
    await syncTedarik(true);
  } else {
    showToast('Kaydedilemedi: ' + ((res && res.error) || ''), 'danger');
  }
}

// Talebi kullanıcının kendi e-posta programında taslak olarak açar.
// Yanıtların kurumsal kutu yerine kişisel kutuya düşmesi istendiğinde kullanılır.
function siparisMailtoAc() {
  const v = _siparisFormVerisi();
  if (!v.tedarikciKaydi) { showToast('Önce tedarikçi seçin.', 'warning'); return; }
  if (!v.eposta) { showToast('Bu tedarikçinin e-posta adresi kayıtlı değil.', 'warning'); return; }
  if (!v.urun) { showToast('Ürün / hammadde bilgisi zorunludur.', 'warning'); return; }

  const konu = 'Hammadde Talebi — Edirne Olgunlaşma Enstitüsü';
  const govde = [
    'Sayın ' + (v.yetkili || 'Yetkili') + ',',
    '',
    'Kurumumuz atölyelerinde yürütülen üretim faaliyetleri kapsamında,',
    'aşağıda belirtilen hammadde için fiyat ve temin süresi bilgisi talep etmekteyiz.',
    '',
    'Ürün / Hammadde : ' + v.urun,
    'Miktar          : ' + (v.miktar || '-') + ' ' + v.birim,
    'Talep Eden Birim: ' + (v.atolye || '-'),
    v.notlar ? 'Notlar          : ' + v.notlar : '',
    '',
    'Değerlendirmenizi rica eder, iyi çalışmalar dileriz.',
    '',
    (STATE.currentUser && STATE.currentUser.name) || '',
    'Edirne Olgunlaşma Enstitüsü'
  ].filter((x) => x !== '').join('\n');

  const adres = 'mailto:' + encodeURIComponent(v.eposta) +
    '?subject=' + encodeURIComponent(konu) +
    '&body=' + encodeURIComponent(govde);
  openExternal(adres);
  showToast('Talep taslağı e-posta programınızda açılıyor. Kaydı da tutmak için “Kaydet” deyin.', 'info');
}

async function siparisDurumGuncelle(rowNum, durum) {
  const res = await apiPost('siparis_durum_guncelle', { rowNum: rowNum, durum: durum });
  if (res && res.success) {
    showToast('Durum güncellendi: ' + durum, 'success');
    await syncTedarik(true);
  } else {
    showToast('Güncellenemedi: ' + ((res && res.error) || ''), 'danger');
  }
}

function renderSiparisler() {
  const tbody = document.getElementById('siparis-tbody');
  if (!tbody) return;

  const aramaEl = document.getElementById('siparis-arama');
  const arama = aramaEl ? aramaEl.value.toLowerCase().trim() : '';
  const durumEl = document.getElementById('siparis-durum-filtre');
  const durum = durumEl ? durumEl.value : '';

  const hepsi = STATE.siparisler || [];
  const suzulmus = hepsi.filter((s) => {
    if (durum && String(s['Durum']) !== durum) return false;
    if (!arama) return true;
    return ['Sipariş No', 'Tedarikçi', 'Ürün / Hammadde', 'Talep Eden Atölye', 'Kategori']
      .some((k) => String(s[k] || '').toLowerCase().includes(arama));
  });

  const sayac = document.getElementById('siparis-sayac');
  if (sayac) {
    sayac.textContent = (arama || durum)
      ? suzulmus.length + ' / ' + hepsi.length + ' kayıt'
      : 'Toplam: ' + hepsi.length + ' kayıt';
  }

  if (suzulmus.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center">${(arama || durum)
      ? 'Aramanıza uygun kayıt bulunamadı.' : 'Henüz talep/sipariş kaydı yok.'}</td></tr>`;
    return;
  }

  const yazabilir = STATE.currentUser &&
    (STATE.currentUser.role === 'admin' || STATE.currentUser.role === 'editor');
  const durumlar = ['Talep', 'Sipariş Verildi', 'Teslim Alındı', 'İptal'];

  tbody.innerHTML = [...suzulmus].reverse().map((s) => {
    const d = String(s['Durum'] || 'Talep');
    const tutar = parseFloat(s['Tutar (₺)']) || 0;
    return `
      <tr>
        <td data-label="Talep No"><code>${escapeHtml(String(s['Sipariş No'] || ''))}</code></td>
        <td data-label="Tarih">${escapeHtml(String(s['Tarih'] || ''))}</td>
        <td data-label="Tedarikçi"><strong>${escapeHtml(String(s['Tedarikçi'] || ''))}</strong></td>
        <td data-label="Ürün">${escapeHtml(String(s['Ürün / Hammadde'] || ''))}</td>
        <td data-label="Miktar">${escapeHtml(String(s['Miktar'] || '-'))} ${escapeHtml(String(s['Birim'] || ''))}</td>
        <td data-label="Tutar">${tutar ? smParaFormat(tutar) : '-'}</td>
        <td data-label="Atölye">${escapeHtml(String(s['Talep Eden Atölye'] || '-'))}</td>
        <td data-label="Durum">${yazabilir
          ? `<select class="siparis-durum-sec" data-siparis-durum="${s._rowNum}">${durumlar.map((x) =>
              `<option value="${x}"${x === d ? ' selected' : ''}>${x}</option>`).join('')}</select>`
          : `<span class="badge ${TEDARIK_DURUM_SINIF[d] || 'badge-pending'}">${escapeHtml(d)}</span>`}</td>
        <td data-label="İşlem" style="text-align:right;">
          <span class="siparis-olusturan">${escapeHtml(String(s['Oluşturan'] || ''))}</span>
        </td>
      </tr>`;
  }).join('');
}

// --- Alım Raporu (pasta grafik) -----------------------------------------
// İptal edilen kayıtlar toplama katılmaz; talep aşamasındakiler tahmini
// tutarlarıyla sayılır çünkü bütçe planlaması için anlamlıdırlar.
function tedarikAlimOzeti() {
  const gecerli = (STATE.siparisler || []).filter((s) => String(s['Durum']) !== 'İptal');
  const firmaya = {};
  const kategoriye = {};
  let toplam = 0;

  gecerli.forEach((s) => {
    const tutar = parseFloat(s['Tutar (₺)']) || 0;
    const firma = String(s['Tedarikçi'] || 'Belirtilmemiş').trim() || 'Belirtilmemiş';
    if (!firmaya[firma]) firmaya[firma] = { tutar: 0, adet: 0 };
    firmaya[firma].tutar += tutar;
    firmaya[firma].adet += 1;
    toplam += tutar;

    // Bir siparişin kategorisi birden çok olabilir; tutar ilk kategoriye yazılır
    const kat = metniEtiketlere(s['Kategori'])[0] || 'Sınıflandırılmamış';
    kategoriye[kat] = (kategoriye[kat] || 0) + tutar;
  });

  return { firmaya, kategoriye, toplam, adet: gecerli.length };
}

function renderTedarikRaporu() {
  const ozet = tedarikAlimOzeti();

  const ozetKutu = document.getElementById('tedarik-ozet');
  if (ozetKutu) {
    const teslim = (STATE.siparisler || []).filter((s) => String(s['Durum']) === 'Teslim Alındı').length;
    const bekleyen = (STATE.siparisler || []).filter((s) => String(s['Durum']) === 'Talep').length;
    ozetKutu.innerHTML = `
      <div class="sm-stat"><small>Toplam Alım</small><strong>${smParaFormat(ozet.toplam)}</strong></div>
      <div class="sm-stat"><small>Kayıt</small><strong>${ozet.adet}</strong></div>
      <div class="sm-stat"><small>Teslim Alınan</small><strong>${teslim}</strong></div>
      <div class="sm-stat"><small>Bekleyen Talep</small><strong>${bekleyen}</strong></div>
      <div class="sm-stat"><small>Tedarikçi</small><strong>${(STATE.tedarikciler || []).length}</strong></div>`;
  }

  const firmaSirali = Object.entries(ozet.firmaya).sort((a, b) => b[1].tutar - a[1].tutar);
  tedarikPastaCiz('chart-tedarikci', 'tedarikci',
    firmaSirali.map((e) => e[0]), firmaSirali.map((e) => e[1].tutar));

  const katSirali = Object.entries(ozet.kategoriye).sort((a, b) => b[1] - a[1]);
  tedarikPastaCiz('chart-tedarik-kategori', 'tedarikKategori',
    katSirali.map((e) => e[0]), katSirali.map((e) => e[1]));

  const tbody = document.getElementById('tedarik-rapor-tbody');
  if (tbody) {
    if (firmaSirali.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center">Henüz alım kaydı yok.</td></tr>';
    } else {
      tbody.innerHTML = firmaSirali.map(([firma, v]) => {
        const kayit = (STATE.tedarikciler || []).find(
          (t) => String(t['Firma / Kurum Adı']).trim() === firma);
        const pay = ozet.toplam > 0 ? (v.tutar / ozet.toplam * 100) : 0;
        return `
          <tr>
            <td data-label="Tedarikçi"><strong>${escapeHtml(firma)}</strong></td>
            <td data-label="Kurum Türü">${escapeHtml(kayit ? String(kayit['Kurum Türü'] || '-') : '-')}</td>
            <td data-label="Sipariş Adedi">${v.adet}</td>
            <td data-label="Toplam Tutar">${smParaFormat(v.tutar)}</td>
            <td data-label="Pay">
              <div class="pay-cubugu"><span style="width:${pay.toFixed(1)}%"></span></div>
              <small>%${pay.toFixed(1)}</small>
            </td>
          </tr>`;
      }).join('');
    }
  }
}

function tedarikPastaCiz(canvasId, anahtar, etiketler, degerler) {
  const ctx = document.getElementById(canvasId);
  if (!ctx || typeof Chart === 'undefined') return;
  if (!STATE.charts) STATE.charts = {};
  if (STATE.charts[anahtar]) { STATE.charts[anahtar].destroy(); STATE.charts[anahtar] = null; }

  // Tümü sıfırsa grafik anlamsız olur; boş durum yazısı gösterilir
  const toplam = degerler.reduce((a, b) => a + b, 0);
  if (!etiketler.length || toplam <= 0) {
    const kap = ctx.parentElement;
    if (kap) kap.innerHTML = '<div class="materyal-bos">Grafik için henüz tutar girilmiş bir alım kaydı yok.</div>';
    return;
  }

  STATE.charts[anahtar] = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: etiketler,
      datasets: [{
        data: degerler,
        backgroundColor: etiketler.map((_, i) => TEDARIK_PALET[i % TEDARIK_PALET.length]),
        borderColor: '#191425',
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { color: '#f3effa', font: { size: 10 }, boxWidth: 12 } },
        tooltip: {
          callbacks: {
            label: (c) => {
              const yuzde = toplam > 0 ? (c.parsed / toplam * 100).toFixed(1) : 0;
              return ' ' + c.label + ': ' + smParaFormat(c.parsed) + ' (%' + yuzde + ')';
            }
          }
        }
      }
    }
  });
}

// ==========================================================================
// PWA — Çevrimdışı destek + OTOMATİK GÜNCELLEME (mobil sürüm)
// --------------------------------------------------------------------------
// Masaüstünde güncelleme electron-updater ile yapılır; burası yalnızca
// telefona kurulan (Ana ekrana ekle) sürüm içindir. Yeni sürüm yayınlandığında
// service worker onu arka planda indirir, kullanıcıya tek düğmelik bir uyarı
// çıkar ve onaylandığında uygulama yeni sürümle yeniden açılır.
// ==========================================================================
function pwaGuncellemeBandiGoster(bekleyenWorker) {
  if (document.getElementById('pwa-update-bar')) return;

  const bar = document.createElement('div');
  bar.id = 'pwa-update-bar';
  bar.className = 'pwa-update-bar';

  const metin = document.createElement('span');
  metin.textContent = 'Yeni sürüm hazır.';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'Şimdi güncelle';
  btn.addEventListener('click', () => {
    btn.disabled = true;
    btn.textContent = 'Güncelleniyor...';
    bekleyenWorker.postMessage({ type: 'SKIP_WAITING' });
  });

  const kapat = document.createElement('button');
  kapat.type = 'button';
  kapat.className = 'pwa-update-dismiss';
  kapat.setAttribute('aria-label', 'Kapat');
  kapat.textContent = '×';
  kapat.addEventListener('click', () => bar.remove());

  bar.appendChild(metin);
  bar.appendChild(btn);
  bar.appendChild(kapat);
  document.body.appendChild(bar);
}

function initPwaUpdates() {
  if (!('serviceWorker' in navigator)) return;
  if (window.api && window.api.isElectron) return;

  // Yeni service worker devreye girdiğinde sayfayı bir kez tazele
  let yenileniyor = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (yenileniyor) return;
    yenileniyor = true;
    window.location.reload();
  });

  navigator.serviceWorker.register('./service-worker.js')
    .then((reg) => {
      // Sayfa açılmadan önce indirilmiş, sırada bekleyen bir sürüm olabilir.
      // Bu, uygulamanın AÇILIŞ anıdır: kullanıcının kaybedecek bir işi yok,
      // o yüzden banda gerek kalmadan doğrudan devreye alınır. Kabuk artık
      // önbellekten servis edildiği için güncellemenin telefona ulaşmasını
      // sağlayan asıl adım budur.
      if (reg.waiting && navigator.serviceWorker.controller) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      }

      reg.addEventListener('updatefound', () => {
        const yeni = reg.installing;
        if (!yeni) return;
        yeni.addEventListener('statechange', () => {
          // controller yoksa bu ilk kurulumdur, uyarıya gerek yok
          if (yeni.state === 'installed' && navigator.serviceWorker.controller) {
            pwaGuncellemeBandiGoster(yeni);
          }
        });
      });

      const guncellemeDenetle = () => { reg.update().catch(() => {}); };
      // Uygulama ön plana her geldiğinde ve saatte bir denetlenir
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) guncellemeDenetle();
      });
      window.addEventListener('online', guncellemeDenetle);
      setInterval(guncellemeDenetle, 60 * 60 * 1000);
    })
    .catch((err) => console.error('Service Worker kaydedilemedi:', err));
}

if (!(window.api && window.api.isElectron)) {
  window.addEventListener('load', initPwaUpdates);
}

// DOM Yüklendiğinde Başlat
document.addEventListener('DOMContentLoaded', initApp);

// === ANA SAYFA MAĞAZA BİLDİRİMLERİ PANALİ HESAPLAYICI VE OLUŞTURUCU ===

function updateHomeNotifications() {
  const card = document.getElementById('home-notifications-card');
  const list = document.getElementById('home-notifications-list');
  if (!card || !list) return;

  if (!STATE.currentUser) {
    card.classList.add('hidden');
    return;
  }

  const hasMagazaPerm = STATE.currentUser.role === 'admin' || checkUserPermission(STATE.currentUser.permissions, 'magaza-view');
  if (!hasMagazaPerm) {
    card.classList.add('hidden');
    return;
  }

  card.classList.remove('hidden');
  list.innerHTML = '';

  const notifications = [];

  // 1. Fiyat Bekleyenler
  const priceAwaitingItems = (STATE.magaza.stock || []).filter(item => {
    const status = String(item.durum || '').trim().toLowerCase();
    const price = parseFloat(item.satisFiyati || 0);
    return status === 'fiyat bekliyor' || price === 0;
  });

  if (priceAwaitingItems.length > 0) {
    notifications.push({
      type: 'warning',
      title: '🏷️ Fiyat Belirlenmesi Bekleniyor',
      message: `Mağaza stoğunda fiyatı belirlenmemiş <strong>${priceAwaitingItems.length}</strong> adet yeni ürün bulunmaktadır.`,
      actionText: 'Fiyatları Belirle ➔',
      action: () => {
        showSection('magaza-view');
        // Magaza sekmesindeki "Mağaza Stoğu" alt sekmesini aç ve "Fiyat Bekliyor" filtresini uygula
        const tabBtn = document.querySelector('.btn-tab[data-subtarget="magaza-stock-tab"]');
        if (tabBtn) tabBtn.click();
        const filterSelect = document.getElementById('magaza-stock-filter-status');
        if (filterSelect) {
          filterSelect.value = 'Fiyat Bekliyor';
          filterSelect.dispatchEvent(new Event('change'));
        }
      }
    });
  }

  // 2. Onaylı ve Stoğa Çekilmeyi Bekleyen Ürünler (Main inventory)
  const approvedInventory = STATE.inventory.filter(item => {
    const statusVal = String(item.durum || '').trim().toLowerCase();
    return statusVal.indexOf('arşive eklendi') > -1 || statusVal.indexOf('onaylandı') > -1;
  });

  const existingStockNos = new Set((STATE.magaza.stock || []).map(item => String(item.envanterNo || '').trim()));
  const pullableItems = approvedInventory.filter(item => {
    const envNo = String(item.envanterNo || '').trim();
    return envNo && !existingStockNos.has(envNo);
  });

  if (pullableItems.length > 0) {
    notifications.push({
      type: 'info',
      title: '📥 Stoğa Çekilebilir Yeni Ürünler',
      message: `Ana envanterde onaylanmış ve mağazaya çekilmeyi bekleyen <strong>${pullableItems.length}</strong> adet yeni ürün bulunmaktadır.`,
      actionText: 'Stoğa Çek ➔',
      action: () => {
        showSection('magaza-view');
        const tabBtn = document.querySelector('.btn-tab[data-subtarget="magaza-stock-tab"]');
        if (tabBtn) tabBtn.click();
        // Stoğa çekme butonuna odaklan veya tıkla
        const pullBtn = document.getElementById('btn-magaza-pull-stock');
        if (pullBtn) {
          pullBtn.scrollIntoView({ behavior: 'smooth' });
          pullBtn.classList.add('highlight-animation');
          setTimeout(() => pullBtn.classList.remove('highlight-animation'), 2000);
        }
      }
    });
  }

  // 3. Bekleyen İhtiyaç Talepleri
  const pendingNeeds = (STATE.magaza.needs || []).filter(item => {
    const status = String(item["Durum"] || item["status"] || '').trim().toLowerCase();
    return status === 'beklemede' || status === 'bekliyor';
  });

  if (pendingNeeds.length > 0) {
    notifications.push({
      type: 'warning',
      title: '📋 Onay Bekleyen İhtiyaç Talepleri',
      message: `Mağaza personeli tarafından girilmiş onay bekleyen <strong>${pendingNeeds.length}</strong> adet ihtiyaç talebi bulunuyor.`,
      actionText: 'İhtiyaç Listesini Gör ➔',
      action: () => {
        showSection('magaza-view');
        const tabBtn = document.querySelector('.btn-tab[data-subtarget="magaza-needs-tab"]');
        if (tabBtn) tabBtn.click();
      }
    });
  }

  // 4. Günlük Satış Özeti
  const todayStr = new Date().toISOString().split('T')[0];
  const todaySales = (STATE.magaza.cash || []).filter(sale => {
    let dateStr = sale["Tarih"] || sale["date"] || '';
    if (dateStr instanceof Date) {
      dateStr = dateStr.toISOString().split('T')[0];
    } else if (typeof dateStr === 'string' && dateStr.includes('T')) {
      dateStr = dateStr.split('T')[0];
    }
    return dateStr === todayStr;
  });

  if (todaySales.length > 0) {
    const totalAmount = todaySales.reduce((sum, sale) => {
      const amt = parseFloat(sale["Satış Tutarı"] || sale["Satış Tutarı (₺)"] || sale["price"] || 0);
      return sum + amt;
    }, 0);

    notifications.push({
      type: 'success',
      title: '💰 Günlük Satış Raporu',
      message: `Bugün mağazada <strong>${todaySales.length}</strong> adet ürün satıldı. Toplam ciro: <strong>${totalAmount.toLocaleString('tr-TR')} ₺</strong>.`,
      actionText: 'Satış Detaylarını Gör ➔',
      action: () => {
        showSection('magaza-view');
        const tabBtn = document.querySelector('.btn-tab[data-subtarget="magaza-cash-tab"]');
        if (tabBtn) tabBtn.click();
      }
    });
  }

  if (notifications.length === 0) {
    list.innerHTML = `
      <div style="text-align: center; padding: 2rem 1rem; color: var(--text-muted);">
        <span style="font-size: 2rem; display: block; margin-bottom: 0.5rem;">🎉</span>
        <p style="font-size: 0.85rem;">Her şey yolunda! Okunmamış veya işlem bekleyen mağaza bildirimi bulunmamaktadır.</p>
      </div>
    `;
    return;
  }

  notifications.forEach((notif, idx) => {
    const itemDiv = document.createElement('div');
    itemDiv.className = `notification-item ${notif.type}`;

    const header = document.createElement('div');
    header.className = 'notification-header';
    header.innerHTML = notif.title;

    const body = document.createElement('div');
    body.className = 'notification-body';
    body.innerHTML = notif.message;

    itemDiv.appendChild(header);
    itemDiv.appendChild(body);

    if (notif.actionText && notif.action) {
      const btn = document.createElement('button');
      btn.className = 'notification-action';
      btn.textContent = notif.actionText;
      btn.addEventListener('click', notif.action);
      itemDiv.appendChild(btn);
    }

    list.appendChild(itemDiv);
  });
}

// ============================================================
// PERSONEL SUB-TAB YÖNETİMİ (personel-urun / personel-proje)
// ============================================================
(function initPersonelSubTabs() {
  document.addEventListener('click', async function (e) {
    const btn = e.target.closest('[data-subtarget]');
    if (!btn) return;
    const targetId = btn.getAttribute('data-subtarget');
    if (!targetId || !targetId.startsWith('personel-')) return;
    const views = document.querySelectorAll('.personel-sub-view');
    views.forEach(v => {
      v.classList.toggle('active', v.id === targetId);
      v.classList.toggle('hidden', v.id !== targetId);
    });
    const tabs = document.querySelectorAll('[data-subtarget^="personel-"]');
    tabs.forEach(t => t.classList.toggle('active', t === btn));

    if (targetId === 'personel-proje-subview' && !window._projeDataLoaded) {
      loadProjeData();
    } else if (targetId === 'personel-grafik-subview') {
      if (!window._projeDataLoaded) {
        toggleLoading(true, 'Proje verileri yükleniyor...');
        await loadProjeData();
        toggleLoading(false);
      }
      renderProjeTimeChart();
    }
  });
})();

// ============================================================
// PROJE TAKİP MODÜLÜ
// ============================================================
let _allProjects = [];
let _filteredProjects = [];
let _projeGrouped = false;

function mapProjectRow(row) {
  const keys = Object.keys(row).filter(k => k !== '_rowNum');
  const get = (i) => row[keys[i]] || '';
  return {
    _rowNum: row._rowNum,
    zamanDamgasi: get(0),
    atolye: get(1),
    urunAdi: get(2),
    baslangic: get(3),
    planlananBitis: get(4),
    gercekBitis: get(5),
    durum: get(6),
    tahminiSure: get(7),
    uzatma: get(8),
    personelSayisi: get(9),
    personel: get(10),
    ortaklar: get(11),
    detay: get(12),
    _raw: row
  };
}

function getProjeStatus(p) {
  const d = String(p.durum || '').toLowerCase();
  if (d.includes('tamamland')) return 'tamamlandi';
  if (d.includes('gecik') || d.includes('iptal') || d.includes('red')) return 'gecikti';
  return 'devam';
}

async function loadProjeData() {
  const tbody = document.getElementById('proje-tbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="text-center" style="padding:2rem;"><span style="opacity:0.6">Yükleniyor…</span></td></tr>';
  try {
    const res = await apiProjePost('get_projects');
    if (!res || !res.success) { showToast('Proje verisi alınamadı: ' + (res?.error || 'Bilinmeyen hata'), 'danger'); return; }
    _allProjects = (res.projects || []).map(mapProjectRow);
    if (!_allProjects.length) {
      showToast(res.message || 'Proje kaydı bulunamadı. Ayarlar > Proje Takip Apps Script URL\'sinin doğru e-tabloya bağlı olduğunu kontrol edin.', 'warning');
    }
    window._projeDataLoaded = true;
    populateProjeFilters();
    applyProjeFilters();
  } catch (err) { showToast('Proje verisi yüklenemedi: ' + err.message, 'danger'); }
}

function populateProjeFilters() {
  const atolyeSet = new Set();
  const personelSet = new Set();
  _allProjects.forEach(p => {
    if (p.atolye) atolyeSet.add(p.atolye.trim());
    if (p.personel) personelSet.add(p.personel.trim());
  });
  const atolyeSel = document.getElementById('proje-filter-atolye');
  if (atolyeSel) {
    atolyeSel.innerHTML = '<option value="all">Tümü</option>';
    [...atolyeSet].sort().forEach(a => { const o = document.createElement('option'); o.value = a; o.textContent = a; atolyeSel.appendChild(o); });
  }
  const personelSel = document.getElementById('proje-filter-personel');
  if (personelSel) {
    personelSel.innerHTML = '<option value="all">Tüm Personel</option>';
    [...personelSet].sort().forEach(p => { const o = document.createElement('option'); o.value = p; o.textContent = p; personelSel.appendChild(o); });
  }

  // Grafik Filtrelerini de doldur
  const chartAtolyeSel = document.getElementById('proje-chart-filter-atolye');
  if (chartAtolyeSel) {
    chartAtolyeSel.innerHTML = '<option value="all">Tüm Atölyeler</option>';
    [...atolyeSet].sort().forEach(a => { const o = document.createElement('option'); o.value = a; o.textContent = a; chartAtolyeSel.appendChild(o); });
  }
  const chartPersonelSel = document.getElementById('proje-chart-filter-personel');
  if (chartPersonelSel) {
    // Grafiklerde ortak çalışan personel de filtrelenebilsin
    const katkiSet = new Set(personelSet);
    _allProjects.forEach(p => projeKisiler(p).forEach(k => katkiSet.add(k)));
    chartPersonelSel.innerHTML = '<option value="all">Tüm Personel</option>';
    [...katkiSet].sort((a, b) => a.localeCompare(b, 'tr')).forEach(p => { const o = document.createElement('option'); o.value = p; o.textContent = p; chartPersonelSel.appendChild(o); });
  }
}

function applyProjeFilters() {
  const search = (document.getElementById('proje-search')?.value || '').toLowerCase();
  const atolye = document.getElementById('proje-filter-atolye')?.value || 'all';
  const status = document.getElementById('proje-filter-status')?.value || 'all';
  const personel = document.getElementById('proje-filter-personel')?.value || 'all';
  const startDate = document.getElementById('proje-start-date')?.value || '';
  const endDate = document.getElementById('proje-end-date')?.value || '';
  _filteredProjects = _allProjects.filter(p => {
    if (search && ![(p.urunAdi || ''), (p.personel || ''), (p.atolye || ''), (p.detay || ''), (p.ortaklar || '')].some(s => s.toLowerCase().includes(search))) return false;
    if (atolye !== 'all' && p.atolye.trim() !== atolye) return false;
    if (personel !== 'all' && p.personel.trim() !== personel) return false;
    if (status !== 'all' && getProjeStatus(p) !== status) return false;
    if (startDate || endDate) {
      const bs = parseTRDate(p.baslangic);
      if (startDate && bs && bs < startDate) return false;
      if (endDate && bs && bs > endDate) return false;
    }
    return true;
  });
  updateProjeStats(_allProjects, _filteredProjects);
  renderProjeTable();
}

function parseTRDate(str) {
  if (!str) return null;
  const m = String(str).match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return str;
}

function updateProjeStats(all, filtered) {
  const total = all.length;
  const completed = all.filter(p => getProjeStatus(p) === 'tamamlandi').length;
  const delayed = all.filter(p => getProjeStatus(p) === 'gecikti').length;
  const ongoing = all.filter(p => getProjeStatus(p) === 'devam').length;
  const personnelSet = new Set(all.map(p => p.personel).filter(Boolean));
  const workshopSet = new Set(all.map(p => p.atolye).filter(Boolean));
  const setV = (id, v) => { const el = document.getElementById(id); if (el) { el.textContent = v; el.closest('.proje-stat-card')?.classList.add('proje-stat-pop'); setTimeout(() => el.closest('.proje-stat-card')?.classList.remove('proje-stat-pop'), 400); } };
  setV('proje-stat-total', total);
  setV('proje-stat-completed', completed);
  setV('proje-stat-delayed', delayed);
  setV('proje-stat-ongoing', ongoing);
  setV('proje-stat-personnel', personnelSet.size);
  setV('proje-stat-workshops', workshopSet.size);
  const label = document.getElementById('proje-count-label');
  if (label) label.textContent = `${filtered.length} kayıt listeleniyor (toplam ${total})`;
}

function renderProjeTable() {
  const tbody = document.getElementById('proje-tbody');
  const noData = document.getElementById('proje-no-data');
  if (!tbody) return;
  if (_filteredProjects.length === 0) { tbody.innerHTML = ''; noData?.classList.remove('hidden'); return; }
  noData?.classList.add('hidden');
  if (_projeGrouped) { renderProjeGrouped(tbody); } else { renderProjeFlatTable(tbody); }
}

function projeRowHtml(p, i) {
  const st = getProjeStatus(p);
  const rowClass = st === 'tamamlandi' ? 'proje-row-ok'
    : st === 'gecikti' ? 'proje-row-danger'
      : 'proje-row-warn';
  const badge = st === 'tamamlandi' ? '<span class="proje-badge proje-badge-ok">✅ Tamamlandı</span>'
    : st === 'gecikti' ? '<span class="proje-badge proje-badge-danger">🔴 Gecikti</span>'
      : '<span class="proje-badge proje-badge-warn">🔄 Devam</span>';
  return `<tr class="proje-row ${rowClass}" data-idx="${i}" style="cursor:pointer;">
    <td><span class="proje-atolye-chip">${p.atolye || '—'}</span></td>
    <td><strong>${p.personel || '—'}</strong></td>
    <td style="font-size:0.8rem; max-width:150px; white-space:normal;">${p.ortaklar || '—'}</td>
    <td><strong>${p.urunAdi || '—'}</strong></td>
    <td style="white-space:nowrap;">${p.baslangic || '—'}</td>
    <td>${p.tahminiSure || '—'}</td>
    <td>${badge}</td>
    <td><button class="btn btn-secondary btn-sm proje-detail-btn" data-idx="${i}">🔍</button></td>
  </tr>`;
}

function renderProjeFlatTable(tbody) {
  tbody.innerHTML = _filteredProjects.map((p, i) => projeRowHtml(p, i)).join('');
}

function renderProjeGrouped(tbody) {
  const groups = {};
  _filteredProjects.forEach((p, i) => { const k = p.atolye || 'Belirtilmemiş'; if (!groups[k]) groups[k] = []; groups[k].push({ p, i }); });
  let html = '';
  Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0])).forEach(([atolye, items]) => {
    html += `<tr class="proje-group-header"><td colspan="8">🏛️ ${atolye} <span style="font-size:0.78rem;font-weight:400;opacity:0.7;">(${items.length} proje)</span></td></tr>`;
    html += items.map(({ p, i }) => projeRowHtml(p, i)).join('');
  });
  tbody.innerHTML = html;
}

function openProjeDetail(idx) {
  const p = _filteredProjects[idx];
  if (!p) return;
  const panel = document.getElementById('proje-detail-panel');
  const title = document.getElementById('proje-detail-title');
  const body = document.getElementById('proje-detail-body');
  if (!panel) return;
  title.textContent = p.urunAdi || 'Proje Detayı';
  const st = getProjeStatus(p);
  const statusHtml = st === 'tamamlandi' ? '<span class="proje-badge proje-badge-ok">✅ Tamamlandı</span>'
    : st === 'gecikti' ? '<span class="proje-badge proje-badge-danger">🔴 Gecikti</span>'
      : '<span class="proje-badge proje-badge-warn">🔄 Devam Ediyor</span>';
  body.innerHTML = `<div class="proje-detail-grid">
    <div class="proje-detail-item"><span class="proje-detail-lbl">Atölye</span><span>${p.atolye || '—'}</span></div>
    <div class="proje-detail-item"><span class="proje-detail-lbl">Ana Personel</span><span>${p.personel || '—'}</span></div>
    <div class="proje-detail-item proje-detail-full"><span class="proje-detail-lbl">Ortak Çalışanlar</span><span>${p.ortaklar || '—'}</span></div>
    <div class="proje-detail-item"><span class="proje-detail-lbl">Başlangıç</span><span>${p.baslangic || '—'}</span></div>
    <div class="proje-detail-item"><span class="proje-detail-lbl">Tahmini Süre</span><span>${p.tahminiSure || '—'}</span></div>
    <div class="proje-detail-item"><span class="proje-detail-lbl">Gerçek Bitiş</span><span>${p.gercekBitis || '—'}</span></div>
    <div class="proje-detail-item"><span class="proje-detail-lbl">Durum</span><span>${statusHtml}</span></div>
    <div class="proje-detail-item"><span class="proje-detail-lbl">Uzatma</span><span>${p.uzatma || '0'} gün</span></div>
    <div class="proje-detail-item"><span class="proje-detail-lbl">Personel Sayısı</span><span>${p.personelSayisi || '—'}</span></div>
    <div class="proje-detail-item proje-detail-full"><span class="proje-detail-lbl">Detay Notlar</span><span style="white-space:pre-wrap;">${p.detay || '—'}</span></div>
    ${p.ekBilgi ? `<div class="proje-detail-item proje-detail-full"><span class="proje-detail-lbl">Ek Bilgi</span><span>${p.ekBilgi}</span></div>` : ''}
  </div>`;
  panel.classList.remove('hidden');
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function calcProjeStats() {
  return {
    total: _filteredProjects.length,
    completed: _filteredProjects.filter(p => getProjeStatus(p) === 'tamamlandi').length,
    delayed: _filteredProjects.filter(p => getProjeStatus(p) === 'gecikti').length,
    ongoing: _filteredProjects.filter(p => getProjeStatus(p) === 'devam').length
  };
}

async function printProjeReport() {
  // PDF motoru istek üzerine yüklenir (açılışı yavaşlatmasın diye).
  if (!(await pdfMotoruHazirla())) return;

  if (!window._projeDataLoaded) {
    toggleLoading(true, 'Proje verileri yükleniyor...');
    await loadProjeData();
    toggleLoading(false);
  }

  const st = calcProjeStats();
  const rows = _filteredProjects.map(p => {
    const s = getProjeStatus(p);
    const sTxt = s === 'tamamlandi' ? 'Tamamlandı' : s === 'gecikti' ? 'Gecikti' : 'Devam Ediyor';
    return `<tr><td>${p.atolye || '—'}</td><td>${p.personel || '—'}</td><td>${p.urunAdi || '—'}</td><td>${p.baslangic || '—'}</td><td>${p.tahminiSure || '—'}</td><td>${p.gercekBitis || '—'}</td><td>${sTxt}</td></tr>`;
  }).join('');

  // Create temporary container (kept detached to prevent rendering issues with z-index/position)
  const tempDiv = document.createElement('div');
  tempDiv.style.width = '800px';
  tempDiv.style.backgroundColor = '#ffffff';
  tempDiv.style.color = '#333333';
  tempDiv.innerHTML = `
    <div style="font-family: Arial, sans-serif; padding: 20px; color: #333333; background: #ffffff;">
      <h1 style="color: #4b1478; font-size: 18px; border-bottom: 2px solid #d4af37; padding-bottom: 6px; margin-top: 0; margin-bottom: 4px;">🏛️ Edirne Olgunlaşma Enstitüsü</h1>
      <h2 style="color: #333333; font-size: 14px; margin-top: 0; margin-bottom: 15px;">Proje Takip Raporu (${new Date().toLocaleDateString('tr-TR')})</h2>
      
      <div style="display: flex; gap: 12px; margin-bottom: 20px;">
        <div style="background: #f7f6fa; border-radius: 6px; padding: 8px 14px; border-top: 3px solid #4b1478; text-align: center; flex: 1;">
          <div style="font-size: 18px; font-weight: bold; color: #4b1478;">${st.total}</div>
          <div style="font-size: 10px; color: #666666;">Toplam</div>
        </div>
        <div style="background: #f7f6fa; border-radius: 6px; padding: 8px 14px; border-top: 3px solid #2e7d32; text-align: center; flex: 1;">
          <div style="font-size: 18px; font-weight: bold; color: #2e7d32;">${st.completed}</div>
          <div style="font-size: 10px; color: #666666;">Tamamlanan</div>
        </div>
        <div style="background: #f7f6fa; border-radius: 6px; padding: 8px 14px; border-top: 3px solid #c62828; text-align: center; flex: 1;">
          <div style="font-size: 18px; font-weight: bold; color: #c62828;">${st.delayed}</div>
          <div style="font-size: 10px; color: #666666;">Geciken</div>
        </div>
        <div style="background: #f7f6fa; border-radius: 6px; padding: 8px 14px; border-top: 3px solid #e65100; text-align: center; flex: 1;">
          <div style="font-size: 18px; font-weight: bold; color: #e65100;">${st.ongoing}</div>
          <div style="font-size: 10px; color: #666666;">Devam Eden</div>
        </div>
      </div>
      
      <table style="width: 100%; border-collapse: collapse; margin-top: 12px;">
        <thead>
          <tr style="background: #4b1478; color: #ffffff;">
            <th style="padding: 8px; text-align: left; font-size: 11px;">Atölye</th>
            <th style="padding: 8px; text-align: left; font-size: 11px;">Personel</th>
            <th style="padding: 8px; text-align: left; font-size: 11px;">Ürün</th>
            <th style="padding: 8px; text-align: left; font-size: 11px;">Başlangıç</th>
            <th style="padding: 8px; text-align: left; font-size: 11px;">Tahmini Süre</th>
            <th style="padding: 8px; text-align: left; font-size: 11px;">Bitiş</th>
            <th style="padding: 8px; text-align: left; font-size: 11px;">Durum</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
      
      <div style="margin-top: 30px; text-align: center; color: #999999; font-size: 10px; border-top: 1px dashed #ddd; padding-top: 10px;">
        Edirne Olgunlaşma Enstitüsü Yönetim Sistemi — ${new Date().toLocaleString('tr-TR')}
      </div>
    </div>
  `;

  // Apply styles inline on the detached DOM element
  const cells = tempDiv.querySelectorAll('td, th');
  cells.forEach(c => {
    c.style.padding = '8px';
    c.style.borderBottom = '1px solid #eee';
    c.style.fontSize = '11px';
    if (c.tagName.toLowerCase() === 'th') {
      c.style.color = '#ffffff';
    } else {
      c.style.color = '#333333';
    }
  });

  const rowEls = tempDiv.querySelectorAll('tbody tr');
  rowEls.forEach((r, idx) => {
    if (idx % 2 === 1) {
      r.style.backgroundColor = '#f7f6fa';
    }
  });

  const opt = {
    margin: [10, 10],
    filename: `Proje_Takip_Raporu_${new Date().toISOString().split('T')[0]}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, letterRendering: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  showToast('PDF raporu hazırlanıyor, lütfen bekleyin...', 'info');

  html2pdf().set(opt).from(tempDiv).save()
    .then(() => {
      showToast('PDF başarıyla indirildi.', 'success');
    })
    .catch(err => {
      console.error('PDF Hatası:', err);
      showToast('PDF oluşturulurken bir hata oluştu: ' + err.message, 'danger');
    });
}

async function sendProjeReportMail() {
  if (!window._projeDataLoaded) {
    toggleLoading(true, 'Proje verileri yükleniyor...');
    await loadProjeData();
    toggleLoading(false);
  }
  const recipient = await showEmailPrompt('', 'Proje Takip Raporu Gönder');
  if (recipient === null) return; // Kullanıcı iptal etti
  if (!recipient || !recipient.includes('@')) { showToast('Geçerli bir e-posta adresi girilmedi.', 'warning'); return; }
  const stats = calcProjeStats();
  const mailProjects = _filteredProjects.map(p => ({
    personel: p.personel, atolye: p.atolye, urunAdi: p.urunAdi,
    baslangicTarihi: p.baslangic, tahminiSure: p.tahminiSure,
    gercekBitis: p.gercekBitis, durum: p.durum, detay: p.detay
  }));
  const aSel = document.getElementById('proje-filter-atolye');
  const sSel = document.getElementById('proje-filter-status');
  const reportTitle = `Proje Takip Raporu${aSel?.value !== 'all' ? ' — ' + aSel.value : ''}${sSel?.value !== 'all' ? ' (' + (sSel.options[sSel.selectedIndex]?.text || '') + ')' : ''}`;
  toggleLoading(true);
  try {
    const res = await apiProjePost('send_project_report_mail', {
      recipient,
      reportTitle,
      reportDate: new Date().toLocaleDateString('tr-TR'),
      stats,
      projects: mailProjects
    });
    toggleLoading(false);
    if (res?.success) showToast('Proje raporu ' + recipient + ' adresine gönderildi!', 'success');
    else showToast('Mail gönderilemedi: ' + (res?.error || 'Bilinmeyen hata'), 'danger');
  } catch (err) { toggleLoading(false); showToast('Mail gönderilemedi: ' + err.message, 'danger'); }
}

// ============================================================
// GELİŞMİŞ PROJE GRAFİKLERİ
// (Personel & Proje Takibi → 📊 Gelişmiş Grafikler)
// ============================================================

let _projeChartType = 'trend';

const PROJE_CHART_PALETTE = [
  '#9c27b0', '#d4af37', '#2e7d32', '#0277bd', '#e65100', '#00838f',
  '#c62828', '#5e35b1', '#7cb342', '#ad1457', '#3949ab', '#ef6c00'
];

const PROJE_DURUM_RENK = { tamamlandi: '#2e7d32', devam: '#e65100', gecikti: '#c62828' };
const PROJE_DURUM_ETIKET = { tamamlandi: 'Tamamlanan', devam: 'Devam Eden', gecikti: 'Geciken / İptal' };
const PROJE_AY_KISA = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

// --- Ortak yardımcılar -------------------------------------------------

function projeChartTheme() {
  const cs = getComputedStyle(document.body);
  const pick = (name, fb) => (cs.getPropertyValue(name) || '').trim() || fb;
  const light = document.body.classList.contains('light-theme');
  const gold = pick('--accent-gold', '#d4af37');
  return {
    text: pick('--text-main', '#f3effa'),
    muted: pick('--text-muted', '#a89ebc'),
    gold: gold,
    // İpuçları her temada koyu kalır (grafiğin üstünde okunaklı olsun diye),
    // vurgu ve kenarlık rengi seçili temadan gelir.
    zemin: pick('--bg-app', '#151120'),
    grid: light ? 'rgba(43, 34, 60, 0.08)' : 'rgba(255, 255, 255, 0.06)',
    tooltip: {
      backgroundColor: '#191425',
      titleColor: gold,
      bodyColor: '#f3effa',
      borderColor: 'rgba(' + pick('--primary-purple-rgb', '75, 0, 130') + ', 0.9)',
      borderWidth: 1,
      padding: 10,
      cornerRadius: 6
    }
  };
}

function projeParseDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  let m = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function projeAyAnahtari(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }

function projeAyEtiketi(key) {
  const [y, m] = key.split('-');
  return `${PROJE_AY_KISA[Number(m) - 1] || m} ${y}`;
}

function projeAyAralik(keys) {
  const uniq = [...new Set(keys.filter(Boolean))].sort();
  if (!uniq.length) return [];
  const range = getMonthYearRange(uniq[0], uniq[uniq.length - 1]);
  // Bozuk tarihli tek bir kayıt yüzünden yüzlerce ay üretilmesini engelle
  return range.length > 60 ? range.slice(-60) : range;
}

function projeGunFarki(a, b) { return Math.round((b.getTime() - a.getTime()) / 86400000); }

function projeTarihTR(d) { return d ? d.toLocaleDateString('tr-TR') : '—'; }

function projeKisaMetin(s, n) {
  const t = String(s || '').trim() || '—';
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

// Bir projede emeği geçen herkes (sorumlu personel + ortaklar)
function projeKisiler(p) {
  const raw = [p.personel, p.ortaklar].filter(Boolean).join(',');
  return [...new Set(
    raw.split(/[,;\/\n]| ve /i).map(s => s.trim()).filter(s => s.length > 1)
  )];
}

function projeBitisTarihi(p) {
  return projeParseDate(p.gercekBitis) || projeParseDate(p.planlananBitis);
}

function projeHareketliOrtalama(arr, pencere) {
  return arr.map((_, i) => {
    const bas = Math.max(0, i - pencere + 1);
    const dilim = arr.slice(bas, i + 1);
    return Number((dilim.reduce((a, b) => a + b, 0) / dilim.length).toFixed(2));
  });
}

// --- Filtreler ---------------------------------------------------------

function getProjeChartRows() {
  const v = (id) => document.getElementById(id)?.value || '';
  const personel = v('proje-chart-filter-personel') || 'all';
  const atolye = v('proje-chart-filter-atolye') || 'all';
  const durum = v('proje-chart-filter-status') || 'all';
  const minStr = v('proje-chart-start-date');
  const maxStr = v('proje-chart-end-date');
  const min = minStr ? projeParseDate(minStr) : null;
  const max = maxStr ? projeParseDate(maxStr) : null;
  const personelLower = personel.toLocaleLowerCase('tr');

  return (_allProjects || []).filter(p => {
    if (atolye !== 'all' && String(p.atolye || '').trim() !== atolye) return false;
    if (personel !== 'all') {
      const kisiler = projeKisiler(p).map(k => k.toLocaleLowerCase('tr'));
      if (!kisiler.includes(personelLower)) return false;
    }
    if (durum !== 'all' && getProjeStatus(p) !== durum) return false;
    if (min || max) {
      const d = projeParseDate(p.baslangic);
      if (!d) return false;
      if (min && d < min) return false;
      if (max && d > max) return false;
    }
    return true;
  });
}

// --- Grafik türü kataloğu ---------------------------------------------

const PROJE_CHART_TYPES = {
  trend: {
    title: 'Zamana Göre Proje Üretim Trendi',
    desc: 'Aylık başlatılan ve tamamlanan proje sayısı; kesikli çizgi 3 aylık hareketli ortalamadır.',
    build: projeChartTrend
  },
  cfd: {
    title: 'Kümülatif Akış Diyagramı',
    desc: 'Birikimli tamamlanan işler ile o an devam eden (WIP) iş yükünün zaman içindeki değişimi.',
    build: projeChartCFD
  },
  atolye: {
    title: 'Atölye Bazlı Durum Kırılımı',
    desc: 'Her atölyenin proje hacmi, durumlara göre yığılmış olarak.',
    build: projeChartAtolye
  },
  durum: {
    title: 'Proje Durum Dağılımı',
    desc: 'Tamamlanan, devam eden ve geciken projelerin payları.',
    build: projeChartDurum
  },
  radar: {
    title: 'Atölye Performans Radarı',
    desc: 'En yoğun atölyelerin 5 eksende (hacim, tamamlanma, zamanında teslim, ekip gücü, hız) 0–100 normalize karşılaştırması.',
    build: projeChartRadar
  },
  gantt: {
    title: 'Gantt Zaman Çizelgesi',
    desc: 'Projelerin başlangıç–bitiş aralıkları; dikey altın çizgi bugünü gösterir.',
    build: projeChartGantt
  },
  sapma: {
    title: 'Plan – Gerçekleşen Süre Sapması',
    desc: 'Tamamlanmış projelerde planlanan (yatay) ve gerçekleşen (dikey) gün sayısı. Kabarcık büyüklüğü ekip mevcudunu, kesikli çizginin üstü gecikmeyi gösterir.',
    build: projeChartSapma
  },
  personel: {
    title: 'Personel İş Yükü Dağılımı',
    desc: 'En çok projede emeği geçen personel (ortak çalışmalar dâhil), durumlara göre kırılımlı.',
    build: projeChartPersonel
  },
  isi: {
    title: 'Atölye × Ay Yoğunluk Isı Haritası',
    desc: 'Hangi atölyenin hangi ayda kaç proje başlattığını gösteren yoğunluk matrisi.',
    build: projeChartIsiHaritasi,
    custom: true
  }
};

// --- Ana çizim akışı ---------------------------------------------------

function renderProjeChart() {
  const canvas = document.getElementById('proje-time-chart');
  if (!canvas || !window.Chart) return;

  if (STATE.charts.projeTime) { STATE.charts.projeTime.destroy(); STATE.charts.projeTime = null; }

  const wrap = document.getElementById('proje-chart-canvas-wrap');
  const custom = document.getElementById('proje-chart-custom');
  const empty = document.getElementById('proje-chart-empty');
  const insight = document.getElementById('proje-chart-insight');
  const pngBtn = document.getElementById('btn-proje-chart-png');

  if (custom) { custom.innerHTML = ''; custom.classList.add('hidden'); }
  wrap?.classList.remove('hidden');
  empty?.classList.add('hidden');
  insight?.classList.add('hidden');

  const def = PROJE_CHART_TYPES[_projeChartType] || PROJE_CHART_TYPES.trend;
  const setText = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
  setText('proje-chart-title', def.title);
  setText('proje-chart-desc', def.desc);

  const rows = getProjeChartRows();
  setText('proje-chart-meta', `${rows.length} proje`);
  pngBtn?.classList.toggle('hidden', !!def.custom);

  const bosGoster = (mesaj) => {
    wrap?.classList.add('hidden');
    if (custom) { custom.innerHTML = ''; custom.classList.add('hidden'); }
    if (empty) { empty.textContent = mesaj; empty.classList.remove('hidden'); }
  };

  if (!rows.length) { bosGoster('Seçilen filtrelerle gösterilecek proje bulunamadı.'); return; }

  let sonuc;
  try {
    sonuc = def.build(rows, projeChartTheme());
  } catch (err) {
    console.error('Proje grafiği oluşturulamadı:', err);
    bosGoster('Grafik oluşturulamadı: ' + err.message);
    return;
  }

  if (!sonuc || sonuc.empty) { bosGoster(sonuc?.empty || 'Bu grafik için yeterli veri yok.'); return; }

  if (sonuc.html) {
    wrap?.classList.add('hidden');
    if (custom) { custom.innerHTML = sonuc.html; custom.classList.remove('hidden'); }
  } else {
    STATE.charts.projeTime = new Chart(canvas, sonuc.config);
  }

  if (insight && sonuc.insight) { insight.innerHTML = sonuc.insight; insight.classList.remove('hidden'); }
}

// Eski çağrı noktalarıyla uyum
function renderProjeTimeChart() { renderProjeChart(); }

// --- 1. Zaman trendi ---------------------------------------------------

function projeChartTrend(rows, T) {
  const bas = {}, bit = {};
  rows.forEach(p => {
    const s = projeParseDate(p.baslangic);
    if (s) { const k = projeAyAnahtari(s); bas[k] = (bas[k] || 0) + 1; }
    if (getProjeStatus(p) === 'tamamlandi') {
      const e = projeBitisTarihi(p) || s;
      if (e) { const k = projeAyAnahtari(e); bit[k] = (bit[k] || 0) + 1; }
    }
  });

  const aylar = projeAyAralik([...Object.keys(bas), ...Object.keys(bit)]);
  if (!aylar.length) return { empty: 'Tarih bilgisi girilmiş proje bulunamadı.' };

  const basData = aylar.map(a => bas[a] || 0);
  const bitData = aylar.map(a => bit[a] || 0);
  const ort = projeHareketliOrtalama(basData, 3);

  const enYogunIdx = basData.indexOf(Math.max(...basData));

  return {
    insight: `📌 En yoğun başlangıç ayı: <strong>${projeAyEtiketi(aylar[enYogunIdx])}</strong> (${basData[enYogunIdx]} proje) · Toplam başlatılan: <strong>${basData.reduce((a, b) => a + b, 0)}</strong> · Toplam tamamlanan: <strong>${bitData.reduce((a, b) => a + b, 0)}</strong>`,
    config: {
      type: 'line',
      data: {
        labels: aylar.map(projeAyEtiketi),
        datasets: [
          {
            label: 'Başlatılan Projeler', data: basData,
            borderColor: '#9c27b0', backgroundColor: 'rgba(156, 39, 176, 0.12)',
            borderWidth: 3, tension: 0.3, fill: true, pointBackgroundColor: '#9c27b0', pointRadius: 4
          },
          {
            label: 'Tamamlanan Projeler', data: bitData,
            borderColor: '#2e7d32', backgroundColor: 'rgba(46, 125, 50, 0.12)',
            borderWidth: 3, tension: 0.3, fill: true, pointBackgroundColor: '#2e7d32', pointRadius: 4
          },
          {
            label: '3 Aylık Hareketli Ortalama', data: ort,
            borderColor: T.gold, borderWidth: 2, borderDash: [6, 4],
            tension: 0.35, fill: false, pointRadius: 0
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: T.text, boxWidth: 14, usePointStyle: true } },
          tooltip: T.tooltip
        },
        scales: {
          x: { grid: { color: T.grid }, ticks: { color: T.muted, maxRotation: 45, minRotation: 0 } },
          y: { beginAtZero: true, grid: { color: T.grid }, ticks: { color: T.muted, precision: 0 } }
        }
      }
    }
  };
}

// --- 2. Kümülatif akış (CFD) ------------------------------------------

function projeChartCFD(rows, T) {
  const bas = {}, bit = {};
  rows.forEach(p => {
    const s = projeParseDate(p.baslangic);
    if (s) { const k = projeAyAnahtari(s); bas[k] = (bas[k] || 0) + 1; }
    if (getProjeStatus(p) === 'tamamlandi') {
      const e = projeBitisTarihi(p) || s;
      if (e) { const k = projeAyAnahtari(e); bit[k] = (bit[k] || 0) + 1; }
    }
  });

  const aylar = projeAyAralik([...Object.keys(bas), ...Object.keys(bit)]);
  if (!aylar.length) return { empty: 'Tarih bilgisi girilmiş proje bulunamadı.' };

  let kb = 0, kt = 0;
  const kumBas = [], kumBit = [], wip = [];
  aylar.forEach(a => {
    kb += bas[a] || 0;
    kt += bit[a] || 0;
    kumBas.push(kb); kumBit.push(kt); wip.push(Math.max(0, kb - kt));
  });

  const sonWip = wip[wip.length - 1];
  const enYuksekWip = Math.max(...wip);

  return {
    insight: `📌 Şu anki devam eden yük (WIP): <strong>${sonWip}</strong> proje · Dönem içindeki en yüksek yük: <strong>${enYuksekWip}</strong> · Birikimli tamamlanma: <strong>%${kb ? Math.round(kt / kb * 100) : 0}</strong>`,
    config: {
      type: 'line',
      data: {
        labels: aylar.map(projeAyEtiketi),
        datasets: [
          {
            label: 'Tamamlanan (birikimli)', data: kumBit,
            borderColor: '#2e7d32', backgroundColor: 'rgba(46, 125, 50, 0.45)',
            borderWidth: 2, tension: 0.25, fill: true, pointRadius: 0
          },
          {
            label: 'Devam Eden (WIP)', data: wip,
            borderColor: '#e65100', backgroundColor: 'rgba(230, 81, 0, 0.35)',
            borderWidth: 2, tension: 0.25, fill: true, pointRadius: 0
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: T.text, boxWidth: 14, usePointStyle: true } },
          tooltip: {
            ...T.tooltip,
            callbacks: {
              footer: (items) => 'Birikimli başlatılan: ' + kumBas[items[0].dataIndex]
            }
          }
        },
        scales: {
          x: { grid: { color: T.grid }, ticks: { color: T.muted, maxRotation: 45 } },
          y: { stacked: true, beginAtZero: true, grid: { color: T.grid }, ticks: { color: T.muted, precision: 0 } }
        }
      }
    }
  };
}

// --- 3. Atölye kırılımı ------------------------------------------------

function projeChartAtolye(rows, T) {
  const map = {};
  rows.forEach(p => {
    const a = (String(p.atolye || '').trim()) || 'Belirtilmemiş';
    if (!map[a]) map[a] = { tamamlandi: 0, devam: 0, gecikti: 0, toplam: 0 };
    map[a][getProjeStatus(p)]++;
    map[a].toplam++;
  });

  const liste = Object.entries(map).sort((a, b) => b[1].toplam - a[1].toplam).slice(0, 12);
  if (!liste.length) return { empty: 'Atölye bilgisi bulunamadı.' };

  const gecikmeli = liste
    .filter(([, v]) => v.toplam >= 2)
    .map(([k, v]) => ({ k, oran: v.gecikti / v.toplam }))
    .sort((a, b) => b.oran - a.oran)[0];

  return {
    insight: `📌 En yüksek hacim: <strong>${liste[0][0]}</strong> (${liste[0][1].toplam} proje)` +
      (gecikmeli && gecikmeli.oran > 0 ? ` · En yüksek gecikme oranı: <strong>${gecikmeli.k}</strong> (%${Math.round(gecikmeli.oran * 100)})` : ''),
    config: {
      type: 'bar',
      data: {
        labels: liste.map(([k]) => projeKisaMetin(k, 26)),
        datasets: ['tamamlandi', 'devam', 'gecikti'].map(d => ({
          label: PROJE_DURUM_ETIKET[d],
          data: liste.map(([, v]) => v[d]),
          backgroundColor: PROJE_DURUM_RENK[d],
          borderRadius: 4,
          borderSkipped: false
        }))
      },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: T.text, boxWidth: 14, usePointStyle: true } },
          tooltip: { ...T.tooltip, mode: 'index', intersect: false }
        },
        scales: {
          x: { stacked: true, beginAtZero: true, grid: { color: T.grid }, ticks: { color: T.muted, precision: 0 } },
          y: { stacked: true, grid: { display: false }, ticks: { color: T.muted } }
        }
      }
    }
  };
}

// --- 4. Durum dağılımı (halka + merkez toplam) -------------------------

const projeMerkezToplamPlugin = {
  id: 'projeMerkezToplam',
  afterDraw(chart) {
    const opt = chart.options.plugins?.projeMerkezToplam;
    if (!opt) return;
    const { ctx, chartArea } = chart;
    if (!chartArea) return;
    const cx = (chartArea.left + chartArea.right) / 2;
    const cy = (chartArea.top + chartArea.bottom) / 2;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = opt.valueColor || '#d4af37';
    ctx.font = '700 30px Inter, sans-serif';
    ctx.fillText(String(opt.value), cx, cy + 4);
    ctx.fillStyle = opt.labelColor || '#a89ebc';
    ctx.font = '500 11px Inter, sans-serif';
    ctx.fillText(opt.label || '', cx, cy + 24);
    ctx.restore();
  }
};

function projeChartDurum(rows, T) {
  const sayim = { tamamlandi: 0, devam: 0, gecikti: 0 };
  rows.forEach(p => sayim[getProjeStatus(p)]++);
  const anahtarlar = Object.keys(sayim).filter(k => sayim[k] > 0);
  if (!anahtarlar.length) return { empty: 'Durum bilgisi bulunamadı.' };
  const toplam = rows.length;

  return {
    insight: `📌 Tamamlanma oranı: <strong>%${Math.round(sayim.tamamlandi / toplam * 100)}</strong> · Gecikme oranı: <strong>%${Math.round(sayim.gecikti / toplam * 100)}</strong> · Devam eden: <strong>${sayim.devam}</strong> proje`,
    config: {
      type: 'doughnut',
      data: {
        labels: anahtarlar.map(k => PROJE_DURUM_ETIKET[k]),
        datasets: [{
          data: anahtarlar.map(k => sayim[k]),
          backgroundColor: anahtarlar.map(k => PROJE_DURUM_RENK[k]),
          borderColor: '#191425',
          borderWidth: 2,
          hoverOffset: 10
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        cutout: '62%',
        plugins: {
          legend: { position: 'right', labels: { color: T.text, boxWidth: 14, usePointStyle: true, padding: 14 } },
          projeMerkezToplam: { value: toplam, label: 'TOPLAM PROJE', valueColor: T.gold, labelColor: T.muted },
          tooltip: {
            ...T.tooltip,
            callbacks: {
              label: (c) => ` ${c.label}: ${c.parsed} (%${(c.parsed / toplam * 100).toFixed(1)})`
            }
          }
        }
      },
      plugins: [projeMerkezToplamPlugin]
    }
  };
}

// --- 5. Atölye performans radarı --------------------------------------

function projeChartRadar(rows, T) {
  const map = {};
  rows.forEach(p => {
    const a = (String(p.atolye || '').trim()) || 'Belirtilmemiş';
    if (!map[a]) map[a] = { toplam: 0, tamam: 0, zamaninda: 0, olcumlu: 0, ekip: 0, ekipAdet: 0, sure: 0, sureAdet: 0 };
    const m = map[a];
    m.toplam++;
    const durum = getProjeStatus(p);
    if (durum === 'tamamlandi') m.tamam++;

    const bas = projeParseDate(p.baslangic);
    const plan = projeParseDate(p.planlananBitis);
    const gercek = projeParseDate(p.gercekBitis);
    if (plan && gercek) { m.olcumlu++; if (gercek <= plan) m.zamaninda++; }
    if (bas && gercek) { const g = projeGunFarki(bas, gercek); if (g >= 0) { m.sure += g; m.sureAdet++; } }

    const kisi = parseInt(String(p.personelSayisi).replace(/\D/g, ''), 10);
    const ekip = Number.isFinite(kisi) && kisi > 0 ? kisi : projeKisiler(p).length;
    if (ekip > 0) { m.ekip += ekip; m.ekipAdet++; }
  });

  const liste = Object.entries(map).sort((a, b) => b[1].toplam - a[1].toplam).slice(0, 6);
  if (!liste.length) return { empty: 'Atölye bilgisi bulunamadı.' };

  const maxHacim = Math.max(...liste.map(([, v]) => v.toplam)) || 1;
  const maxEkip = Math.max(...liste.map(([, v]) => v.ekipAdet ? v.ekip / v.ekipAdet : 0)) || 1;
  const sureler = liste.map(([, v]) => (v.sureAdet ? v.sure / v.sureAdet : 0)).filter(x => x > 0);
  const maxSure = sureler.length ? Math.max(...sureler) : 1;

  const eksenler = ['Proje Hacmi', 'Tamamlanma', 'Zamanında Teslim', 'Ekip Gücü', 'Hız'];

  const datasets = liste.map(([ad, v], i) => {
    const renk = PROJE_CHART_PALETTE[i % PROJE_CHART_PALETTE.length];
    const ortSure = v.sureAdet ? v.sure / v.sureAdet : 0;
    return {
      label: projeKisaMetin(ad, 22),
      data: [
        Math.round(v.toplam / maxHacim * 100),
        Math.round(v.tamam / v.toplam * 100),
        v.olcumlu ? Math.round(v.zamaninda / v.olcumlu * 100) : 0,
        Math.round((v.ekipAdet ? v.ekip / v.ekipAdet : 0) / maxEkip * 100),
        ortSure > 0 ? Math.max(5, Math.round((1 - ortSure / maxSure) * 100)) : 0
      ],
      borderColor: renk,
      backgroundColor: renk + '2e',
      borderWidth: 2,
      pointBackgroundColor: renk,
      pointRadius: 3
    };
  });

  return {
    insight: '📌 Tüm eksenler 0–100 aralığına normalize edilmiştir. <strong>Hız</strong> ekseninde yüksek değer, ortalama tamamlanma süresinin kısa olduğu anlamına gelir.',
    config: {
      type: 'radar',
      data: { labels: eksenler, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { color: T.text, boxWidth: 12, usePointStyle: true, padding: 12 } },
          tooltip: { ...T.tooltip, callbacks: { label: (c) => ` ${c.dataset.label}: ${c.parsed.r}/100` } }
        },
        scales: {
          r: {
            min: 0, max: 100,
            angleLines: { color: T.grid },
            grid: { color: T.grid },
            pointLabels: { color: T.text, font: { size: 11 } },
            ticks: { color: T.muted, backdropColor: 'transparent', stepSize: 25 }
          }
        }
      }
    }
  };
}

// --- 6. Gantt zaman çizelgesi -----------------------------------------

const projeBugunCizgisiPlugin = {
  id: 'projeBugunCizgisi',
  afterDatasetsDraw(chart) {
    const opt = chart.options.plugins?.projeBugunCizgisi;
    if (!opt) return;
    const x = chart.scales.x;
    const { ctx, chartArea } = chart;
    if (!x || !chartArea) return;
    const px = x.getPixelForValue(opt.value);
    if (px < chartArea.left || px > chartArea.right) return;
    ctx.save();
    ctx.strokeStyle = opt.color || '#d4af37';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(px, chartArea.top);
    ctx.lineTo(px, chartArea.bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = opt.color || '#d4af37';
    ctx.font = '600 10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('bugün', px, chartArea.top - 4);
    ctx.restore();
  }
};

function projeChartGantt(rows, T) {
  const bugun = new Date();
  const kayitlar = rows.map(p => {
    const bas = projeParseDate(p.baslangic);
    if (!bas) return null;
    const durum = getProjeStatus(p);
    let bit = projeParseDate(p.gercekBitis) || projeParseDate(p.planlananBitis);
    if (!bit || bit < bas) bit = durum === 'tamamlandi' ? bas : bugun;
    return { p, bas, bit, durum };
  }).filter(Boolean);

  if (!kayitlar.length) return { empty: 'Başlangıç tarihi girilmiş proje bulunamadı.' };

  const gosterilen = kayitlar
    .sort((a, b) => b.bas - a.bas)
    .slice(0, 28)
    .sort((a, b) => a.bas - b.bas);

  const enUzun = [...gosterilen].sort((a, b) => projeGunFarki(a.bas, a.bit) < projeGunFarki(b.bas, b.bit) ? 1 : -1)[0];

  // Çubuk grafiğin değer ekseni varsayılan olarak 0'dan (1970) başlar; aralığı veriye sabitle
  const enErken = Math.min(...gosterilen.map(k => k.bas.getTime()));
  const enGec = Math.max(...gosterilen.map(k => k.bit.getTime()), bugun.getTime());
  const pay = Math.max((enGec - enErken) * 0.03, 3 * 86400000);

  return {
    insight: `📌 En yeni ${gosterilen.length} proje gösteriliyor (toplam ${kayitlar.length}) · En uzun süren: <strong>${projeKisaMetin(enUzun.p.urunAdi, 40)}</strong> (${projeGunFarki(enUzun.bas, enUzun.bit)} gün)`,
    config: {
      type: 'bar',
      data: {
        labels: gosterilen.map(k => projeKisaMetin(k.p.urunAdi || k.p.atolye, 30)),
        datasets: [{
          label: 'Proje Süresi',
          data: gosterilen.map(k => [k.bas.getTime(), Math.max(k.bit.getTime(), k.bas.getTime() + 86400000)]),
          backgroundColor: gosterilen.map(k => PROJE_DURUM_RENK[k.durum]),
          borderRadius: 4,
          borderSkipped: false,
          barPercentage: 0.72
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 14 } },
        plugins: {
          legend: { display: false },
          projeBugunCizgisi: { value: bugun.getTime(), color: T.gold },
          tooltip: {
            ...T.tooltip,
            callbacks: {
              title: (items) => gosterilen[items[0].dataIndex].p.urunAdi || '—',
              label: (c) => {
                const k = gosterilen[c.dataIndex];
                return ` ${projeTarihTR(k.bas)} → ${projeTarihTR(k.bit)} (${projeGunFarki(k.bas, k.bit)} gün)`;
              },
              afterLabel: (c) => {
                const k = gosterilen[c.dataIndex];
                return [` Atölye: ${k.p.atolye || '—'}`, ` Personel: ${projeKisaMetin(k.p.personel, 40)}`, ` Durum: ${PROJE_DURUM_ETIKET[k.durum]}`];
              }
            }
          }
        },
        scales: {
          x: {
            type: 'linear',
            min: enErken - pay,
            max: enGec + pay,
            grid: { color: T.grid },
            ticks: {
              color: T.muted,
              maxTicksLimit: 8,
              callback: (v) => {
                const d = new Date(v);
                return `${PROJE_AY_KISA[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
              }
            }
          },
          y: { grid: { display: false }, ticks: { color: T.muted, font: { size: 10 } } }
        }
      },
      plugins: [projeBugunCizgisiPlugin]
    }
  };
}

// --- 7. Plan – gerçekleşen sapma (kabarcık) ---------------------------

const projeReferansCizgisiPlugin = {
  id: 'projeReferansCizgisi',
  beforeDatasetsDraw(chart) {
    const opt = chart.options.plugins?.projeReferansCizgisi;
    if (!opt) return;
    const { ctx, chartArea, scales } = chart;
    if (!chartArea || !scales.x || !scales.y) return;
    const ust = Math.min(scales.x.max, scales.y.max);
    ctx.save();
    ctx.strokeStyle = opt.color || '#d4af37';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(scales.x.getPixelForValue(0), scales.y.getPixelForValue(0));
    ctx.lineTo(scales.x.getPixelForValue(ust), scales.y.getPixelForValue(ust));
    ctx.stroke();
    ctx.restore();
  }
};

function projeChartSapma(rows, T) {
  const zamaninda = [], gecikmeli = [], devamEden = [];
  const bugun = new Date();

  rows.forEach(p => {
    const bas = projeParseDate(p.baslangic);
    const plan = projeParseDate(p.planlananBitis);
    if (!bas || !plan) return;
    const planG = projeGunFarki(bas, plan);
    if (planG <= 0) return;

    const gercek = projeParseDate(p.gercekBitis);
    const tamam = !!gercek && getProjeStatus(p) === 'tamamlandi';
    const bit = gercek || bugun;
    const gercekG = projeGunFarki(bas, bit);
    if (gercekG < 0) return;

    const kisi = parseInt(String(p.personelSayisi).replace(/\D/g, ''), 10);
    const ekip = Number.isFinite(kisi) && kisi > 0 ? kisi : Math.max(1, projeKisiler(p).length);
    const nokta = {
      x: planG, y: gercekG, r: Math.min(16, 4 + ekip * 1.6),
      _ad: p.urunAdi || '—', _atolye: p.atolye || '—', _ekip: ekip,
      _sapma: gercekG - planG, _tamam: tamam
    };

    if (!tamam) devamEden.push(nokta);
    else if (nokta._sapma > 0) gecikmeli.push(nokta);
    else zamaninda.push(nokta);
  });

  // Devam eden işler grafikte çizilmez: üzerinden aylar geçmiş açık kayıtlar
  // ekseni şişirip tamamlanmış projelerin sapmasını okunmaz hâle getiriyor.
  if (!zamaninda.length && !gecikmeli.length) {
    return {
      empty: devamEden.length
        ? 'Sapma analizi için gerçek bitiş tarihi girilmiş (tamamlanmış) proje gerekiyor. Şu an yalnızca ' + devamEden.length + ' devam eden proje var.'
        : 'Sapma analizi için başlangıç ve planlanan bitiş tarihi dolu proje gerekiyor.'
    };
  }

  const olculen = [...zamaninda, ...gecikmeli];
  const ortSapma = olculen.length
    ? Math.round(olculen.reduce((a, b) => a + b._sapma, 0) / olculen.length) : null;
  const enKotu = [...olculen].sort((a, b) => b._sapma - a._sapma)[0];
  const sureyiAsan = devamEden.filter(d => d._sapma > 0).length;

  const etiket = (c) => {
    const d = c.raw;
    return [
      ` ${d._ad} (${d._atolye})`,
      ` Planlanan: ${d.x} gün · Gerçekleşen: ${d.y} gün`,
      ` Sapma: ${d._sapma > 0 ? '+' : ''}${d._sapma} gün · Ekip: ${d._ekip} kişi`
    ];
  };

  const bilgi = [];
  bilgi.push(ortSapma === null
    ? '📌 Henüz gerçek bitiş tarihi girilmiş proje yok; ortalama sapma hesaplanamadı'
    : `📌 Tamamlanan projelerde ortalama sapma: <strong>${ortSapma > 0 ? '+' : ''}${ortSapma} gün</strong>`);
  bilgi.push(`Zamanında/erken: <strong>${zamaninda.length}</strong>`);
  bilgi.push(`Gecikmeli: <strong>${gecikmeli.length}</strong>`);
  if (devamEden.length) bilgi.push(`Grafik dışı ${devamEden.length} devam eden projeden <strong>${sureyiAsan}</strong> tanesi planlanan süreyi aştı`);
  if (enKotu && enKotu._sapma > 0) bilgi.push(`En yüksek sapma: <strong>${projeKisaMetin(enKotu._ad, 32)}</strong> (+${enKotu._sapma} gün)`);

  return {
    insight: bilgi.join(' · '),
    config: {
      type: 'bubble',
      data: {
        datasets: [
          {
            label: 'Zamanında / Erken', data: zamaninda,
            backgroundColor: 'rgba(46, 125, 50, 0.55)', borderColor: '#2e7d32', borderWidth: 1
          },
          {
            label: 'Gecikmeli', data: gecikmeli,
            backgroundColor: 'rgba(198, 40, 40, 0.55)', borderColor: '#c62828', borderWidth: 1
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: T.text, boxWidth: 12, usePointStyle: true } },
          projeReferansCizgisi: { color: T.gold },
          tooltip: { ...T.tooltip, callbacks: { label: etiket } }
        },
        scales: {
          x: {
            beginAtZero: true, grid: { color: T.grid }, ticks: { color: T.muted },
            title: { display: true, text: 'Planlanan Süre (gün)', color: T.muted }
          },
          y: {
            beginAtZero: true, grid: { color: T.grid }, ticks: { color: T.muted },
            title: { display: true, text: 'Gerçekleşen Süre (gün)', color: T.muted }
          }
        }
      },
      plugins: [projeReferansCizgisiPlugin]
    }
  };
}

// --- 8. Personel iş yükü ----------------------------------------------

function projeChartPersonel(rows, T) {
  const map = {};
  rows.forEach(p => {
    const durum = getProjeStatus(p);
    projeKisiler(p).forEach(k => {
      if (!map[k]) map[k] = { tamamlandi: 0, devam: 0, gecikti: 0, toplam: 0 };
      map[k][durum]++;
      map[k].toplam++;
    });
  });

  const liste = Object.entries(map).sort((a, b) => b[1].toplam - a[1].toplam).slice(0, 15);
  if (!liste.length) return { empty: 'Personel bilgisi bulunamadı.' };

  const toplamKatki = Object.values(map).reduce((a, b) => a + b.toplam, 0);

  return {
    insight: `📌 ${Object.keys(map).length} kişi, toplam ${toplamKatki} proje katkısı · En yoğun: <strong>${liste[0][0]}</strong> (${liste[0][1].toplam} proje, ${liste[0][1].tamamlandi} tamamlanmış)`,
    config: {
      type: 'bar',
      data: {
        labels: liste.map(([k]) => projeKisaMetin(k, 24)),
        datasets: ['tamamlandi', 'devam', 'gecikti'].map(d => ({
          label: PROJE_DURUM_ETIKET[d],
          data: liste.map(([, v]) => v[d]),
          backgroundColor: PROJE_DURUM_RENK[d],
          borderRadius: 4,
          borderSkipped: false
        }))
      },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: T.text, boxWidth: 14, usePointStyle: true } },
          tooltip: { ...T.tooltip, mode: 'index', intersect: false }
        },
        scales: {
          x: { stacked: true, beginAtZero: true, grid: { color: T.grid }, ticks: { color: T.muted, precision: 0 } },
          y: { stacked: true, grid: { display: false }, ticks: { color: T.muted, font: { size: 11 } } }
        }
      }
    }
  };
}

// --- 9. Yoğunluk ısı haritası (atölye × ay) ---------------------------

function projeChartIsiHaritasi(rows) {
  const hucre = {}, atolyeToplam = {}, ayKeys = [];
  rows.forEach(p => {
    const d = projeParseDate(p.baslangic);
    if (!d) return;
    const a = (String(p.atolye || '').trim()) || 'Belirtilmemiş';
    const k = projeAyAnahtari(d);
    hucre[a + '|' + k] = (hucre[a + '|' + k] || 0) + 1;
    atolyeToplam[a] = (atolyeToplam[a] || 0) + 1;
    ayKeys.push(k);
  });

  if (!ayKeys.length) return { empty: 'Başlangıç tarihi girilmiş proje bulunamadı.' };

  let aylar = projeAyAralik(ayKeys);
  if (aylar.length > 18) aylar = aylar.slice(-18);
  const atolyeler = Object.entries(atolyeToplam).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k]) => k);
  const enYuksek = Math.max(...atolyeler.flatMap(a => aylar.map(m => hucre[a + '|' + m] || 0)), 1);

  const hucreHtml = (a, m) => {
    const v = hucre[a + '|' + m] || 0;
    const oran = v / enYuksek;
    const alpha = v === 0 ? 0 : 0.18 + 0.82 * oran;
    const stil = v === 0
      ? 'background: rgba(255,255,255,0.03); color: transparent;'
      : `background: rgba(212, 175, 55, ${alpha.toFixed(2)}); color: ${oran > 0.55 ? '#241a05' : 'var(--text-main)'};`;
    return `<div class="proje-isi-hucre" style="${stil}" title="${escapeHtml(a)} · ${projeAyEtiketi(m)}: ${v} proje">${v || ''}</div>`;
  };

  const html = `
    <div class="proje-isi-sarmal">
      <div class="proje-isi-grid" style="grid-template-columns: minmax(120px, 170px) repeat(${aylar.length}, minmax(38px, 1fr));">
        <div class="proje-isi-kose"></div>
        ${aylar.map(m => `<div class="proje-isi-baslik">${escapeHtml(projeAyEtiketi(m))}</div>`).join('')}
        ${atolyeler.map(a => `
          <div class="proje-isi-satir-baslik" title="${escapeHtml(a)}">${escapeHtml(projeKisaMetin(a, 24))}<span>${atolyeToplam[a]}</span></div>
          ${aylar.map(m => hucreHtml(a, m)).join('')}
        `).join('')}
      </div>
    </div>
    <div class="proje-isi-olcek">
      <span>Az</span>
      ${[0.15, 0.35, 0.55, 0.75, 1].map(o => `<i style="background: rgba(212, 175, 55, ${(0.18 + 0.82 * o).toFixed(2)});"></i>`).join('')}
      <span>Çok (${enYuksek} proje)</span>
    </div>`;

  return {
    html,
    insight: `📌 ${atolyeler.length} atölye × ${aylar.length} ay gösteriliyor · En yoğun hücre: <strong>${enYuksek} proje</strong> · En üretken atölye: <strong>${atolyeler[0]}</strong> (${atolyeToplam[atolyeler[0]]} proje)`
  };
}

// --- PNG dışa aktarma --------------------------------------------------

function projeChartPngIndir() {
  const chart = STATE.charts.projeTime;
  if (!chart) { showToast('İndirilecek bir grafik yok.', 'warning'); return; }
  const kaynak = chart.canvas;
  const hedef = document.createElement('canvas');
  hedef.width = kaynak.width;
  hedef.height = kaynak.height;
  const ctx = hedef.getContext('2d');
  ctx.fillStyle = projeChartTheme().zemin || '#191425';
  ctx.fillRect(0, 0, hedef.width, hedef.height);
  ctx.drawImage(kaynak, 0, 0);
  const a = document.createElement('a');
  a.href = hedef.toDataURL('image/png');
  a.download = `proje-${_projeChartType}-${new Date().toISOString().slice(0, 10)}.png`;
  a.click();
  showToast('Grafik PNG olarak indirildi.', 'success');
}

function getMonthYearRange(minMy, maxMy) {
  const range = [];
  let [currY, currM] = minMy.split('-').map(Number);
  const [maxY, maxM] = maxMy.split('-').map(Number);

  while (currY < maxY || (currY === maxY && currM <= maxM)) {
    const mStr = String(currM).padStart(2, '0');
    range.push(`${currY}-${mStr}`);
    currM++;
    if (currM > 12) {
      currM = 1;
      currY++;
    }
  }
  return range;
}

// Proje Event Listener'ları
document.addEventListener('DOMContentLoaded', function () {
  document.getElementById('btn-proje-load')?.addEventListener('click', loadProjeData);
  document.getElementById('btn-proje-filter-clear')?.addEventListener('click', () => {
    ['proje-search', 'proje-start-date', 'proje-end-date'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    ['proje-filter-atolye', 'proje-filter-status', 'proje-filter-personel'].forEach(id => { const el = document.getElementById(id); if (el) el.value = 'all'; });
    applyProjeFilters();
  });
  ['proje-search', 'proje-filter-atolye', 'proje-filter-status', 'proje-filter-personel', 'proje-start-date', 'proje-end-date'].forEach(id => {
    const el = document.getElementById(id);
    el?.addEventListener(id === 'proje-search' ? 'input' : 'change', applyProjeFilters);
  });
  document.getElementById('btn-proje-group-toggle')?.addEventListener('click', function () {
    _projeGrouped = !_projeGrouped;
    this.textContent = _projeGrouped ? '📋 Düz Liste Görünümü' : '🗂️ Atölyeye Göre Grupla';
    renderProjeTable();
  });
  document.getElementById('btn-proje-pdf-main')?.addEventListener('click', printProjeReport);
  document.getElementById('btn-proje-pdf')?.addEventListener('click', printProjeReport);
  document.getElementById('btn-proje-mail-main')?.addEventListener('click', sendProjeReportMail);
  document.getElementById('btn-proje-mail')?.addEventListener('click', sendProjeReportMail);

  // Gelişmiş Grafik Dinleyicileri
  ['proje-chart-filter-personel', 'proje-chart-filter-atolye', 'proje-chart-filter-status',
   'proje-chart-start-date', 'proje-chart-end-date'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', renderProjeChart);
  });

  document.getElementById('proje-chart-typebar')?.addEventListener('click', (e) => {
    const chip = e.target.closest('.proje-chart-chip');
    if (!chip) return;
    const tur = chip.getAttribute('data-charttype');
    if (!tur || !PROJE_CHART_TYPES[tur]) return;
    _projeChartType = tur;
    document.querySelectorAll('#proje-chart-typebar .proje-chart-chip')
      .forEach(c => c.classList.toggle('active', c === chip));
    renderProjeChart();
  });

  document.getElementById('btn-proje-chart-png')?.addEventListener('click', projeChartPngIndir);

  document.getElementById('btn-reset-proje-chart')?.addEventListener('click', () => {
    ['proje-chart-filter-personel', 'proje-chart-filter-atolye', 'proje-chart-filter-status']
      .forEach(id => { const el = document.getElementById(id); if (el) el.value = 'all'; });
    ['proje-chart-start-date', 'proje-chart-end-date']
      .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    renderProjeChart();
  });

  document.getElementById('proje-tbody')?.addEventListener('click', function (e) {
    const detailBtn = e.target.closest('.proje-detail-btn');
    const row = e.target.closest('.proje-row');
    const idx = parseInt((detailBtn || row)?.getAttribute('data-idx'));
    if (!isNaN(idx)) openProjeDetail(idx);
  });
  document.getElementById('btn-proje-detail-close')?.addEventListener('click', () => {
    document.getElementById('proje-detail-panel')?.classList.add('hidden');
  });
});

// ============================================================
// ENVANTER SUB-TAB VE İNTERAKTİF YERLEŞKE HARİTASI MODÜLÜ
// ============================================================

function getItemLocationGroup(stokVal) {
  const val = (stokVal || '').trim().toLowerCase();
  if (!val || val === 'konak') return 'Konak';
  if (val === 'devecihan') return 'Devecihan';
  if (val === 'valilik') return 'Valilik';
  if (val === 'bohça' || val === 'bohca') return 'Bohça';
  if (val === 'hediyelik' || val === 'satış için gönderildi' || val === 'satis icin gonderildi') return 'Hediyelik';
  return 'Diğer';
}

function getDriveGalleryThumbnailUrl(driveUrl) {
  if (!driveUrl) return '';
  const urlStr = String(driveUrl).trim();
  if (urlStr.startsWith('http') && urlStr.indexOf('drive.google.com') === -1 && urlStr.indexOf('docs.google.com') === -1) {
    return urlStr;
  }
  const fileIdMatch = urlStr.match(/id=([a-zA-Z0-9_-]+)/) || urlStr.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || urlStr.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (fileIdMatch && fileIdMatch[1]) {
    return `https://drive.google.com/thumbnail?id=${fileIdMatch[1]}&sz=w400`;
  }
  return '';
}

function renderCampusMap() {
  const konakBadge = document.getElementById('badge-count-konak');
  if (!konakBadge) return;

  const counts = {
    Konak: 0,
    Devecihan: 0,
    Valilik: 0,
    Hediyelik: 0,
    Bohça: 0,
    Diğer: 0
  };

  (STATE.inventory || []).forEach(item => {
    const loc = getItemLocationGroup(item.stok);
    if (counts[loc] !== undefined) {
      counts[loc]++;
    }
  });

  document.getElementById('badge-count-konak').textContent = counts.Konak;
  document.getElementById('badge-count-devecihan').textContent = counts.Devecihan;
  document.getElementById('badge-count-valilik').textContent = counts.Valilik;
  document.getElementById('badge-count-hediyelik').textContent = counts.Hediyelik;
  document.getElementById('badge-count-bohca').textContent = counts.Bohça;
  document.getElementById('badge-count-diger').textContent = counts.Diğer;

  const selectedLocation = STATE.selectedMapLocation || 'Konak';

  const nodes = document.querySelectorAll('.campus-map-grid .map-node');
  nodes.forEach(node => {
    const loc = node.getAttribute('data-location');
    node.classList.toggle('active', loc === selectedLocation);
  });

  const galleryTitle = document.getElementById('gallery-title');
  const gallerySubtitle = document.getElementById('gallery-subtitle');
  const galleryGrid = document.getElementById('map-gallery-grid');
  const noDataDiv = document.getElementById('map-gallery-no-data');

  if (!galleryGrid) return;

  const locationTitles = {
    Konak: 'Tarihi Konak Eserleri',
    Devecihan: 'Devecihan Kültür Merkezi Eserleri',
    Valilik: 'Valilik Eserleri',
    Hediyelik: 'Mağaza & Hediyelik Eserleri',
    Bohça: 'Bohça Odası Eserleri',
    Diğer: 'Diğer Konumlardaki Eserler'
  };

  galleryTitle.textContent = locationTitles[selectedLocation] || 'Eserler';

  const filteredItems = (STATE.inventory || []).filter(item => getItemLocationGroup(item.stok) === selectedLocation);

  gallerySubtitle.textContent = `${filteredItems.length} eser listeleniyor`;
  galleryGrid.innerHTML = '';

  if (filteredItems.length === 0) {
    galleryGrid.classList.add('hidden');
    noDataDiv.classList.remove('hidden');
  } else {
    galleryGrid.classList.remove('hidden');
    noDataDiv.classList.add('hidden');

    filteredItems.forEach(item => {
      const card = document.createElement('div');
      card.className = 'gallery-card';
      card.setAttribute('data-row', item._rowNum);

      const statusValClean = String(item.durum).toLowerCase().replace(/[^a-z0-9ıışğüöç]/g, '');
      let statusClass = 'badge-role';
      const isCompleted = statusValClean.includes('arsiv') || statusValClean.includes('arşiv') || statusValClean.includes('tamam') || statusValClean.includes('onay');
      const isPending = statusValClean.includes('grafik') || statusValClean.includes('bekle') || statusValClean.includes('gorsel') || statusValClean.includes('görsel');
      if (isCompleted) {
        statusClass = 'badge-success';
      } else if (isPending) {
        statusClass = 'badge-warning';
      }

      const thumbUrl = getDriveGalleryThumbnailUrl(item.linkImage);
      let imgHtml = '';
      if (thumbUrl) {
        imgHtml = `<img src="${thumbUrl}" loading="lazy" decoding="async" referrerpolicy="no-referrer" alt="${escapeHtml(item.eserAdi || 'Görsel')}" class="gallery-card-img" data-fallback="sibling">`;
      }

      const name = item.eserAdi || 'İsimsiz Eser';
      const initials = name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || 'ES';

      const initialsHtml = `
        <div class="gallery-card-fallback" style="${thumbUrl ? 'display:none;' : 'display:flex;'}">
          <span class="fallback-text">${initials}</span>
        </div>
      `;

      card.innerHTML = `
        <div class="gallery-card-img-wrapper">
          ${imgHtml}
          ${initialsHtml}
          <div class="gallery-card-tag">${item.envanterNo || '-'}</div>
        </div>
        <div class="gallery-card-info">
          <span class="gallery-card-theme">${item.tema || 'Temasız'}</span>
          <h4 class="gallery-card-title">${name}</h4>
          <div class="gallery-card-meta">
            <span class="gallery-card-author" title="${item.personel || 'Belirtilmemiş'}">👤 ${item.personel || 'Belirtilmemiş'}</span>
            <span class="badge ${statusClass}">${item.durum && item.durum !== 'undefined' ? item.durum : 'Belirtilmemiş'}</span>
          </div>
        </div>
      `;

      card.addEventListener('click', () => {
        openEditInventoryModal(item._rowNum);
      });

      galleryGrid.appendChild(card);
    });
  }
}

// YERLEŞKE HARİTASI RAPORLAMA FONKSİYONLARI

async function printMapReport() {
  // PDF motoru istek üzerine yüklenir (açılışı yavaşlatmasın diye).
  if (!(await pdfMotoruHazirla())) return;

  const selectedLocation = STATE.selectedMapLocation || 'Konak';
  const locationNames = {
    Konak: 'Tarihi Konak',
    Devecihan: 'Devecihan Kültür Merkezi',
    Valilik: 'Valilik',
    Hediyelik: 'Mağaza & Hediyelik',
    Bohça: 'Bohça Odası',
    Diğer: 'Diğer Konumlar / Depolar'
  };
  const locName = locationNames[selectedLocation] || selectedLocation;
  const items = (STATE.inventory || []).filter(item => getItemLocationGroup(item.stok) === selectedLocation);

  const rows = items.map(item => {
    return `<tr>
      <td>${item.envanterNo || '—'}</td>
      <td>${item.eserAdi || '—'}</td>
      <td>${item.personel || '—'}</td>
      <td>${item.tema || '—'}</td>
      <td>${item.cins || '—'}</td>
      <td>${item.durum || '—'}</td>
    </tr>`;
  }).join('');

  const tempDiv = document.createElement('div');
  tempDiv.style.width = '800px';
  tempDiv.style.backgroundColor = '#ffffff';
  tempDiv.style.color = '#333333';
  tempDiv.innerHTML = `
    <div style="font-family: Arial, sans-serif; padding: 25px; color: #333333; background: #ffffff;">
      <h1 style="color: #4b1478; font-size: 20px; border-bottom: 2px solid #d4af37; padding-bottom: 8px; margin-top: 0; margin-bottom: 4px; font-weight: bold;">🏛️ Edirne Olgunlaşma Enstitüsü</h1>
      <h2 style="color: #555555; font-size: 15px; margin-top: 0; margin-bottom: 20px;">Yerleşke Konum Stok Raporu (${new Date().toLocaleDateString('tr-TR')})</h2>
      
      <div style="background: #f7f6fa; border-radius: 8px; padding: 12px 18px; border-left: 4px solid #4b1478; margin-bottom: 20px;">
        <span style="font-size: 14px; color: #333333; display: block; font-weight: bold;">Konum: ${locName}</span>
        <span style="font-size: 12px; color: #666666;">Toplam Eser Sayısı: <strong>${items.length}</strong></span>
      </div>
      
      <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
        <thead>
          <tr style="background: #4b1478; color: #ffffff;">
            <th style="padding: 10px 8px; text-align: left; font-size: 11px; font-weight: bold; width: 15%;">Envanter No</th>
            <th style="padding: 10px 8px; text-align: left; font-size: 11px; font-weight: bold; width: 25%;">Eser Adı</th>
            <th style="padding: 10px 8px; text-align: left; font-size: 11px; font-weight: bold; width: 20%;">Personel</th>
            <th style="padding: 10px 8px; text-align: left; font-size: 11px; font-weight: bold; width: 15%;">Tema</th>
            <th style="padding: 10px 8px; text-align: left; font-size: 11px; font-weight: bold; width: 15%;">Ürün Cinsi</th>
            <th style="padding: 10px 8px; text-align: left; font-size: 11px; font-weight: bold; width: 10%;">Durum</th>
          </tr>
        </thead>
        <tbody>
          ${rows || '<tr><td colspan="6" style="text-align:center; padding:15px; color:#999;">Bu konumda kayıtlı eser bulunmamaktadır.</td></tr>'}
        </tbody>
      </table>
      
      <div style="margin-top: 40px; text-align: center; color: #999999; font-size: 10px; border-top: 1px dashed #ddd; padding-top: 15px;">
        Edirne Olgunlaşma Enstitüsü Envanter Yönetim Sistemi — ${new Date().toLocaleString('tr-TR')}
      </div>
    </div>
  `;

  const cells = tempDiv.querySelectorAll('td, th');
  cells.forEach(c => {
    c.style.padding = '10px 8px';
    c.style.borderBottom = '1px solid #eee';
    c.style.fontSize = '11px';
    if (c.tagName.toLowerCase() === 'th') {
      c.style.color = '#ffffff';
    } else {
      c.style.color = '#333333';
    }
  });

  const rowEls = tempDiv.querySelectorAll('tbody tr');
  rowEls.forEach((r, idx) => {
    if (idx % 2 === 1) {
      r.style.backgroundColor = '#f7f6fa';
    }
  });

  const opt = {
    margin: [10, 10],
    filename: `Yerleske_Stok_Raporu_${locName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, letterRendering: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  showToast('PDF raporu hazırlanıyor, lütfen bekleyin...', 'info');

  html2pdf().set(opt).from(tempDiv).save()
    .then(() => {
      showToast('PDF başarıyla indirildi.', 'success');
    })
    .catch(err => {
      console.error('PDF Hatası:', err);
      showToast('PDF oluşturulurken bir hata oluştu: ' + err.message, 'danger');
    });
}

async function sendMapReportMail() {
  const selectedLocation = STATE.selectedMapLocation || 'Konak';
  const locationNames = {
    Konak: 'Tarihi Konak',
    Devecihan: 'Devecihan Kültür Merkezi',
    Valilik: 'Valilik',
    Hediyelik: 'Mağaza & Hediyelik',
    Bohça: 'Bohça Odası',
    Diğer: 'Diğer Konumlar / Depolar'
  };
  const locName = locationNames[selectedLocation] || selectedLocation;
  const items = (STATE.inventory || []).filter(item => getItemLocationGroup(item.stok) === selectedLocation);

  const recipient = await showEmailPrompt('', 'Konum Stok Raporu Gönder');
  if (recipient === null) return;
  if (!recipient || !recipient.includes('@')) {
    showToast('Geçerli bir e-posta adresi girilmedi.', 'warning');
    return;
  }

  const mailItems = items.map(item => ({
    envanterNo: item.envanterNo,
    eserAdi: item.eserAdi,
    personel: item.personel,
    tema: item.tema,
    cins: item.cins,
    durum: item.durum
  }));

  toggleLoading(true, 'E-posta gönderiliyor...');
  try {
    const res = await apiPost('send_map_report_mail', {
      recipient,
      locationName: locName,
      reportDate: new Date().toLocaleDateString('tr-TR'),
      items: mailItems
    });
    toggleLoading(false);
    if (res?.success) {
      showToast('Yerleşke raporu ' + recipient + ' adresine başarıyla gönderildi.', 'success');
    } else {
      showToast('Mail gönderilemedi: ' + (res?.error || 'Bilinmeyen hata'), 'danger');
    }
  } catch (err) {
    toggleLoading(false);
    showToast('Mail gönderilemedi: ' + err.message, 'danger');
  }
}

// FİLTRELENMİŞ ENVANTERİ PDF OLARAK RAPORLA (html2pdf.js ile)
async function printFilteredInventoryReport() {
  // PDF motoru istek üzerine yüklenir (açılışı yavaşlatmasın diye).
  if (!(await pdfMotoruHazirla())) return;

  const items = window._lastFilteredInventory || STATE.inventory || [];
  const filtersStr = window._lastFilteredInventoryFiltersStr || 'Yok (Tümü)';

  if (items.length === 0) {
    showToast('Raporlanacak eser bulunmamaktadır.', 'warning');
    return;
  }

  const rows = items.map(item => {
    const statusValClean = String(item.durum).toLowerCase().replace(/[^a-z0-9ıışğüöç]/g, '');
    const isCompleted = statusValClean.includes('arsiv') || statusValClean.includes('arşiv') || statusValClean.includes('tamam') || statusValClean.includes('onay');
    const isPending = statusValClean.includes('grafik') || statusValClean.includes('bekle') || statusValClean.includes('gorsel') || statusValClean.includes('görsel');

    let statusStyle = 'font-size: 8px; padding: 2px 4px; border-radius: 4px; font-weight: 600; display: inline-block; text-align: center; ';
    if (isCompleted) {
      statusStyle += 'background-color: #e2f9e9; color: #1e7e34; border: 1px solid #c3e6cb;';
    } else if (isPending) {
      statusStyle += 'background-color: #fff3cd; color: #856404; border: 1px solid #ffeeba;';
    } else {
      statusStyle += 'background-color: #e2e3e5; color: #383d41; border: 1px solid #d6d8db;';
    }

    return `<tr>
      <td style="font-weight: bold; color: #4b1478; font-family: monospace; font-size: 9px;">${item.envanterNo || '—'}</td>
      <td style="font-weight: 600; color: #222;">${item.eserAdi || '—'}</td>
      <td>${item.personel || '—'}</td>
      <td>${item.atolye || '—'}</td>
      <td>${item.teknik || '—'}</td>
      <td>${item.malzeme || '—'}</td>
      <td>${item.tema || '—'}</td>
      <td>${item.cins || '—'}</td>
      <td style="font-size: 8px; color: #666;">${item.olculeri || '—'}</td>
      <td><span style="${statusStyle}">${item.durum && item.durum !== 'undefined' ? item.durum : 'Belirtilmemiş'}</span></td>
    </tr>`;
  }).join('');

  const tempDiv = document.createElement('div');
  tempDiv.style.width = '1040px';
  tempDiv.style.backgroundColor = '#ffffff';
  tempDiv.style.color = '#333333';
  tempDiv.innerHTML = `
    <div style="font-family: Arial, sans-serif; padding: 25px; color: #333333; background: #ffffff;">
      <h1 style="color: #4b1478; font-size: 22px; border-bottom: 2px solid #d4af37; padding-bottom: 8px; margin-top: 0; margin-bottom: 4px; font-weight: bold; letter-spacing: 0.5px;">🏛️ Edirne Olgunlaşma Enstitüsü</h1>
      <h2 style="color: #555555; font-size: 14px; margin-top: 0; margin-bottom: 20px; font-weight: 500;">Filtrelenmiş Kurumsal Envanter Raporu</h2>
      
      <div style="background: #fdfafd; border-radius: 8px; padding: 12px 18px; border-left: 4px solid #4b1478; margin-bottom: 20px; border: 1px solid rgba(75,20,120,0.08); border-left-width: 4px;">
        <span style="font-size: 12px; color: #4b1478; display: block; font-weight: bold; margin-bottom: 4px;">Uygulanan Arama &amp; Filtreleme Seçenekleri:</span>
        <span style="font-size: 11px; color: #666; display: block; line-height: 1.4; margin-bottom: 6px;">${filtersStr}</span>
        <span style="font-size: 11px; color: #333;">Toplam Raporlanan Eser Sayısı: <strong style="color: #4b1478; font-size: 12px;">${items.length}</strong></span>
      </div>
      
      <table style="width: 100%; border-collapse: collapse; margin-top: 15px; box-shadow: 0 2px 5px rgba(0,0,0,0.02);">
        <thead>
          <tr style="background: #4b1478; color: #ffffff;">
            <th style="padding: 10px 6px; text-align: left; font-size: 10px; font-weight: bold; width: 10%; border-bottom: 2px solid #d4af37;">Envanter No</th>
            <th style="padding: 10px 6px; text-align: left; font-size: 10px; font-weight: bold; width: 16%; border-bottom: 2px solid #d4af37;">Eser Adı</th>
            <th style="padding: 10px 6px; text-align: left; font-size: 10px; font-weight: bold; width: 11%; border-bottom: 2px solid #d4af37;">Personel</th>
            <th style="padding: 10px 6px; text-align: left; font-size: 10px; font-weight: bold; width: 10%; border-bottom: 2px solid #d4af37;">Atölye</th>
            <th style="padding: 10px 6px; text-align: left; font-size: 10px; font-weight: bold; width: 10%; border-bottom: 2px solid #d4af37;">Teknik</th>
            <th style="padding: 10px 6px; text-align: left; font-size: 10px; font-weight: bold; width: 10%; border-bottom: 2px solid #d4af37;">Malzeme</th>
            <th style="padding: 10px 6px; text-align: left; font-size: 10px; font-weight: bold; width: 10%; border-bottom: 2px solid #d4af37;">Tema</th>
            <th style="padding: 10px 6px; text-align: left; font-size: 10px; font-weight: bold; width: 8%; border-bottom: 2px solid #d4af37;">Cins</th>
            <th style="padding: 10px 6px; text-align: left; font-size: 10px; font-weight: bold; width: 7%; border-bottom: 2px solid #d4af37;">Ölçü</th>
            <th style="padding: 10px 6px; text-align: left; font-size: 10px; font-weight: bold; width: 8%; border-bottom: 2px solid #d4af37;">Durum</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
      
      <div style="margin-top: 40px; text-align: center; color: #999999; font-size: 9px; border-top: 1px dashed #ddd; padding-top: 15px;">
        Edirne Olgunlaşma Enstitüsü Arşiv Otomasyon Sistemi — Rapor Tarihi: ${new Date().toLocaleString('tr-TR')}
      </div>
    </div>
  `;

  const cells = tempDiv.querySelectorAll('td, th');
  cells.forEach(c => {
    c.style.padding = '8px 5px';
    c.style.borderBottom = '1px solid #e9e9e9';
    c.style.fontSize = '9px';
    c.style.lineHeight = '1.3';
    if (c.tagName.toLowerCase() === 'th') {
      c.style.color = '#ffffff';
    } else {
      if (!c.style.color) c.style.color = '#333333';
    }
  });

  const rowEls = tempDiv.querySelectorAll('tbody tr');
  rowEls.forEach((r, idx) => {
    if (idx % 2 === 1) {
      r.style.backgroundColor = '#fbfafd';
    }
  });

  const opt = {
    margin: [10, 10],
    filename: `Filtrelenmis_Envanter_Raporu_${new Date().toISOString().split('T')[0]}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, letterRendering: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
  };

  showToast('Profesyonel PDF envanter raporu hazırlanıyor, lütfen bekleyin...', 'info');

  html2pdf().set(opt).from(tempDiv).save()
    .then(() => {
      showToast('PDF başarıyla indirildi.', 'success');
    })
    .catch(err => {
      console.error('PDF Hatası:', err);
      showToast('PDF oluşturulurken bir hata oluştu: ' + err.message, 'danger');
    });
}

// Drive görselini PDF'e gömülebilecek data: adresine çevirir. Önceden tuvale çizilen
// görsel html2canvas'ta kaynak sorunu çıkarmaz. (fetch yerine <img> kullanılır: CSP
// connect-src Google görsel adreslerine kapalıdır, img-src açıktır.) Erişilemezse boş
// döner ve PDF görselsiz üretilir.
function envanterGorselDataUrl(dosyaId) {
  if (!dosyaId) return Promise.resolve('');
  const adresler = [
    `https://lh3.googleusercontent.com/d/${dosyaId}=w800`,
    `https://drive.google.com/thumbnail?id=${dosyaId}&sz=w800`
  ];
  const dene = (adres) => new Promise((coz) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    const zaman = setTimeout(() => coz(''), 15000);
    img.onload = () => {
      clearTimeout(zaman);
      try {
        const tuval = document.createElement('canvas');
        tuval.width = img.naturalWidth;
        tuval.height = img.naturalHeight;
        tuval.getContext('2d').drawImage(img, 0, 0);
        coz(tuval.toDataURL('image/jpeg', 0.92));
      } catch (err) { coz(''); } // CORS izni yoksa tuval kirlenir
    };
    img.onerror = () => { clearTimeout(zaman); coz(''); };
    img.src = adres;
  });
  return adresler.reduce((onceki, adres) => onceki.then((sonuc) => sonuc || dene(adres)), Promise.resolve(''));
}

// DÜZENLEME PENCERESİNDEKİ ENVANTER KAYDINI PDF OLARAK KAYDET
// Formdaki güncel (henüz kaydedilmemiş olabilecek) değerler kullanılır.
async function envanterKaydiPdfKaydet() {
  const item = STATE.selectedInventoryItem;
  if (!item) {
    showToast('PDF\'e aktarılacak kayıt bulunamadı.', 'warning');
    return;
  }
  if (!(await pdfMotoruHazirla())) return;

  const deger = (id) => (document.getElementById(id)?.value || '').trim();
  const stokSecim = deger('edit-stok-select');
  const stok = stokSecim === 'Diğer' ? deger('edit-stok-other') : stokSecim;
  const bilgiFisi = deger('edit-link-info');
  const envanterNo = item.envanterNo || '';

  const alanlar = [
    ['Envanter No', envanterNo],
    ['Eser Adı', deger('edit-eser-adi')],
    ['Atölye', deger('edit-atolye')],
    ['Giriş Yapan Personel', deger('edit-personel')],
    ['Tema', deger('edit-tema')],
    ['Ürün Cinsi', deger('edit-cins')],
    ['Kullanılan Teknik', deger('edit-teknik')],
    ['Cinsi (Kullanılan Malzeme)', deger('edit-malzeme')],
    ['Ölçüleri', deger('edit-olculeri')],
    ['Üretim Başlangıç Tarihi', deger('edit-tarih-baslangic')],
    ['Üretim Bitiş Tarihi', deger('edit-tarih-bitis')],
    ['Kökeni (Kaynak)', deger('edit-koken')],
    ['Stok Durumu', stok],
    ['Ortak Atölye / Kişi', deger('edit-ortak')],
    ['Arşiv Durumu', deger('edit-durum')],
    ['Geleneksel Motif', deger('edit-etiket-motif')],
    ['Renk Paleti Kodu', deger('edit-etiket-renk')],
    ['Dönem / Yüzyıl', deger('edit-etiket-donem')],
    ['Materyal Tipi', deger('edit-etiket-materyal')]
  ];
  const uzunAlanlar = [
    ['Üretici Açıklaması', deger('edit-aciklama')],
    ['Hikaye', deger('edit-hikaye')],
    ['Bilgi Fişi', bilgiFisi]
  ];

  showToast('Envanter kaydı PDF olarak hazırlanıyor...', 'info');

  // Bilgi fişinde kullanılan görsel (★) tercih edilir; yoksa hücredeki ilk görsel.
  const galeri = _envanterGaleri.envanterNo === envanterNo ? _envanterGaleri : null;
  const gorselId = (galeri && galeri.fisGorselId) || driveDosyaId(deger('edit-link-image') || item.linkImage);
  const gorsel = await envanterGorselDataUrl(gorselId);

  const satirlar = alanlar.map(([ad, v], i) => `
    <tr style="background: ${i % 2 ? '#fbfafd' : '#ffffff'};">
      <td style="padding: 7px 10px; font-weight: bold; color: #4b1478; width: 38%; border-bottom: 1px solid #eee;">${escapeHtml(ad)}</td>
      <td style="padding: 7px 10px; color: #222; border-bottom: 1px solid #eee;">${escapeHtml(v || '—')}</td>
    </tr>`).join('');
  const bloklar = uzunAlanlar.filter(([, v]) => v).map(([ad, v]) => `
    <div style="margin-top: 16px; page-break-inside: avoid;">
      <div style="font-size: 12px; font-weight: bold; color: #4b1478; border-bottom: 1px solid #d4af37; padding-bottom: 4px; margin-bottom: 6px;">${escapeHtml(ad)}</div>
      <div style="font-size: 11px; line-height: 1.5; color: #333; white-space: pre-wrap; word-break: break-word;">${escapeHtml(v)}</div>
    </div>`).join('');

  const kap = document.createElement('div');
  kap.style.width = '700px';
  kap.style.backgroundColor = '#ffffff';
  kap.innerHTML = `
    <div style="font-family: Arial, sans-serif; padding: 25px; color: #333; background: #fff;">
      <h1 style="color: #4b1478; font-size: 20px; border-bottom: 2px solid #d4af37; padding-bottom: 8px; margin: 0 0 4px;">Edirne Olgunlaşma Enstitüsü</h1>
      <h2 style="color: #555; font-size: 13px; font-weight: 500; margin: 0 0 18px;">Envanter Kaydı — ${escapeHtml(envanterNo || 'Numarasız')}</h2>
      ${gorsel ? `<div style="text-align: center; margin-bottom: 18px;"><img src="${gorsel}" style="max-width: 320px; max-height: 320px; border-radius: 6px; border: 1px solid #eee;"></div>` : ''}
      <table style="width: 100%; border-collapse: collapse; font-size: 11px;">${satirlar}</table>
      ${bloklar}
      <div style="margin-top: 30px; text-align: center; color: #999; font-size: 9px; border-top: 1px dashed #ddd; padding-top: 12px;">
        Edirne Olgunlaşma Enstitüsü Arşiv Otomasyon Sistemi — Oluşturma Tarihi: ${new Date().toLocaleString('tr-TR')}
      </div>
    </div>`;

  const dosyaAdi = `Envanter_${String(envanterNo || 'Kayit').replace(/[^\w.-]+/g, '_')}.pdf`;
  html2pdf().set({
    margin: [10, 10],
    filename: dosyaAdi,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak: { mode: ['css', 'legacy'] }
  }).from(kap).save()
    .then(() => showToast('PDF başarıyla kaydedildi.', 'success'))
    .catch(err => {
      console.error('PDF Hatası:', err);
      showToast('PDF oluşturulurken bir hata oluştu: ' + err.message, 'danger');
    });
}

// FİLTRELENMİŞ ENVANTER RAPORUNU E-POSTA İLE GÖNDER
async function sendFilteredInventoryReportMail() {
  const items = window._lastFilteredInventory || STATE.inventory || [];
  const filtersStr = window._lastFilteredInventoryFiltersStr || 'Yok (Tümü)';

  if (items.length === 0) {
    showToast('Gönderilecek eser bulunmamaktadır.', 'warning');
    return;
  }

  const recipient = await showEmailPrompt('', 'Filtrelenmiş Envanter Raporu Gönder');
  if (recipient === null) return;
  if (!recipient || !recipient.includes('@')) {
    showToast('Geçerli bir e-posta adresi girilmedi.', 'warning');
    return;
  }

  const mailItems = items.map(item => ({
    envanterNo: item.envanterNo,
    eserAdi: item.eserAdi,
    personel: item.personel,
    tema: item.tema,
    cins: item.cins,
    durum: item.durum
  }));

  toggleLoading(true, 'E-posta gönderiliyor...');
  try {
    const res = await apiPost('send_filtered_inventory_mail', {
      recipient: recipient,
      reportDate: new Date().toLocaleDateString('tr-TR'),
      filtersStr: filtersStr,
      items: mailItems
    });
    toggleLoading(false);
    if (res?.success) {
      showToast('Envanter raporu ' + recipient + ' adresine başarıyla gönderildi.', 'success');
    } else {
      showToast('Mail gönderilemedi: ' + (res?.error || 'Bilinmeyen hata'), 'danger');
    }
  } catch (err) {
    toggleLoading(false);
    showToast('Mail gönderilemedi: ' + err.message, 'danger');
  }
}

(function initEnvanterSubTabs() {
  STATE.selectedMapLocation = 'Konak';

  document.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-subtarget]');
    if (!btn) return;
    const targetId = btn.getAttribute('data-subtarget');
    if (!targetId || !targetId.startsWith('envanter-')) return;

    const tabs = document.querySelectorAll('[data-subtarget^="envanter-"]');
    tabs.forEach(t => t.classList.toggle('active', t === btn));

    const subviews = document.querySelectorAll('.envanter-sub-view');
    subviews.forEach(v => {
      v.classList.toggle('active', v.id === targetId);
      v.classList.toggle('hidden', v.id !== targetId);
    });

    if (targetId === 'envanter-harita-subview') {
      renderCampusMap();
    }
    if (targetId === 'envanter-foto-subview') {
      renderEnvanterFoto();
    }
  });

  // Fotoğraf bekleyenler: süzgeçler, seçim, işaretleme, Görsel Yükle kısayolu
  const debouncedEnvanterFoto = debounce(renderEnvanterFoto, 150);
  document.addEventListener('input', function (e) {
    if (e.target.id === 'envanter-foto-arama') debouncedEnvanterFoto();
  });
  document.addEventListener('change', function (e) {
    const id = e.target.id;
    if (id === 'envanter-foto-atolye' || id === 'envanter-foto-durum') { renderEnvanterFoto(); return; }
    if (id === 'envanter-foto-hepsi') {
      _envanterFotoListelenen.forEach((no) => (e.target.checked ? _envanterFotoSecili.add(no) : _envanterFotoSecili.delete(no)));
      renderEnvanterFoto();
      return;
    }
    if (id === 'edit-grafik-foto') {
      const kutu = e.target;
      const item = STATE.selectedInventoryItem;
      if (!item) return;
      envanterGrafikFotoIsaretle([String(item.envanterNo).trim()], kutu.checked).then((tamam) => {
        if (!tamam) kutu.checked = !kutu.checked;
      });
      return;
    }
    const kutu = e.target.closest && e.target.closest('[data-foto-sec]');
    if (kutu) {
      const no = kutu.getAttribute('data-foto-sec');
      if (kutu.checked) _envanterFotoSecili.add(no); else _envanterFotoSecili.delete(no);
      kutu.closest('.muze-kart')?.classList.toggle('secili', kutu.checked);
      envanterFotoCubugunuGuncelle();
    }
  });
  document.addEventListener('click', function (e) {
    const yukle = e.target.closest('[data-foto-yukle]');
    if (yukle) {
      openEditInventoryModal(yukle.getAttribute('data-foto-yukle'));
      document.getElementById('envanter-galeri-bolum')?.scrollIntoView({ block: 'center' });
      return;
    }
    const pro = e.target.closest('[data-foto-profesyonel]');
    if (pro) { envanterGrafikFotoIsaretle([pro.getAttribute('data-foto-profesyonel')], true); return; }
    if (e.target.id === 'btn-envanter-foto-isaretle') {
      const nolar = [..._envanterFotoSecili];
      if (nolar.length && confirm(nolar.length + ' eser "grafik birimi fotoğrafı var" olarak işaretlenecek ve bu listeden çıkacak.\n\nDevam edilsin mi?')) {
        envanterGrafikFotoIsaretle(nolar, true);
      }
    }
  });

  document.addEventListener('click', function (e) {
    const node = e.target.closest('.campus-map-grid .map-node');
    if (!node) return;

    const loc = node.getAttribute('data-location');
    if (loc) {
      STATE.selectedMapLocation = loc;
      renderCampusMap();
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-map-pdf')?.addEventListener('click', printMapReport);
    document.getElementById('btn-map-mail')?.addEventListener('click', sendMapReportMail);
    document.getElementById('btn-export-literature-pdf')?.addEventListener('click', printFilteredLiteratureReport);
    document.getElementById('btn-export-photocards-pdf')?.addEventListener('click', printFilteredPhotoCardsReport);
  });
})();

// FİLTRELENMİŞ LİTERATÜR VE SAHA ZİYARETLERİNİ PDF OLARAK İNDİR
async function printFilteredLiteratureReport() {
  // PDF motoru istek üzerine yüklenir (açılışı yavaşlatmasın diye).
  if (!(await pdfMotoruHazirla())) return;

  const items = window._lastFilteredLiterature || STATE.literature || [];
  const filtersStr = window._lastFilteredLiteratureFiltersStr || 'Yok (Tümü)';

  if (items.length === 0) {
    showToast('Raporlanacak araştırma kaydı bulunmamaktadır.', 'warning');
    return;
  }

  function getLitValue(item, candidates) {
    for (const c of candidates) {
      const cl = c.toLowerCase();
      for (const k of Object.keys(item)) {
        if (k === '_rowNum') continue;
        const kl = k.toLowerCase();
        if (kl === cl || kl.includes(cl) || cl.includes(kl)) {
          const val = item[k];
          if (val !== null && val !== undefined && String(val).trim() !== '') {
            return String(val);
          }
        }
      }
    }
    return '';
  }

  const rows = items.map(item => {
    const id = getLitValue(item, ['ID', 'Kayıt ID', 'id', 'No']) || 'LIT';
    const tarih = getLitValue(item, ['Tarih', 'Date', 'Kayıt Tarihi', 'Zaman Damgası', 'Timestamp']);
    const konu = getLitValue(item, ['Konu / Başlık', 'Konu', 'Başlık', 'Title', 'Konu / Kaynak Adı', 'Kaynak Adı', 'İşlem Konusu']);
    const yer = getLitValue(item, ['Ziyaret Edilen Yer / Kaynak Arşiv', 'Ziyaret Yeri', 'Kaynak Arşiv', 'Yer', 'Lokasyon', 'Ziyaret Edilen Yer', 'Arşiv']);
    const personel = getLitValue(item, ['Araştırmacı Personel', 'Personel', 'Sorumlu Personel', 'Araştırmacı', 'Kullanıcı', 'Person']);
    const aciklama = getLitValue(item, ['Detaylı Açıklama', 'Açıklama', 'Description', 'Not', 'Detaylar', 'Notlar']);

    const rawDate = tarih ? tarih.split('T')[0] : 'Belirtilmemiş';

    return `<tr>
      <td style="font-weight: bold; color: #4b1478; font-family: monospace; font-size: 9px;">${id}</td>
      <td style="font-weight: 600; color: #222;">${rawDate}</td>
      <td>${konu || '—'}</td>
      <td>${yer || '—'}</td>
      <td>${personel || '—'}</td>
      <td style="font-size: 8px; color: #666; max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: normal;">${aciklama || '—'}</td>
    </tr>`;
  }).join('');

  const tempDiv = document.createElement('div');
  tempDiv.style.width = '1040px';
  tempDiv.style.backgroundColor = '#ffffff';
  tempDiv.style.color = '#333333';
  tempDiv.innerHTML = `
    <div style="font-family: Arial, sans-serif; padding: 25px; color: #333333; background: #ffffff;">
      <h1 style="color: #4b1478; font-size: 22px; border-bottom: 2px solid #d4af37; padding-bottom: 8px; margin-top: 0; margin-bottom: 4px; font-weight: bold; letter-spacing: 0.5px;">🏛️ Edirne Olgunlaşma Enstitüsü</h1>
      <h2 style="color: #555555; font-size: 14px; margin-top: 0; margin-bottom: 20px; font-weight: 500;">Filtrelenmiş Saha ve Literatür Araştırma Raporu</h2>
      
      <div style="background: #fdfafd; border-radius: 8px; padding: 12px 18px; border-left: 4px solid #4b1478; margin-bottom: 20px; border: 1px solid rgba(75,20,120,0.08); border-left-width: 4px;">
        <span style="font-size: 12px; color: #4b1478; display: block; font-weight: bold; margin-bottom: 4px;">Uygulanan Arama &amp; Filtreleme Seçenekleri:</span>
        <span style="font-size: 11px; color: #666; display: block; line-height: 1.4; margin-bottom: 6px;">${filtersStr}</span>
        <span style="font-size: 11px; color: #333;">Toplam Raporlanan Ziyaret Kaydı Sayısı: <strong style="color: #4b1478; font-size: 12px;">${items.length}</strong></span>
      </div>
      
      <table style="width: 100%; border-collapse: collapse; margin-top: 15px; box-shadow: 0 2px 5px rgba(0,0,0,0.02);">
        <thead>
          <tr style="background: #4b1478; color: #ffffff;">
            <th style="padding: 10px 6px; text-align: left; font-size: 10px; font-weight: bold; width: 10%; border-bottom: 2px solid #d4af37;">Kayıt ID</th>
            <th style="padding: 10px 6px; text-align: left; font-size: 10px; font-weight: bold; width: 12%; border-bottom: 2px solid #d4af37;">Tarih</th>
            <th style="padding: 10px 6px; text-align: left; font-size: 10px; font-weight: bold; width: 22%; border-bottom: 2px solid #d4af37;">Konu / Başlık</th>
            <th style="padding: 10px 6px; text-align: left; font-size: 10px; font-weight: bold; width: 20%; border-bottom: 2px solid #d4af37;">Ziyaret Edilen Yer / Kaynak Arşiv</th>
            <th style="padding: 10px 6px; text-align: left; font-size: 10px; font-weight: bold; width: 16%; border-bottom: 2px solid #d4af37;">Araştırmacı Personel</th>
            <th style="padding: 10px 6px; text-align: left; font-size: 10px; font-weight: bold; width: 20%; border-bottom: 2px solid #d4af37;">Açıklama</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
      
      <div style="margin-top: 40px; text-align: center; color: #999999; font-size: 9px; border-top: 1px dashed #ddd; padding-top: 15px;">
        Edirne Olgunlaşma Enstitüsü Arşiv Otomasyon Sistemi — Rapor Tarihi: ${new Date().toLocaleString('tr-TR')}
      </div>
    </div>
  `;

  const cells = tempDiv.querySelectorAll('td, th');
  cells.forEach(c => {
    c.style.padding = '10px 8px';
    c.style.borderBottom = '1px solid #e9e9e9';
    c.style.fontSize = '9px';
    c.style.lineHeight = '1.4';
    if (c.tagName.toLowerCase() === 'th') {
      c.style.color = '#ffffff';
    } else {
      if (!c.style.color) c.style.color = '#333333';
    }
  });

  const rowEls = tempDiv.querySelectorAll('tbody tr');
  rowEls.forEach((r, idx) => {
    if (idx % 2 === 1) {
      r.style.backgroundColor = '#fbfafd';
    }
  });

  const opt = {
    margin: [10, 10],
    filename: `Filtrelenmis_Saha_Ziyaretleri_Raporu_${new Date().toISOString().split('T')[0]}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, letterRendering: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
  };

  showToast('Profesyonel PDF saha ziyaretleri raporu hazırlanıyor, lütfen bekleyin...', 'info');

  html2pdf().set(opt).from(tempDiv).save()
    .then(() => {
      showToast('PDF başarıyla indirildi.', 'success');
    })
    .catch(err => {
      console.error('PDF Hatası:', err);
      showToast('PDF oluşturulurken bir hata oluştu: ' + err.message, 'danger');
    });
}

// FİLTRELENMİŞ FOTOĞRAF BİLGİ KARTLARINI KATALOG OLARAK PDF İNDİR
async function printFilteredPhotoCardsReport() {
  // PDF motoru istek üzerine yüklenir (açılışı yavaşlatmasın diye).
  if (!(await pdfMotoruHazirla())) return;

  const items = window._lastFilteredPhotoCards || [];
  const filtersStr = window._lastFilteredPhotoCardsFiltersStr || 'Yok (Tümü)';

  if (items.length === 0) {
    showToast('Raporlanacak fotoğraf bilgi kartı bulunmamaktadır.', 'warning');
    return;
  }

  function getLitValue(item, candidates) {
    for (const c of candidates) {
      const cl = c.toLowerCase();
      for (const k of Object.keys(item)) {
        if (k === '_rowNum') continue;
        const kl = k.toLowerCase();
        if (kl === cl || kl.includes(cl) || cl.includes(kl)) {
          const val = item[k];
          if (val !== null && val !== undefined && String(val).trim() !== '') {
            return String(val);
          }
        }
      }
    }
    return '';
  }

  const cardsHtml = items.map(item => {
    const konu = getLitValue(item, ['Tür / Kategori', 'Tür', 'Kategori', 'Dosya Adı', 'Konu / Başlık', 'Konu', 'Başlık', 'Title', 'Konu / Kaynak Adı', 'Kaynak Adı', 'İşlem Konusu']) || 'Başlıksız Görsel';
    const yer = getLitValue(item, ['Ziyaret Edilen Yer / Kaynak Arşiv', 'Ziyaret Yeri', 'Kaynak Arşiv', 'Yer', 'Lokasyon', 'Ziyaret Edilen Yer', 'Arşiv', 'Çekildiği Yer']) || 'Lokasyon Belirtilmemiş';
    const tarih = getLitValue(item, ['Tarih', 'Date', 'Kayıt Tarihi', 'Zaman Damgası', 'Timestamp']);
    const aciklama = getLitValue(item, ['Yapay Zeka Hikayesi', 'Hikaye', 'Yapay Zeka', 'Hikayesi', 'Detaylı Açıklama', 'Açıklama', 'Description', 'Not', 'Detaylar', 'Notlar']) || 'Açıklama girilmemiş.';
    const malzeme = getLitValue(item, ['ürün cinsi', 'cins', 'Tür / Kategori', 'tür', 'kategori', 'malzeme', 'pismis toprak', 'tip']) || '';
    const onayDurumu = getLitValue(item, ['Onay Durumu', 'Durum', 'Status']) || 'Bekliyor';

    const imageUrl = resolveImageUrl(item, 250);
    const dateFormatted = tarih ? tarih.split('T')[0] : 'Tarih Yok';
    const cleanYer = getCleanedLocation(yer, malzeme);

    const imgTag = imageUrl
      ? `<img src="${imageUrl}" referrerpolicy="no-referrer" style="width: 100%; max-height: 140px; object-fit: contain; border-radius: 6px; border: 1px solid rgba(0,0,0,0.06);" />`
      : `<div style="width: 100%; height: 120px; background: #f0f0f0; border-radius: 6px; display: flex; align-items: center; justify-content: center; color: #999; font-size: 24px;">🖼️</div>`;

    return `
      <div style="display: flex; gap: 15px; margin-bottom: 20px; padding-bottom: 20px; border-bottom: 1px solid #eeeeee; page-break-inside: avoid;">
        <div style="flex: 0 0 150px; text-align: center;">
          ${imgTag}
          <div style="margin-top: 8px; font-size: 8px; font-weight: 600; color: #4b1478; text-transform: uppercase;">${onayDurumu}</div>
        </div>
        <div style="flex: 1;">
          <h3 style="margin-top: 0; margin-bottom: 6px; font-size: 13px; color: #4b1478; font-weight: 700;">${konu}</h3>
          <div style="margin-bottom: 8px;">
            <span style="background: rgba(75,20,120,0.06); color: #4b1478; padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: 600; margin-right: 5px;">📍 ${cleanYer}</span>
            ${malzeme ? `<span style="background: rgba(212,175,55,0.1); color: #8a6d1c; padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: 600; margin-right: 5px;">🎨 ${malzeme}</span>` : ''}
            <span style="background: #f0f0f0; color: #555; padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: 600;">📅 ${dateFormatted}</span>
          </div>
          <p style="margin: 0; font-size: 10px; color: #444444; line-height: 1.5; text-align: justify; white-space: normal;">${aciklama}</p>
        </div>
      </div>
    `;
  }).join('');

  const tempDiv = document.createElement('div');
  tempDiv.style.width = '700px';
  tempDiv.style.backgroundColor = '#ffffff';
  tempDiv.style.color = '#333333';
  tempDiv.innerHTML = `
    <div style="font-family: Arial, sans-serif; padding: 30px; color: #333333; background: #ffffff;">
      <h1 style="color: #4b1478; font-size: 20px; border-bottom: 2px solid #d4af37; padding-bottom: 8px; margin-top: 0; margin-bottom: 4px; font-weight: bold; letter-spacing: 0.5px; text-align: center;">🏛️ Edirne Olgunlaşma Enstitüsü</h1>
      <h2 style="color: #555555; font-size: 13px; margin-top: 0; margin-bottom: 25px; font-weight: 500; text-align: center;">Filtrelenmiş Fotoğraf Bilgi Kartları Kataloğu</h2>
      
      <div style="background: #fdfafd; border-radius: 8px; padding: 12px 18px; border-left: 4px solid #4b1478; margin-bottom: 25px; border: 1px solid rgba(75,20,120,0.08); border-left-width: 4px;">
        <span style="font-size: 11px; color: #4b1478; display: block; font-weight: bold; margin-bottom: 3px;">Uygulanan Filtreleme Seçenekleri:</span>
        <span style="font-size: 10px; color: #666; display: block; line-height: 1.4; margin-bottom: 5px;">${filtersStr}</span>
        <span style="font-size: 10px; color: #333;">Toplam Listelenen Görsel Sayısı: <strong style="color: #4b1478; font-size: 11px;">${items.length}</strong></span>
      </div>
      
      <div>
        ${cardsHtml}
      </div>
      
      <div style="margin-top: 40px; text-align: center; color: #999999; font-size: 8px; border-top: 1px dashed #ddd; padding-top: 15px; page-break-inside: avoid;">
        Edirne Olgunlaşma Enstitüsü Arşiv Otomasyon Sistemi — Rapor Tarihi: ${new Date().toLocaleString('tr-TR')}
      </div>
    </div>
  `;

  const opt = {
    margin: [10, 10],
    filename: `Fotoğraf_Bilgi_Kartlari_Katalogu_${new Date().toISOString().split('T')[0]}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, letterRendering: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  showToast('Profesyonel PDF görsel kataloğu hazırlanıyor, lütfen bekleyin...', 'info');

  html2pdf().set(opt).from(tempDiv).save()
    .then(() => {
      showToast('PDF Kataloğu başarıyla indirildi.', 'success');
    })
    .catch(err => {
      console.error('PDF Hatası:', err);
      showToast('PDF oluşturulurken bir hata oluştu: ' + err.message, 'danger');
    });
}

/* ==========================================================================
   ÖZEL ÜRÜN KATALOĞU OLUŞTURUCU (PDF & PPTX KATALOG MODÜLÜ)
   ========================================================================== */

const CATALOG_STATE = {
  selectedIds: new Set(),
  order: [],
  theme: 'royal',
  texture: 'tezhip',
  layout: '1',
  title: 'EDİRNE OLGUNLAŞMA ENSTİTÜSÜ ÜRÜN KATALOĞU',
  subtitle: 'Geleneksel El Sanatları ve Özel Koleksiyon Seçkisi',
  customBg: '#4b0082',
  customText: '#ffffff',
  customAccent: '#d4af37',
  visibleFields: {
    envanterNo: true,
    atolye: true,
    tema: true,
    teknik: true,
    malzeme: true,
    olculeri: true,
    personel: true,
    aciklama: true
  }
};

const CATALOG_THEMES = {
  royal: { themeKey: 'royal', bg: '#4b0082', text: '#ffffff', accent: '#d4af37', cardBg: 'rgba(255,255,255,0.08)', labelColor: '#f3e8c8' },
  navy: { themeKey: 'navy', bg: '#0f172a', text: '#f8fafc', accent: '#38bdf8', cardBg: 'rgba(255,255,255,0.08)', labelColor: '#7dd3fc' },
  cream: { themeKey: 'cream', bg: '#fdfbf7', text: '#1c1917', accent: '#b45309', cardBg: '#ffffff', labelColor: '#065f46' },
  dark: { themeKey: 'dark', bg: '#121212', text: '#f3f4f6', accent: '#f59e0b', cardBg: '#1e1e1e', labelColor: '#fbbf24' },
  emerald: { themeKey: 'emerald', bg: '#064e3b', text: '#ffffff', accent: '#fbbf24', cardBg: 'rgba(255,255,255,0.09)', labelColor: '#fde047' },
  minimal: { themeKey: 'minimal', bg: '#ffffff', text: '#1e293b', accent: '#4b0082', cardBg: '#f8fafc', labelColor: '#6b21a8' },
  tulipRed: { themeKey: 'tulipRed', bg: '#6b0512', text: '#ffffff', accent: '#f59e0b', cardBg: 'rgba(255,255,255,0.08)', labelColor: '#fef08a' },
  bursaIvory: { themeKey: 'bursaIvory', bg: '#fefce8', text: '#331800', accent: '#92400e', cardBg: '#ffffff', labelColor: '#15803d' },
  aegeanTurq: { themeKey: 'aegeanTurq', bg: '#042f2e', text: '#f0fdfa', accent: '#2dd4bf', cardBg: 'rgba(255,255,255,0.08)', labelColor: '#99f6e4' },
  copper: { themeKey: 'copper', bg: '#24140e', text: '#fff7ed', accent: '#fb923c', cardBg: 'rgba(255,255,255,0.08)', labelColor: '#fdba74' },
  plum: { themeKey: 'plum', bg: '#2e1065', text: '#faf5ff', accent: '#c084fc', cardBg: 'rgba(255,255,255,0.08)', labelColor: '#e9d5ff' },
  terracotta: { themeKey: 'terracotta', bg: '#7c2d12', text: '#fff7ed', accent: '#fde047', cardBg: 'rgba(255,255,255,0.08)', labelColor: '#fef08a' }
};

function getDriveCatalogImageUrl(driveUrl) {
  if (!driveUrl) return '';
  const urlStr = String(driveUrl).trim();
  if (urlStr.indexOf('drive.google.com') === -1 && urlStr.indexOf('docs.google.com') === -1) {
    return urlStr;
  }
  const fileIdMatch = urlStr.match(/id=([a-zA-Z0-9_-]+)/) || urlStr.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || urlStr.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (fileIdMatch && fileIdMatch[1]) {
    return `https://drive.google.com/thumbnail?id=${fileIdMatch[1]}&sz=w1000`;
  }
  return urlStr;
}

function initCatalogEventListeners() {
  const searchInput = document.getElementById('catalog-search-input');
  const atolyeFilter = document.getElementById('catalog-filter-atolye');
  const temaFilter = document.getElementById('catalog-filter-tema');
  const imageFilter = document.getElementById('catalog-filter-has-image');

  const themeSelect = document.getElementById('catalog-theme-select');
  const textureSelect = document.getElementById('catalog-texture-select');
  const layoutSelect = document.getElementById('catalog-layout-select');
  const titleInput = document.getElementById('catalog-title-input');
  const subtitleInput = document.getElementById('catalog-subtitle-input');

  const customBg = document.getElementById('catalog-custom-bg');
  const customText = document.getElementById('catalog-custom-text');
  const customAccent = document.getElementById('catalog-custom-accent');

  // Search & Filter change events
  searchInput?.addEventListener('input', renderCatalogPickerList);
  atolyeFilter?.addEventListener('change', renderCatalogPickerList);
  temaFilter?.addEventListener('change', renderCatalogPickerList);
  imageFilter?.addEventListener('change', renderCatalogPickerList);

  // Customization controls change events
  themeSelect?.addEventListener('change', (e) => {
    CATALOG_STATE.theme = e.target.value;
    const customRow = document.getElementById('catalog-custom-colors-row');
    if (e.target.value === 'custom') {
      customRow?.classList.remove('hidden');
    } else {
      customRow?.classList.add('hidden');
    }
    renderCatalogLivePreview();
  });

  textureSelect?.addEventListener('change', (e) => {
    CATALOG_STATE.texture = e.target.value;
    renderCatalogLivePreview();
  });

  layoutSelect?.addEventListener('change', (e) => {
    CATALOG_STATE.layout = e.target.value;
    renderCatalogLivePreview();
  });

  titleInput?.addEventListener('input', (e) => {
    CATALOG_STATE.title = e.target.value || 'EDİRNE OLGUNLAŞMA ENSTİTÜSÜ ÜRÜN KATALOĞU';
    renderCatalogLivePreview();
  });

  subtitleInput?.addEventListener('input', (e) => {
    CATALOG_STATE.subtitle = e.target.value || '';
    renderCatalogLivePreview();
  });

  customBg?.addEventListener('input', (e) => {
    CATALOG_STATE.customBg = e.target.value;
    if (CATALOG_STATE.theme === 'custom') renderCatalogLivePreview();
  });
  customText?.addEventListener('input', (e) => {
    CATALOG_STATE.customText = e.target.value;
    if (CATALOG_STATE.theme === 'custom') renderCatalogLivePreview();
  });
  customAccent?.addEventListener('input', (e) => {
    CATALOG_STATE.customAccent = e.target.value;
    if (CATALOG_STATE.theme === 'custom') renderCatalogLivePreview();
  });

  // Toggle detail fields
  document.querySelectorAll('.catalog-field-toggle').forEach(chk => {
    chk.addEventListener('change', (e) => {
      CATALOG_STATE.visibleFields[e.target.value] = e.target.checked;
      renderCatalogLivePreview();
    });
  });

  // Action Buttons
  document.getElementById('btn-catalog-select-all')?.addEventListener('click', () => {
    const items = getFilteredCatalogProducts();
    items.forEach(item => {
      if (!CATALOG_STATE.selectedIds.has(item._rowNum)) {
        CATALOG_STATE.selectedIds.add(item._rowNum);
        CATALOG_STATE.order.push(item);
      }
    });
    updateCatalogSelectionBadge();
    renderCatalogPickerList();
    renderCatalogLivePreview();
  });

  document.getElementById('btn-catalog-clear-all')?.addEventListener('click', () => {
    CATALOG_STATE.selectedIds.clear();
    CATALOG_STATE.order = [];
    updateCatalogSelectionBadge();
    renderCatalogPickerList();
    renderCatalogLivePreview();
  });

  document.getElementById('btn-export-catalog-pptx')?.addEventListener('click', exportCatalogPPTX);
  document.getElementById('btn-export-catalog-pdf')?.addEventListener('click', exportCatalogPDF);
}

function initOrRenderCatalogView() {
  populateCatalogFilters();
  renderCatalogPickerList();
  renderCatalogLivePreview();
}

function populateCatalogFilters() {
  const atolyeSelect = document.getElementById('catalog-filter-atolye');
  const temaSelect = document.getElementById('catalog-filter-tema');

  if (!atolyeSelect || !temaSelect) return;

  const currentAtolye = atolyeSelect.value;
  const currentTema = temaSelect.value;

  const atolyes = new Set();
  const temas = new Set();

  (STATE.inventory || []).forEach(item => {
    if (item.atolye) atolyes.add(String(item.atolye).trim());
    if (item.cins && !item.atolye) atolyes.add(String(item.cins).trim());
    if (item.tema) temas.add(String(item.tema).trim());
  });

  atolyeSelect.innerHTML = '<option value="all">Tüm Atölyeler</option>';
  Array.from(atolyes).sort().forEach(a => {
    atolyeSelect.innerHTML += `<option value="${a}">${a}</option>`;
  });
  atolyeSelect.value = currentAtolye || 'all';

  temaSelect.innerHTML = '<option value="all">Tüm Temalar</option>';
  Array.from(temas).sort().forEach(t => {
    temaSelect.innerHTML += `<option value="${t}">${t}</option>`;
  });
  temaSelect.value = currentTema || 'all';
}

function getFilteredCatalogProducts() {
  const searchQuery = String(document.getElementById('catalog-search-input')?.value || '').toLowerCase().trim();
  const atolyeVal = document.getElementById('catalog-filter-atolye')?.value || 'all';
  const temaVal = document.getElementById('catalog-filter-tema')?.value || 'all';
  const hasImageOnly = document.getElementById('catalog-filter-has-image')?.checked;

  return (STATE.inventory || []).filter(item => {
    if (!item) return false;

    // Search query
    if (searchQuery) {
      const matchName = String(item.eserAdi || '').toLowerCase().includes(searchQuery);
      const matchNo = String(item.envanterNo || '').toLowerCase().includes(searchQuery);
      const matchDesc = String(item.aciklama || item.hikaye || '').toLowerCase().includes(searchQuery);
      if (!matchName && !matchNo && !matchDesc) return false;
    }

    // Atolye filter
    if (atolyeVal !== 'all') {
      const itemAtolye = String(item.atolye || item.cins || '').trim();
      if (itemAtolye !== atolyeVal) return false;
    }

    // Tema filter
    if (temaVal !== 'all') {
      const itemTema = String(item.tema || '').trim();
      if (itemTema !== temaVal) return false;
    }

    // Has Image filter
    if (hasImageOnly) {
      if (!item.linkImage && !item.gorselLinki) return false;
    }

    return true;
  });
}

function renderCatalogPickerList() {
  const container = document.getElementById('catalog-product-picker-list');
  const countText = document.getElementById('catalog-filtered-count-text');
  if (!container) return;

  const items = getFilteredCatalogProducts();
  if (countText) countText.textContent = `${items.length} ürün`;

  if (items.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 2rem 1rem; color: var(--text-muted); font-size: 0.85rem;">
        <span style="font-size: 2rem; display: block; margin-bottom: 0.5rem;">🔍</span>
        Filtrelere uygun envanter ürünü bulunamadı.
      </div>
    `;
    return;
  }

  let html = '';
  items.forEach(item => {
    const isSelected = CATALOG_STATE.selectedIds.has(item._rowNum);
    const imgUrl = getDriveThumbnailUrl(item.linkImage);

    html += `
      <div class="catalog-item-card ${isSelected ? 'selected' : ''}" data-id="${item._rowNum}">
        <input type="checkbox" class="catalog-item-checkbox" ${isSelected ? 'checked' : ''} data-id="${item._rowNum}">
        ${imgUrl ? `<img src="${imgUrl}" loading="lazy" decoding="async" referrerpolicy="no-referrer" class="catalog-item-thumb" alt="ürün">` : `<div class="catalog-item-thumb">🎨</div>`}
        <div class="catalog-item-info">
          <div class="catalog-item-title">${item.eserAdi || 'İsimsiz Eser'}</div>
          <div class="catalog-item-sub">
            <span>No: <strong>${item.envanterNo || '-'}</strong></span>
            <span>•</span>
            <span>${item.atolye || item.cins || 'Atölye Belirtilmemiş'}</span>
          </div>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;

  // Click handler to toggle selection
  container.querySelectorAll('.catalog-item-card').forEach(card => {
    card.addEventListener('click', (e) => {
      const rowId = card.getAttribute('data-id');
      const item = (STATE.inventory || []).find(i => String(i._rowNum) === String(rowId));
      if (item) {
        toggleCatalogItemSelection(item);
      }
    });
  });
}

function toggleCatalogItemSelection(item) {
  if (CATALOG_STATE.selectedIds.has(item._rowNum)) {
    CATALOG_STATE.selectedIds.delete(item._rowNum);
    CATALOG_STATE.order = CATALOG_STATE.order.filter(i => i._rowNum !== item._rowNum);
  } else {
    CATALOG_STATE.selectedIds.add(item._rowNum);
    CATALOG_STATE.order.push(item);
  }

  updateCatalogSelectionBadge();
  renderCatalogPickerList();
  renderCatalogLivePreview();
}

function updateCatalogSelectionBadge() {
  const badge = document.getElementById('catalog-selected-count');
  const totalBadge = document.getElementById('catalog-total-available-count');
  if (badge) badge.textContent = CATALOG_STATE.selectedIds.size;
  if (totalBadge) totalBadge.textContent = (STATE.inventory || []).length;
}

function renderCatalogLivePreview() {
  const wrapper = document.getElementById('catalog-live-preview-wrapper');
  if (!wrapper) return;

  if (CATALOG_STATE.order.length === 0) {
    wrapper.innerHTML = `
      <div style="text-align: center; padding: 4rem 2rem; color: var(--text-muted);">
        <span style="font-size: 3.5rem; display: block; margin-bottom: 1rem; opacity: 0.7;">📖</span>
        <h4 style="margin: 0 0 0.5rem 0; color: var(--text-main); font-size: 1.1rem;">Katalog Önizlemesi Boş</h4>
        <p style="font-size: 0.85rem; max-width: 360px; margin: 0 auto;">
          Sol paneldeki listeden kataloğa eklemek istediğiniz envanter ürünlerini seçin.
        </p>
      </div>
    `;
    return;
  }

  // Active theme colors
  let themeObj;
  if (CATALOG_STATE.theme === 'custom') {
    themeObj = {
      bg: CATALOG_STATE.customBg,
      text: CATALOG_STATE.customText,
      accent: CATALOG_STATE.customAccent,
      cardBg: 'rgba(255,255,255,0.08)',
      labelColor: CATALOG_STATE.customAccent
    };
  } else {
    themeObj = CATALOG_THEMES[CATALOG_STATE.theme] || CATALOG_THEMES.royal;
  }

  const textureClass = `texture-${CATALOG_STATE.texture}`;
  const layoutMode = parseInt(CATALOG_STATE.layout, 10) || 1;
  const itemsPerPage = layoutMode === 4 ? 4 : (layoutMode === 2 ? 2 : 1);

  let html = '';

  // 1. SAYFA: KAPAK SAYFASI (Cover Page)
  html += `
    <div class="catalog-page-sheet ${textureClass}" style="background-color: ${themeObj.bg}; color: ${themeObj.text}; font-family: 'Outfit', 'Inter', sans-serif;">
      <div style="text-align: center; margin-top: 0.5rem;">
        ${STATE.institutionLogo ? `<img src="${STATE.institutionLogo}" referrerpolicy="no-referrer" alt="Kurum Logosu" style="height: 55px; max-width: 140px; object-fit: contain; margin-bottom: 0.5rem; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));">` : ''}
        <div style="font-size: 0.75rem; text-transform: uppercase; letter-spacing: 2px; color: ${themeObj.accent}; font-weight: 700; margin-bottom: 0.25rem;">
          T.C. MİLLÎ EĞİTİM BAKANLIĞI
        </div>
        <div style="font-size: 1.1rem; font-weight: 800; color: ${themeObj.accent}; letter-spacing: 1px;">
          EDİRNE OLGUNLAŞMA ENSTİTÜSÜ
        </div>
      </div>

      <div style="text-align: center; margin: 2rem 0;">
        <div style="width: 60px; height: 3px; background: ${themeObj.accent}; margin: 0 auto 1.5rem auto; border-radius: 2px;"></div>
        <h1 style="font-size: 1.8rem; font-weight: 800; margin: 0 0 1rem 0; line-height: 1.3; color: ${themeObj.text}; text-shadow: 0 2px 4px rgba(0,0,0,0.3);">
          ${CATALOG_STATE.title}
        </h1>
        <p style="font-size: 1.05rem; font-style: italic; opacity: 0.9; margin: 0; color: ${themeObj.accent};">
          ${CATALOG_STATE.subtitle}
        </p>
      </div>

      <div style="display: flex; justify-content: space-between; align-items: flex-end; border-top: 1px solid rgba(255,255,255,0.15); padding-top: 1rem; font-size: 0.8rem;">
        <div>
          <span style="display: inline-block; padding: 0.25rem 0.75rem; background: ${themeObj.accent}; color: #000; font-weight: 700; border-radius: 12px;">
            ${CATALOG_STATE.order.length} Özel Eser İçerir
          </span>
        </div>
        <div style="opacity: 0.8; text-align: right;">
          Yayın Tarihi: ${new Date().toLocaleDateString('tr-TR')}
        </div>
      </div>
    </div>
  `;

  // 2..N. SAYFALAR: ÜRÜN SAYFALARI (Product Pages)
  const totalPages = Math.ceil(CATALOG_STATE.order.length / itemsPerPage);

  for (let p = 0; p < totalPages; p++) {
    const pageItems = CATALOG_STATE.order.slice(p * itemsPerPage, (p + 1) * itemsPerPage);

    html += `
      <div class="catalog-page-sheet ${textureClass}" style="background-color: ${themeObj.bg}; color: ${themeObj.text}; font-family: 'Inter', sans-serif;">
        <!-- Sayfa Üst Bilgisi (Header) -->
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.15); padding-bottom: 0.5rem; margin-bottom: 1rem; font-size: 0.75rem;">
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            ${STATE.institutionLogo ? `<img src="${STATE.institutionLogo}" referrerpolicy="no-referrer" style="height: 22px; max-width: 50px; object-fit: contain;" alt="Logo">` : ''}
            <span style="font-weight: 700; color: ${themeObj.accent}; letter-spacing: 0.5px;">
              EDİRNE OLGUNLAŞMA ENSTİTÜSÜ KATALOĞU
            </span>
          </div>
          <span style="opacity: 0.7;">Sayfa ${p + 2} / ${totalPages + 1}</span>
        </div>

        <!-- Ürün İçerik Düzeni -->
    `;

    if (itemsPerPage === 1) {
      // 1 ÜRÜN / SAYFA DÜZENİ
      const item = pageItems[0];
      const imgUrl = getDriveCatalogImageUrl(item.linkImage);

      html += `
        <div style="display: grid; grid-template-columns: 1.1fr 1fr; gap: 1.5rem; flex: 1; align-items: center;">
          <!-- Sol Görsel -->
          <div style="height: 100%; max-height: 300px; border-radius: 8px; overflow: hidden; background: rgba(0,0,0,0.3); border: 2px solid ${themeObj.accent}; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(0,0,0,0.3);">
            ${imgUrl ? `<img src="${imgUrl}" referrerpolicy="no-referrer" style="width:100%; height:100%; object-fit:contain;" alt="ürün">` : `<span style="font-size:3rem;">🎨</span>`}
          </div>

          <!-- Sağ Detay Bilgileri -->
          <div style="display: flex; flex-direction: column; justify-content: center; gap: 0.5rem; font-size: 0.82rem;">
            <h2 style="font-size: 1.25rem; margin: 0 0 0.5rem 0; color: ${themeObj.accent}; font-weight: 700;">
              ${item.eserAdi || 'İsimsiz Eser'}
            </h2>

            ${CATALOG_STATE.visibleFields.envanterNo && item.envanterNo ? `
              <div><strong style="color:${themeObj.labelColor};">Envanter No:</strong> ${item.envanterNo}</div>
            ` : ''}

            ${CATALOG_STATE.visibleFields.atolye && (item.atolye || item.cins) ? `
              <div><strong style="color:${themeObj.labelColor};">Atölye / Cins:</strong> ${item.atolye || item.cins}</div>
            ` : ''}

            ${CATALOG_STATE.visibleFields.tema && item.tema ? `
              <div><strong style="color:${themeObj.labelColor};">Tema:</strong> ${item.tema}</div>
            ` : ''}

            ${CATALOG_STATE.visibleFields.teknik && item.teknik ? `
              <div><strong style="color:${themeObj.labelColor};">Teknik:</strong> ${item.teknik}</div>
            ` : ''}

            ${CATALOG_STATE.visibleFields.malzeme && item.malzeme ? `
              <div><strong style="color:${themeObj.labelColor};">Malzeme:</strong> ${item.malzeme}</div>
            ` : ''}

            ${CATALOG_STATE.visibleFields.olculeri && item.olculeri ? `
              <div><strong style="color:${themeObj.labelColor};">Ölçüleri:</strong> ${item.olculeri}</div>
            ` : ''}

            ${CATALOG_STATE.visibleFields.personel && item.personel ? `
              <div><strong style="color:${themeObj.labelColor};">Usta Öğretici:</strong> ${item.personel}</div>
            ` : ''}

            ${CATALOG_STATE.visibleFields.aciklama && (item.aciklama || item.hikaye) ? `
              <div style="margin-top: 0.5rem; padding-top: 0.5rem; border-top: 1px dashed rgba(255,255,255,0.2); font-style: italic; font-size: 0.78rem; opacity: 0.95; line-height: 1.4;">
                "${(item.aciklama || item.hikaye).substring(0, 220)}${(item.aciklama || item.hikaye).length > 220 ? '...' : ''}"
              </div>
            ` : ''}
          </div>
        </div>
      `;

    } else if (itemsPerPage === 2) {
      // 2 ÜRÜN / SAYFA DÜZENİ
      html += `<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem; flex: 1;">`;
      pageItems.forEach(item => {
        const imgUrl = getDriveCatalogImageUrl(item.linkImage);
        html += `
          <div style="background: ${themeObj.cardBg}; padding: 0.8rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.15); display: flex; flex-direction: column; justify-content: space-between;">
            <div style="height: 150px; border-radius: 6px; overflow: hidden; background: rgba(0,0,0,0.3); border: 1px solid ${themeObj.accent}; margin-bottom: 0.6rem; display: flex; align-items: center; justify-content: center;">
              ${imgUrl ? `<img src="${imgUrl}" referrerpolicy="no-referrer" style="width:100%; height:100%; object-fit:contain;">` : `<span style="font-size:2rem;">🎨</span>`}
            </div>
            <div>
              <h3 style="font-size: 0.95rem; margin: 0 0 0.3rem 0; color: ${themeObj.accent}; font-weight: 700;">${item.eserAdi || 'İsimsiz Eser'}</h3>
              <div style="font-size: 0.75rem; display: flex; flex-direction: column; gap: 0.2rem;">
                ${item.envanterNo ? `<div><strong>No:</strong> ${item.envanterNo}</div>` : ''}
                ${item.atolye ? `<div><strong>Atölye:</strong> ${item.atolye}</div>` : ''}
                ${item.teknik ? `<div><strong>Teknik:</strong> ${item.teknik}</div>` : ''}
              </div>
            </div>
          </div>
        `;
      });
      html += `</div>`;

    } else if (itemsPerPage === 4) {
      // 4 ÜRÜN / SAYFA DÜZENİ
      html += `<div style="display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 1rem; flex: 1;">`;
      pageItems.forEach(item => {
        const imgUrl = getDriveCatalogImageUrl(item.linkImage);
        html += `
          <div style="background: ${themeObj.cardBg}; padding: 0.6rem; border-radius: 6px; border: 1px solid rgba(255,255,255,0.12); display: flex; gap: 0.75rem; align-items: center;">
            <div style="width: 75px; height: 75px; border-radius: 6px; overflow: hidden; background: rgba(0,0,0,0.3); border: 1px solid ${themeObj.accent}; flex-shrink: 0; display: flex; align-items: center; justify-content: center;">
              ${imgUrl ? `<img src="${imgUrl}" referrerpolicy="no-referrer" style="width:100%; height:100%; object-fit:cover;">` : `<span style="font-size:1.5rem;">🎨</span>`}
            </div>
            <div style="font-size: 0.72rem; flex: 1; overflow: hidden;">
              <h4 style="font-size: 0.82rem; margin: 0 0 0.2rem 0; color: ${themeObj.accent}; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.eserAdi || 'İsimsiz Eser'}</h4>
              <div><strong>No:</strong> ${item.envanterNo || '-'}</div>
              <div><strong>Atölye:</strong> ${item.atolye || item.cins || '-'}</div>
            </div>
          </div>
        `;
      });
      html += `</div>`;
    }

    // Sayfa Alt Bilgisi (Footer)
    html += `
        <div style="border-top: 1px solid rgba(255,255,255,0.15); padding-top: 0.4rem; margin-top: 0.6rem; font-size: 0.7rem; opacity: 0.75; text-align: center;">
          Edirne Olgunlaşma Enstitüsü Resmî Ürün Kataloğu
        </div>
      </div>
    `;
  }

  wrapper.innerHTML = html;
}

// PPTX SUNUM KATALOĞU İNDİR
async function exportCatalogPPTX() {
  // Sunum motoru istek üzerine yüklenir.
  if (!(await pptxMotoruHazirla())) return;

  if (!CATALOG_STATE.order || CATALOG_STATE.order.length === 0) {
    showToast('Lütfen önce katalogda yer alacak en az bir ürün seçiniz.', 'warning');
    return;
  }

  showToast('Düzenlenebilir PPTX (PowerPoint) sunum kataloğu oluşturuluyor...', 'info');

  try {
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_16x9';
    pptx.title = CATALOG_STATE.title;
    pptx.author = 'Edirne Olgunlaşma Enstitüsü';

    // Theme colors for PPTX
    let themeObj;
    if (CATALOG_STATE.theme === 'custom') {
      themeObj = {
        bg: CATALOG_STATE.customBg.replace('#', ''),
        text: CATALOG_STATE.customText.replace('#', ''),
        accent: CATALOG_STATE.customAccent.replace('#', '')
      };
    } else {
      const preset = CATALOG_THEMES[CATALOG_STATE.theme] || CATALOG_THEMES.royal;
      themeObj = {
        bg: preset.bg.replace('#', ''),
        text: preset.text.replace('#', ''),
        accent: preset.accent.replace('#', '')
      };
    }

    // SLIDE 1: Kapak Slaytı
    const coverSlide = pptx.addSlide();
    coverSlide.background = { color: themeObj.bg };

    if (CATALOG_STATE.texture === 'tezhip' || CATALOG_STATE.texture === 'seljuk') {
      coverSlide.addShape(pptx.shapes.RECTANGLE, {
        x: 0.3, y: 0.3, w: 9.4, h: 5.0,
        line: { color: themeObj.accent, width: 3 }
      });
      coverSlide.addShape(pptx.shapes.RECTANGLE, {
        x: 0.4, y: 0.4, w: 9.2, h: 4.8,
        line: { color: themeObj.accent, width: 1 }
      });
    }

    coverSlide.addText("T.C. MİLLÎ EĞİTİM BAKANLIĞI\nEDİRNE OLGUNLAŞMA ENSTİTÜSÜ", {
      x: 0.5, y: 0.8, w: 9.0, h: 0.8,
      fontSize: 16, bold: true, color: themeObj.accent, align: 'center'
    });

    coverSlide.addText(CATALOG_STATE.title, {
      x: 0.5, y: 1.8, w: 9.0, h: 1.2,
      fontSize: 26, bold: true, color: themeObj.text, align: 'center'
    });

    coverSlide.addShape(pptx.shapes.LINE, {
      x: 3.0, y: 3.1, w: 4.0, h: 0,
      line: { color: themeObj.accent, width: 2 }
    });

    coverSlide.addText(CATALOG_STATE.subtitle, {
      x: 0.5, y: 3.3, w: 9.0, h: 0.8,
      fontSize: 18, italic: true, color: themeObj.text, align: 'center'
    });

    coverSlide.addText(`Seçilen Ürün Adedi: ${CATALOG_STATE.order.length} Eser   |   Tarih: ${new Date().toLocaleDateString('tr-TR')}`, {
      x: 0.5, y: 4.6, w: 9.0, h: 0.5,
      fontSize: 12, color: themeObj.accent, align: 'center'
    });

    // PRODUCT SLIDES
    const layoutMode = parseInt(CATALOG_STATE.layout, 10) || 1;
    const itemsPerSlide = layoutMode === 4 ? 4 : (layoutMode === 2 ? 2 : 1);

    for (let i = 0; i < CATALOG_STATE.order.length; i += itemsPerSlide) {
      const slide = pptx.addSlide();
      slide.background = { color: themeObj.bg };

      if (CATALOG_STATE.texture === 'tezhip') {
        slide.addShape(pptx.shapes.RECTANGLE, {
          x: 0.2, y: 0.2, w: 9.6, h: 5.22,
          line: { color: themeObj.accent, width: 1.5 }
        });
      }

      slide.addText(CATALOG_STATE.title, {
        x: 0.4, y: 0.3, w: 7.0, h: 0.4,
        fontSize: 10, bold: true, color: themeObj.accent
      });
      slide.addText(`Sayfa ${Math.floor(i / itemsPerSlide) + 2}`, {
        x: 7.5, y: 0.3, w: 2.0, h: 0.4,
        fontSize: 10, color: themeObj.accent, align: 'right'
      });

      const slideItems = CATALOG_STATE.order.slice(i, i + itemsPerSlide);

      if (itemsPerSlide === 1) {
        const item = slideItems[0];
        const imgUrl = getDriveCatalogImageUrl(item.linkImage);

        if (imgUrl) {
          try {
            slide.addImage({
              path: imgUrl,
              x: 0.5, y: 0.9, w: 4.2, h: 4.0,
              sizing: { type: 'contain', w: 4.2, h: 4.0 }
            });
          } catch (e) {
            console.warn('PPTX Görsel hatası:', e);
          }
        }

        const textRuns = [
          { text: (item.eserAdi || 'İsimsiz Eser') + '\n\n', options: { fontSize: 20, bold: true, color: themeObj.accent } }
        ];

        if (CATALOG_STATE.visibleFields.envanterNo && item.envanterNo) {
          textRuns.push({ text: 'Envanter No: ', options: { bold: true, fontSize: 13, color: themeObj.accent } });
          textRuns.push({ text: item.envanterNo + '\n', options: { fontSize: 13, color: themeObj.text } });
        }
        if (CATALOG_STATE.visibleFields.atolye && (item.atolye || item.cins)) {
          textRuns.push({ text: 'Atölye / Cins: ', options: { bold: true, fontSize: 12, color: themeObj.accent } });
          textRuns.push({ text: (item.atolye || item.cins) + '\n', options: { fontSize: 12, color: themeObj.text } });
        }
        if (CATALOG_STATE.visibleFields.tema && item.tema) {
          textRuns.push({ text: 'Tema: ', options: { bold: true, fontSize: 12, color: themeObj.accent } });
          textRuns.push({ text: item.tema + '\n', options: { fontSize: 12, color: themeObj.text } });
        }
        if (CATALOG_STATE.visibleFields.teknik && item.teknik) {
          textRuns.push({ text: 'Teknik: ', options: { bold: true, fontSize: 12, color: themeObj.accent } });
          textRuns.push({ text: item.teknik + '\n', options: { fontSize: 12, color: themeObj.text } });
        }
        if (CATALOG_STATE.visibleFields.malzeme && item.malzeme) {
          textRuns.push({ text: 'Malzeme: ', options: { bold: true, fontSize: 12, color: themeObj.accent } });
          textRuns.push({ text: item.malzeme + '\n', options: { fontSize: 12, color: themeObj.text } });
        }
        if (CATALOG_STATE.visibleFields.olculeri && item.olculeri) {
          textRuns.push({ text: 'Ölçüleri: ', options: { bold: true, fontSize: 12, color: themeObj.accent } });
          textRuns.push({ text: item.olculeri + '\n', options: { fontSize: 12, color: themeObj.text } });
        }
        if (CATALOG_STATE.visibleFields.personel && item.personel) {
          textRuns.push({ text: 'Usta Öğretici: ', options: { bold: true, fontSize: 12, color: themeObj.accent } });
          textRuns.push({ text: item.personel + '\n', options: { fontSize: 12, color: themeObj.text } });
        }
        if (CATALOG_STATE.visibleFields.aciklama && (item.aciklama || item.hikaye)) {
          textRuns.push({ text: '\nAçıklama / Hikaye:\n', options: { bold: true, fontSize: 12, color: themeObj.accent } });
          textRuns.push({ text: (item.aciklama || item.hikaye) + '\n', options: { fontSize: 11, italic: true, color: themeObj.text } });
        }

        slide.addText(textRuns, {
          x: 4.9, y: 0.9, w: 4.6, h: 4.0,
          valign: 'top'
        });

      } else if (itemsPerSlide === 2) {
        slideItems.forEach((item, idx) => {
          const xPos = idx === 0 ? 0.5 : 5.1;
          const imgUrl = getDriveCatalogImageUrl(item.linkImage);

          if (imgUrl) {
            try {
              slide.addImage({
                path: imgUrl,
                x: xPos, y: 0.9, w: 4.4, h: 2.2,
                sizing: { type: 'contain', w: 4.4, h: 2.2 }
              });
            } catch (e) { }
          }

          const textRuns = [
            { text: (item.eserAdi || 'İsimsiz Eser') + '\n', options: { fontSize: 16, bold: true, color: themeObj.accent } }
          ];
          if (item.envanterNo) textRuns.push({ text: `ENV: ${item.envanterNo}  |  `, options: { fontSize: 11, color: themeObj.text } });
          if (item.atolye || item.cins) textRuns.push({ text: `Atölye: ${item.atolye || item.cins}\n`, options: { fontSize: 11, color: themeObj.text } });
          if (item.teknik) textRuns.push({ text: `Teknik: ${item.teknik}\n`, options: { fontSize: 10, color: themeObj.text } });

          slide.addText(textRuns, {
            x: xPos, y: 3.2, w: 4.4, h: 1.8,
            valign: 'top'
          });
        });

      } else if (itemsPerSlide === 4) {
        slideItems.forEach((item, idx) => {
          const col = idx % 2;
          const row = Math.floor(idx / 2);
          const xPos = col === 0 ? 0.5 : 5.1;
          const yPos = row === 0 ? 0.8 : 3.0;

          const imgUrl = getDriveCatalogImageUrl(item.linkImage);
          if (imgUrl) {
            try {
              slide.addImage({
                path: imgUrl,
                x: xPos, y: yPos, w: 1.8, h: 1.8,
                sizing: { type: 'contain', w: 1.8, h: 1.8 }
              });
            } catch (e) { }
          }

          const textRuns = [
            { text: (item.eserAdi || 'İsimsiz Eser') + '\n', options: { fontSize: 13, bold: true, color: themeObj.accent } }
          ];
          if (item.envanterNo) textRuns.push({ text: `No: ${item.envanterNo}\n`, options: { fontSize: 10, color: themeObj.text } });
          if (item.atolye || item.cins) textRuns.push({ text: `${item.atolye || item.cins}\n`, options: { fontSize: 10, color: themeObj.text } });

          slide.addText(textRuns, {
            x: xPos + 1.9, y: yPos, w: 2.5, h: 1.8,
            valign: 'top'
          });
        });
      }
    }

    const fileName = `Edirne_Olgunlasma_Urun_Katalogu_${new Date().toISOString().split('T')[0]}.pptx`;
    await pptx.writeFile({ fileName: fileName });
    showToast(`Düzenlenebilir PPTX sunum kataloğu "${fileName}" olarak indirildi!`, 'success');

  } catch (err) {
    console.error('PPTX Oluşturma Hatası:', err);
    showToast('PPTX sunumu hazırlanırken hata oluştu: ' + err.message, 'danger');
  }
}

// PDF KATALOĞU İNDİR (Optimize Edilmiş Sayfa Düzeni)
async function exportCatalogPDF() {
  // PDF motoru istek üzerine yüklenir (açılışı yavaşlatmasın diye).
  if (!(await pdfMotoruHazirla())) return;

  const wrapper = document.getElementById('catalog-live-preview-wrapper');
  if (!wrapper || CATALOG_STATE.order.length === 0) {
    showToast('Lütfen önce kataloğa eklemek için ürün seçiniz.', 'warning');
    return;
  }

  const sheets = wrapper.querySelectorAll('.catalog-page-sheet');
  if (sheets.length === 0) {
    showToast('Katalog sayfası bulunamadı.', 'warning');
    return;
  }

  showToast('Yüksek kaliteli A4 PDF kataloğu hazırlanıyor, lütfen bekleyin...', 'info');

  // Birebir A4 Yatay (297mm x 210mm) boyutlarında özel temp div oluştur
  const container = document.createElement('div');
  container.style.width = '297mm';
  container.style.margin = '0';
  container.style.padding = '0';
  container.style.background = '#ffffff';

  sheets.forEach((sheet, idx) => {
    const clone = sheet.cloneNode(true);

    // Birebir A4 Yatay Sayfa Ölçüleri ve Sıfır Kayma
    clone.style.width = '297mm';
    clone.style.height = '209.5mm';
    clone.style.maxWidth = 'none';
    clone.style.boxShadow = 'none';
    clone.style.borderRadius = '0';
    clone.style.margin = '0';
    clone.style.boxSizing = 'border-box';

    if (idx < sheets.length - 1) {
      clone.style.pageBreakAfter = 'always';
      clone.style.breakAfter = 'page';
    } else {
      clone.style.pageBreakAfter = 'auto';
      clone.style.breakAfter = 'auto';
    }
    clone.style.pageBreakInside = 'avoid';
    clone.style.breakInside = 'avoid';

    container.appendChild(clone);
  });

  const opt = {
    margin: 0,
    filename: `Edirne_Olgunlasma_Urun_Katalogu_${new Date().toISOString().split('T')[0]}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, letterRendering: true, logging: false },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
  };

  html2pdf().set(opt).from(container).save()
    .then(() => {
      showToast('PDF Kataloğu tam sayfa uyumuyla başarıyla indirildi.', 'success');
    })
    .catch(err => {
      console.error('PDF Kataloğu Hatası:', err);
      showToast('PDF Kataloğu oluşturulurken bir hata oluştu: ' + err.message, 'danger');
    });
}

/* ==========================================================================
   KURUMSAL MARKA VE LOGO YÖNETİMİ HİZMETLERİ
   ========================================================================== */

function initLogoCustomizationListeners() {
  const appFile = document.getElementById('settings-app-logo-file');
  const instFile = document.getElementById('settings-institution-logo-file');

  let pendingAppLogo = null;
  let pendingInstLogo = null;

  appFile?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        pendingAppLogo = evt.target.result;
        const preview = document.getElementById('settings-app-logo-preview');
        if (preview) preview.src = pendingAppLogo;
      };
      reader.readAsDataURL(file);
    }
  });

  instFile?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        pendingInstLogo = evt.target.result;
        const preview = document.getElementById('settings-institution-logo-preview');
        if (preview) preview.src = pendingInstLogo;
      };
      reader.readAsDataURL(file);
    }
  });

  document.getElementById('btn-save-app-logo')?.addEventListener('click', async () => {
    const logoToSave = pendingAppLogo || STATE.appLogo;
    if (!logoToSave) {
      showToast('Lütfen önce bir logo görseli seçiniz.', 'warning');
      return;
    }
    STATE.appLogo = logoToSave;
    localStorage.setItem('eo_app_logo', STATE.appLogo);
    applyAppLogo(STATE.appLogo);

    if (window.api && window.api.isElectron) {
      const cache = (await window.api.readLocalCache('config.json')) || {};
      cache.appLogo = STATE.appLogo;
      await window.api.writeLocalCache('config.json', cache);
    }
    showToast('Program logosu başarıyla güncellendi ve tüm sistemde uygulandı.', 'success');
  });

  document.getElementById('btn-reset-app-logo')?.addEventListener('click', async () => {
    pendingAppLogo = null;
    STATE.appLogo = '';
    localStorage.removeItem('eo_app_logo');
    applyAppLogo('favicon.svg');

    if (window.api && window.api.isElectron) {
      const cache = (await window.api.readLocalCache('config.json')) || {};
      delete cache.appLogo;
      await window.api.writeLocalCache('config.json', cache);
    }
    const fileInput = document.getElementById('settings-app-logo-file');
    if (fileInput) fileInput.value = '';
    showToast('Program logosu varsayılan ambleme sıfırlandı.', 'info');
  });

  document.getElementById('btn-save-institution-logo')?.addEventListener('click', async () => {
    const logoToSave = pendingInstLogo || STATE.institutionLogo;
    if (!logoToSave) {
      showToast('Lütfen önce bir resmî kurum logosu seçiniz.', 'warning');
      return;
    }
    STATE.institutionLogo = logoToSave;
    localStorage.setItem('eo_institution_logo', STATE.institutionLogo);
    applyInstitutionLogo(STATE.institutionLogo);

    if (window.api && window.api.isElectron) {
      const cache = (await window.api.readLocalCache('config.json')) || {};
      cache.institutionLogo = STATE.institutionLogo;
      await window.api.writeLocalCache('config.json', cache);
    }
    showToast('Resmî Kurum Logosu kaydedildi! Katalog ve rapor çıktılarında kullanılacak.', 'success');
  });

  document.getElementById('btn-reset-institution-logo')?.addEventListener('click', async () => {
    pendingInstLogo = null;
    STATE.institutionLogo = '';
    localStorage.removeItem('eo_institution_logo');
    applyInstitutionLogo('favicon.svg');

    if (window.api && window.api.isElectron) {
      const cache = (await window.api.readLocalCache('config.json')) || {};
      delete cache.institutionLogo;
      await window.api.writeLocalCache('config.json', cache);
    }
    const fileInput = document.getElementById('settings-institution-logo-file');
    if (fileInput) fileInput.value = '';
    showToast('Kurum logosu varsayılan ambleme sıfırlandı.', 'info');
  });
}

function applyAppLogo(logoSrc) {
  const src = logoSrc || 'favicon.svg';
  ['app-logo-login', 'app-logo-sidebar', 'app-logo-drawer', 'app-logo-badge', 'settings-app-logo-preview'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.src = src;
  });
}

function applyInstitutionLogo(logoSrc) {
  const src = logoSrc || 'favicon.svg';
  const preview = document.getElementById('settings-institution-logo-preview');
  if (preview) preview.src = src;
}

/* ==========================================================================
   KURUMSAL MARKA VE LOGO YÖNETİMİ HİZMETLERİ (Çökme Korumalı)
   ========================================================================== */

// Girişi olmayan personel için TAM ADDAN türetilen kararlı kullanıcı adı.
// Türkçe harfler karşılıklarına çevrilir; eski kod bunları siliyordu
// (ör. "SEÇİL" -> "seil"), bu da isimleri birbirine karıştırıyordu.
function personnelUsername(fullName) {
  const slug = String(fullName || 'personel')
    .toLocaleLowerCase('tr-TR')
    .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's')
    .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return 'pers_' + (slug || 'personel');
}

// Bir mesajdaki kişiyi mevcut rehberde bulur.
// Kullanıcı adı bulunamazsa (eski 'pers_<sıra>_<ad>' kimlikleri, sayfa
// sıralaması değişmiş olabilir) mesajda saklı ADA göre eşleştirir.
// contacts dışarıdan verilir; toplu çağrılarda rehber bir kez kurulur.
function resolveContactId(username, displayName, contacts) {
  if (!username || username === 'ALL') return username;
  const rehber = contacts || getAllSystemContacts();
  if (rehber.some(c => c.username === username)) return username;

  if (displayName) {
    const hedef = String(displayName).toLocaleUpperCase('tr-TR');
    const eslesen = rehber.find(c => String(c.name || '').toLocaleUpperCase('tr-TR') === hedef);
    if (eslesen) return eslesen.username;
  }
  return username;
}

// Eski/kaymış kimlikleri bir kerede geçerli kimliklere bağlar
function normalizeMessageContacts(list) {
  if (!Array.isArray(list) || !list.length) return list;
  const rehber = getAllSystemContacts();
  list.forEach(m => {
    if (!m) return;
    if (String(m.senderUsername || '').indexOf('pers_') === 0) {
      m.senderUsername = resolveContactId(m.senderUsername, m.senderName, rehber);
    }
    if (String(m.recipientUsername || '').indexOf('pers_') === 0) {
      m.recipientUsername = resolveContactId(m.recipientUsername, m.recipientName, rehber);
    }
  });
  return list;
}

// Tüm Kayıtlı Kullanıcıları ve Kurum Personelini Birleştirir (Çökme Korumalı)
function getAllSystemContacts() {
  const contactsMap = new Map();

  // 1. Kayıtlı Sistem Kullanıcıları
  (STATE.users || []).forEach((u, idx) => {
    if (!u) return;
    const uname = String(u.username || u.user || ('user_' + idx)).trim();
    const displayName = String(u.name || u.ad || uname).trim();
    if (!uname || !displayName) return;

    contactsMap.set(uname, {
      username: uname,
      name: displayName,
      role: u.role || 'user',
      duty: u.duty || translateRole(u.role || ''),
      isRegistered: true
    });
  });

  // 2. Enstitü Personeli Listesi
  const personnelList = (STATE.personnel && STATE.personnel.length > 0) ? STATE.personnel : DEFAULT_PERSONNEL;
  (personnelList || []).forEach((p, idx) => {
    if (!p) return;
    const firstName = String(p['Adı'] || p['Ad'] || p['NAME'] || '').trim();
    const lastName = String(p['Soyadı'] || p['Soyad'] || p['SURNAME'] || '').trim();
    const fullName = `${firstName} ${lastName}`.trim();
    if (!fullName) return;

    // İsmine göre mevcut kayıtlı kullanıcılar içinde kontrol et
    let existing = false;
    for (const [key, c] of contactsMap.entries()) {
      if (c && c.name && c.name.toLocaleUpperCase('tr-TR') === fullName.toLocaleUpperCase('tr-TR')) {
        existing = true;
        break;
      }
    }

    if (!existing) {
      // Kimlik TAM ADDAN türetilir, dizideki sıradan (idx) DEĞİL.
      // Eskiden 'pers_' + idx kullanılıyordu; Personel sayfasına bir satır
      // eklendiğinde herkesin kimliği kayıyor ve o kişiye gönderilmiş tüm
      // mesajlar erişilemez hâle geliyordu.
      const uname = personnelUsername(fullName);
      contactsMap.set(uname, {
        username: uname,
        name: fullName,
        role: 'personnel',
        duty: p['Alan / Dal'] || p['Görevi'] || 'Kurum Personeli',
        isRegistered: false
      });
    }
  });

  // Eğer hâlâ hiç kullanıcı bulunamadıysa yedek varsayılan kullanıcıları ekle
  if (contactsMap.size === 0) {
    contactsMap.set('admin', { username: 'admin', name: 'Sistem Yöneticisi', role: 'admin', duty: 'Yönetici', isRegistered: true });
    contactsMap.set('gulcan_sak', { username: 'gulcan_sak', name: 'GÜLCAN SAK', role: 'personnel', duty: 'Tekstil Ve Moda Tasarım', isRegistered: false });
    contactsMap.set('secil_celik', { username: 'secil_celik', name: 'SEÇİL ERSEV ÇELİK', role: 'personnel', duty: 'Seramik Ve Cam Teknolojisi', isRegistered: false });
  }

  return Array.from(contactsMap.values());
}

// Kişiler ve Kanallar Listesini Render Eder (Tüm Kişiler + Çevrim İçi Durumu)
// ==========================================================================
// MESAJLASMA MODULU ALTYAPISI
// (Bu fonksiyonlar cagriliyor ama tanimli degildi; initMessagingModule'un
//  ReferenceError vermesi initEventListeners'i ve ayar formunu da kiriyordu.)
// ==========================================================================

// Mesaj icerikleri kullanicidan geldigi icin HTML kacisi zorunlu
function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Mesajlasma kodunun kullandigi kisa ad
function playSound(type = 'info') {
  playNotificationSound(type);
}

// Son 90 saniyede sinyal veren kullanici cevrim ici sayilir
const PRESENCE_TIMEOUT_MS = 90 * 1000;

function isUserOnline(username) {
  if (!username) return false;
  const currentUsername = STATE.currentUser ? STATE.currentUser.username : null;
  if (currentUsername && username === currentUsername) return true;
  const last = STATE.presenceStore ? STATE.presenceStore[username] : null;
  if (!last) return false;
  return (Date.now() - Number(last)) < PRESENCE_TIMEOUT_MS;
}

// Mesajlasma yapilandirilmis mi? (kendi e-tablosu tanimli mi)
function isMessagingConfigured() {
  return !!STATE.mesajlarSheetUrl;
}

// Cevrim ici kullanici listesini tazeler (kalp atisi).
async function refreshPresence() {
  const user = STATE.currentUser;
  if (!user || !isMessagingConfigured()) return;

  const res = await apiMesajlarPost('presence', {
    username: user.username,
    name: user.name || ''
  });
  if (res && res.success && res.presence) {
    STATE.presenceStore = res.presence;
  }
}

// --------------------------------------------------------------------------
// Yerel onbellek - YALNIZCA okuma yedegi. Hicbir kosulda sunucuya toplu
// yazilmaz; eskiden butun dizi POST edildigi icin iki istemci birbirinin
// mesajlarini eziyordu.
// --------------------------------------------------------------------------
async function loadMessagesCache() {
  let raw = null;
  if (window.api && window.api.isElectron) {
    raw = await window.api.readLocalCache('messages_store.json');
  } else {
    try {
      raw = JSON.parse(localStorage.getItem('eo_messages_store') || 'null');
    } catch (e) {
      raw = null;
    }
  }

  if (Array.isArray(raw)) {
    // v1 bicimi: ciplak dizi. Imlec bilgisi yok, tam senkron gerekir.
    STATE.messages = raw.map(m => Object.assign({}, m, { legacy: true }));
    STATE.messagesRowCursor = 0;
  } else if (raw && Array.isArray(raw.messages)) {
    STATE.messages = raw.messages;
    STATE.messagesRowCursor = Number(raw.rowCursor) || 0;
    STATE.messageOutbox = Array.isArray(raw.outbox) ? raw.outbox : [];
    STATE.readOutbox = Array.isArray(raw.readOutbox) ? raw.readOutbox : [];
  } else {
    STATE.messages = [];
    STATE.messagesRowCursor = 0;
  }

  normalizeMessageContacts(STATE.messages);
  STATE.messageIds = new Set(STATE.messages.map(m => m.id));
}

function saveMessagesCache() {
  const payload = {
    version: 2,
    rowCursor: STATE.messagesRowCursor || 0,
    messages: STATE.messages || [],
    outbox: STATE.messageOutbox || [],
    readOutbox: STATE.readOutbox || []
  };

  if (window.api && window.api.isElectron) {
    window.api.writeLocalCache('messages_store.json', payload);
  } else {
    try {
      localStorage.setItem('eo_messages_store', JSON.stringify(payload));
    } catch (e) {
      console.error('Mesajlar yerel olarak kaydedilemedi:', e);
    }
  }
}

// Gelen artimli mesajlari id'ye gore tekillestirerek birlestirir
function mergeIncomingMessages(list) {
  if (!Array.isArray(list) || !list.length) return 0;
  if (!STATE.messageIds) STATE.messageIds = new Set(STATE.messages.map(m => m.id));

  normalizeMessageContacts(list);

  const currentUsername = STATE.currentUser ? STATE.currentUser.username : null;
  let eklenen = 0;
  let banaGelen = 0;

  list.forEach(msg => {
    if (!msg || !msg.id || STATE.messageIds.has(msg.id)) return;
    STATE.messageIds.add(msg.id);
    STATE.messages.push(msg);
    eklenen++;
    if (currentUsername && msg.senderUsername !== currentUsername) banaGelen++;
  });

  if (eklenen) {
    // Siralama rowNum birincil: makineler arasi saat kaymasi timestamp'i bozabilir
    STATE.messages.sort((a, b) => {
      const ra = Number(a.rowNum) || 0;
      const rb = Number(b.rowNum) || 0;
      if (ra && rb && ra !== rb) return ra - rb;
      return String(a.timestamp || '').localeCompare(String(b.timestamp || ''));
    });
  }

  // Ilk senkronda ses calmaz; yoksa her acilista onlarca kez bip eder
  if (banaGelen && STATE.messagingFirstSyncDone) {
    playSound('info');
  }
  return eklenen;
}

function applyReadIds(ids) {
  if (!Array.isArray(ids) || !ids.length) return;
  const okunanlar = new Set(ids);
  STATE.messages.forEach(m => {
    if (!m.read && okunanlar.has(m.id)) m.read = true;
  });
}

// Bekleyen gonderimleri ve "okundu" bildirimlerini iletir.
// Sunucu ayni id'yi iki kez satir acmadigi icin tekrar gonderim guvenlidir.
async function flushOutbox() {
  if (STATE.messageOutbox && STATE.messageOutbox.length) {
    const bekleyen = STATE.messageOutbox.slice();
    for (const msg of bekleyen) {
      const res = await apiMesajlarPost('send_message', msg);
      if (res && res.success) {
        STATE.messageOutbox = STATE.messageOutbox.filter(m => m.id !== msg.id);
        const yerel = STATE.messages.find(m => m.id === msg.id);
        if (yerel) {
          delete yerel.pending;
          delete yerel.failed;
          yerel.rowNum = res.rowNum;
        }
      } else {
        break; // Bağlantı hâlâ yok; sıradakileri deneme
      }
    }
  }

  if (STATE.readOutbox && STATE.readOutbox.length && STATE.currentUser) {
    const res = await apiMesajlarPost('mark_read', {
      username: STATE.currentUser.username,
      ids: STATE.readOutbox
    });
    if (res && res.success) STATE.readOutbox = [];
  }
}

// --------------------------------------------------------------------------
// SENKRON - tek istekte kalp atisi + artimli mesajlar + okundu + cevrimici
// --------------------------------------------------------------------------
async function syncMessages(retryAfterReset = true) {
  const user = STATE.currentUser;
  if (!user || !isMessagingConfigured()) return false;

  await flushOutbox();

  const res = await apiMesajlarPost('sync', {
    username: user.username,
    name: user.name || '',
    sinceRow: STATE.messagesRowCursor || 0
  });

  if (!res || !res.success) {
    STATE.messagingBackoff = (STATE.messagingBackoff || 0) + 1;
    if (STATE.messagingBackoff === 3) {
      showToast('Mesajlaşma sunucusuna ulaşılamıyor. Çevrimdışı moddasınız.', 'warning');
    }
    return false;
  }

  // Sunucudaki sayfa temizlenmis/kucultulmus: imleci sifirlayip bir kez daha dene
  if (res.reset && retryAfterReset) {
    STATE.messagesRowCursor = 0;
    return syncMessages(false);
  }

  if (STATE.messagingBackoff >= 3) {
    showToast('Mesajlaşma bağlantısı yeniden kuruldu.', 'success');
  }
  STATE.messagingBackoff = 0;

  mergeIncomingMessages(res.messages);
  applyReadIds(res.readIds);
  if (res.presence) STATE.presenceStore = res.presence;
  if (res.rowCursor) STATE.messagesRowCursor = res.rowCursor;

  STATE.messagingFirstSyncDone = true;
  saveMessagesCache();

  renderChatContacts(document.getElementById('chat-contact-search')?.value || '');
  renderChatMessages();
  updateUnreadMessagesBadge();
  return true;
}

// Mesajlar ekrani acildiginda: once onbellekten aninda boya, sonra senkron et
async function loadMessages() {
  await loadMessagesCache();
  renderChatContacts(document.getElementById('chat-contact-search')?.value || '');
  renderChatMessages();
  updateUnreadMessagesBadge();

  if (!isMessagingConfigured()) {
    showMessagingNotConfigured();
    return;
  }

  await syncMessages();
}

// URL tanimli degilse sessizce basarisiz olmak yerine acikca soyle
function showMessagingNotConfigured() {
  const container = document.getElementById('chat-messages-container');
  if (container) {
    container.innerHTML = `
      <div class="no-data" style="margin: auto; text-align: center; max-width: 460px;">
        <div style="font-size: 2.5rem;">💬</div>
        <h3 style="margin: 0.5rem 0;">Mesajlaşma sunucusu tanımlı değil</h3>
        <p style="color: var(--text-muted);">
          Mesajların diğer bilgisayarlara ulaşabilmesi için
          <strong>Ayarlar › Mesajlaşma Apps Script Web App URL</strong> alanının
          doldurulması gerekir. Şu anda yalnızca bu bilgisayardaki eski kayıtlar görüntüleniyor.
        </p>
        <button class="btn btn-primary" id="btn-goto-messaging-settings">Ayarlara Git</button>
      </div>
    `;
    document.getElementById('btn-goto-messaging-settings')?.addEventListener('click', () => {
      showSection('ayarlar-view');
    });
  }

  if (!STATE.messagingUrlWarned) {
    STATE.messagingUrlWarned = true;
    showToast('Mesajlaşma bağlantısı tanımlı değil. Ayarlar bölümünden URL girin.', 'warning');
  }
}

// --------------------------------------------------------------------------
// Uyarlanabilir yoklama
// Sabit 20 sn, ~12 istemcide Apps Script gunluk yurutme kotasini asiyordu.
// --------------------------------------------------------------------------
const POLL_AKTIF_MS = 15000;    // Mesajlar ekrani acik ve pencere onde
const POLL_ARKA_MS = 90000;     // Uygulama acik ama baska ekranda
const POLL_GIZLI_MS = 300000;   // Pencere tamamen arkada
const POLL_HATA_MS = [30000, 60000, 120000, 300000];

function nextPollDelay() {
  if (STATE.messagingBackoff > 0) {
    const i = Math.min(STATE.messagingBackoff - 1, POLL_HATA_MS.length - 1);
    return POLL_HATA_MS[i];
  }
  if (document.hidden) return POLL_GIZLI_MS;
  if (STATE.activeView === 'mesajlar-view') return POLL_AKTIF_MS;
  return POLL_ARKA_MS;
}

function scheduleMessagingPoll() {
  if (STATE.messagingPollTimer) clearTimeout(STATE.messagingPollTimer);
  STATE.messagingPollTimer = setTimeout(runMessagingPoll, nextPollDelay());
}

async function runMessagingPoll() {
  if (!STATE.currentUser || !isMessagingConfigured()) {
    STATE.messagingPollTimer = null;
    return;
  }

  try {
    if (!document.hidden && STATE.activeView === 'mesajlar-view') {
      await syncMessages();
    } else {
      await refreshPresence();
      updateUnreadMessagesBadge();
    }
  } catch (err) {
    console.warn('Mesajlaşma yoklaması hatası:', err);
  }

  scheduleMessagingPoll();
}

// Mesajlasma arayuzunun olay dinleyicileri
function initMessagingModule() {
  const form = document.getElementById('chat-message-form');
  const input = document.getElementById('chat-message-input');
  if (form && input) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value;
      if (!text.trim()) return;
      sendChatMessage(text);
      input.value = '';
      input.focus();
    });
  }

  const search = document.getElementById('chat-contact-search');
  if (search) {
    search.addEventListener('input', (e) => renderChatContacts(e.target.value));
  }

  // Sohbeti elle yenile
  document.getElementById('btn-refresh-chat')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const eskiMetin = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ Yenileniyor...';
    try {
      await loadMessages();
    } finally {
      btn.disabled = false;
      btn.textContent = eskiMetin;
    }
  });

  // Hızlı şablon yanıtlar
  document.querySelectorAll('.chat-quick-reply').forEach(btn => {
    btn.addEventListener('click', () => {
      sendChatMessage(btn.dataset.text || btn.textContent.trim());
    });
  });

  // Kişi listesi tıklamaları (satır içi onclick yerine delege dinleyici -
  // tırnak içeren bir isim satır içi handler'ı kırıyordu)
  const contactsList = document.getElementById('chat-contacts-list');
  if (contactsList) {
    contactsList.addEventListener('click', (e) => {
      const item = e.target.closest('.chat-contact-item');
      if (item && item.dataset.username) selectChatContact(item.dataset.username);
    });
  }

  // Pencere öne gelince bekleme, hemen tazele
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !STATE.currentUser || !isMessagingConfigured()) return;
    if (STATE.messagingPollTimer) clearTimeout(STATE.messagingPollTimer);
    runMessagingPoll();
  });

  scheduleMessagingPoll();
}

function renderChatContacts(searchTerm = '') {
  const container = document.getElementById('chat-contacts-list');
  if (!container) return;

  try {
    const searchLower = String(searchTerm || '').trim().toLowerCase();
    const currentUsername = STATE.currentUser ? String(STATE.currentUser.username || 'admin') : 'admin';

    let html = '';

    // 1. KANAL: Genel Duyuru & İletişim Kanalı (Tüm Personel)
    const isPublicActive = STATE.activeChatContact === 'ALL';
    const publicMessages = (STATE.messages || []).filter(m => m && m.recipientUsername === 'ALL');
    const lastPublicMsg = publicMessages[publicMessages.length - 1];
    const lastPublicTime = lastPublicMsg ? formatChatTime(lastPublicMsg.timestamp) : '';
    const lastPublicText = lastPublicMsg ? `${lastPublicMsg.senderName || 'Kullanıcı'}: ${lastPublicMsg.content || ''}` : 'Kanal aktif. Tüm personele mesaj yazabilirsiniz.';

    if (!searchLower || 'genel duyuru iletişim tüm personel'.includes(searchLower)) {
      html += `
        <div class="chat-contact-item ${isPublicActive ? 'active' : ''}" data-username="ALL">
          <div class="chat-contact-avatar-wrapper">
            <div class="chat-contact-avatar" style="background: var(--accent-gold); color: #000;">📢</div>
            <div class="chat-status-dot chat-status-online"></div>
          </div>
          <div class="chat-contact-info">
            <div class="chat-contact-name">
              <span>Genel Duyuru Kanalı</span>
              <span class="chat-contact-time">${lastPublicTime}</span>
            </div>
            <div class="chat-contact-lastmsg">${escapeHtml(lastPublicText)}</div>
          </div>
        </div>
      `;
    }

    // 2. TÜM KULLANICILAR & PERSONEL LİSTESİ
    const allContacts = getAllSystemContacts().filter(c => c && c.username !== currentUsername);

    // Çevrim içi sayısını hesapla ve header'ı güncelle
    const onlineCount = allContacts.filter(c => isUserOnline(c.username)).length + 1; // +1 Kendisi
    const countEl = document.getElementById('chat-active-users-count-val');
    if (countEl) countEl.textContent = onlineCount;

    // Güvenli Sıralama: Önce Çevrim İçi olanlar, Sonra Çevrim Dışı olanlar (Kendi içinde Alfabetik)
    allContacts.sort((a, b) => {
      const aOnline = isUserOnline(a ? a.username : '');
      const bOnline = isUserOnline(b ? b.username : '');
      if (aOnline && !bOnline) return -1;
      if (!aOnline && bOnline) return 1;
      const nameA = String((a && a.name) || (a && a.username) || '');
      const nameB = String((b && b.name) || (b && b.username) || '');
      return nameA.localeCompare(nameB, 'tr-TR');
    });

    allContacts.forEach(u => {
      if (searchLower && !u.name.toLowerCase().includes(searchLower) && !u.username.toLowerCase().includes(searchLower) && !(u.duty || '').toLowerCase().includes(searchLower)) {
        return;
      }

      const isActive = STATE.activeChatContact === u.username;
      const online = isUserOnline(u.username);

      // İki kişi arasındaki son mesaj
      const directMsgs = STATE.messages.filter(m =>
        (m.senderUsername === currentUsername && m.recipientUsername === u.username) ||
        (m.senderUsername === u.username && m.recipientUsername === currentUsername)
      );
      const lastMsg = directMsgs[directMsgs.length - 1];
      const lastTime = lastMsg ? formatChatTime(lastMsg.timestamp) : '';
      // Çevrim içi durumu zaten isim satırındaki rozette; burada tekrar etme
      const lastText = lastMsg ? `${lastMsg.senderUsername === currentUsername ? 'Siz: ' : ''}${lastMsg.content}` : 'Henüz mesaj yok.';

      // Okunmamış mesaj sayısı
      const unreadCount = directMsgs.filter(m => m.senderUsername === u.username && !m.read).length;

      const statusBadge = online
        ? `<span class="badge" style="font-size:0.62rem; background:rgba(34,197,94,0.18); color:#22c55e; border:1px solid rgba(34,197,94,0.4); padding:0.1rem 0.35rem; border-radius:6px;">🟢 Çevrim içi</span>`
        : `<span class="badge" style="font-size:0.62rem; background:rgba(255,255,255,0.06); color:var(--text-muted); border:1px solid var(--border-color); padding:0.1rem 0.35rem; border-radius:6px;">Çevrim dışı</span>`;

      // Alt satır: mesaj varsa önizleme, yoksa durum bilgisi.
      // "Sisteme kayıtlı değil" bilgisi isim satırından BURAYA alındı; orada
      // geniş bir rozet olarak durduğunda adı tek harfe kadar kırpıyordu.
      let altSatir;
      if (lastMsg) {
        altSatir = escapeHtml(lastText);
      } else if (u.isRegistered === false) {
        altSatir = 'Sisteme kayıtlı değil · mesaj okuyamaz';
      } else {
        altSatir = escapeHtml(lastText);
      }

      html += `
      <div class="chat-contact-item ${isActive ? 'active' : ''}" data-username="${escapeHtml(u.username)}">
        <div class="chat-contact-avatar-wrapper">
          <div class="chat-contact-avatar">${escapeHtml(String(u.name || '?').charAt(0).toLocaleUpperCase('tr-TR'))}</div>
          <div class="chat-status-dot ${online ? 'chat-status-online' : 'chat-status-offline'}"></div>
        </div>
        <div class="chat-contact-info">
          <div class="chat-contact-name">
            <span style="display:flex; align-items:center; gap:0.35rem; min-width:0; flex:1 1 auto;">
              <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0;">${escapeHtml(u.name)}</span>
              ${online ? statusBadge : ''}
            </span>
            <span class="chat-contact-time" style="flex-shrink:0;">${lastTime}</span>
          </div>
          <div class="chat-contact-lastmsg" style="display: flex; justify-content: space-between; align-items: center; gap: 0.4rem;">
            <span style="overflow: hidden; white-space: nowrap; text-overflow: ellipsis; flex: 1 1 auto; min-width: 0; opacity: ${online ? '1' : '0.75'};">${altSatir}</span>
            ${unreadCount > 0 ? `<span class="chat-unread-badge" style="flex-shrink:0;">${unreadCount}</span>` : ''}
          </div>
        </div>
      </div>
    `;
    });

    container.innerHTML = html;
  } catch (err) {
    console.error('renderChatContacts hatası:', err);
  }
}

// Sohbet Edilecek Kişiyi / Kanalı Seçer
function selectChatContact(contactId) {
  STATE.activeChatContact = contactId;

  // Header Bilgilerini Güncelle
  const avatarEl = document.getElementById('chat-active-avatar');
  const nameEl = document.getElementById('chat-active-name');
  const subEl = document.getElementById('chat-active-sub');

  if (contactId === 'ALL') {
    if (avatarEl) { avatarEl.textContent = '📢'; avatarEl.style.background = 'var(--accent-gold)'; avatarEl.style.color = '#000'; }
    if (nameEl) nameEl.textContent = '📢 Genel Duyuru & İletişim Kanalı';
    if (subEl) subEl.textContent = 'Tüm Kurum Personeli ve Yöneticiler';

    // Duyuru okunması KİŞİSELDİR; sunucuya bildirilmez (alıcı "ALL" olduğu için
    // orada kimse adına işaretlenemez). Yalnızca bu bilgisayarda saklanır.
    const benimKullaniciAdim = STATE.currentUser ? STATE.currentUser.username : 'admin';
    let degisti = false;
    STATE.messages.forEach(m => {
      if (m.recipientUsername === 'ALL' && m.senderUsername !== benimKullaniciAdim && !m.read) {
        m.read = true;
        degisti = true;
      }
    });
    if (degisti) {
      saveMessagesCache();
      updateUnreadMessagesBadge();
    }
  } else {
    const allContacts = getAllSystemContacts();
    const targetUser = allContacts.find(u => u.username === contactId);
    const uName = targetUser ? targetUser.name : contactId;
    const uDuty = targetUser ? (targetUser.duty || 'Kurum Personeli') : 'Sistem Kullanıcısı';
    const online = isUserOnline(contactId);

    if (avatarEl) {
      avatarEl.textContent = String(uName || '?').charAt(0).toLocaleUpperCase('tr-TR');
      avatarEl.style.background = online ? 'var(--accent-gold)' : 'var(--bg-card)';
      avatarEl.style.color = online ? '#000' : 'var(--accent-gold)';
    }
    if (nameEl) nameEl.textContent = uName;
    if (subEl) {
      subEl.innerHTML = online
        ? `<span style="color:#22c55e; font-weight:600;">🟢 Çevrim içi</span> • ${escapeHtml(uDuty)}`
        : `<span style="color:var(--text-muted);">⚪ Çevrim dışı</span> • ${escapeHtml(uDuty)}`;
    }

    // Bu kişiden gelen tüm okunmamış mesajları okundu olarak işaretle
    const currentUsername = STATE.currentUser ? STATE.currentUser.username : 'admin';
    const okunanIds = [];
    STATE.messages.forEach(m => {
      if (m.senderUsername === contactId && m.recipientUsername === currentUsername && !m.read) {
        m.read = true;
        okunanIds.push(m.id);
      }
    });
    if (okunanIds.length) {
      saveMessagesCache();
      updateUnreadMessagesBadge();
      // Sunucuya bildir; ulaşmazsa kuyruğa alınır ve sonraki senkronda tekrar denenir
      if (isMessagingConfigured()) {
        apiMesajlarPost('mark_read', { username: currentUsername, ids: okunanIds })
          .then(res => {
            if (!res || !res.success) {
              STATE.readOutbox = (STATE.readOutbox || []).concat(okunanIds);
              saveMessagesCache();
            }
          });
      }
    }
  }

  renderChatContacts(document.getElementById('chat-contact-search')?.value || '');
  renderChatMessages();
}

// Mesaj Akışını Render Eder
function renderChatMessages() {
  const container = document.getElementById('chat-messages-container');
  if (!container) return;

  const currentUsername = STATE.currentUser ? STATE.currentUser.username : 'admin';
  const activeContact = STATE.activeChatContact || 'ALL';

  let activeMessages = [];
  if (activeContact === 'ALL') {
    activeMessages = STATE.messages.filter(m => m.recipientUsername === 'ALL');
  } else {
    activeMessages = STATE.messages.filter(m =>
      (m.senderUsername === currentUsername && m.recipientUsername === activeContact) ||
      (m.senderUsername === activeContact && m.recipientUsername === currentUsername)
    );
  }

  if (activeMessages.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; color: var(--text-muted); margin: auto; padding: 2rem;">
        <div style="font-size: 3rem; margin-bottom: 0.5rem; opacity: 0.6;">💬</div>
        <h3>Henüz mesaj yok</h3>
        <p style="font-size: 0.85rem;">Aşağıdaki kutucuğu kullanarak ilk mesajınızı yazabilirsiniz.</p>
      </div>
    `;
    return;
  }

  let html = '';
  let lastDateStr = '';

  activeMessages.forEach(msg => {
    const isSent = msg.senderUsername === currentUsername;
    const msgDate = new Date(msg.timestamp);
    const dateStr = msgDate.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });

    if (dateStr !== lastDateStr) {
      html += `
        <div class="chat-date-separator">
          <span>${dateStr}</span>
        </div>
      `;
      lastDateStr = dateStr;
    }

    const timeStr = msgDate.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

    // Gönderim durumu: ⏳ bekliyor, ⚠ başarısız, ✓ iletildi, ✓✓ okundu
    let durumIsareti = '';
    if (isSent) {
      if (msg.pending) durumIsareti = '<span title="Gönderiliyor">⏳</span>';
      else if (msg.failed) durumIsareti = '<span style="color:var(--danger,#ef4444);" title="Gönderilemedi, tekrar denenecek">⚠</span>';
      else if (msg.read) durumIsareti = '<span style="color:#22c55e;">✓✓</span>';
      else durumIsareti = '<span>✓</span>';
    }
    const eskiKayitIsareti = msg.legacy
      ? '<span style="opacity:0.6; font-size:0.7rem;" title="Bu mesaj yalnızca bu bilgisayarda saklı">(yerel arşiv)</span>'
      : '';

    html += `
      <div class="chat-bubble-wrapper ${isSent ? 'sent' : 'received'}">
        ${!isSent && activeContact === 'ALL' ? `<div class="chat-bubble-sender">${escapeHtml(msg.senderName || msg.senderUsername)}</div>` : ''}
        <div class="chat-bubble-content">
          ${escapeHtml(msg.content)}
        </div>
        <div class="chat-bubble-meta">
          <span>${timeStr}</span>
          ${eskiKayitIsareti}
          ${durumIsareti}
        </div>
      </div>
    `;
  });

  container.innerHTML = html;

  setTimeout(() => {
    container.scrollTop = container.scrollHeight;
  }, 50);
}

// Mesaj Gönderir
async function sendChatMessage(text) {
  if (!text || !text.trim()) return;

  // Sunucu yoksa mesajı yerele yazıp "gönderildi" havası vermek en kötü seçenek
  if (!isMessagingConfigured()) {
    showToast('Mesaj gönderilemez: Mesajlaşma bağlantısı Ayarlar\'dan tanımlanmalı.', 'danger');
    return;
  }

  const currentUsername = STATE.currentUser ? STATE.currentUser.username : 'admin';
  const currentName = STATE.currentUser ? STATE.currentUser.name : 'Yönetici';
  const recipient = STATE.activeChatContact || 'ALL';

  let recipientName = 'Tüm Kurum Personeli';
  if (recipient !== 'ALL') {
    const allContacts = getAllSystemContacts();
    const targetUser = allContacts.find(u => u.username === recipient);
    recipientName = targetUser ? targetUser.name : recipient;
  }

  const newMsg = {
    id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
    senderUsername: currentUsername,
    senderName: currentName,
    recipientUsername: recipient,
    recipientName: recipientName,
    content: text.trim(),
    timestamp: new Date().toISOString(),
    read: false
  };

  // İyimser arayüz: mesaj hemen görünür, sonuç beklenirken ⏳ ile işaretlenir
  newMsg.pending = true;
  STATE.messages.push(newMsg);
  if (STATE.messageIds) STATE.messageIds.add(newMsg.id);
  saveMessagesCache();
  renderChatContacts(document.getElementById('chat-contact-search')?.value || '');
  renderChatMessages();
  playSound('success');

  const res = await apiMesajlarPost('send_message', newMsg);
  if (res && res.success) {
    delete newMsg.pending;
    newMsg.rowNum = res.rowNum;
    if (res.rowCursor) STATE.messagesRowCursor = Math.max(STATE.messagesRowCursor || 0, res.rowCursor);
  } else {
    delete newMsg.pending;
    newMsg.failed = true;
    STATE.messageOutbox = (STATE.messageOutbox || []).concat([newMsg]);
    showToast('Mesaj gönderilemedi, bağlantı kurulunca tekrar denenecek.', 'warning');
  }

  saveMessagesCache();
  renderChatMessages();
}

// Okunmamış Mesaj Rozetini Günceller
function getUnreadMessagesCount() {
  const currentUsername = STATE.currentUser ? STATE.currentUser.username : 'admin';
  // Duyuru kanalındaki (ALL) başkalarından gelen mesajlar da sayılır; eskiden
  // yalnızca özel mesajlar sayıldığı için duyurular rozete hiç yansımıyordu.
  return STATE.messages.filter(m =>
    !m.read &&
    m.senderUsername !== currentUsername &&
    (m.recipientUsername === currentUsername || m.recipientUsername === 'ALL')
  ).length;
}

function updateUnreadMessagesBadge() {
  const count = getUnreadMessagesCount();
  const badge = document.getElementById('unread-messages-badge');
  if (badge) {
    if (count > 0) {
      badge.textContent = count;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }
}

// Zaman Biçimlendirme Yardımcısı (Saat:Dakika veya Tarih)
function formatChatTime(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'numeric' });
}






// ==========================================================================
// SANAL MÜZE ve SERGİ YÖNETİMİ
// --------------------------------------------------------------------------
// Envanterdeki eserleri kurum dışına (web sitesi / VR platformu) açan kürasyon
// katmanı. Ekran, envanter listesinin ÜZERİNE oturur: burada eser yaratılmaz,
// yalnızca "sergilenecek mi", "hangi dillerde ne anlatılacak" ve "hangi görsel
// yayınlanacak" kararları verilir. Veriyi dışarıya açan uç Apps Script'teki
// muzeApiGet fonksiyonudur (bkz. google-apps-script.js).
//
// DİL EKLEMEK: Aşağıdaki MUZE_DILLER dizisine bir satır eklemek yeterlidir;
// e-tablo yapısı değişmez (çeviriler tek JSON sütununda durur). Apps Script
// tarafındaki MUZE_DILLER listesine de AYNI dil kodu eklenmelidir, yoksa yeni
// dil kaydedilir ama dış API'den dönmez.
// ==========================================================================
const MUZE_DILLER = [
  { kod: 'tr', ad: 'Türkçe',    bayrak: '🇹🇷' },
  { kod: 'en', ad: 'English',   bayrak: '🇬🇧' },
  { kod: 'de', ad: 'Deutsch',   bayrak: '🇩🇪' },
  { kod: 'bg', ad: 'Български', bayrak: '🇧🇬' },
  { kod: 'ar', ad: 'العربية',    bayrak: '🇸🇦' }
];
const MUZE_VARSAYILAN_DIL = 'tr';
const MUZE_LISANSLAR = [
  'Tüm hakları saklıdır',
  'CC BY 4.0',
  'CC BY-SA 4.0',
  'CC BY-NC 4.0',
  'CC BY-NC-ND 4.0',
  'Kamu malı (Public Domain)'
];
const MUZE_ALANLAR = [
  { kod: 'baslik', etiket: 'Sergi Başlığı', tur: 'input',    ipucu: 'Eserin sergideki adı' },
  { kod: 'ozet',   etiket: 'Kısa Tanıtım',  tur: 'input',    ipucu: 'Kart altında görünecek tek cümle' },
  { kod: 'hikaye', etiket: 'Koleksiyon Hikayesi', tur: 'textarea', ipucu: 'Eserin kültürel arka planı, motifi, üretim öyküsü' }
];

let _muzeAktifDil = MUZE_VARSAYILAN_DIL;
let _muzeAcikEser = null;          // { envanterNo, item, kayit }
let _muzeTaslakCeviriler = {};     // form açıkken tutulan çeviri havuzu
let _muzeSecilenGorseller = [];    // yayınlanacak görsel adresleri

function muzeYazabilir() {
  return STATE.currentUser &&
    (STATE.currentUser.role === 'admin' || STATE.currentUser.role === 'editor');
}

// Envanter No -> sergi kaydı haritası (kayıt yoksa undefined döner)
function muzeKayitBul(envanterNo) {
  const hedef = String(envanterNo || '').trim().toLowerCase();
  if (!hedef) return null;
  return (STATE.muzeKayitlari || []).find(
    (k) => String(k['Envanter No'] || '').trim().toLowerCase() === hedef
  ) || null;
}

function muzeCevirileriCoz(kayit) {
  if (!kayit) return {};
  try {
    const o = JSON.parse(String(kayit['Çeviriler (JSON)'] || '{}'));
    return (o && typeof o === 'object') ? o : {};
  } catch (err) {
    return {};
  }
}

function muzeGorselleriCoz(kayit) {
  if (!kayit) return [];
  try {
    const o = JSON.parse(String(kayit['Sergi Görselleri (JSON)'] || '[]'));
    return Array.isArray(o) ? o : [];
  } catch (err) {
    return [];
  }
}

function muzeEvet(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return s === 'evet' || s === 'true' || s === '1' || s === 'yes';
}

// Bir dilin "dolu" sayılması için başlık VE hikaye gerekir; yalnız başlık
// girilmiş bir dil, dış sitede boş bir sayfa demek olurdu.
function muzeDilTamam(ceviriler, dilKodu) {
  const d = ceviriler[dilKodu];
  if (!d) return false;
  return String(d.baslik || '').trim() !== '' && String(d.hikaye || '').trim() !== '';
}

function muzeDoluDiller(ceviriler) {
  return MUZE_DILLER.filter((d) => muzeDilTamam(ceviriler, d.kod)).map((d) => d.kod);
}

// --------------------------------------------------------------------------
// Veri eşitleme
// --------------------------------------------------------------------------
// Ekrana geçiş ve "envanterden kısayol" aynı anda eşitleme isteyebilir. Devam
// eden bir istek varsa yenisi açılmaz, herkes aynı sonucu bekler; aksi halde
// form, henüz gelmemiş veriyle boş açılıp kayıtlı hikayeyi eziyordu.
let _muzeSyncIslemi = null;

async function syncMuze(sessiz) {
  if (_muzeSyncIslemi) return _muzeSyncIslemi;
  if (!sessiz) toggleLoading(true, 'Sanal sergi kayıtları yükleniyor...');
  _muzeSyncIslemi = (async () => {
    const res = await apiPost('muze_kayitlari');
    if (res && res.success) {
      STATE.muzeKayitlari = res.kayitlar || [];
      // Eski sunucu koleksiyon listesi göndermez; o zaman kayıtlardan türetilir ve
      // koleksiyonla gönderim, sunucu güncellenene kadar kapalı tutulur.
      STATE.muzeKoleksiyonDestegi = Array.isArray(res.koleksiyonlar);
      STATE.muzeKoleksiyonlar = res.koleksiyonlar || muzeKoleksiyonlariKayitlardan();
      modulOnbellegeYaz('muze');
      renderMuzeTumu();
    } else if (!sessiz) {
      showToast('Sergi kayıtları alınamadı: ' + ((res && res.error) || ''), 'danger');
    }
    return res;
  })();
  try {
    return await _muzeSyncIslemi;
  } finally {
    _muzeSyncIslemi = null;
    if (!sessiz) toggleLoading(false);
  }
}

// --------------------------------------------------------------------------
// Kürasyon listesi
// --------------------------------------------------------------------------
function muzeEserGorselleri(item) {
  // Eserin yayınlanabilecek tüm görselleri: envanter satırındaki iki alan +
  // aynı envanter numarasıyla eşleşen AR-GE fotoğraf kartları.
  const adresler = [];
  const ekle = (url, kaynak) => {
    const s = String(url || '').trim();
    if (!s || s.indexOf('http') !== 0) return;
    if (adresler.some((a) => a.url === s)) return;
    adresler.push({ url: s, kaynak: kaynak });
  };
  ekle(item.linkWeb, 'Web görseli');
  ekle(item.linkImage, 'Ürün görseli');

  const no = String(item.envanterNo || '').trim().toLowerCase();
  if (no) {
    (STATE.photocards || []).forEach((kart) => {
      const kartNo = String(getLitValueGlobal(kart, ['Envanter No', 'EnvanterNo', 'Envanter Numarası']) || '')
        .trim().toLowerCase();
      if (!kartNo || kartNo !== no) return;
      const gorsel = getLitValueGlobal(kart, ['Görsel Linkleri', 'Görsel', 'Fotoğraf', 'Resim', 'Link']);
      ekle(gorsel, 'Fotoğraf kartı');
    });
  }
  return adresler;
}

// Envanterde aynı atölye farklı yazılabiliyor ("Edirnekari" / "Edirnekâri");
// süzgeç ve sanal müze odaları şapkasız, küçük harfli anahtarla gruplanır.
// Sanal müze sitesindeki odaAnahtari() ile aynı kural.
function muzeAtolyeAnahtari(ad) {
  return String(ad || '').trim().toLocaleLowerCase('tr')
    .replace(/â/g, 'a').replace(/î/g, 'i').replace(/û/g, 'u').replace(/\s+/g, ' ');
}

// Görünen ad: şapkalı yazım varsa o (doğru yazım odur), yoksa en sık kullanılan.
function muzeAtolyeListesi() {
  const gruplar = new Map();
  (STATE.inventory || []).forEach((item) => {
    const ad = String(item.atolye || '').trim();
    const anahtar = muzeAtolyeAnahtari(ad);
    if (!anahtar) return;
    if (!gruplar.has(anahtar)) gruplar.set(anahtar, { anahtar, sayi: 0, yazimlar: new Map() });
    const g = gruplar.get(anahtar);
    g.sayi++;
    g.yazimlar.set(ad, (g.yazimlar.get(ad) || 0) + 1);
  });
  return [...gruplar.values()].map((g) => {
    const yazimlar = [...g.yazimlar.entries()].sort((a, b) => b[1] - a[1]);
    const sapkali = yazimlar.find(([y]) => /[âîû]/i.test(y));
    return { anahtar: g.anahtar, ad: (sapkali || yazimlar[0])[0], sayi: g.sayi };
  }).sort((a, b) => a.ad.localeCompare(b.ad, 'tr'));
}

// Kürasyon ızgarasında toplu işlem için seçilen envanter numaraları. Süzgeç
// değişince seçim korunur; kullanıcı farklı atölyelerden seçim biriktirebilir.
const _muzeSecili = new Set();
let _muzeListelenen = [];

function muzeSecimCubugunuGuncelle() {
  const n = _muzeSecili.size;
  const sayac = document.getElementById('muze-secim-sayac');
  if (sayac) sayac.textContent = n ? n + ' eser seçili' : 'Seçim yok';
  ['btn-muze-toplu-gonder', 'btn-muze-toplu-kaldir'].forEach((id) => {
    const b = document.getElementById(id);
    if (b) b.disabled = n === 0;
  });
  const hepsi = document.getElementById('muze-hepsini-sec');
  if (hepsi) {
    const secilenListede = _muzeListelenen.filter((no) => _muzeSecili.has(no)).length;
    hepsi.checked = _muzeListelenen.length > 0 && secilenListede === _muzeListelenen.length;
    hepsi.indeterminate = secilenListede > 0 && secilenListede < _muzeListelenen.length;
  }
  document.getElementById('muze-toplu-cubuk')?.classList.toggle('hidden', !muzeYazabilir());
}

function renderMuze() {
  const izgara = document.getElementById('muze-kart-izgara');
  if (!izgara) return;

  const arama = (document.getElementById('muze-arama')?.value || '').toLowerCase().trim();
  const durumFiltre = document.getElementById('muze-filtre-durum')?.value || 'all';
  const atolyeFiltre = document.getElementById('muze-filtre-atolye')?.value || 'all';
  const koleksiyonFiltre = document.getElementById('muze-filtre-koleksiyon')?.value || 'all';
  const dilFiltre = document.getElementById('muze-filtre-dil')?.value || 'all';

  const atolyeSelect = document.getElementById('muze-filtre-atolye');
  if (atolyeSelect) {
    const secili = atolyeSelect.value;
    const atolyeler = muzeAtolyeListesi();
    atolyeSelect.innerHTML = '<option value="all">Tüm Atölyeler</option>' +
      atolyeler.map((a) => `<option value="${escapeHtml(a.anahtar)}">${escapeHtml(a.ad)} (${a.sayi})</option>`).join('');
    if (atolyeler.some((a) => a.anahtar === secili)) atolyeSelect.value = secili;
  }

  // Koleksiyon açılır kutusu ve formdaki öneri listesi tanımlı koleksiyonlardan beslenir
  const koleksiyonlar = muzeKoleksiyonAdlari();

  const kolSelect = document.getElementById('muze-filtre-koleksiyon');
  if (kolSelect) {
    const secili = kolSelect.value;
    kolSelect.innerHTML = '<option value="all">Tüm Koleksiyonlar</option>' +
      koleksiyonlar.map((k) => `<option value="${escapeHtml(k)}">${escapeHtml(k)}</option>`).join('');
    if (koleksiyonlar.includes(secili)) kolSelect.value = secili;
  }
  const kolDatalist = document.getElementById('muze-koleksiyon-listesi');
  if (kolDatalist) {
    kolDatalist.innerHTML = koleksiyonlar.map((k) => `<option value="${escapeHtml(k)}"></option>`).join('');
  }

  // İstatistikler yalnızca sergi kaydı olan eserlerden hesaplanır
  let yayinda = 0, taslak = 0, dilPuani = 0, dilPayda = 0;
  (STATE.muzeKayitlari || []).forEach((k) => {
    const durum = String(k['Yayın Durumu'] || '').trim();
    if (muzeEvet(k['Sergide Göster']) && durum === 'Yayında') yayinda++;
    else if (durum === 'Taslak') taslak++;
    if (muzeEvet(k['Sergide Göster'])) {
      const cev = muzeCevirileriCoz(k);
      dilPuani += muzeDoluDiller(cev).length;
      dilPayda += MUZE_DILLER.length;
    }
  });
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setText('muze-stat-yayinda', yayinda);
  setText('muze-stat-taslak', taslak);
  setText('muze-stat-koleksiyon', koleksiyonlar.length);
  setText('muze-stat-ceviri', dilPayda ? '%' + Math.round((dilPuani / dilPayda) * 100) : '%0');

  // Liste: envanterin tamamı gezilir, sergi kaydı olanlar zenginleştirilir
  const suzulmus = (STATE.inventory || []).filter((item) => {
    // Envanter numarası olmayan satır sergilenemez: sunucu da reddeder.
    if (!String(item.envanterNo || '').trim()) return false;
    const kayit = muzeKayitBul(item.envanterNo);
    const durum = kayit ? String(kayit['Yayın Durumu'] || '').trim() : '';
    const koleksiyon = kayit ? String(kayit['Koleksiyon'] || '').trim() : '';
    const ceviriler = muzeCevirileriCoz(kayit);

    if (durumFiltre === 'kayitsiz') {
      if (kayit) return false;
    } else if (durumFiltre !== 'all') {
      if (!kayit || durum !== durumFiltre) return false;
    }
    if (koleksiyonFiltre !== 'all' && koleksiyon !== koleksiyonFiltre) return false;
    if (atolyeFiltre !== 'all' && muzeAtolyeAnahtari(item.atolye) !== atolyeFiltre) return false;

    if (dilFiltre === 'tam' && muzeDoluDiller(ceviriler).length !== MUZE_DILLER.length) return false;
    if (dilFiltre === 'eksik') {
      if (!kayit) return false;
      if (muzeDoluDiller(ceviriler).length === MUZE_DILLER.length) return false;
    }

    if (!arama) return true;
    const trBaslik = String((ceviriler[MUZE_VARSAYILAN_DIL] || {}).baslik || '');
    return [item.envanterNo, item.eserAdi, item.tema, item.atolye, koleksiyon, trBaslik]
      .some((v) => String(v || '').toLowerCase().includes(arama));
  });

  setText('muze-sayac', suzulmus.length + ' / ' + (STATE.inventory || []).length + ' eser listeleniyor');
  _muzeListelenen = suzulmus.map((item) => String(item.envanterNo).trim());
  muzeSecimCubugunuGuncelle();
  const yazabilir = muzeYazabilir();

  const bosKutu = document.getElementById('muze-bos');
  if (suzulmus.length === 0) {
    izgara.innerHTML = '';
    if (bosKutu) bosKutu.classList.remove('hidden');
    return;
  }
  if (bosKutu) bosKutu.classList.add('hidden');

  izgara.innerHTML = suzulmus.map((item) => {
    const kayit = muzeKayitBul(item.envanterNo);
    const ceviriler = muzeCevirileriCoz(kayit);
    const durum = kayit ? String(kayit['Yayın Durumu'] || '').trim() : '';
    const sergide = kayit && muzeEvet(kayit['Sergide Göster']);

    let rozetSinif = 'badge-role';
    let rozetMetin = 'Sergi dışı';
    if (sergide && durum === 'Yayında') { rozetSinif = 'badge-success'; rozetMetin = '🌍 Yayında'; }
    else if (kayit && durum === 'Taslak') { rozetSinif = 'badge-warning'; rozetMetin = '📝 Taslak'; }
    else if (kayit && durum === 'Arşiv') { rozetSinif = 'badge-danger'; rozetMetin = '📦 Arşiv'; }

    const gorselHtml = muzeKartGorseli(item);

    const dilRozetleri = MUZE_DILLER.map((d) => {
      const tam = muzeDilTamam(ceviriler, d.kod);
      return `<span class="muze-dil-rozet ${tam ? 'dolu' : ''}" title="${escapeHtml(d.ad)}${tam ? ' — hazır' : ' — eksik'}">${d.bayrak} ${d.kod.toUpperCase()}</span>`;
    }).join('');

    const trBaslik = String((ceviriler[MUZE_VARSAYILAN_DIL] || {}).baslik || '');
    const no = String(item.envanterNo).trim();
    const secili = _muzeSecili.has(no);

    return `
      <div class="muze-kart card${secili ? ' secili' : ''}">
        ${yazabilir ? `<label class="muze-kart-sec" title="Toplu işlem için seç">
          <input type="checkbox" data-muze-sec="${escapeHtml(no)}"${secili ? ' checked' : ''}>
        </label>` : ''}
        ${gorselHtml}
        <div class="muze-kart-govde">
          <div class="muze-kart-ust">
            <strong>${escapeHtml(item.eserAdi || 'İsimsiz eser')}</strong>
            <span class="badge ${rozetSinif}">${rozetMetin}</span>
          </div>
          <span class="muze-kart-meta">
            <code>${escapeHtml(item.envanterNo || '-')}</code>
            ${item.atolye ? ' · 🏛️ ' + escapeHtml(String(item.atolye)) : ''}
            ${item.tema ? ' · ' + escapeHtml(String(item.tema)) : ''}
            ${kayit && kayit['Koleksiyon'] ? ' · 🗂️ ' + escapeHtml(String(kayit['Koleksiyon'])) : ''}
            ${kayit && muzeEvet(kayit['Öne Çıkan']) ? ' · ⭐' : ''}
          </span>
          ${trBaslik ? `<span class="muze-kart-baslik">“${escapeHtml(trBaslik)}”</span>` : ''}
          <div class="muze-dil-rozetleri">${dilRozetleri}</div>
        </div>
        <div class="muze-kart-islem">
          <button class="btn btn-outline-primary btn-sm" data-muze-duzenle="${escapeHtml(String(item.envanterNo))}">
            ${kayit ? 'Sergi Bilgileri' : 'Sergiye Ekle'}
          </button>
        </div>
      </div>`;
  }).join('');
}

// --------------------------------------------------------------------------
// Form: çoklu dil sekmeleri
// --------------------------------------------------------------------------
function muzeDilSekmeleriniCiz() {
  const kutu = document.getElementById('muze-dil-sekmeleri');
  if (!kutu) return;
  kutu.innerHTML = MUZE_DILLER.map((d) => {
    const tam = muzeDilTamam(_muzeTaslakCeviriler, d.kod);
    const zorunlu = d.kod === MUZE_VARSAYILAN_DIL;
    return `<button type="button" class="muze-dil-sekme ${d.kod === _muzeAktifDil ? 'active' : ''}" data-muze-dil="${d.kod}">
      ${d.bayrak} ${escapeHtml(d.ad)}
      ${zorunlu ? '<span class="zorunlu">*</span>' : ''}
      <span class="muze-dil-nokta ${tam ? 'dolu' : ''}"></span>
    </button>`;
  }).join('');
}

function muzeDilPaneliniCiz() {
  const kutu = document.getElementById('muze-dil-panelleri');
  if (!kutu) return;
  const dil = MUZE_DILLER.find((d) => d.kod === _muzeAktifDil) || MUZE_DILLER[0];
  const veri = _muzeTaslakCeviriler[dil.kod] || {};
  const sagaYazilan = dil.kod === 'ar'; // Arapça sağdan sola yazılır

  kutu.innerHTML = `
    <div class="muze-dil-panel" ${sagaYazilan ? 'dir="rtl"' : ''}>
      ${MUZE_ALANLAR.map((alan) => {
        const deger = escapeHtml(String(veri[alan.kod] || ''));
        const id = 'muze-alan-' + alan.kod;
        const zorunlu = dil.kod === MUZE_VARSAYILAN_DIL && alan.kod !== 'ozet';
        return `
          <div class="form-group">
            <label for="${id}">${escapeHtml(alan.etiket)} (${dil.kod.toUpperCase()})${zorunlu ? ' <span class="zorunlu">*</span>' : ''}</label>
            ${alan.tur === 'textarea'
              ? `<textarea id="${id}" data-muze-alan="${alan.kod}" rows="6" placeholder="${escapeHtml(alan.ipucu)}">${deger}</textarea>`
              : `<input type="text" id="${id}" data-muze-alan="${alan.kod}" placeholder="${escapeHtml(alan.ipucu)}" value="${deger}">`}
          </div>`;
      }).join('')}
      ${dil.kod === MUZE_VARSAYILAN_DIL ? '' : `
        <div class="muze-dil-arac">
          <button type="button" class="btn btn-text btn-sm" id="btn-muze-tr-kopyala">
            📋 Türkçe metni bu dile kopyala (çeviri taslağı olarak)
          </button>
        </div>`}
    </div>`;
}

// Ekrandaki alanları taslak havuzuna yazar. Dil sekmesi değişmeden ve
// kaydetmeden ÖNCE çağrılmalıdır, yoksa yazılan metin kaybolur.
function muzeAktifDiliTopla() {
  const kayit = {};
  let dolu = false;
  MUZE_ALANLAR.forEach((alan) => {
    const el = document.getElementById('muze-alan-' + alan.kod);
    const deger = el ? String(el.value || '').trim() : '';
    kayit[alan.kod] = deger;
    if (deger) dolu = true;
  });
  if (dolu) {
    _muzeTaslakCeviriler[_muzeAktifDil] = kayit;
  } else {
    delete _muzeTaslakCeviriler[_muzeAktifDil];
  }
}

function muzeDilSec(dilKodu) {
  if (!MUZE_DILLER.some((d) => d.kod === dilKodu)) return;
  muzeAktifDiliTopla();
  _muzeAktifDil = dilKodu;
  muzeDilSekmeleriniCiz();
  muzeDilPaneliniCiz();
  // Panel yeniden kurulduğu için alanlar yeniden etkinleşti; okuyucu rolünde
  // tekrar kilitlenmeleri gerekir.
  muzeYazmaYetkisiUygula();
}

// --------------------------------------------------------------------------
// Form: görsel seçimi
// --------------------------------------------------------------------------
function muzeGorselleriniCiz() {
  const kutu = document.getElementById('muze-gorsel-izgara');
  if (!kutu || !_muzeAcikEser) return;
  const adresler = muzeEserGorselleri(_muzeAcikEser.item);

  if (!adresler.length) {
    kutu.innerHTML = `<div class="materyal-bos">Bu eser için kayıtlı görsel bağlantısı yok. Envanter kaydına Drive görseli ekleyin.</div>`;
    return;
  }

  kutu.innerHTML = adresler.map((g, i) => {
    const secili = _muzeSecilenGorseller.includes(g.url);
    const thumb = getDriveThumbnailUrl(g.url) || g.url;
    return `
      <label class="muze-gorsel-kutu ${secili ? 'secili' : ''}">
        <input type="checkbox" data-muze-gorsel="${escapeHtml(g.url)}" ${secili ? 'checked' : ''}>
        <img src="${escapeHtml(thumb)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" alt="" data-fallback="favicon">
        <span class="muze-gorsel-kaynak">${escapeHtml(g.kaynak)}${i === 0 ? ' · kapak' : ''}</span>
      </label>`;
  }).join('');
}

// --------------------------------------------------------------------------
// Formu aç / doldur
// --------------------------------------------------------------------------
function openMuzeForm(envanterNo) {
  const item = (STATE.inventory || []).find(
    (i) => String(i.envanterNo || '').trim().toLowerCase() === String(envanterNo || '').trim().toLowerCase()
  );
  if (!item) {
    showToast('Eser envanterde bulunamadı.', 'warning');
    return;
  }
  const kayit = muzeKayitBul(envanterNo);
  _muzeAcikEser = { envanterNo: String(item.envanterNo).trim(), item: item, kayit: kayit };
  _muzeTaslakCeviriler = muzeCevirileriCoz(kayit);
  _muzeSecilenGorseller = muzeGorselleriCoz(kayit);
  _muzeAktifDil = MUZE_VARSAYILAN_DIL;

  // Seçim hiç yapılmamışsa, kapak görseli varsayılan olarak işaretlenir.
  if (!_muzeSecilenGorseller.length) {
    const ilk = muzeEserGorselleri(item)[0];
    if (ilk) _muzeSecilenGorseller = [ilk.url];
  }

  document.getElementById('muze-envanter-no').value = _muzeAcikEser.envanterNo;
  document.getElementById('muze-eser-adi').textContent = item.eserAdi || 'İsimsiz eser';
  document.getElementById('muze-eser-envanter').textContent = 'Envanter No: ' + (item.envanterNo || '-');
  document.getElementById('muze-eser-meta').textContent =
    [item.tema, item.cins, item.teknik].filter(Boolean).join(' · ') || 'Künye bilgisi yok';

  const gorselEl = document.getElementById('muze-eser-gorsel');
  const thumb = getDriveThumbnailUrl(item.linkWeb || item.linkImage);
  if (thumb) {
    gorselEl.src = thumb;
    gorselEl.classList.remove('hidden');
  } else {
    gorselEl.classList.add('hidden');
  }

  document.getElementById('muze-sergide').checked = kayit ? muzeEvet(kayit['Sergide Göster']) : false;
  document.getElementById('muze-koleksiyon').value = kayit ? String(kayit['Koleksiyon'] || '') : '';
  document.getElementById('muze-yayin-durumu').value = kayit ? (String(kayit['Yayın Durumu'] || 'Taslak')) : 'Taslak';
  document.getElementById('muze-sira').value = kayit ? (parseInt(kayit['Sıra No'], 10) || 0) : 0;
  document.getElementById('muze-one-cikan').checked = kayit ? muzeEvet(kayit['Öne Çıkan']) : false;
  document.getElementById('muze-uretici-ad').checked = kayit ? muzeEvet(kayit['Üretici Adı Yayınlansın']) : false;
  document.getElementById('muze-sanal-tur').value = kayit ? String(kayit['Sanal Tur Bağlantısı'] || '') : '';

  const lisansSelect = document.getElementById('muze-lisans');
  lisansSelect.innerHTML = MUZE_LISANSLAR
    .map((l) => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join('');
  lisansSelect.value = (kayit && kayit['Lisans']) ? String(kayit['Lisans']) : MUZE_LISANSLAR[0];

  const silBtn = document.getElementById('btn-muze-sil');
  if (silBtn) silBtn.classList.toggle('hidden', !kayit || !muzeYazabilir());

  document.getElementById('muze-onizleme-kutusu').classList.add('hidden');

  muzeDilSekmeleriniCiz();
  muzeDilPaneliniCiz();
  muzeGorselleriniCiz();
  muzeYazmaYetkisiUygula();

  document.getElementById('dialog-muze-eser').showModal();
}

// Okuyucu rolü formu görebilir ama değiştiremez.
function muzeYazmaYetkisiUygula() {
  const yazabilir = muzeYazabilir();
  const dialog = document.getElementById('dialog-muze-eser');
  if (!dialog) return;
  dialog.querySelectorAll('input, textarea, select').forEach((el) => {
    el.disabled = !yazabilir;
  });
  ['btn-muze-kaydet', 'btn-muze-gorsel-yayinla', 'btn-muze-sil'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', !yazabilir);
  });
}

// --------------------------------------------------------------------------
// Kaydet / sil / önizle
// --------------------------------------------------------------------------
function muzeFormPayload() {
  muzeAktifDiliTopla();
  return {
    envanterNo: document.getElementById('muze-envanter-no').value,
    sergide: document.getElementById('muze-sergide').checked,
    koleksiyon: document.getElementById('muze-koleksiyon').value.trim(),
    yayinDurumu: document.getElementById('muze-yayin-durumu').value,
    sira: parseInt(document.getElementById('muze-sira').value, 10) || 0,
    oneCikan: document.getElementById('muze-one-cikan').checked,
    ureticiAdiYayinlansin: document.getElementById('muze-uretici-ad').checked,
    lisans: document.getElementById('muze-lisans').value,
    sanalTur: document.getElementById('muze-sanal-tur').value.trim(),
    ceviriler: _muzeTaslakCeviriler,
    gorseller: _muzeSecilenGorseller
  };
}

async function muzeKaydet() {
  if (!muzeYazabilir()) {
    showToast('Sergi kaydı için düzenleme yetkiniz yok.', 'warning');
    return;
  }
  const payload = muzeFormPayload();

  // Yayına alma, veriyi kurum dışına açan bir karardır: kullanıcı ne yaptığını
  // görerek onaylasın.
  if (payload.sergide && payload.yayinDurumu === 'Yayında') {
    const tr = _muzeTaslakCeviriler[MUZE_VARSAYILAN_DIL] || {};
    if (!String(tr.baslik || '').trim() || !String(tr.hikaye || '').trim()) {
      showToast('Yayına almadan önce Türkçe sergi başlığı ve koleksiyon hikayesi doldurulmalıdır.', 'warning');
      muzeDilSec(MUZE_VARSAYILAN_DIL);
      return;
    }
    const diller = muzeDoluDiller(_muzeTaslakCeviriler).map((d) => d.toUpperCase()).join(', ');
    const onay = confirm(
      '“' + (_muzeAcikEser?.item.eserAdi || payload.envanterNo) + '” yayına alınacak.\n\n' +
      'Bu eserin künyesi, hikayesi ve seçili görselleri API anahtarına sahip dış sistemlerden ' +
      'okunabilir hale gelir.\n\n' +
      'Yayınlanacak diller: ' + (diller || 'TR') + '\n' +
      'Görsel sayısı: ' + payload.gorseller.length + '\n' +
      (payload.ureticiAdiYayinlansin ? 'Üreticinin adı künyede yayınlanacak.\n' : '') +
      '\nDevam edilsin mi?'
    );
    if (!onay) return;
  }

  toggleLoading(true, 'Sergi kaydı Google E-Tabloya yazılıyor...');
  const res = await apiPost('muze_kaydet', payload);
  toggleLoading(false);

  if (res && res.success) {
    showToast('Sanal sergi kaydı güncellendi.', 'success');
    document.getElementById('dialog-muze-eser').close();
    await syncMuze(true);
  } else {
    showToast('Kaydedilemedi: ' + ((res && res.error) || 'İstek başarısız oldu.'), 'danger');
  }
}

// Toplu işlemler: gönderim (koleksiyon seçilerek), sergiden kaldırma ve
// koleksiyon değiştirme. Sunucu eksik Türkçe metni envanterden tamamlar ve
// gönderilen eserlerin görsellerini Drive'da paylaşıma açar.
// Drive çağrıları yavaş olduğu için istekler 25'lik parçalarla gider.
const MUZE_TOPLU_PARCA = 25;
const MUZE_TOPLU_METIN = {
  gonder: { ilerleme: 'Sanal müzeye gönderiliyor', basari: (n, k) => n + ' eser “' + k + '” koleksiyonunda yayında.' },
  kaldir: { ilerleme: 'Sergiden kaldırılıyor', basari: (n) => n + ' eser sergiden kaldırıldı.' },
  tasi: { ilerleme: 'Koleksiyon değiştiriliyor', basari: (n, k) => n + ' eser “' + k + '” koleksiyonuna taşındı.' }
};

function muzeSunucuHatasi(res) {
  const hata = (res && res.error) || 'İstek başarısız oldu.';
  return /Bilinmeyen API eylemi/.test(hata)
    ? 'Sunucu bu işlemi henüz tanımıyor: Apps Script yeni sürümle yeniden dağıtılmalı.'
    : hata;
}

async function muzeTopluCalistir(islem, nolar, koleksiyon, secimKumesi) {
  if (!muzeYazabilir()) {
    showToast('Sergi kaydı için düzenleme yetkiniz yok.', 'warning');
    return;
  }
  if (!nolar.length) return;
  const metin = MUZE_TOPLU_METIN[islem];
  const sonuclar = [];
  let hata = '';
  try {
    for (let i = 0; i < nolar.length; i += MUZE_TOPLU_PARCA) {
      const parca = nolar.slice(i, i + MUZE_TOPLU_PARCA);
      toggleLoading(true, metin.ilerleme + '... (' + Math.min(i + parca.length, nolar.length) + ' / ' + nolar.length + ')');
      const res = await apiPost('muze_toplu_gonder', { envanterNolar: parca, islem, koleksiyon: koleksiyon || '' });
      if (!res || !res.success) { hata = muzeSunucuHatasi(res); break; }
      sonuclar.push(...(res.sonuc || []));
    }
  } finally {
    toggleLoading(false);
  }

  const tamam = sonuclar.filter((s) => s.durum !== 'atlandı');
  if (secimKumesi) tamam.forEach((s) => secimKumesi.delete(String(s.envanterNo).trim()));
  const atlanan = sonuclar.filter((s) => s.durum === 'atlandı');
  const uyarili = tamam.filter((s) => s.not);

  if (tamam.length) {
    showToast(metin.basari(tamam.length, koleksiyon) + (atlanan.length ? ' ' + atlanan.length + ' eser atlandı.' : ''),
      atlanan.length || hata ? 'warning' : 'success');
  }
  if (hata) showToast('İşlem yarıda kaldı: ' + hata, 'danger');
  if (atlanan.length || uyarili.length) {
    const satirlar = atlanan.concat(uyarili).slice(0, 15)
      .map((s) => '• ' + s.envanterNo + ': ' + (s.not || s.durum));
    const kalan = atlanan.length + uyarili.length - satirlar.length;
    alert('Dikkat edilmesi gereken eserler:\n\n' + satirlar.join('\n') + (kalan > 0 ? '\n… ve ' + kalan + ' eser daha' : ''));
  }
  if (tamam.length) await syncMuze(true);
  else renderMuzeTumu();
}

// --- Koleksiyon seçme penceresi (gönderim ve taşıma) ---
let _muzeTopluIstek = null;
let _muzeSonKoleksiyon = '';

function muzeTopluDialogAc(islem, secimKumesi) {
  const nolar = [...secimKumesi];
  if (!nolar.length || !muzeYazabilir()) return;
  if (STATE.muzeKoleksiyonDestegi === false) {
    showToast('Koleksiyonla gönderim için Apps Script yeni sürümle yeniden dağıtılmalı.', 'warning');
    return;
  }
  _muzeTopluIstek = { islem, nolar, secimKumesi };
  const gonder = islem === 'gonder';
  document.getElementById('muze-toplu-baslik').textContent = gonder ? 'Sanal Müzeye Gönder' : 'Koleksiyonunu Değiştir';
  document.getElementById('muze-toplu-ozet').textContent = gonder
    ? nolar.length + ' eser seçildi. Sanal müzede hangi koleksiyonun salonunda sergilenecek?'
    : nolar.length + ' eser başka bir koleksiyona taşınacak.';

  const koleksiyonlar = STATE.muzeKoleksiyonlar || [];
  const secim = document.getElementById('muze-toplu-koleksiyon');
  secim.innerHTML = koleksiyonlar.map((k) =>
    `<option value="${escapeHtml(k.ad)}">${escapeHtml(k.ad)}${k.tanimli === false ? ' (tanımsız)' : ''} — ${k.yayindaSayisi || 0} eser yayında</option>`
  ).join('') + '<option value="__yeni__">➕ Yeni koleksiyon…</option>';
  const onceki = koleksiyonlar.find((k) => k.ad === _muzeSonKoleksiyon) || koleksiyonlar.find((k) => k.tanimli !== false);
  secim.value = onceki ? onceki.ad : '__yeni__';
  document.getElementById('muze-toplu-yeni').value = '';
  document.getElementById('muze-toplu-yeni-kutu').classList.toggle('hidden', secim.value !== '__yeni__');

  const notlar = gonder ? [
    'Eserler bu koleksiyonun salonunda sergilenir; daha önce yayında olanlar da bu koleksiyona geçer.',
    'Türkçe başlığı veya hikayesi boş olanlar envanterdeki Eser Adı ve Hikaye alanlarıyla doldurulur; yazdığınız sergi metinlerine dokunulmaz.',
    'Görselleri Google Drive\'da "bağlantıya sahip herkes görüntüleyebilir" yapılır ve kurum dışından açılabilir hale gelir.'
  ] : ['Eserler sergide kalır; sanal müzede yalnızca salonları değişir.'];
  document.getElementById('muze-toplu-notlar').innerHTML = notlar.map((n) => `<li>${escapeHtml(n)}</li>`).join('');
  document.getElementById('btn-muze-toplu-onay').textContent = nolar.length + (gonder ? ' Eseri Gönder' : ' Eseri Taşı');
  document.getElementById('dialog-muze-toplu').showModal();
  if (secim.value === '__yeni__') document.getElementById('muze-toplu-yeni').focus();
}

async function muzeTopluDialogOnay() {
  if (!_muzeTopluIstek) return;
  const secim = document.getElementById('muze-toplu-koleksiyon').value;
  const koleksiyon = (secim === '__yeni__' ? document.getElementById('muze-toplu-yeni').value : secim).trim().replace(/\s+/g, ' ');
  if (!koleksiyon) {
    showToast('Bir koleksiyon seçin ya da yeni koleksiyonun adını yazın.', 'warning');
    document.getElementById('muze-toplu-yeni').focus();
    return;
  }
  const { islem, nolar, secimKumesi } = _muzeTopluIstek;
  _muzeTopluIstek = null;
  _muzeSonKoleksiyon = koleksiyon;
  document.getElementById('dialog-muze-toplu').close();
  await muzeTopluCalistir(islem, nolar, koleksiyon, secimKumesi);
}

async function muzeSergidenKaldir(nolar, secimKumesi) {
  if (!nolar.length) return;
  const mesaj = (nolar.length === 1 ? 'Eser' : nolar.length + ' eser') + ' sanal müzeden kaldırılacak.\n\n' +
    'Sergi metinleri ve çeviriler silinmez; daha sonra yeniden gönderebilirsiniz.\n\nDevam edilsin mi?';
  if (!confirm(mesaj)) return;
  await muzeTopluCalistir('kaldir', nolar, '', secimKumesi);
}

// --------------------------------------------------------------------------
// Koleksiyonlar (sanal müzedeki salonlar)
// --------------------------------------------------------------------------
// Sunucudaki _muzeKoleksiyonAnahtari ile aynı kural.
function muzeKoleksiyonAnahtari(ad) {
  return String(ad == null ? '' : ad).trim().replace(/\s+/g, ' ').toLowerCase();
}

function muzeKoleksiyonlariKayitlardan() {
  const harita = new Map();
  (STATE.muzeKayitlari || []).forEach((k) => {
    const ad = String(k['Koleksiyon'] || '').trim();
    if (!ad) return;
    const anahtar = muzeKoleksiyonAnahtari(ad);
    if (!harita.has(anahtar)) harita.set(anahtar, { ad, aciklama: '', sira: 0, tanimli: false, eserSayisi: 0, yayindaSayisi: 0 });
    const x = harita.get(anahtar);
    x.eserSayisi++;
    if (muzeEvet(k['Sergide Göster']) && String(k['Yayın Durumu'] || '').trim() === 'Yayında') x.yayindaSayisi++;
  });
  return [...harita.values()].sort((a, b) => a.ad.localeCompare(b.ad, 'tr'));
}

function muzeKoleksiyonAdlari() {
  return (STATE.muzeKoleksiyonlar || []).map((k) => k.ad);
}

function muzeKolFormDoldur(k) {
  document.getElementById('muze-kol-eski').value = k ? k.ad : '';
  document.getElementById('muze-kol-ad').value = k ? k.ad : '';
  document.getElementById('muze-kol-sira').value = k && k.sira > 0 ? k.sira : '';
  document.getElementById('muze-kol-aciklama').value = k ? (k.aciklama || '') : '';
  document.getElementById('muze-kol-form-baslik').textContent =
    !k ? 'Yeni Koleksiyon' : (k.tanimli === false ? 'Koleksiyonu Tanımla' : 'Koleksiyonu Düzenle');
  document.getElementById('btn-muze-kol-kaydet').textContent = k ? '💾 Kaydet' : '➕ Koleksiyonu Ekle';
  document.getElementById('btn-muze-kol-vazgec').classList.toggle('hidden', !k);
  if (k) document.getElementById('muze-kol-ad').focus();
}

async function muzeKolKaydet(e) {
  e.preventDefault();
  if (!muzeYazabilir()) return;
  const eskiAd = document.getElementById('muze-kol-eski').value;
  const payload = {
    ad: document.getElementById('muze-kol-ad').value.trim(),
    sira: parseInt(document.getElementById('muze-kol-sira').value, 10) || 0,
    aciklama: document.getElementById('muze-kol-aciklama').value.trim()
  };
  if (eskiAd) payload.eskiAd = eskiAd;
  if (!payload.ad) { showToast('Koleksiyon adı boş olamaz.', 'warning'); return; }
  toggleLoading(true, 'Koleksiyon kaydediliyor...');
  const res = await apiPost('muze_koleksiyon_kaydet', payload);
  toggleLoading(false);
  if (!res || !res.success) { showToast('Kaydedilemedi: ' + muzeSunucuHatasi(res), 'danger'); return; }
  showToast('“' + res.ad + '” koleksiyonu kaydedildi.' + (res.tasinan ? ' ' + res.tasinan + ' eser yeni adı aldı.' : ''), 'success');
  muzeKolFormDoldur(null);
  await syncMuze(true);
}

async function muzeKolSil(ad) {
  if (!muzeYazabilir()) return;
  if (!confirm('“' + ad + '” koleksiyonu silinecek.\n\nYayında eseri olan koleksiyon silinemez; önce eserleri Yayındakiler sekmesinden başka koleksiyona taşıyın.\n\nDevam edilsin mi?')) return;
  toggleLoading(true, 'Koleksiyon siliniyor...');
  const res = await apiPost('muze_koleksiyon_sil', { ad });
  toggleLoading(false);
  if (!res || !res.success) { showToast(muzeSunucuHatasi(res), 'warning'); return; }
  showToast('“' + ad + '” koleksiyonu silindi.', 'success');
  if (document.getElementById('muze-kol-eski').value === ad) muzeKolFormDoldur(null);
  await syncMuze(true);
}

function renderMuzeKoleksiyonlar() {
  const kutu = document.getElementById('muze-kol-liste');
  if (!kutu) return;
  const yazabilir = muzeYazabilir();
  document.querySelectorAll('#muze-kol-form input, #muze-kol-form textarea, #muze-kol-form button')
    .forEach((el) => { el.disabled = !yazabilir; });
  const liste = STATE.muzeKoleksiyonlar || [];
  document.getElementById('muze-kol-bos')?.classList.toggle('hidden', liste.length > 0);
  kutu.innerHTML = liste.map((k) => {
    const taslak = (k.eserSayisi || 0) - (k.yayindaSayisi || 0);
    return `
      <div class="muze-kol-satir card${k.tanimli === false ? ' tanimsiz' : ''}">
        <div class="muze-kol-sira-rozet" title="Salon sırası">${k.sira > 0 ? k.sira : '–'}</div>
        <div class="muze-kol-govde">
          <div class="muze-kol-ust">
            <strong>${escapeHtml(k.ad)}</strong>
            ${k.tanimli === false ? '<span class="badge badge-warning" title="Eserlere yazılmış ama koleksiyon olarak tanımlanmamış (ör. atölye adıyla gönderilenler)">Tanımsız</span>' : ''}
          </div>
          ${k.aciklama ? `<p class="muze-kol-aciklama">${escapeHtml(k.aciklama)}</p>` : ''}
          <span class="muze-kart-meta">🌍 ${k.yayindaSayisi || 0} eser yayında${taslak > 0 ? ' · ' + taslak + ' sergi dışı kayıt' : ''}</span>
        </div>
        ${yazabilir ? `<div class="muze-kart-islem">
          <button class="btn btn-outline-primary btn-sm" data-muze-kol-duzenle="${escapeHtml(k.ad)}">${k.tanimli === false ? 'Tanımla' : 'Düzenle'}</button>
          ${k.tanimli === false ? '' : `<button class="btn btn-outline-danger btn-sm" data-muze-kol-sil="${escapeHtml(k.ad)}">Sil</button>`}
        </div>` : ''}
      </div>`;
  }).join('');
}

// --------------------------------------------------------------------------
// Yayındakiler: sanal müzede şu an sergilenen eserler, koleksiyonlarına göre
// --------------------------------------------------------------------------
const _muzeYayindaSecili = new Set();
let _muzeYayindaListelenen = [];

function muzeYayindakiEserler() {
  const envanter = new Map((STATE.inventory || []).map((i) => [String(i.envanterNo || '').trim().toLowerCase(), i]));
  return (STATE.muzeKayitlari || [])
    .filter((k) => muzeEvet(k['Sergide Göster']) && String(k['Yayın Durumu'] || '').trim() === 'Yayında')
    .map((k) => {
      const no = String(k['Envanter No'] || '').trim();
      const item = envanter.get(no.toLowerCase()) || { envanterNo: no, eserAdi: String(k['Sergi Başlığı (TR)'] || no) };
      return { no, kayit: k, item, koleksiyon: String(k['Koleksiyon'] || '').trim() };
    });
}

function muzeYayindaCubugunuGuncelle() {
  const n = _muzeYayindaSecili.size;
  const sayac = document.getElementById('muze-yayinda-secim-sayac');
  if (sayac) sayac.textContent = n ? n + ' eser seçili' : 'Seçim yok';
  ['btn-muze-yayinda-tasi', 'btn-muze-yayinda-kaldir'].forEach((id) => {
    const b = document.getElementById(id);
    if (b) b.disabled = n === 0;
  });
  const hepsi = document.getElementById('muze-yayinda-hepsi');
  if (hepsi) {
    const secilen = _muzeYayindaListelenen.filter((no) => _muzeYayindaSecili.has(no)).length;
    hepsi.checked = _muzeYayindaListelenen.length > 0 && secilen === _muzeYayindaListelenen.length;
    hepsi.indeterminate = secilen > 0 && secilen < _muzeYayindaListelenen.length;
  }
  document.getElementById('muze-yayinda-cubuk')?.classList.toggle('hidden', !muzeYazabilir());
}

function renderMuzeYayinda() {
  const kutu = document.getElementById('muze-yayinda-liste');
  if (!kutu) return;
  const tum = muzeYayindakiEserler();
  const yayindaNolari = new Set(tum.map((x) => x.no));
  [..._muzeYayindaSecili].forEach((no) => { if (!yayindaNolari.has(no)) _muzeYayindaSecili.delete(no); });
  const sekmeSayi = document.getElementById('muze-yayinda-sekme-sayi');
  if (sekmeSayi) sekmeSayi.textContent = tum.length;

  // Koleksiyon sırası: tanımlı liste (salon sırası), sonra ada göre
  const sira = new Map(muzeKoleksiyonAdlari().map((ad, i) => [muzeKoleksiyonAnahtari(ad), i]));
  const gruplar = new Map();
  tum.forEach((x) => {
    const anahtar = muzeKoleksiyonAnahtari(x.koleksiyon) || '~';
    if (!gruplar.has(anahtar)) gruplar.set(anahtar, { ad: x.koleksiyon || 'Koleksiyonsuz', anahtar, eserler: [] });
    gruplar.get(anahtar).eserler.push(x);
  });
  const siraliGruplar = [...gruplar.values()].sort((a, b) =>
    (sira.has(a.anahtar) ? sira.get(a.anahtar) : 1e6) - (sira.has(b.anahtar) ? sira.get(b.anahtar) : 1e6) ||
    a.ad.localeCompare(b.ad, 'tr'));

  const kolSelect = document.getElementById('muze-yayinda-koleksiyon');
  if (kolSelect) {
    const secili = kolSelect.value;
    kolSelect.innerHTML = '<option value="all">Tüm Koleksiyonlar</option>' + siraliGruplar
      .map((g) => `<option value="${escapeHtml(g.anahtar)}">${escapeHtml(g.ad)} (${g.eserler.length})</option>`).join('');
    if (siraliGruplar.some((g) => g.anahtar === secili)) kolSelect.value = secili;
  }
  const kolFiltre = kolSelect ? kolSelect.value : 'all';
  const arama = (document.getElementById('muze-yayinda-arama')?.value || '').toLocaleLowerCase('tr').trim();

  const yazabilir = muzeYazabilir();
  const gorunen = siraliGruplar
    .filter((g) => kolFiltre === 'all' || g.anahtar === kolFiltre)
    .map((g) => ({ ...g, eserler: g.eserler.filter((x) => !arama ||
      [x.no, x.item.eserAdi, x.item.atolye, x.koleksiyon, x.kayit['Sergi Başlığı (TR)']]
        .some((v) => String(v || '').toLocaleLowerCase('tr').includes(arama))) }))
    .filter((g) => g.eserler.length);
  _muzeYayindaListelenen = gorunen.flatMap((g) => g.eserler.map((x) => x.no));
  const listelenen = _muzeYayindaListelenen.length;
  const sayac = document.getElementById('muze-yayinda-sayac');
  if (sayac) sayac.textContent = listelenen === tum.length ? tum.length + ' eser yayında' : listelenen + ' / ' + tum.length + ' eser listeleniyor';
  document.getElementById('muze-yayinda-bos')?.classList.toggle('hidden', listelenen > 0);
  muzeYayindaCubugunuGuncelle();

  kutu.innerHTML = gorunen.map((g) => `
    <section class="muze-kol-grup">
      <h3 class="muze-kol-grup-baslik">🗂️ ${escapeHtml(g.ad)} <span>${g.eserler.length} eser</span></h3>
      <div class="muze-kart-izgara">
        ${g.eserler.map((x) => {
          const secili = _muzeYayindaSecili.has(x.no);
          const sergiBasligi = String(x.kayit['Sergi Başlığı (TR)'] || '').trim();
          return `
          <div class="muze-kart card${secili ? ' secili' : ''}">
            ${yazabilir ? `<label class="muze-kart-sec" title="Toplu işlem için seç">
              <input type="checkbox" data-muze-yayin-sec="${escapeHtml(x.no)}"${secili ? ' checked' : ''}>
            </label>` : ''}
            ${muzeKartGorseli(x.item)}
            <div class="muze-kart-govde">
              <div class="muze-kart-ust"><strong>${escapeHtml(x.item.eserAdi || 'İsimsiz eser')}</strong></div>
              <span class="muze-kart-meta"><code>${escapeHtml(x.no)}</code>${x.item.atolye ? ' · 🏛️ ' + escapeHtml(String(x.item.atolye)) : ''}</span>
              ${sergiBasligi && sergiBasligi !== x.item.eserAdi ? `<span class="muze-kart-baslik">“${escapeHtml(sergiBasligi)}”</span>` : ''}
            </div>
            ${yazabilir ? `<div class="muze-kart-islem">
              <button class="btn btn-outline-danger btn-sm" data-muze-yayin-kaldir="${escapeHtml(x.no)}">Kaldır</button>
            </div>` : ''}
          </div>`;
        }).join('')}
      </div>
    </section>`).join('');
}

// --------------------------------------------------------------------------
// Görseller: kartta küçük resim, üzerine gelince önizleme, tıklayınca büyük hali
// --------------------------------------------------------------------------
function muzeGorselAdresi(link, genislik) {
  const id = driveDosyaId(link);
  return id ? `https://lh3.googleusercontent.com/d/${id}=w${genislik}` : '';
}

function muzeKartGorseli(item) {
  const link = item.linkWeb || item.linkImage;
  const kucuk = getDriveThumbnailUrl(link);
  if (!kucuk) return '<div class="muze-kart-gorsel muze-kart-gorsel--bos">🖼️</div>';
  return `<button type="button" class="muze-kart-gorsel-dugme" data-muze-buyuk="${escapeHtml(link)}"
      data-muze-baslik="${escapeHtml(item.eserAdi || '')}" title="Büyütmek için tıklayın" aria-label="Görseli büyüt">
      <img src="${kucuk}" loading="lazy" decoding="async" referrerpolicy="no-referrer" alt="" class="muze-kart-gorsel" data-fallback="favicon">
    </button>`;
}

function muzeGorselAc(link, baslik) {
  const adres = muzeGorselAdresi(link, 1600);
  if (!adres) return;
  const d = document.getElementById('dialog-muze-gorsel');
  const img = document.getElementById('muze-gorsel-buyuk');
  img.onerror = () => {
    const alt = gorselAlternatifAdres(img.src);
    if (alt && img.src !== alt) img.src = alt;
  };
  img.src = adres;
  img.alt = baslik || '';
  document.getElementById('muze-gorsel-altyazi').textContent = baslik || '';
  d.classList.remove('yakin');
  muzeOnizlemeGizle();
  d.showModal();
}

let _muzeOnizlemeZamanlayici = null;

function muzeOnizlemeGizle() {
  clearTimeout(_muzeOnizlemeZamanlayici);
  _muzeOnizlemeZamanlayici = null;
  document.getElementById('muze-hover-onizleme')?.classList.remove('acik');
}

// Önizleme imlecin sağ altında durur; ekrana sığmazsa sola/yukarı kayar.
function muzeOnizlemeKonumla(x, y) {
  const kutu = document.getElementById('muze-hover-onizleme');
  if (!kutu) return;
  const w = kutu.offsetWidth || 340, h = kutu.offsetHeight || 340, bosluk = 18;
  let sol = x + bosluk, ust = y + bosluk;
  if (sol + w > window.innerWidth - 8) sol = x - w - bosluk;
  if (ust + h > window.innerHeight - 8) ust = Math.max(8, window.innerHeight - h - 8);
  kutu.style.left = Math.max(8, sol) + 'px';
  kutu.style.top = ust + 'px';
}

// Kart görselleri ([data-muze-buyuk]): fareyle üzerine gelince önizleme,
// tıklayınca büyük hali. Sanal Müze ve Fotoğraf Bekleyenler ekranlarında kullanılır.
function gorselYakinlastirmaBagla(kapsayici) {
  if (!kapsayici) return;
  const inceImlec = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  kapsayici.addEventListener('click', (e) => {
    const gorsel = e.target.closest('[data-muze-buyuk]');
    if (gorsel) muzeGorselAc(gorsel.getAttribute('data-muze-buyuk'), gorsel.getAttribute('data-muze-baslik'));
  });
  if (inceImlec) {
    const onizlemeBaslat = (gorsel) => {
      clearTimeout(_muzeOnizlemeZamanlayici);
      _muzeOnizlemeZamanlayici = setTimeout(() => {
        const kutu = document.getElementById('muze-hover-onizleme');
        const img = kutu.querySelector('img');
        const adres = muzeGorselAdresi(gorsel.getAttribute('data-muze-buyuk'), 640);
        if (img.getAttribute('src') !== adres) img.src = adres;
        kutu.classList.add('acik');
      }, 180);
    };
    kapsayici.addEventListener('mouseover', (e) => {
      const gorsel = e.target.closest('[data-muze-buyuk]');
      if (gorsel) onizlemeBaslat(gorsel);
    });
    // Kaydırma önizlemeyi kapatır; imleç görselin üzerinde kıpırdayınca yeniden açılır.
    kapsayici.addEventListener('mousemove', (e) => {
      const gorsel = e.target.closest('[data-muze-buyuk]');
      if (!gorsel) return;
      muzeOnizlemeKonumla(e.clientX, e.clientY);
      const acik = document.getElementById('muze-hover-onizleme').classList.contains('acik');
      if (!acik && !_muzeOnizlemeZamanlayici) onizlemeBaslat(gorsel);
    });
    kapsayici.addEventListener('mouseout', (e) => {
      const gorsel = e.target.closest('[data-muze-buyuk]');
      if (gorsel && !gorsel.contains(e.relatedTarget)) muzeOnizlemeGizle();
    });
    window.addEventListener('scroll', muzeOnizlemeGizle, true);
  }
}

function renderMuzeTumu() {
  renderMuze();
  renderMuzeYayinda();
  renderMuzeKoleksiyonlar();
}

async function muzeKayitSil() {
  if (!_muzeAcikEser) return;
  const onay = confirm(
    '“' + (_muzeAcikEser.item.eserAdi || _muzeAcikEser.envanterNo) + '” sergiden kaldırılacak.\n\n' +
    'Koleksiyon hikayesi ve çeviriler de silinir. Envanter kaydına dokunulmaz.\n\nDevam edilsin mi?'
  );
  if (!onay) return;
  toggleLoading(true, 'Sergi kaydı kaldırılıyor...');
  const res = await apiPost('muze_kayit_sil', { envanterNo: _muzeAcikEser.envanterNo });
  toggleLoading(false);
  if (res && res.success) {
    showToast('Sergi kaydı kaldırıldı.', 'success');
    document.getElementById('dialog-muze-eser').close();
    await syncMuze(true);
  } else {
    showToast('Kaldırılamadı: ' + ((res && res.error) || ''), 'danger');
  }
}

async function muzeOnizle() {
  if (!_muzeAcikEser) return;
  muzeAktifDiliTopla();
  const kutu = document.getElementById('muze-onizleme-kutusu');
  const kod = document.getElementById('muze-onizleme-kod');

  // Kaydedilmemiş değişiklikler sunucuda yok; önizleme kaydedilmiş hali gösterir.
  toggleLoading(true, 'Önizleme hazırlanıyor...');
  const res = await apiPost('muze_onizleme', { envanterNo: _muzeAcikEser.envanterNo, dil: _muzeAktifDil });
  toggleLoading(false);

  if (res && res.success) {
    kod.textContent = JSON.stringify(res.veri, null, 2);
    kutu.classList.remove('hidden');
    if (!res.yayinda) {
      showToast('Bu eser henüz yayında değil; önizleme yalnızca örnek amaçlıdır.', 'info');
    }
  } else {
    showToast(((res && res.error) || 'Önizleme alınamadı') + ' — önce kaydedin.', 'warning');
  }
}

async function muzeGorselleriYayinla() {
  if (!_muzeAcikEser) return;
  if (!_muzeSecilenGorseller.length) {
    showToast('Önce yayınlanacak görselleri seçin.', 'warning');
    return;
  }
  const onay = confirm(
    _muzeSecilenGorseller.length + ' görselin Google Drive izni "bağlantıya sahip herkes görüntüleyebilir" ' +
    'olarak değiştirilecek.\n\nBu, görsellerin kurum dışından açılabilmesi için gereklidir ve ' +
    'Drive üzerinden geri alınabilir.\n\nDevam edilsin mi?'
  );
  if (!onay) return;

  toggleLoading(true, 'Drive izinleri güncelleniyor...');
  const res = await apiPost('muze_gorsel_yayinla', {
    envanterNo: _muzeAcikEser.envanterNo,
    gorseller: _muzeSecilenGorseller
  });
  toggleLoading(false);

  if (res && res.success) {
    const acilan = (res.sonuc || []).filter((s) => s.durum === 'açıldı').length;
    const hatali = (res.sonuc || []).filter((s) => s.durum === 'hata');
    showToast(acilan + ' görsel paylaşıma açıldı.' + (hatali.length ? ' ' + hatali.length + ' görselde hata var.' : ''),
      hatali.length ? 'warning' : 'success');
    if (hatali.length) console.warn('Paylaşılamayan görseller:', hatali);
  } else {
    showToast('İzinler güncellenemedi: ' + ((res && res.error) || ''), 'danger');
  }
}

// --------------------------------------------------------------------------
// Yayın & API sekmesi
// --------------------------------------------------------------------------
function muzeApiKok() {
  return STATE.sheetUrl || '<APPS_SCRIPT_URL>';
}

function renderMuzeApiUclari() {
  const kutu = document.getElementById('muze-uc-listesi');
  if (!kutu) return;
  const kok = muzeApiKok();
  const uclar = [
    { ad: 'Servis durumu', not: 'Anahtar gerekmez; izleme/uptime kontrolü için.', sorgu: '?kaynak=saglik' },
    { ad: 'Koleksiyon listesi', not: 'Koleksiyon adları, eser sayıları ve kapak görselleri.', sorgu: '?kaynak=koleksiyonlar&key=API_ANAHTARI' },
    { ad: 'Eser listesi', not: 'Sayfalı liste. koleksiyon, ara, oneCikan, dil, sayfa, limit parametreleri desteklenir.', sorgu: '?kaynak=eserler&dil=en&limit=25&sayfa=1&key=API_ANAHTARI' },
    { ad: 'Tek eser', not: 'Envanter numarası ile eserin tam kaydı.', sorgu: '?kaynak=eserler/ENVANTER_NO&dil=tr&key=API_ANAHTARI' },
    { ad: 'Sergi manifesti', not: 'Tüm sergi tek gövdede — VR/oyun istemcilerinin açılışta çekmesi için.', sorgu: '?kaynak=manifest&key=API_ANAHTARI' }
  ];
  kutu.innerHTML = uclar.map((u) => `
    <div class="muze-uc">
      <div class="muze-uc-ust">
        <span class="muze-uc-yontem">GET</span>
        <strong>${escapeHtml(u.ad)}</strong>
        <button type="button" class="btn btn-text btn-sm" data-muze-kopyala="${escapeHtml(kok + u.sorgu)}">📋 Kopyala</button>
      </div>
      <code class="muze-uc-adres">${escapeHtml(kok + u.sorgu)}</code>
      <span class="muze-uc-not">${escapeHtml(u.not)}</span>
    </div>`).join('');

  const ornek = document.getElementById('muze-ornek-kod');
  if (ornek) {
    ornek.textContent =
`const API = "${kok}";
const KEY = "eom_...";   // Yayın & API sekmesinden üretilir

// Koleksiyonu istenen dilde çek
async function eserleriGetir(dil = "tr", sayfa = 1) {
  const adres = \`\${API}?kaynak=eserler&dil=\${dil}&sayfa=\${sayfa}&limit=25&key=\${KEY}\`;
  const yanit = await fetch(adres);
  const veri = await yanit.json();
  if (!veri.success) throw new Error(veri.error);
  return veri;   // { toplam, sayfa, sayfaSayisi, veri: [ ...eserler ] }
}

// Tek eserin sergi sayfası
async function eserGetir(envanterNo, dil = "tr") {
  const adres = \`\${API}?kaynak=eserler/\${encodeURIComponent(envanterNo)}&dil=\${dil}&key=\${KEY}\`;
  return (await (await fetch(adres)).json()).veri;
}

// Her eser: { envanterNo, koleksiyon, icerik: {baslik, ozet, hikaye},
//             kunye: {...}, gorseller: [{kucuk, buyuk, tamBoy}], lisans }`;
  }
}

async function renderMuzeAnahtarlar() {
  const tbody = document.getElementById('muze-anahtar-tbody');
  const bos = document.getElementById('muze-anahtar-bos');
  if (!tbody) return;
  if (!STATE.currentUser || STATE.currentUser.role !== 'admin') return;

  const res = await apiPost('muze_anahtarlar');
  if (!res || !res.success) {
    tbody.innerHTML = '';
    if (bos) {
      bos.textContent = 'Anahtarlar okunamadı: ' + ((res && res.error) || '');
      bos.classList.remove('hidden');
    }
    return;
  }

  STATE.muzeAnahtarlar = res.anahtarlar || [];
  if (!STATE.muzeAnahtarlar.length) {
    tbody.innerHTML = '';
    if (bos) {
      bos.textContent = 'Henüz API anahtarı üretilmedi.';
      bos.classList.remove('hidden');
    }
    return;
  }
  if (bos) bos.classList.add('hidden');

  tbody.innerHTML = STATE.muzeAnahtarlar.map((a) => `
    <tr>
      <td data-label="Ad">${escapeHtml(a.ad || '-')}</td>
      <td data-label="Önek"><code>${escapeHtml(a.onek || '')}…</code></td>
      <td data-label="Durum"><span class="badge ${a.aktif ? 'badge-success' : 'badge-danger'}">${a.aktif ? 'Aktif' : 'Kapalı'}</span></td>
      <td data-label="Son Kullanım">${a.sonKullanim ? escapeHtml(new Date(a.sonKullanim).toLocaleString('tr-TR')) : 'Hiç'}</td>
      <td data-label="İstek">${escapeHtml(String(a.istekSayisi || 0))}</td>
      <td>
        <button class="btn btn-sm btn-secondary" data-muze-anahtar-durum="${escapeHtml(a.onek)}" data-aktif="${a.aktif ? '0' : '1'}">
          ${a.aktif ? 'Devre dışı bırak' : 'Etkinleştir'}
        </button>
        <button class="btn btn-sm btn-text" data-muze-anahtar-sil="${escapeHtml(a.onek)}">🗑️</button>
      </td>
    </tr>`).join('');
}

async function muzeAnahtarDurumDegistir(onek, aktif) {
  const res = await apiPost('muze_anahtar_durum', { onek: onek, aktif: aktif });
  if (res && res.success) {
    showToast(res.message || 'Anahtar güncellendi.', 'success');
    renderMuzeAnahtarlar();
  } else {
    showToast('İşlem başarısız: ' + ((res && res.error) || ''), 'danger');
  }
}

async function muzeAnahtarSil(onek) {
  const onay = confirm(
    'Bu anahtar kalıcı olarak silinecek.\n\nAnahtarı kullanan web sitesi veya VR istemcisi ' +
    'anında erişimini kaybeder.\n\nDevam edilsin mi?'
  );
  if (!onay) return;
  const res = await apiPost('muze_anahtar_durum', { onek: onek, sil: true });
  if (res && res.success) {
    showToast('Anahtar silindi.', 'success');
    renderMuzeAnahtarlar();
  } else {
    showToast('Silinemedi: ' + ((res && res.error) || ''), 'danger');
  }
}

async function muzeAnahtarUret() {
  const ad = document.getElementById('muze-anahtar-ad').value.trim();
  if (!ad) {
    showToast('Anahtar için bir ad girin.', 'warning');
    return;
  }
  toggleLoading(true, 'Anahtar üretiliyor...');
  const res = await apiPost('muze_anahtar_olustur', { ad: ad });
  toggleLoading(false);
  if (res && res.success) {
    document.getElementById('muze-anahtar-deger').textContent = res.anahtar;
    document.getElementById('muze-anahtar-sonuc').classList.remove('hidden');
    document.getElementById('btn-muze-anahtar-uret').classList.add('hidden');
    renderMuzeAnahtarlar();
  } else {
    showToast('Anahtar üretilemedi: ' + ((res && res.error) || ''), 'danger');
  }
}

// --------------------------------------------------------------------------
// Kurulum
// --------------------------------------------------------------------------
function initSanalMuze() {
  const bolum = document.getElementById('sanal-muze-view');
  if (!bolum) return;

  // Alt sekmeler
  bolum.querySelectorAll('.btn-tab').forEach((tab) => {
    tab.addEventListener('click', (e) => {
      bolum.querySelectorAll('.btn-tab').forEach((t) => t.classList.remove('active'));
      e.currentTarget.classList.add('active');
      const hedef = e.currentTarget.getAttribute('data-subtarget');
      bolum.querySelectorAll('.muze-sub-view').forEach((v) => {
        v.classList.add('hidden');
        v.classList.remove('active');
      });
      const panel = document.getElementById(hedef);
      if (panel) {
        panel.classList.remove('hidden');
        panel.classList.add('active');
      }
      if (hedef === 'muze-api-subview') {
        renderMuzeApiUclari();
        renderMuzeAnahtarlar();
      }
      if (hedef === 'muze-yayinda-subview') renderMuzeYayinda();
      if (hedef === 'muze-koleksiyon-subview') renderMuzeKoleksiyonlar();
    });
  });

  document.getElementById('btn-muze-yenile')?.addEventListener('click', () => syncMuze(false));
  document.getElementById('btn-muze-sheet')?.addEventListener('click', () => {
    const adres = STATE.envanterTableUrl;
    if (adres) openExternal(adres);
    else showToast('E-tablo adresi Ayarlar bölümünden tanımlanmalı.', 'warning');
  });

  ['muze-arama', 'muze-filtre-durum', 'muze-filtre-atolye', 'muze-filtre-koleksiyon', 'muze-filtre-dil'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change',
      el.tagName === 'INPUT' ? debounce(renderMuze, 150) : renderMuze);
  });

  // Kart üzerindeki "Sergi Bilgileri" butonları (delege)
  document.getElementById('muze-kart-izgara')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-muze-duzenle]');
    if (!btn) return;
    openMuzeForm(btn.getAttribute('data-muze-duzenle'));
  });

  // Toplu işlem seçimi: kart kutucukları ve "listelenenlerin tümü"
  document.getElementById('muze-kart-izgara')?.addEventListener('change', (e) => {
    const kutu = e.target.closest('[data-muze-sec]');
    if (!kutu) return;
    const no = kutu.getAttribute('data-muze-sec');
    if (kutu.checked) _muzeSecili.add(no); else _muzeSecili.delete(no);
    kutu.closest('.muze-kart')?.classList.toggle('secili', kutu.checked);
    muzeSecimCubugunuGuncelle();
  });
  document.getElementById('muze-hepsini-sec')?.addEventListener('change', (e) => {
    _muzeListelenen.forEach((no) => (e.target.checked ? _muzeSecili.add(no) : _muzeSecili.delete(no)));
    renderMuze();
  });
  document.getElementById('btn-muze-toplu-gonder')?.addEventListener('click', () => muzeTopluDialogAc('gonder', _muzeSecili));

  // Koleksiyon seçme penceresi
  const topluDialog = document.getElementById('dialog-muze-toplu');
  document.getElementById('muze-toplu-koleksiyon')?.addEventListener('change', (e) => {
    const yeni = e.target.value === '__yeni__';
    document.getElementById('muze-toplu-yeni-kutu').classList.toggle('hidden', !yeni);
    if (yeni) document.getElementById('muze-toplu-yeni').focus();
  });
  document.getElementById('muze-toplu-yeni')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); muzeTopluDialogOnay(); }
  });
  document.getElementById('btn-muze-toplu-onay')?.addEventListener('click', muzeTopluDialogOnay);
  ['btn-muze-toplu-iptal', 'btn-muze-toplu-kapat'].forEach((id) =>
    document.getElementById(id)?.addEventListener('click', () => { _muzeTopluIstek = null; topluDialog.close(); }));

  // Yayındakiler sekmesi
  const yayinArama = document.getElementById('muze-yayinda-arama');
  yayinArama?.addEventListener('input', debounce(renderMuzeYayinda, 150));
  document.getElementById('muze-yayinda-koleksiyon')?.addEventListener('change', renderMuzeYayinda);
  const yayinListe = document.getElementById('muze-yayinda-liste');
  yayinListe?.addEventListener('change', (e) => {
    const kutu = e.target.closest('[data-muze-yayin-sec]');
    if (!kutu) return;
    const no = kutu.getAttribute('data-muze-yayin-sec');
    if (kutu.checked) _muzeYayindaSecili.add(no); else _muzeYayindaSecili.delete(no);
    kutu.closest('.muze-kart')?.classList.toggle('secili', kutu.checked);
    muzeYayindaCubugunuGuncelle();
  });
  yayinListe?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-muze-yayin-kaldir]');
    if (btn) muzeSergidenKaldir([btn.getAttribute('data-muze-yayin-kaldir')], _muzeYayindaSecili);
  });
  document.getElementById('muze-yayinda-hepsi')?.addEventListener('change', (e) => {
    _muzeYayindaListelenen.forEach((no) => (e.target.checked ? _muzeYayindaSecili.add(no) : _muzeYayindaSecili.delete(no)));
    renderMuzeYayinda();
  });
  document.getElementById('btn-muze-yayinda-tasi')?.addEventListener('click', () => muzeTopluDialogAc('tasi', _muzeYayindaSecili));
  document.getElementById('btn-muze-yayinda-kaldir')?.addEventListener('click', () =>
    muzeSergidenKaldir([..._muzeYayindaSecili], _muzeYayindaSecili));

  // Koleksiyonlar sekmesi
  document.getElementById('muze-kol-form')?.addEventListener('submit', muzeKolKaydet);
  document.getElementById('btn-muze-kol-vazgec')?.addEventListener('click', () => muzeKolFormDoldur(null));
  document.getElementById('muze-kol-liste')?.addEventListener('click', (e) => {
    const duzenle = e.target.closest('[data-muze-kol-duzenle]');
    if (duzenle) {
      const ad = duzenle.getAttribute('data-muze-kol-duzenle');
      muzeKolFormDoldur((STATE.muzeKoleksiyonlar || []).find((k) => k.ad === ad));
      document.getElementById('muze-kol-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const sil = e.target.closest('[data-muze-kol-sil]');
    if (sil) muzeKolSil(sil.getAttribute('data-muze-kol-sil'));
  });

  // Görseller: üzerine gelince önizleme (fare), tıklayınca büyük hali
  gorselYakinlastirmaBagla(bolum);
  gorselYakinlastirmaBagla(document.getElementById('envanter-foto-subview'));
  const gorselDialog = document.getElementById('dialog-muze-gorsel');
  document.getElementById('btn-muze-gorsel-kapat')?.addEventListener('click', () => gorselDialog.close());
  gorselDialog?.addEventListener('click', (e) => {
    if (e.target === gorselDialog) gorselDialog.close();
    else if (e.target.id === 'muze-gorsel-buyuk') gorselDialog.classList.toggle('yakin');
  });

  // Envanter düzenleme penceresinden kısayol
  document.getElementById('btn-envanter-muze')?.addEventListener('click', () => {
    const no = document.getElementById('edit-envanter-no-display')?.textContent || '';
    document.getElementById('dialog-edit-inventory')?.close();
    showSection('sanal-muze-view');
    syncMuze(true).then(() => openMuzeForm(no.trim()));
  });

  // --- Form içi olaylar ---
  const dialog = document.getElementById('dialog-muze-eser');
  document.getElementById('muze-dil-sekmeleri')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-muze-dil]');
    if (btn) muzeDilSec(btn.getAttribute('data-muze-dil'));
  });

  // Alan değişince sekmedeki "dolu" noktası anında güncellensin
  document.getElementById('muze-dil-panelleri')?.addEventListener('input', debounce(() => {
    muzeAktifDiliTopla();
    muzeDilSekmeleriniCiz();
  }, 400));

  document.getElementById('muze-dil-panelleri')?.addEventListener('click', (e) => {
    if (!e.target.closest('#btn-muze-tr-kopyala')) return;
    const tr = _muzeTaslakCeviriler[MUZE_VARSAYILAN_DIL];
    if (!tr) {
      showToast('Önce Türkçe metinleri doldurun.', 'warning');
      return;
    }
    MUZE_ALANLAR.forEach((alan) => {
      const el = document.getElementById('muze-alan-' + alan.kod);
      if (el && !String(el.value || '').trim()) el.value = tr[alan.kod] || '';
    });
    muzeAktifDiliTopla();
    muzeDilSekmeleriniCiz();
    showToast('Türkçe metin kopyalandı — çevirmeyi unutmayın.', 'info');
  });

  document.getElementById('muze-gorsel-izgara')?.addEventListener('change', (e) => {
    const kutu = e.target.closest('[data-muze-gorsel]');
    if (!kutu) return;
    const adres = kutu.getAttribute('data-muze-gorsel');
    if (kutu.checked) {
      if (!_muzeSecilenGorseller.includes(adres)) _muzeSecilenGorseller.push(adres);
    } else {
      _muzeSecilenGorseller = _muzeSecilenGorseller.filter((g) => g !== adres);
    }
    kutu.closest('.muze-gorsel-kutu')?.classList.toggle('secili', kutu.checked);
  });

  document.getElementById('btn-muze-kaydet')?.addEventListener('click', muzeKaydet);
  document.getElementById('btn-muze-sil')?.addEventListener('click', muzeKayitSil);
  document.getElementById('btn-muze-onizle')?.addEventListener('click', muzeOnizle);
  document.getElementById('btn-muze-gorsel-yayinla')?.addEventListener('click', muzeGorselleriYayinla);
  document.getElementById('btn-muze-onizleme-kapat')?.addEventListener('click', () => {
    document.getElementById('muze-onizleme-kutusu').classList.add('hidden');
  });
  ['btn-muze-kapat', 'btn-muze-kapat-carpi'].forEach((id) => {
    document.getElementById(id)?.addEventListener('click', () => dialog?.close());
  });

  // --- API sekmesi olayları ---
  document.getElementById('muze-uc-listesi')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-muze-kopyala]');
    if (!btn) return;
    const adres = btn.getAttribute('data-muze-kopyala');
    try {
      await navigator.clipboard.writeText(adres);
      showToast('Adres panoya kopyalandı.', 'success');
    } catch (err) {
      showToast('Kopyalanamadı: ' + adres, 'warning');
    }
  });

  document.getElementById('muze-anahtar-tbody')?.addEventListener('click', (e) => {
    const durumBtn = e.target.closest('[data-muze-anahtar-durum]');
    if (durumBtn) {
      muzeAnahtarDurumDegistir(durumBtn.getAttribute('data-muze-anahtar-durum'),
        durumBtn.getAttribute('data-aktif') === '1');
      return;
    }
    const silBtn = e.target.closest('[data-muze-anahtar-sil]');
    if (silBtn) muzeAnahtarSil(silBtn.getAttribute('data-muze-anahtar-sil'));
  });

  const anahtarDialog = document.getElementById('dialog-muze-anahtar');
  document.getElementById('btn-muze-anahtar-olustur')?.addEventListener('click', () => {
    document.getElementById('muze-anahtar-ad').value = '';
    document.getElementById('muze-anahtar-deger').textContent = '';
    document.getElementById('muze-anahtar-sonuc').classList.add('hidden');
    document.getElementById('btn-muze-anahtar-uret').classList.remove('hidden');
    anahtarDialog?.showModal();
  });
  document.getElementById('btn-muze-anahtar-uret')?.addEventListener('click', muzeAnahtarUret);
  ['btn-muze-anahtar-kapat', 'btn-muze-anahtar-kapat-carpi'].forEach((id) => {
    document.getElementById(id)?.addEventListener('click', () => anahtarDialog?.close());
  });
  document.getElementById('btn-muze-anahtar-kopyala')?.addEventListener('click', async () => {
    const deger = document.getElementById('muze-anahtar-deger').textContent;
    try {
      await navigator.clipboard.writeText(deger);
      showToast('Anahtar panoya kopyalandı.', 'success');
    } catch (err) {
      showToast('Kopyalanamadı. Metni elle seçip kopyalayın.', 'warning');
    }
  });
}

// ==========================================================================
// E-TİCARET ve LOJİSTİK
// --------------------------------------------------------------------------
// Mağaza modülünün online ayağı. Tezgâh satışından farkı, satışın bir AN değil
// bir SÜREÇ olması: sipariş alınır → hazırlanır → kargolanır → teslim edilir.
// Kanban panosu bu süreci görünür kılar; kart bir sütundan diğerine
// sürüklendiğinde sunucudaki sipariş durumu güncellenir.
//
// Veri, mağaza e-tablosunda (STATE.magazaSheetUrl) tutulur; bu yüzden tüm
// istekler apiMagazaPost üzerinden gider — envanter e-tablosuna dokunulmaz.
// ==========================================================================
const ET_DURUMLAR = ['Yeni Sipariş', 'Hazırlanıyor', 'Kargolandı', 'Teslim Edildi', 'İptal / İade'];
const ET_DURUM_STIL = {
  'Yeni Sipariş':  { ikon: '🆕', sinif: 'yeni' },
  'Hazırlanıyor':  { ikon: '📦', sinif: 'hazirlaniyor' },
  'Kargolandı':    { ikon: '🚚', sinif: 'kargolandi' },
  'Teslim Edildi': { ikon: '✅', sinif: 'teslim' },
  'İptal / İade':  { ikon: '↩️', sinif: 'iptal' }
};
const ET_ODEME_STIL = {
  'Bekliyor': 'badge-warning',
  'Tahsil Edildi': 'badge-success',
  'İade Edildi': 'badge-danger'
};

// Kargo firmalarının hazır istek şablonları. Alan adları firmaların yayımladığı
// servis dokümanlarına göre hazırlanmıştır; SÖZLEŞME SÜRÜMÜNE GÖRE DEĞİŞEBİLİR,
// bu yüzden ayar ekranında düzenlenebilir bırakılmıştır.
const ET_KARGO_SABLONLARI = {
  ptt: {
    protokol: 'soap',
    uc: 'https://obesiparis.ptt.gov.tr/OBEWebServis/OBEWebServis.asmx',
    soapAction: 'http://tempuri.org/KargoGonderiEkle',
    takipDeseni: '<(?:Barkod|BarkodNo|TakipNo)>([^<]+)<',
    sablon: `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <KargoGonderiEkle xmlns="http://tempuri.org/">
      <MusteriKodu>{MUSTERI_KODU}</MusteriKodu>
      <KullaniciAdi>{KULLANICI}</KullaniciAdi>
      <Sifre>{SIFRE}</Sifre>
      <Barkod>{BARKOD}</Barkod>
      <ReferansNo>{SIPARIS_NO}</ReferansNo>
      <AliciAdi>{ALICI_AD}</AliciAdi>
      <AliciTelefon>{ALICI_TEL}</AliciTelefon>
      <AliciIl>{ALICI_IL}</AliciIl>
      <AliciIlce>{ALICI_ILCE}</AliciIlce>
      <AliciAdres>{ALICI_ADRES}</AliciAdres>
      <Icerik>{ICERIK}</Icerik>
      <Adet>{ADET}</Adet>
    </KargoGonderiEkle>
  </soap:Body>
</soap:Envelope>`
  },
  yurtici: {
    protokol: 'soap',
    uc: 'https://webservices.yurticikargo.com:443/KOPSWebServices/ShippingOrderDispatcherServices',
    soapAction: 'createShipment',
    takipDeseni: '<(?:cargoKey|invoiceKey|trackingNumber)>([^<]+)<',
    sablon: `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://service.ecommerce.yurticikargo.com/">
  <soapenv:Body>
    <ser:createShipment>
      <wsUserName>{KULLANICI}</wsUserName>
      <wsPassword>{SIFRE}</wsPassword>
      <userLanguage>TR</userLanguage>
      <ShippingOrderVO>
        <cargoKey>{BARKOD}</cargoKey>
        <invoiceKey>{SIPARIS_NO}</invoiceKey>
        <receiverCustName>{ALICI_AD}</receiverCustName>
        <receiverAddress>{ALICI_ADRES}</receiverAddress>
        <cityName>{ALICI_IL}</cityName>
        <townName>{ALICI_ILCE}</townName>
        <receiverPhone1>{ALICI_TEL}</receiverPhone1>
        <emailAddress>{ALICI_EPOSTA}</emailAddress>
        <cargoCount>{ADET}</cargoCount>
        <ttInvoiceAmount>{TUTAR}</ttInvoiceAmount>
        <description>{ICERIK}</description>
      </ShippingOrderVO>
    </ser:createShipment>
  </soapenv:Body>
</soapenv:Envelope>`
  }
};

let _etKalemler = [];        // sipariş formundaki geçici kalem listesi
let _etAktifSiparis = null;  // detay/kargo penceresinde açık olan sipariş
let _etGorunum = 'kanban';
let _etSyncIslemi = null;

function etYazabilir() {
  return STATE.currentUser &&
    (STATE.currentUser.role === 'admin' || STATE.currentUser.role === 'editor');
}

function etPara(n) {
  const v = parseFloat(n) || 0;
  return v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺';
}

function etTarih(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function etKalemleriCoz(siparis) {
  try {
    const o = JSON.parse(String(siparis['Ürünler (JSON)'] || '[]'));
    return Array.isArray(o) ? o : [];
  } catch (err) {
    return [];
  }
}

function etSiparisBul(siparisNo) {
  return (STATE.eticaret.siparisler || []).find(
    (s) => String(s['Sipariş No']).trim() === String(siparisNo).trim()
  ) || null;
}

function etFirmaKodu(firmaAdi) {
  const f = (STATE.eticaret.kargoFirmalari || []).find((x) => x.ad === firmaAdi);
  return f ? f.kod : '';
}

// --------------------------------------------------------------------------
// Veri eşitleme
// --------------------------------------------------------------------------
async function syncEticaret(sessiz) {
  if (!STATE.magazaSheetUrl) {
    if (!sessiz) showToast('Mağaza Apps Script URL adresi Ayarlar bölümünden tanımlanmalı.', 'warning');
    return null;
  }
  if (_etSyncIslemi) return _etSyncIslemi;
  if (!sessiz) toggleLoading(true, 'Siparişler yükleniyor...');
  _etSyncIslemi = (async () => {
    const res = await apiMagazaPost('get_eticaret_siparisler');
    if (res && res.success) {
      STATE.eticaret.siparisler = res.siparisler || [];
      if (res.kanallar) STATE.eticaret.kanallar = res.kanallar;
      if (res.odemeDurumlari) STATE.eticaret.odemeDurumlari = res.odemeDurumlari;
      if (res.kargoFirmalari) STATE.eticaret.kargoFirmalari = res.kargoFirmalari;
      modulOnbellegeYaz('eticaret');
      etSecenekleriDoldur();
      renderEticaret();
    } else if (!sessiz) {
      showToast('Siparişler alınamadı: ' + ((res && res.error) || ''), 'danger');
    }
    return res;
  })();
  try {
    return await _etSyncIslemi;
  } finally {
    _etSyncIslemi = null;
    if (!sessiz) toggleLoading(false);
  }
}

// Kanal / ödeme / kargo açılır kutuları sunucudan gelen listelerle doldurulur;
// sabit listeler iki yerde tutulmasın diye tek kaynak sunucudur.
function etSecenekleriDoldur() {
  const kanallar = STATE.eticaret.kanallar || [];
  const odemeler = STATE.eticaret.odemeDurumlari || [];
  const firmalar = STATE.eticaret.kargoFirmalari || [];

  const doldur = (id, liste, tumuEtiket) => {
    const el = document.getElementById(id);
    if (!el) return;
    const secili = el.value;
    el.innerHTML = (tumuEtiket ? `<option value="all">${tumuEtiket}</option>` : '') +
      liste.map((v) => {
        const deger = (v && v.kod !== undefined) ? v.kod : v;
        const metin = (v && v.ad !== undefined) ? v.ad : v;
        return `<option value="${escapeHtml(String(deger))}">${escapeHtml(String(metin))}</option>`;
      }).join('');
    if (secili) el.value = secili;
  };

  doldur('et-kanal', kanallar, '');
  doldur('qs-et-kanal', kanallar, '');
  doldur('et-odeme-durumu', odemeler, '');
  doldur('qs-et-odeme-durumu', odemeler, '');
  doldur('et-kargo-firma', firmalar, '');
  doldur('qs-et-kargo-firma', firmalar, '');
  doldur('et-kargo-secim', firmalar, '');
  doldur('et-filtre-kanal', kanallar, 'Tüm Kanallar');
  doldur('et-filtre-odeme', odemeler, 'Tümü');
  doldur('et-filtre-kargo', firmalar.map((f) => f.ad), 'Tüm Firmalar');
}

// --------------------------------------------------------------------------
// Listeleme: Kanban + tablo
// --------------------------------------------------------------------------
function etSuzulmusSiparisler() {
  const arama = (document.getElementById('et-arama')?.value || '').toLowerCase().trim();
  const kanal = document.getElementById('et-filtre-kanal')?.value || 'all';
  const kargo = document.getElementById('et-filtre-kargo')?.value || 'all';
  const odeme = document.getElementById('et-filtre-odeme')?.value || 'all';

  return (STATE.eticaret.siparisler || []).filter((s) => {
    if (kanal !== 'all' && String(s['Kanal']) !== kanal) return false;
    if (kargo !== 'all' && String(s['Kargo Firması']) !== kargo) return false;
    if (odeme !== 'all' && String(s['Ödeme Durumu']) !== odeme) return false;
    if (!arama) return true;
    return ['Sipariş No', 'Müşteri', 'Telefon', 'Takip Kodu', 'Barkod', 'Ürün Özeti', 'İl']
      .some((k) => String(s[k] || '').toLowerCase().includes(arama));
  });
}

function renderEticaret() {
  const kanbanKutu = document.getElementById('et-kanban');
  if (!kanbanKutu) return;

  const hepsi = STATE.eticaret.siparisler || [];
  const suzulmus = etSuzulmusSiparisler();

  // İstatistikler tüm siparişlerden hesaplanır (filtre görünümü daraltır,
  // işletme tablosunu değil).
  const say = (d) => hepsi.filter((s) => String(s['Sipariş Durumu']) === d).length;
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setText('et-stat-yeni', say('Yeni Sipariş') + say('Hazırlanıyor'));
  setText('et-stat-yolda', say('Kargolandı'));
  setText('et-stat-teslim', say('Teslim Edildi'));
  setText('et-stat-tahsilat', etPara(hepsi
    .filter((s) => String(s['Ödeme Durumu']) === 'Bekliyor' && String(s['Sipariş Durumu']) !== 'İptal / İade')
    .reduce((t, s) => t + (parseFloat(s['Toplam Tutar']) || 0), 0)));
  setText('et-sayac', suzulmus.length + ' / ' + hepsi.length + ' sipariş');

  const bos = document.getElementById('et-bos');
  if (bos) bos.classList.toggle('hidden', hepsi.length > 0);

  const tabloKutu = document.getElementById('et-tablo-kutusu');
  kanbanKutu.classList.toggle('hidden', _etGorunum !== 'kanban');
  if (tabloKutu) tabloKutu.classList.toggle('hidden', _etGorunum !== 'tablo');

  if (_etGorunum === 'kanban') etKanbanCiz(suzulmus);
  else etTabloCiz(suzulmus);
}

function etKanbanCiz(siparisler) {
  const kutu = document.getElementById('et-kanban');
  if (!kutu) return;
  const yazabilir = etYazabilir();

  kutu.innerHTML = ET_DURUMLAR.map((durum) => {
    const stil = ET_DURUM_STIL[durum] || { ikon: '•', sinif: 'yeni' };
    const sutunSiparisleri = siparisler.filter((s) => String(s['Sipariş Durumu']) === durum);
    const tutar = sutunSiparisleri.reduce((t, s) => t + (parseFloat(s['Toplam Tutar']) || 0), 0);

    const kartlar = sutunSiparisleri.map((s) => {
      const takip = String(s['Takip Kodu'] || '').trim();
      const odeme = String(s['Ödeme Durumu'] || 'Bekliyor');
      return `
        <div class="et-kart" draggable="${yazabilir}" data-et-siparis="${escapeHtml(String(s['Sipariş No']))}">
          <div class="et-kart-ust">
            <code class="et-kart-no">${escapeHtml(String(s['Sipariş No']))}</code>
            <span class="badge ${ET_ODEME_STIL[odeme] || 'badge-role'}">${escapeHtml(odeme)}</span>
          </div>
          <strong class="et-kart-musteri">${escapeHtml(String(s['Müşteri'] || '—'))}</strong>
          <span class="et-kart-urun">${escapeHtml(String(s['Ürün Özeti'] || '—'))}</span>
          <div class="et-kart-alt">
            <span class="et-kart-tutar">${etPara(s['Toplam Tutar'])}</span>
            <span class="et-kart-tarih">${etTarih(s['Sipariş Tarihi'])}</span>
          </div>
          ${takip
            ? `<div class="et-kart-takip">🚚 ${escapeHtml(String(s['Kargo Firması'] || ''))} · <code>${escapeHtml(takip)}</code></div>`
            : (durum === 'Hazırlanıyor' && yazabilir
                ? `<button type="button" class="btn btn-sm btn-outline-primary et-kart-kargo" data-et-kargo="${escapeHtml(String(s['Sipariş No']))}">🏷️ Kargo Kodu Üret</button>`
                : '')}
        </div>`;
    }).join('');

    return `
      <div class="et-sutun et-sutun--${stil.sinif}" data-et-durum="${escapeHtml(durum)}">
        <div class="et-sutun-baslik">
          <span>${stil.ikon} ${escapeHtml(durum)}</span>
          <span class="et-sutun-sayi">${sutunSiparisleri.length}</span>
        </div>
        <div class="et-sutun-tutar">${etPara(tutar)}</div>
        <div class="et-sutun-govde" data-et-birakma="${escapeHtml(durum)}">
          ${kartlar || '<div class="et-sutun-bos">—</div>'}
        </div>
      </div>`;
  }).join('');

  if (yazabilir) etSurukleBirakKur();
}

function etTabloCiz(siparisler) {
  const tbody = document.getElementById('et-tablo-tbody');
  if (!tbody) return;
  if (!siparisler.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; color:var(--text-muted); padding:1.5rem;">Filtrenize uyan sipariş yok.</td></tr>';
    return;
  }
  tbody.innerHTML = siparisler.map((s) => {
    const durum = String(s['Sipariş Durumu'] || '');
    const stil = ET_DURUM_STIL[durum] || { ikon: '•', sinif: 'yeni' };
    const odeme = String(s['Ödeme Durumu'] || 'Bekliyor');
    const takip = String(s['Takip Kodu'] || '').trim();
    return `
      <tr data-et-siparis="${escapeHtml(String(s['Sipariş No']))}">
        <td data-label="Sipariş No"><code>${escapeHtml(String(s['Sipariş No']))}</code></td>
        <td data-label="Tarih">${etTarih(s['Sipariş Tarihi'])}</td>
        <td data-label="Müşteri"><strong>${escapeHtml(String(s['Müşteri'] || '—'))}</strong><br><small style="color:var(--text-muted);">${escapeHtml(String(s['İl'] || ''))}</small></td>
        <td data-label="Ürünler">${escapeHtml(String(s['Ürün Özeti'] || '—'))}</td>
        <td data-label="Tutar">${etPara(s['Toplam Tutar'])}</td>
        <td data-label="Ödeme"><span class="badge ${ET_ODEME_STIL[odeme] || 'badge-role'}">${escapeHtml(odeme)}</span></td>
        <td data-label="Kargo">${takip ? escapeHtml(String(s['Kargo Firması'] || '')) + '<br><code>' + escapeHtml(takip) + '</code>' : '<span style="color:var(--text-muted);">—</span>'}</td>
        <td data-label="Durum"><span class="et-durum-rozet et-durum-rozet--${stil.sinif}">${stil.ikon} ${escapeHtml(durum)}</span></td>
        <td><button class="btn btn-outline-primary btn-sm" data-et-detay="${escapeHtml(String(s['Sipariş No']))}">İncele</button></td>
      </tr>`;
  }).join('');
}

// --------------------------------------------------------------------------
// Kanban sürükle-bırak
// Kart bir sütuna bırakıldığında yalnızca durum değişir. Sunucu geçersiz
// geçişleri (örn. takip kodu olmadan "Kargolandı") reddeder; o durumda kart
// eski yerine döner çünkü listeyi sunucudan yeniden çizeriz.
// --------------------------------------------------------------------------
function etSurukleBirakKur() {
  const kutu = document.getElementById('et-kanban');
  if (!kutu) return;

  kutu.querySelectorAll('.et-kart').forEach((kart) => {
    kart.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', kart.getAttribute('data-et-siparis'));
      e.dataTransfer.effectAllowed = 'move';
      kart.classList.add('suruklenen');
    });
    kart.addEventListener('dragend', () => kart.classList.remove('suruklenen'));
  });

  kutu.querySelectorAll('[data-et-birakma]').forEach((alan) => {
    alan.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      alan.classList.add('birakma-aktif');
    });
    alan.addEventListener('dragleave', () => alan.classList.remove('birakma-aktif'));
    alan.addEventListener('drop', async (e) => {
      e.preventDefault();
      alan.classList.remove('birakma-aktif');
      const siparisNo = e.dataTransfer.getData('text/plain');
      const yeniDurum = alan.getAttribute('data-et-birakma');
      if (!siparisNo || !yeniDurum) return;
      const siparis = etSiparisBul(siparisNo);
      if (!siparis || String(siparis['Sipariş Durumu']) === yeniDurum) return;
      await etDurumGuncelle(siparisNo, yeniDurum);
    });
  });
}

async function etDurumGuncelle(siparisNo, yeniDurum, ekstra) {
  if (!etYazabilir()) {
    showToast('Sipariş güncelleme yetkiniz yok.', 'warning');
    return false;
  }
  // İptal geri alınması zor bir karardır: stok satışa döner, müşteriye bilgi
  // verilmesi gerekir. Kullanıcı ne yaptığını görerek onaylasın.
  if (yeniDurum === 'İptal / İade') {
    const onay = confirm(
      siparisNo + ' numaralı sipariş "İptal / İade" durumuna alınacak.\n\n' +
      'Siparişteki envanterli ürünler yeniden satışa açılır. Tahsil edilmiş bir ödeme varsa ' +
      'kasa kaydı KENDİLİĞİNDEN geri alınmaz; iade tutarını Giderler bölümünden işlemelisiniz.\n\n' +
      'Devam edilsin mi?'
    );
    if (!onay) { renderEticaret(); return false; }
  }

  const payload = Object.assign({ siparisNo: siparisNo, durum: yeniDurum }, ekstra || {});
  toggleLoading(true, 'Sipariş durumu güncelleniyor...');
  const res = await apiMagazaPost('eticaret_siparis_guncelle', payload);
  toggleLoading(false);

  if (res && res.success) {
    showToast('Sipariş güncellendi: ' + yeniDurum, 'success');
    await syncEticaret(true);
    return true;
  }
  showToast('Güncellenemedi: ' + ((res && res.error) || ''), 'danger');
  // Sunucu reddettiyse kart görsel olarak yanlış sütunda kalmasın.
  renderEticaret();
  return false;
}

// --------------------------------------------------------------------------
// Sipariş formu
// --------------------------------------------------------------------------
function etStokSecenekleriniDoldur() {
  const sel = document.getElementById('et-urun-secim');
  if (!sel) return;
  const satisa = (STATE.magaza.stock || []).filter((u) => {
    const d = String(u.durum || '').toLowerCase();
    return d.indexOf('satıldı') === -1 && d.indexOf('rezerve') === -1;
  });
  sel.innerHTML = '<option value="">Stoktan ürün seçin...</option>' + satisa.map((u) => {
    const fiyat = parseFloat(u.satisFiyati) || 0;
    return `<option value="${escapeHtml(String(u.envanterNo))}" data-row="${u._rowNum}" data-fiyat="${fiyat}" data-ad="${escapeHtml(String(u.eserAdi || ''))}">
      ${escapeHtml(String(u.eserAdi || 'İsimsiz'))} — ${escapeHtml(String(u.envanterNo))} (${etPara(fiyat)})
    </option>`;
  }).join('');
}

function etKalemleriCiz() {
  const kutu = document.getElementById('et-kalem-listesi');
  if (!kutu) return;
  if (!_etKalemler.length) {
    kutu.innerHTML = '<div class="materyal-bos">Henüz kalem eklenmedi.</div>';
  } else {
    kutu.innerHTML = _etKalemler.map((k, i) => `
      <div class="et-kalem">
        <div class="et-kalem-ad">
          <strong>${escapeHtml(k.ad)}</strong>
          ${k.envanterNo ? `<code>${escapeHtml(k.envanterNo)}</code>` : '<span class="et-kalem-serbest">elle</span>'}
        </div>
        <input type="number" class="et-kalem-adet" min="1" value="${k.adet}" data-et-kalem-adet="${i}" title="Adet">
        <input type="number" class="et-kalem-fiyat" min="0" step="0.01" value="${k.birimFiyat}" data-et-kalem-fiyat="${i}" title="Birim fiyat">
        <span class="et-kalem-tutar">${etPara(k.adet * k.birimFiyat)}</span>
        <button type="button" class="btn btn-text btn-sm" data-et-kalem-sil="${i}">🗑️</button>
      </div>`).join('');
  }
  etToplamGuncelle();
}

function etToplamGuncelle() {
  const urun = _etKalemler.reduce((t, k) => t + (k.adet * k.birimFiyat), 0);
  const kargo = parseFloat(document.getElementById('et-kargo-ucret')?.value) || 0;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = etPara(v); };
  set('et-toplam-urun', urun);
  set('et-toplam-kargo', kargo);
  set('et-toplam-genel', urun + kargo);
}

function openEticaretForm() {
  if (!etYazabilir()) {
    showToast('Sipariş oluşturma yetkiniz yok.', 'warning');
    return;
  }
  _etKalemler = [];
  const form = document.getElementById('et-siparis-form');
  if (form) form.reset();
  document.getElementById('et-siparis-no').value = '';
  document.getElementById('et-kargo-ucret').value = '0';
  etSecenekleriDoldur();
  etStokSecenekleriniDoldur();
  etKalemleriCiz();
  document.getElementById('dialog-eticaret-siparis').showModal();
}

async function etSiparisKaydet() {
  const musteri = document.getElementById('et-musteri').value.trim();
  if (!musteri) {
    showToast('Müşteri ad soyad zorunludur.', 'warning');
    return;
  }
  if (!_etKalemler.length) {
    showToast('Siparişe en az bir ürün ekleyin.', 'warning');
    return;
  }
  const kargoFirma = document.getElementById('et-kargo-firma').value;
  const adres = document.getElementById('et-adres').value.trim();
  if (kargoFirma && kargoFirma !== 'elden' && !adres) {
    showToast('Kargolu siparişte teslimat adresi zorunludur.', 'warning');
    return;
  }

  const payload = {
    musteri: musteri,
    telefon: document.getElementById('et-telefon').value.trim(),
    eposta: document.getElementById('et-eposta').value.trim(),
    kanal: document.getElementById('et-kanal').value,
    il: document.getElementById('et-il').value.trim(),
    ilce: document.getElementById('et-ilce').value.trim(),
    adres: adres,
    kalemler: _etKalemler,
    kargoUcreti: parseFloat(document.getElementById('et-kargo-ucret').value) || 0,
    odemeYontemi: document.getElementById('et-odeme-yontemi').value,
    odemeDurumu: document.getElementById('et-odeme-durumu').value,
    kargoFirmasi: kargoFirma,
    notlar: document.getElementById('et-notlar').value.trim()
  };

  toggleLoading(true, 'Sipariş oluşturuluyor...');
  const res = await apiMagazaPost('eticaret_siparis_olustur', payload);
  toggleLoading(false);

  if (res && res.success) {
    showToast(res.message || 'Sipariş oluşturuldu.', 'success');
    document.getElementById('dialog-eticaret-siparis').close();
    await syncEticaret(true);
    await syncMagazaData(true);   // rezerve edilen ürünler stok tablosunda güncellensin
  } else {
    showToast('Sipariş oluşturulamadı: ' + ((res && res.error) || ''), 'danger');
  }
}

// --------------------------------------------------------------------------
// Sipariş detayı
// --------------------------------------------------------------------------
function openEticaretDetay(siparisNo) {
  const s = etSiparisBul(siparisNo);
  if (!s) return;
  _etAktifSiparis = s;

  const kalemler = etKalemleriCoz(s);
  const durum = String(s['Sipariş Durumu'] || '');
  const takip = String(s['Takip Kodu'] || '').trim();
  const yazabilir = etYazabilir();

  let gecmis = [];
  try { gecmis = JSON.parse(String(s['Durum Geçmişi (JSON)'] || '[]')) || []; } catch (err) { gecmis = []; }

  document.getElementById('et-detay-baslik').textContent = 'Sipariş ' + s['Sipariş No'];
  document.getElementById('et-detay-govde').innerHTML = `
    <div class="et-detay-ust">
      <div>
        <strong>${escapeHtml(String(s['Müşteri'] || '—'))}</strong>
        <span>${escapeHtml(String(s['Telefon'] || ''))} ${s['E-posta'] ? '· ' + escapeHtml(String(s['E-posta'])) : ''}</span>
        <span>${escapeHtml([s['İl'], s['İlçe']].filter(Boolean).join(' / '))}</span>
      </div>
      <div class="et-detay-durum">
        <span class="et-durum-rozet et-durum-rozet--${(ET_DURUM_STIL[durum] || {}).sinif || 'yeni'}">
          ${(ET_DURUM_STIL[durum] || {}).ikon || ''} ${escapeHtml(durum)}
        </span>
        <span class="badge ${ET_ODEME_STIL[String(s['Ödeme Durumu'])] || 'badge-role'}">${escapeHtml(String(s['Ödeme Durumu'] || ''))}</span>
      </div>
    </div>

    ${s['Adres'] ? `<div class="et-detay-adres">📍 ${escapeHtml(String(s['Adres']))}</div>` : ''}

    <h3>Kalemler</h3>
    <div class="table-responsive">
      <table class="data-table">
        <thead><tr><th>Ürün</th><th>Envanter No</th><th>Adet</th><th>Birim</th><th>Tutar</th></tr></thead>
        <tbody>
          ${kalemler.map((k) => `<tr>
            <td>${escapeHtml(String(k.ad || ''))}</td>
            <td><code>${escapeHtml(String(k.envanterNo || '—'))}</code></td>
            <td>${k.adet}</td>
            <td>${etPara(k.birimFiyat)}</td>
            <td>${etPara(k.tutar)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="et-toplam-kutusu">
      <div><span>Ürünler</span><strong>${etPara(s['Ürün Tutarı'])}</strong></div>
      <div><span>Kargo</span><strong>${etPara(s['Kargo Ücreti'])}</strong></div>
      <div class="et-toplam-genel"><span>TOPLAM</span><strong>${etPara(s['Toplam Tutar'])}</strong></div>
    </div>

    <hr class="divider">
    <h3>Lojistik</h3>
    <div class="et-lojistik">
      <div><span>Kargo Firması</span><strong>${escapeHtml(String(s['Kargo Firması'] || '—'))}</strong></div>
      <div><span>Takip Kodu</span><strong>${takip ? '<code>' + escapeHtml(takip) + '</code>' : '—'}</strong></div>
      <div><span>Barkod</span><strong>${s['Barkod'] ? '<code>' + escapeHtml(String(s['Barkod'])) + '</code>' : '—'}</strong></div>
      <div><span>Kargoya Veriliş</span><strong>${etTarih(s['Kargoya Veriliş'])}</strong></div>
      <div><span>Teslim</span><strong>${etTarih(s['Teslim Tarihi'])}</strong></div>
      <div><span>Ödeme Yöntemi</span><strong>${escapeHtml(String(s['Ödeme Yöntemi'] || '—'))}</strong></div>
    </div>
    ${s['Takip Linki'] ? `<button type="button" class="btn btn-secondary btn-sm" data-external-url="${escapeHtml(String(s['Takip Linki']))}">🔗 Kargo Takip Sayfasını Aç</button>` : ''}

    ${yazabilir ? `
    <hr class="divider">
    <h3>İşlemler</h3>
    <div class="et-detay-islem">
      <div class="form-group">
        <label for="et-detay-durum">Sipariş Durumu</label>
        <select id="et-detay-durum" class="form-control">
          ${ET_DURUMLAR.map((d) => `<option value="${escapeHtml(d)}" ${d === durum ? 'selected' : ''}>${escapeHtml(d)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label for="et-detay-odeme">Ödeme Durumu</label>
        <select id="et-detay-odeme" class="form-control">
          ${(STATE.eticaret.odemeDurumlari || []).map((o) => `<option value="${escapeHtml(o)}" ${o === String(s['Ödeme Durumu']) ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group et-detay-tam">
        <label for="et-detay-notlar">Notlar</label>
        <input type="text" id="et-detay-notlar" value="${escapeHtml(String(s['Notlar'] || ''))}">
      </div>
      <div class="et-detay-butonlar">
        <button type="button" class="btn btn-secondary btn-sm" id="btn-et-detay-kargo">🚚 Kargo Kodu Üret / Görüntüle</button>
        <button type="button" class="btn btn-primary btn-sm" id="btn-et-detay-uygula">💾 Değişiklikleri Uygula</button>
      </div>
    </div>` : ''}

    ${gecmis.length ? `
    <hr class="divider">
    <h3>Süreç Geçmişi</h3>
    <ul class="et-gecmis">
      ${gecmis.slice().reverse().map((g) => `<li>
        <span class="et-gecmis-tarih">${etTarih(g.tarih)}</span>
        <strong>${escapeHtml(String(g.durum || ''))}</strong>
        <span class="et-gecmis-not">${escapeHtml(String(g.not || ''))}</span>
        <span class="et-gecmis-kul">${escapeHtml(String(g.kullanici || ''))}</span>
      </li>`).join('')}
    </ul>` : ''}
  `;

  const silBtn = document.getElementById('btn-et-sil');
  if (silBtn) silBtn.classList.toggle('hidden', !STATE.currentUser || STATE.currentUser.role !== 'admin');
  const etiketBtn = document.getElementById('btn-et-etiket');
  if (etiketBtn) etiketBtn.classList.toggle('hidden', !takip);

  document.getElementById('btn-et-detay-uygula')?.addEventListener('click', async () => {
    const yeniDurum = document.getElementById('et-detay-durum').value;
    const yeniOdeme = document.getElementById('et-detay-odeme').value;
    const notlar = document.getElementById('et-detay-notlar').value.trim();
    const payload = { siparisNo: s['Sipariş No'], odemeDurumu: yeniOdeme, notlar: notlar };
    if (yeniDurum !== durum) payload.durum = yeniDurum;

    if (yeniDurum === 'İptal / İade' && yeniDurum !== durum) {
      const ok = await etDurumGuncelle(s['Sipariş No'], yeniDurum, { odemeDurumu: yeniOdeme, notlar: notlar });
      if (ok) document.getElementById('dialog-eticaret-detay').close();
      return;
    }

    toggleLoading(true, 'Sipariş güncelleniyor...');
    const res = await apiMagazaPost('eticaret_siparis_guncelle', payload);
    toggleLoading(false);
    if (res && res.success) {
      showToast(res.message || 'Sipariş güncellendi.', 'success');
      document.getElementById('dialog-eticaret-detay').close();
      await syncEticaret(true);
    } else {
      showToast('Güncellenemedi: ' + ((res && res.error) || ''), 'danger');
    }
  });

  document.getElementById('btn-et-detay-kargo')?.addEventListener('click', () => {
    document.getElementById('dialog-eticaret-detay').close();
    openEticaretKargo(s['Sipariş No']);
  });

  document.getElementById('dialog-eticaret-detay').showModal();
}

// --------------------------------------------------------------------------
// Kargo barkodu / takip kodu
// --------------------------------------------------------------------------
function openEticaretKargo(siparisNo) {
  const s = etSiparisBul(siparisNo);
  if (!s) return;
  _etAktifSiparis = s;

  etSecenekleriDoldur();
  document.getElementById('et-kargo-siparis-bilgi').textContent =
    s['Sipariş No'] + ' · ' + (s['Müşteri'] || '') + ' · ' + etPara(s['Toplam Tutar']);

  const secim = document.getElementById('et-kargo-secim');
  const mevcutKod = etFirmaKodu(String(s['Kargo Firması'] || ''));
  if (secim && mevcutKod) secim.value = mevcutKod;

  document.getElementById('et-kargo-yenile').checked = false;
  const sonuc = document.getElementById('et-kargo-sonuc');

  if (String(s['Takip Kodu'] || '').trim()) {
    etKargoSonucGoster({
      kaynak: 'mevcut',
      takipKodu: String(s['Takip Kodu']),
      barkod: String(s['Barkod'] || ''),
      takipLinki: String(s['Takip Linki'] || '')
    });
  } else if (sonuc) {
    sonuc.classList.add('hidden');
  }

  document.getElementById('dialog-eticaret-kargo').showModal();
}

function etKargoSonucGoster(veri) {
  const kutu = document.getElementById('et-kargo-sonuc');
  if (!kutu) return;
  kutu.classList.remove('hidden');
  kutu.dataset.takip = veri.takipKodu || '';
  kutu.dataset.link = veri.takipLinki || '';

  const kaynakEl = document.getElementById('et-kargo-kaynak');
  if (kaynakEl) {
    if (veri.kaynak === 'api') {
      kaynakEl.className = 'et-kargo-kaynak et-kaynak-api';
      kaynakEl.textContent = '✅ Kargo firmasının sisteminden alınan gerçek takip numarası.';
    } else if (veri.kaynak === 'mevcut') {
      kaynakEl.className = 'et-kargo-kaynak et-kaynak-mevcut';
      kaynakEl.textContent = 'ℹ️ Bu sipariş için daha önce üretilmiş kod.';
    } else {
      kaynakEl.className = 'et-kargo-kaynak et-kaynak-dahili';
      kaynakEl.textContent = '⚠️ Kurum içi barkod (mod-10 kontrol haneli). Kargo firması entegrasyonu ' +
        'tanımlandığında gerçek takip numarasıyla değiştirilmelidir.' + (veri.uyari ? ' Servis hatası: ' + veri.uyari : '');
    }
  }

  document.getElementById('et-barkod-kod').textContent = veri.takipKodu || '—';
  document.getElementById('et-barkod-barkod').textContent = veri.barkod || '—';

  const qrEl = document.getElementById('et-barkod-qr');
  if (qrEl) {
    // Barkod okuyucular QR'ı da okur; ayrı bir Code128 kütüphanesi paketlemek
    // yerine zaten pakette olan qrcode-generator kullanılır.
    const veriMetni = veri.takipLinki || veri.takipKodu || '';
    const url = veriMetni ? sertifikaQrDataUrl(veriMetni) : '';
    if (url) { qrEl.src = url; qrEl.classList.remove('hidden'); }
    else { qrEl.classList.add('hidden'); }
  }

  const takipBtn = document.getElementById('btn-et-takip-ac');
  if (takipBtn) takipBtn.classList.toggle('hidden', !veri.takipLinki);
}

async function etKargoKoduUret() {
  if (!_etAktifSiparis) return;
  if (!etYazabilir()) {
    showToast('Kargo kaydı açma yetkiniz yok.', 'warning');
    return;
  }
  const firmaKod = document.getElementById('et-kargo-secim').value;
  if (!firmaKod) {
    showToast('Kargo firması seçin.', 'warning');
    return;
  }
  const yenile = document.getElementById('et-kargo-yenile').checked;
  if (yenile) {
    const onay = confirm(
      'Mevcut takip kodu geçersiz sayılıp yeni bir gönderi kaydı açılacak.\n\n' +
      'Kargo firmasında iki ayrı gönderi oluşabilir; eskisini firmadan iptal ettirmeniz gerekir.\n\n' +
      'Devam edilsin mi?'
    );
    if (!onay) return;
  }

  toggleLoading(true, 'Kargo kaydı açılıyor...');
  const res = await apiMagazaPost('eticaret_kargo_olustur', {
    siparisNo: _etAktifSiparis['Sipariş No'],
    kargoFirmasi: firmaKod,
    yenile: yenile
  });
  toggleLoading(false);

  if (res && res.success) {
    etKargoSonucGoster(res);
    showToast(res.message || 'Kod üretildi.', res.uyari ? 'warning' : 'success');
    if (res.uyari) console.warn('Kargo servisi uyarısı:', res.uyari);
    await syncEticaret(true);
    _etAktifSiparis = etSiparisBul(_etAktifSiparis['Sipariş No']) || _etAktifSiparis;
  } else {
    showToast('Kod üretilemedi: ' + ((res && res.error) || ''), 'danger');
  }
}

// Kargo etiketi: 100x150 mm termal etiket boyutunda PDF üretir.
async function etEtiketYazdir(siparis) {
  const s = siparis || _etAktifSiparis;
  if (!s) return;
  const takip = String(s['Takip Kodu'] || '').trim();
  if (!takip) {
    showToast('Önce kargo kodu üretin.', 'warning');
    return;
  }
  // PDF motoru istek üzerine yüklenir (açılışı yavaşlatmasın diye).
  if (!(await pdfMotoruHazirla())) return;

  const qr = sertifikaQrDataUrl(String(s['Takip Linki'] || takip));
  const kalemler = etKalemleriCoz(s);

  const kutu = document.createElement('div');
  kutu.style.width = '100mm';
  kutu.style.background = '#ffffff';
  kutu.style.color = '#000000';
  kutu.style.fontFamily = 'Arial, Helvetica, sans-serif';
  kutu.innerHTML = `
    <div style="padding:6mm; border:1.5px solid #000; box-sizing:border-box;">
      <div style="text-align:center; border-bottom:1.5px solid #000; padding-bottom:3mm; margin-bottom:3mm;">
        <div style="font-size:11pt; font-weight:bold; letter-spacing:0.5px;">EDİRNE OLGUNLAŞMA ENSTİTÜSÜ</div>
        <div style="font-size:8pt;">Gönderici · Edirne / Merkez</div>
      </div>
      <div style="font-size:8pt; text-transform:uppercase; letter-spacing:1px; color:#555;">Alıcı</div>
      <div style="font-size:12pt; font-weight:bold; margin-bottom:1mm;">${escapeHtml(String(s['Müşteri'] || ''))}</div>
      <div style="font-size:9pt; line-height:1.45;">${escapeHtml(String(s['Adres'] || ''))}</div>
      <div style="font-size:9pt; font-weight:bold; margin-top:1mm;">
        ${escapeHtml([s['İlçe'], s['İl']].filter(Boolean).join(' / '))}
      </div>
      <div style="font-size:9pt; margin-top:1mm;">Tel: ${escapeHtml(String(s['Telefon'] || '—'))}</div>

      <div style="margin-top:4mm; padding-top:3mm; border-top:1px dashed #000; text-align:center;">
        ${qr ? `<img src="${qr}" style="width:34mm; height:34mm;">` : ''}
        <div style="font-size:14pt; font-weight:bold; letter-spacing:2px; margin-top:1.5mm;">${escapeHtml(takip)}</div>
        <div style="font-size:9pt;">${escapeHtml(String(s['Kargo Firması'] || ''))}</div>
      </div>

      <div style="margin-top:3mm; padding-top:2mm; border-top:1px dashed #000; font-size:8pt; line-height:1.5;">
        <div><b>Sipariş:</b> ${escapeHtml(String(s['Sipariş No']))} · ${etTarih(s['Sipariş Tarihi'])}</div>
        <div><b>İçerik:</b> ${escapeHtml(String(s['Ürün Özeti'] || ''))} (${kalemler.length} kalem)</div>
        <div><b>Ödeme:</b> ${escapeHtml(String(s['Ödeme Yöntemi'] || ''))} — ${escapeHtml(String(s['Ödeme Durumu'] || ''))}</div>
        ${String(s['Ödeme Durumu']) !== 'Tahsil Edildi'
          ? `<div style="margin-top:1.5mm; font-size:11pt; font-weight:bold; text-align:center; border:1.5px solid #000; padding:1.5mm;">TAHSİLATLI · ${etPara(s['Toplam Tutar'])}</div>`
          : ''}
      </div>
    </div>`;

  showToast('Kargo etiketi hazırlanıyor...', 'info');
  html2pdf().set({
    margin: 0,
    filename: 'Kargo_Etiketi_' + String(s['Sipariş No']).replace(/[^\w-]/g, '_') + '.pdf',
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 3, useCORS: true, logging: false, backgroundColor: '#ffffff' },
    jsPDF: { unit: 'mm', format: [100, 150], orientation: 'portrait' }
  }).from(kutu).save()
    .then(() => showToast('Kargo etiketi indirildi.', 'success'))
    .catch((err) => showToast('Etiket oluşturulamadı: ' + err.message, 'danger'));
}

function etCsvIndir() {
  const siparisler = etSuzulmusSiparisler();
  if (!siparisler.length) {
    showToast('Dışa aktarılacak sipariş yok.', 'warning');
    return;
  }
  const sutunlar = ['Sipariş No', 'Sipariş Tarihi', 'Kanal', 'Müşteri', 'Telefon', 'İl', 'İlçe',
    'Ürün Özeti', 'Ürün Tutarı', 'Kargo Ücreti', 'Toplam Tutar', 'Ödeme Yöntemi',
    'Ödeme Durumu', 'Sipariş Durumu', 'Kargo Firması', 'Takip Kodu'];
  const kacis = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const csv = [sutunlar.map(kacis).join(';')]
    .concat(siparisler.map((s) => sutunlar.map((k) => kacis(s[k])).join(';')))
    .join('\r\n');

  // Excel'in Türkçe karakterleri doğru okuması için BOM eklenir.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'eticaret_siparisleri_' + new Date().toISOString().split('T')[0] + '.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  showToast(siparisler.length + ' sipariş CSV olarak indirildi.', 'success');
}

// --------------------------------------------------------------------------
// Kargo entegrasyon ayarları (yalnızca yönetici)
// --------------------------------------------------------------------------
async function renderKargoAyarlari() {
  const kutu = document.getElementById('et-ayar-listesi');
  if (!kutu) return;
  if (!STATE.currentUser || STATE.currentUser.role !== 'admin') return;

  const res = await apiMagazaPost('eticaret_kargo_ayarlari');
  if (!res || !res.success) {
    kutu.innerHTML = `<div class="materyal-bos">Ayarlar okunamadı: ${escapeHtml((res && res.error) || '')}</div>`;
    return;
  }
  STATE.eticaret.kargoAyarlari = res.ayarlar || [];
  kutu.innerHTML = STATE.eticaret.kargoAyarlari.map((a) => `
    <div class="et-ayar-satiri">
      <div class="et-ayar-ad">
        <strong>${escapeHtml(a.ad)}</strong>
        <span class="badge ${a.aktif ? 'badge-success' : 'badge-role'}">${a.aktif ? 'Canlı entegrasyon' : 'Kurum içi barkod'}</span>
      </div>
      <span class="et-ayar-uc">${a.uc ? escapeHtml(a.uc) : 'Servis adresi tanımsız'}</span>
      <button class="btn btn-secondary btn-sm" data-kargo-ayar="${escapeHtml(a.firmaKod)}">⚙️ Yapılandır</button>
    </div>`).join('');
}

function openKargoAyar(firmaKod) {
  const a = (STATE.eticaret.kargoAyarlari || []).find((x) => x.firmaKod === firmaKod);
  if (!a) return;
  document.getElementById('kargo-ayar-firma').value = firmaKod;
  document.getElementById('kargo-ayar-baslik').textContent = a.ad + ' Entegrasyonu';
  document.getElementById('kargo-ayar-aktif').checked = !!a.aktif;
  document.getElementById('kargo-ayar-protokol').value = a.protokol || 'soap';
  document.getElementById('kargo-ayar-uc').value = a.uc || '';
  document.getElementById('kargo-ayar-musteri').value = a.musteriKodu || '';
  document.getElementById('kargo-ayar-kullanici').value = a.kullanici || '';
  document.getElementById('kargo-ayar-sifre').value = '';
  document.getElementById('kargo-ayar-sifre-durum').textContent = a.sifreTanimli ? '(tanımlı — değiştirmek için yazın)' : '(tanımsız)';
  document.getElementById('kargo-ayar-soapaction').value = a.soapAction || '';
  document.getElementById('kargo-ayar-sablon').value = a.sablon || '';
  document.getElementById('kargo-ayar-takipyolu').value = a.takipYolu || '';
  document.getElementById('kargo-ayar-takipdeseni').value = a.takipDeseni || '';
  document.getElementById('dialog-kargo-ayar').showModal();
}

function kargoHazirSablonYukle() {
  const firmaKod = document.getElementById('kargo-ayar-firma').value;
  const sablon = ET_KARGO_SABLONLARI[firmaKod];
  if (!sablon) {
    showToast('Bu firma için hazır şablon yok; servis dokümanınızdaki gövdeyi yapıştırın.', 'info');
    return;
  }
  document.getElementById('kargo-ayar-protokol').value = sablon.protokol;
  document.getElementById('kargo-ayar-uc').value = sablon.uc;
  document.getElementById('kargo-ayar-soapaction').value = sablon.soapAction || '';
  document.getElementById('kargo-ayar-takipdeseni').value = sablon.takipDeseni || '';
  document.getElementById('kargo-ayar-sablon').value = sablon.sablon;
  showToast('Hazır şablon yüklendi. Alan adlarını kendi servis dokümanınızla doğrulayın.', 'warning');
}

async function kargoAyarKaydet() {
  const payload = {
    firmaKod: document.getElementById('kargo-ayar-firma').value,
    aktif: document.getElementById('kargo-ayar-aktif').checked,
    protokol: document.getElementById('kargo-ayar-protokol').value,
    uc: document.getElementById('kargo-ayar-uc').value.trim(),
    musteriKodu: document.getElementById('kargo-ayar-musteri').value.trim(),
    kullanici: document.getElementById('kargo-ayar-kullanici').value.trim(),
    sifre: document.getElementById('kargo-ayar-sifre').value,
    sablon: document.getElementById('kargo-ayar-sablon').value,
    soapAction: document.getElementById('kargo-ayar-soapaction').value.trim(),
    takipYolu: document.getElementById('kargo-ayar-takipyolu').value.trim(),
    takipDeseni: document.getElementById('kargo-ayar-takipdeseni').value.trim()
  };
  toggleLoading(true, 'Kargo ayarları kaydediliyor...');
  const res = await apiMagazaPost('eticaret_kargo_ayar_kaydet', payload);
  toggleLoading(false);
  if (res && res.success) {
    showToast(res.message || 'Kaydedildi.', 'success');
    document.getElementById('dialog-kargo-ayar').close();
    renderKargoAyarlari();
  } else {
    showToast('Kaydedilemedi: ' + ((res && res.error) || ''), 'danger');
  }
}

async function kargoBaglantiSina() {
  const firmaKod = document.getElementById('kargo-ayar-firma').value;
  toggleLoading(true, 'Servis adresi sınanıyor...');
  const res = await apiMagazaPost('eticaret_kargo_test', { firmaKod: firmaKod });
  toggleLoading(false);
  if (res && res.success) {
    showToast(res.message, 'success');
    console.info('Kargo servisi yanıt önizlemesi:', res.onizleme);
  } else {
    showToast('Sınama başarısız: ' + ((res && res.error) || ''), 'danger');
  }
}

// --------------------------------------------------------------------------
// Hızlı Satış ekranından e-ticaret siparişi
// --------------------------------------------------------------------------
async function etHizliSiparisKaydet(secilenUrun, adet, birimFiyat) {
  const musteri = document.getElementById('qs-et-musteri').value.trim();
  const adres = document.getElementById('qs-et-adres').value.trim();
  const kargoFirma = document.getElementById('qs-et-kargo-firma').value;

  if (!musteri) {
    showToast('Müşteri ad soyad zorunludur.', 'warning');
    return false;
  }
  if (kargoFirma !== 'elden' && !adres) {
    showToast('Kargolu siparişte teslimat adresi zorunludur.', 'warning');
    return false;
  }

  const payload = {
    musteri: musteri,
    telefon: document.getElementById('qs-et-telefon').value.trim(),
    kanal: document.getElementById('qs-et-kanal').value,
    il: document.getElementById('qs-et-il').value.trim(),
    ilce: document.getElementById('qs-et-ilce').value.trim(),
    adres: adres,
    kargoUcreti: parseFloat(document.getElementById('qs-et-kargo-ucret').value) || 0,
    odemeDurumu: document.getElementById('qs-et-odeme-durumu').value,
    odemeYontemi: 'Havale / EFT',
    kargoFirmasi: kargoFirma,
    kalemler: [{
      envanterNo: secilenUrun.envanterNo || '',
      rowNum: secilenUrun.rowNum || 0,
      ad: secilenUrun.ad,
      adet: adet,
      birimFiyat: birimFiyat
    }]
  };

  toggleLoading(true, 'Sipariş oluşturuluyor...');
  const res = await apiMagazaPost('eticaret_siparis_olustur', payload);
  toggleLoading(false);

  if (res && res.success) {
    showToast(res.message || 'Sipariş oluşturuldu.', 'success');
    await syncEticaret(true);
    await syncMagazaData(true);
    return true;
  }
  showToast('Sipariş oluşturulamadı: ' + ((res && res.error) || ''), 'danger');
  return false;
}

// --------------------------------------------------------------------------
// Kurulum
// --------------------------------------------------------------------------
function initEticaret() {
  const bolum = document.getElementById('magaza-eticaret-tab');
  if (!bolum) return;

  // Görünüm anahtarı
  bolum.querySelectorAll('[data-et-gorunum]').forEach((btn) => {
    btn.addEventListener('click', () => {
      bolum.querySelectorAll('[data-et-gorunum]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      _etGorunum = btn.getAttribute('data-et-gorunum');
      renderEticaret();
    });
  });

  ['et-arama', 'et-filtre-kanal', 'et-filtre-kargo', 'et-filtre-odeme'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change',
      el.tagName === 'INPUT' ? debounce(renderEticaret, 150) : renderEticaret);
  });

  document.getElementById('btn-et-yenile')?.addEventListener('click', () => syncEticaret(false));
  document.getElementById('btn-et-csv')?.addEventListener('click', etCsvIndir);
  document.getElementById('btn-et-yeni')?.addEventListener('click', openEticaretForm);

  // Kanban / tablo üzerindeki tıklamalar (delege)
  document.getElementById('et-kanban')?.addEventListener('click', (e) => {
    const kargoBtn = e.target.closest('[data-et-kargo]');
    if (kargoBtn) {
      e.stopPropagation();
      openEticaretKargo(kargoBtn.getAttribute('data-et-kargo'));
      return;
    }
    const kart = e.target.closest('[data-et-siparis]');
    if (kart) openEticaretDetay(kart.getAttribute('data-et-siparis'));
  });
  document.getElementById('et-tablo-tbody')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-et-detay]');
    if (btn) openEticaretDetay(btn.getAttribute('data-et-detay'));
  });

  // --- Sipariş formu ---
  document.getElementById('btn-et-kalem-ekle')?.addEventListener('click', () => {
    const sel = document.getElementById('et-urun-secim');
    const opt = sel.options[sel.selectedIndex];
    if (!sel.value || !opt) {
      showToast('Önce stoktan bir ürün seçin.', 'warning');
      return;
    }
    if (_etKalemler.some((k) => k.envanterNo === sel.value)) {
      showToast('Bu ürün siparişte zaten var.', 'warning');
      return;
    }
    _etKalemler.push({
      envanterNo: sel.value,
      rowNum: parseInt(opt.dataset.row, 10) || 0,
      ad: opt.dataset.ad || sel.value,
      adet: 1,
      birimFiyat: parseFloat(opt.dataset.fiyat) || 0
    });
    sel.value = '';
    etKalemleriCiz();
  });

  document.getElementById('btn-et-serbest-kalem')?.addEventListener('click', () => {
    const ad = prompt('Kalem adı (örn: Hediye paketi, katalog):');
    if (!ad || !ad.trim()) return;
    const fiyat = parseFloat(prompt('Birim fiyat (₺):', '0'));
    _etKalemler.push({
      envanterNo: '', rowNum: 0, ad: ad.trim(),
      adet: 1, birimFiyat: isNaN(fiyat) || fiyat < 0 ? 0 : fiyat
    });
    etKalemleriCiz();
  });

  document.getElementById('et-kalem-listesi')?.addEventListener('input', (e) => {
    const adetEl = e.target.closest('[data-et-kalem-adet]');
    if (adetEl) {
      const i = parseInt(adetEl.getAttribute('data-et-kalem-adet'), 10);
      let v = parseInt(adetEl.value, 10);
      if (isNaN(v) || v < 1) v = 1;
      _etKalemler[i].adet = v;
      etKalemleriCiz();
      return;
    }
    const fiyatEl = e.target.closest('[data-et-kalem-fiyat]');
    if (fiyatEl) {
      const i = parseInt(fiyatEl.getAttribute('data-et-kalem-fiyat'), 10);
      let v = parseFloat(fiyatEl.value);
      if (isNaN(v) || v < 0) v = 0;
      _etKalemler[i].birimFiyat = v;
      etToplamGuncelle();
    }
  });

  document.getElementById('et-kalem-listesi')?.addEventListener('click', (e) => {
    const silBtn = e.target.closest('[data-et-kalem-sil]');
    if (!silBtn) return;
    _etKalemler.splice(parseInt(silBtn.getAttribute('data-et-kalem-sil'), 10), 1);
    etKalemleriCiz();
  });

  document.getElementById('et-kargo-ucret')?.addEventListener('input', etToplamGuncelle);
  document.getElementById('btn-et-kaydet')?.addEventListener('click', etSiparisKaydet);
  ['btn-et-kapat', 'btn-et-kapat-carpi'].forEach((id) => {
    document.getElementById(id)?.addEventListener('click',
      () => document.getElementById('dialog-eticaret-siparis').close());
  });

  // --- Detay penceresi ---
  ['btn-et-detay-kapat', 'btn-et-detay-kapat-carpi'].forEach((id) => {
    document.getElementById(id)?.addEventListener('click',
      () => document.getElementById('dialog-eticaret-detay').close());
  });
  document.getElementById('btn-et-etiket')?.addEventListener('click', () => etEtiketYazdir(_etAktifSiparis));
  document.getElementById('btn-et-sil')?.addEventListener('click', async () => {
    if (!_etAktifSiparis) return;
    const onay = confirm(
      _etAktifSiparis['Sipariş No'] + ' numaralı sipariş kalıcı olarak silinecek.\n\n' +
      'Rezerve edilen ürünler satışa döner. Kasa kaydı olan siparişler silinemez; ' +
      'onlar için "İptal / İade" durumunu kullanın.\n\nDevam edilsin mi?'
    );
    if (!onay) return;
    toggleLoading(true, 'Sipariş siliniyor...');
    const res = await apiMagazaPost('eticaret_siparis_sil', { siparisNo: _etAktifSiparis['Sipariş No'] });
    toggleLoading(false);
    if (res && res.success) {
      showToast(res.message || 'Sipariş silindi.', 'success');
      document.getElementById('dialog-eticaret-detay').close();
      await syncEticaret(true);
      await syncMagazaData(true);
    } else {
      showToast('Silinemedi: ' + ((res && res.error) || ''), 'danger');
    }
  });

  // --- Kargo penceresi ---
  document.getElementById('btn-et-kargo-uret')?.addEventListener('click', etKargoKoduUret);
  ['btn-et-kargo-kapat', 'btn-et-kargo-kapat-carpi'].forEach((id) => {
    document.getElementById(id)?.addEventListener('click',
      () => document.getElementById('dialog-eticaret-kargo').close());
  });
  document.getElementById('btn-et-kod-kopyala')?.addEventListener('click', async () => {
    const kod = document.getElementById('et-kargo-sonuc').dataset.takip || '';
    try {
      await navigator.clipboard.writeText(kod);
      showToast('Takip kodu panoya kopyalandı.', 'success');
    } catch (err) {
      showToast('Kopyalanamadı: ' + kod, 'warning');
    }
  });
  document.getElementById('btn-et-takip-ac')?.addEventListener('click', () => {
    const link = document.getElementById('et-kargo-sonuc').dataset.link || '';
    if (link) openExternal(link);
  });
  document.getElementById('btn-et-etiket-yazdir')?.addEventListener('click', () => etEtiketYazdir(_etAktifSiparis));

  // --- Kargo ayarları ---
  document.getElementById('btn-et-ayar-yenile')?.addEventListener('click', renderKargoAyarlari);
  document.getElementById('et-ayar-listesi')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-kargo-ayar]');
    if (btn) openKargoAyar(btn.getAttribute('data-kargo-ayar'));
  });
  document.getElementById('btn-kargo-ayar-sablon')?.addEventListener('click', kargoHazirSablonYukle);
  document.getElementById('btn-kargo-ayar-test')?.addEventListener('click', kargoBaglantiSina);
  document.getElementById('btn-kargo-ayar-kaydet')?.addEventListener('click', kargoAyarKaydet);
  ['btn-kargo-ayar-kapat', 'btn-kargo-ayar-kapat-carpi'].forEach((id) => {
    document.getElementById(id)?.addEventListener('click',
      () => document.getElementById('dialog-kargo-ayar').close());
  });
}

// ==========================================================================
// SÜRDÜRÜLEBİLİRLİK ve KAYNAK TAKİBİ (Sıfır Atık)
// --------------------------------------------------------------------------
// Atölyelerin hammadde tüketimi, firesi ve geri kazanımı kaydedilir; bundan
// üretim verimliliği ve tahmini karbon ayak izi çıkarılır.
//
// HESAPLAMA NEREDE YAPILIR: Sunucuda (google-apps-script.js → suAnalizYap).
// Arayüz yalnızca çizer. Böylece rapor ekranı, PDF çıktısı ve ileride
// eklenecek e-posta özeti aynı sayıyı gösterir; iki yerde iki farklı
// "verimlilik" tanımı oluşmaz. Formdaki canlı önizleme bunun tek istisnasıdır
// ve kaydetmeden önce fikir vermek içindir — kaydedilen değer sunucununkidir.
// ==========================================================================

let _suSyncIslemi = null;
let _suFiltre = { atolye: '', baslangic: '', bitis: '' };

function suYazabilir() {
  return STATE.currentUser &&
    (STATE.currentUser.role === 'admin' || STATE.currentUser.role === 'editor');
}

function suSayi(v) {
  const n = parseFloat(String(v == null ? '' : v).replace(',', '.'));
  return (isNaN(n) || n < 0) ? 0 : n;
}

function suOran(v) {
  return (Math.round((parseFloat(v) || 0) * 10) / 10).toLocaleString('tr-TR') + '%';
}

function suMiktar(v, birim) {
  const n = parseFloat(v) || 0;
  return n.toLocaleString('tr-TR', { maximumFractionDigits: 2 }) + (birim ? ' ' + birim : '');
}

// --------------------------------------------------------------------------
// Veri
// --------------------------------------------------------------------------
async function syncSurdurulebilirlik(sessiz, filtre) {
  if (_suSyncIslemi) return _suSyncIslemi;
  if (!sessiz) toggleLoading(true, 'Kaynak takibi verileri yükleniyor...');
  _suSyncIslemi = (async () => {
    const res = await apiPost('get_surdurulebilirlik', filtre || {});
    if (res && res.success) {
      STATE.surdurulebilirlik.kayitlar = res.kayitlar || [];
      STATE.surdurulebilirlik.analiz = res.analiz || null;
      STATE.surdurulebilirlik.faktorler = res.faktorler || null;
      STATE.surdurulebilirlik.secenekler = res.secenekler || null;
      modulOnbellegeYaz('surdurulebilirlik');
      suSecenekleriDoldur();
      renderSurdurulebilirlik();
      renderSurdurulebilirlikRapor();
    } else if (!sessiz) {
      showToast('Kaynak takibi verileri alınamadı: ' + ((res && res.error) || ''), 'danger');
    }
    return res;
  })();
  try {
    return await _suSyncIslemi;
  } finally {
    _suSyncIslemi = null;
    if (!sessiz) toggleLoading(false);
  }
}

// Açılır kutular sunucudan gelen listelerle doldurulur; hammadde adları
// emisyon katsayı tablosunun anahtarlarıdır, iki yerde ayrı liste tutulmaz.
function suSecenekleriDoldur() {
  const sec = STATE.surdurulebilirlik.secenekler;
  if (!sec) return;

  const doldur = (id, liste, degerAl, metinAl) => {
    const el = document.getElementById(id);
    if (!el) return;
    const secili = el.value;
    el.innerHTML = liste.map((v) => {
      const d = degerAl ? degerAl(v) : v;
      const m = metinAl ? metinAl(v) : v;
      return `<option value="${escapeHtml(String(d))}">${escapeHtml(String(m))}</option>`;
    }).join('');
    if (secili) el.value = secili;
  };

  doldur('su-hammadde', sec.hammaddeler);
  doldur('su-birim', sec.birimler, (b) => b.kod, (b) => b.ad);
  doldur('su-bertaraf', sec.bertarafYontemleri);

  // Atölye önerileri personel kadrosundan + mevcut kayıtlardan
  const atolyeler = new Set();
  (STATE.personnel && STATE.personnel.length ? STATE.personnel : DEFAULT_PERSONNEL)
    .forEach((p) => { const a = p['Alan / Dal']; if (a) atolyeler.add(String(a).trim()); });
  (STATE.surdurulebilirlik.kayitlar || []).forEach((k) => {
    if (k['Atölye']) atolyeler.add(String(k['Atölye']).trim());
  });
  const sirali = [...atolyeler].sort((a, b) => a.localeCompare(b, 'tr'));

  const dl = document.getElementById('su-atolye-listesi');
  if (dl) dl.innerHTML = sirali.map((a) => `<option value="${escapeHtml(a)}"></option>`).join('');

  ['su-filtre-atolye', 'su-rapor-atolye'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const secili = el.value;
    el.innerHTML = '<option value="all">Tüm Atölyeler</option>' +
      sirali.map((a) => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join('');
    if (secili) el.value = secili;
  });
}

// --------------------------------------------------------------------------
// Form: canlı önizleme
// Sunucudaki suKayitMetrikleri ile AYNI formülleri kullanır. Sunucu
// katsayıları değiştirilirse buraya da yansır çünkü katsayılar sunucudan gelir.
// --------------------------------------------------------------------------
function suOnizlemeGuncelle() {
  const f = STATE.surdurulebilirlik.faktorler;
  const kullanilan = suSayi(document.getElementById('su-kullanilan')?.value);
  let fire = suSayi(document.getElementById('su-fire')?.value);
  let geri = suSayi(document.getElementById('su-geri')?.value);
  const enerji = suSayi(document.getElementById('su-enerji')?.value);
  const su = suSayi(document.getElementById('su-su')?.value);
  const birimKod = document.getElementById('su-birim')?.value || 'kg';
  const birimAgirlik = suSayi(document.getElementById('su-birim-agirlik')?.value);
  const hammadde = document.getElementById('su-hammadde')?.value || 'Diğer';
  const bertaraf = document.getElementById('su-bertaraf')?.value || 'Belirtilmedi';

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  if (kullanilan <= 0) {
    ['su-onizleme-atik', 'su-onizleme-fire', 'su-onizleme-verim', 'su-onizleme-karbon']
      .forEach((id) => set(id, '—'));
    return;
  }

  if (fire > kullanilan) fire = kullanilan;
  if (geri > fire) geri = fire;
  const netAtik = fire - geri;
  const fireOrani = (fire / kullanilan) * 100;
  const verimlilik = ((kullanilan - netAtik) / kullanilan) * 100;

  const birimBilgi = (STATE.surdurulebilirlik.secenekler?.birimler || [])
    .find((b) => b.kod === birimKod);
  const kgCarpani = (birimBilgi && birimBilgi.kutle)
    ? ({ kg: 1, g: 0.001, ton: 1000 })[birimKod]
    : birimAgirlik;

  set('su-onizleme-atik', suMiktar(netAtik, birimKod));
  set('su-onizleme-fire', suOran(fireOrani));
  set('su-onizleme-verim', suOran(verimlilik));

  if (!f) { set('su-onizleme-karbon', '—'); return; }
  const malzemeF = (f.malzeme && f.malzeme[hammadde] !== undefined) ? f.malzeme[hammadde] : f.malzeme['Diğer'];
  const bertarafF = (f.bertaraf && f.bertaraf[bertaraf] !== undefined) ? f.bertaraf[bertaraf] : f.bertaraf['Belirtilmedi'];

  let karbon = enerji * f.enerji + su * f.su;
  let eksik = false;
  if (kgCarpani > 0) {
    karbon += kullanilan * kgCarpani * malzemeF;
    karbon += netAtik * kgCarpani * bertarafF;
    karbon -= geri * kgCarpani * malzemeF * f.geriKazanimKredisi;
  } else {
    eksik = true;
  }
  if (karbon < 0) karbon = 0;
  set('su-onizleme-karbon', suMiktar(karbon, 'kg CO₂e') + (eksik ? ' *' : ''));

  const uyari = document.getElementById('su-birim-uyari');
  if (uyari) uyari.classList.toggle('su-uyari-aktif', eksik);
}

// Kütle olmayan birim seçildiğinde birim ağırlık alanı açılır.
function suBirimDegisti() {
  const birimKod = document.getElementById('su-birim')?.value || 'kg';
  const bilgi = (STATE.surdurulebilirlik.secenekler?.birimler || []).find((b) => b.kod === birimKod);
  const grup = document.getElementById('su-birim-agirlik-grup');
  if (grup) grup.classList.toggle('hidden', !!(bilgi && bilgi.kutle));
  suOnizlemeGuncelle();
}

function suFormTemizle() {
  const form = document.getElementById('su-form');
  if (form) form.reset();
  document.getElementById('su-kayit-id').value = '';
  const donem = document.getElementById('su-donem');
  if (donem && !donem.value) donem.value = new Date().toISOString().slice(0, 7);
  suBirimDegisti();
  suOnizlemeGuncelle();
}

async function suKaydet() {
  if (!suYazabilir()) {
    showToast('Kaynak kaydı için düzenleme yetkiniz yok.', 'warning');
    return;
  }
  const atolye = document.getElementById('su-atolye').value.trim();
  const donem = document.getElementById('su-donem').value;
  if (!atolye) { showToast('Atölye zorunludur.', 'warning'); return; }
  if (!/^\d{4}-\d{2}$/.test(donem)) { showToast('Dönem seçiniz.', 'warning'); return; }

  const kullanilan = suSayi(document.getElementById('su-kullanilan').value);
  if (kullanilan <= 0) { showToast('Kullanılan miktar sıfırdan büyük olmalı.', 'warning'); return; }
  const fire = suSayi(document.getElementById('su-fire').value);
  if (fire > kullanilan) { showToast('Fire, kullanılan miktardan büyük olamaz.', 'warning'); return; }
  const geri = suSayi(document.getElementById('su-geri').value);
  if (geri > fire) { showToast('Geri kazanım, fire miktarından büyük olamaz.', 'warning'); return; }

  const payload = {
    id: document.getElementById('su-kayit-id').value.trim(),
    atolye: atolye,
    donem: donem,
    hammadde: document.getElementById('su-hammadde').value,
    birim: document.getElementById('su-birim').value,
    birimAgirlik: suSayi(document.getElementById('su-birim-agirlik').value),
    kullanilan: kullanilan,
    fire: fire,
    geriKazanim: geri,
    uretilen: suSayi(document.getElementById('su-uretilen').value),
    enerji: suSayi(document.getElementById('su-enerji').value),
    su: suSayi(document.getElementById('su-su').value),
    bertaraf: document.getElementById('su-bertaraf').value,
    tedarikci: document.getElementById('su-tedarikci').value.trim(),
    notlar: document.getElementById('su-notlar').value.trim()
  };

  toggleLoading(true, 'Kayıt Google E-Tabloya yazılıyor...');
  const res = await apiPost('surdurulebilirlik_kaydet', payload);
  toggleLoading(false);

  if (res && res.success) {
    showToast(res.message || 'Kayıt eklendi.', 'success');
    suFormTemizle();
    await syncSurdurulebilirlik(true, _suFiltre);
  } else {
    showToast('Kaydedilemedi: ' + ((res && res.error) || ''), 'danger');
  }
}

function suKaydiDuzenle(id) {
  const k = (STATE.surdurulebilirlik.kayitlar || []).find((x) => String(x['ID']) === String(id));
  if (!k) return;
  const ata = (elId, deger) => { const el = document.getElementById(elId); if (el) el.value = deger; };
  ata('su-kayit-id', k['ID']);
  ata('su-atolye', k['Atölye']);
  ata('su-donem', String(k['Dönem'] || ''));
  ata('su-hammadde', k['Hammadde Türü']);
  ata('su-birim', k['Birim'] || 'kg');
  ata('su-birim-agirlik', k['Birim Ağırlık (kg)'] || '');
  ata('su-kullanilan', k['Kullanılan Miktar']);
  ata('su-fire', k['Fire / Atık Miktarı']);
  ata('su-geri', k['Geri Kazanılan Miktar']);
  ata('su-uretilen', k['Üretilen Ürün Adedi']);
  ata('su-enerji', k['Enerji (kWh)']);
  ata('su-su', k['Su (m³)']);
  ata('su-bertaraf', k['Atık Bertaraf Yöntemi'] || 'Belirtilmedi');
  ata('su-tedarikci', k['Tedarikçi / Kaynak']);
  ata('su-notlar', k['Notlar']);
  suBirimDegisti();
  suOnizlemeGuncelle();
  document.getElementById('su-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
  showToast(k['ID'] + ' düzenleniyor. Kaydet dediğinizde mevcut kayıt güncellenir.', 'info');
}

async function suKaydiSil(id) {
  const onay = confirm(id + ' numaralı kaynak kullanım kaydı silinecek.\n\nBu işlem geri alınamaz. Devam edilsin mi?');
  if (!onay) return;
  toggleLoading(true, 'Kayıt siliniyor...');
  const res = await apiPost('surdurulebilirlik_sil', { id: id });
  toggleLoading(false);
  if (res && res.success) {
    showToast('Kayıt silindi.', 'success');
    await syncSurdurulebilirlik(true, _suFiltre);
  } else {
    showToast('Silinemedi: ' + ((res && res.error) || ''), 'danger');
  }
}

// --------------------------------------------------------------------------
// Atölye & Personel altındaki giriş ekranı
// --------------------------------------------------------------------------
function renderSurdurulebilirlik() {
  const analiz = STATE.surdurulebilirlik.analiz;
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

  if (analiz) {
    setText('su-stat-verimlilik', suOran(analiz.ozet.verimlilik));
    setText('su-stat-fire', suOran(analiz.ozet.fireOrani));
    setText('su-stat-geri', suOran(analiz.ozet.geriKazanimOrani));
    setText('su-stat-karbon', suMiktar(analiz.ozet.karbon, 'kg'));
  }

  // Atölye karnesi
  const karne = document.getElementById('su-karne-listesi');
  if (karne) {
    const atolyeler = (analiz && analiz.atolyeler) || [];
    if (!atolyeler.length) {
      karne.innerHTML = '<div class="materyal-bos">Kayıt girildikçe atölye karnesi burada oluşur.</div>';
    } else {
      karne.innerHTML = atolyeler.map((a) => {
        // Verimlilik bandı: %90+ iyi, %75-90 orta, altı iyileştirme gerektirir.
        const sinif = a.verimlilik >= 90 ? 'iyi' : (a.verimlilik >= 75 ? 'orta' : 'zayif');
        return `
          <div class="su-karne">
            <div class="su-karne-ust">
              <strong>${escapeHtml(a.atolye)}</strong>
              <span class="su-verim-rozet su-verim-${sinif}">${suOran(a.verimlilik)}</span>
            </div>
            <div class="su-karne-bar"><div class="su-karne-dolu su-dolu-${sinif}" style="width:${Math.max(0, Math.min(100, a.verimlilik))}%"></div></div>
            <div class="su-karne-meta">
              Fire ${suOran(a.fireOrani)} · Geri kazanım ${suOran(a.geriKazanimOrani)} · ${suMiktar(a.karbon, 'kg CO₂e')}
            </div>
          </div>`;
      }).join('');
    }
  }

  // Kayıt tablosu
  const tbody = document.getElementById('su-tablo-tbody');
  if (!tbody) return;
  const filtreAtolye = document.getElementById('su-filtre-atolye')?.value || 'all';
  const kayitlar = (STATE.surdurulebilirlik.kayitlar || [])
    .filter((k) => filtreAtolye === 'all' || String(k['Atölye']) === filtreAtolye)
    .slice().reverse();

  setText('su-sayac', kayitlar.length + ' / ' + (STATE.surdurulebilirlik.kayitlar || []).length + ' kayıt');
  const bos = document.getElementById('su-bos');
  if (bos) bos.classList.toggle('hidden', (STATE.surdurulebilirlik.kayitlar || []).length > 0);

  const yazabilir = suYazabilir();
  const f = STATE.surdurulebilirlik.faktorler;

  tbody.innerHTML = kayitlar.map((k) => {
    const m = suKayitMetrikleriIstemci(k, f);
    const sinif = m.verimlilik >= 90 ? 'iyi' : (m.verimlilik >= 75 ? 'orta' : 'zayif');
    return `
      <tr>
        <td data-label="Dönem">${escapeHtml(String(k['Dönem'] || ''))}</td>
        <td data-label="Atölye"><strong>${escapeHtml(String(k['Atölye'] || ''))}</strong></td>
        <td data-label="Hammadde">${escapeHtml(String(k['Hammadde Türü'] || ''))}</td>
        <td data-label="Kullanılan">${suMiktar(k['Kullanılan Miktar'], k['Birim'])}</td>
        <td data-label="Fire">${suMiktar(k['Fire / Atık Miktarı'], k['Birim'])}</td>
        <td data-label="Fire %">${suOran(m.fireOrani)}</td>
        <td data-label="Verimlilik"><span class="su-verim-rozet su-verim-${sinif}">${suOran(m.verimlilik)}</span></td>
        <td data-label="Karbon">${m.kutleBilinir ? suMiktar(m.karbon, '') : suMiktar(m.karbon, '') + ' <span title="Birim ağırlık girilmediği için yalnızca enerji ve su dahil" class="su-kismi">kısmi</span>'}</td>
        <td>
          ${yazabilir ? `<button class="btn btn-sm btn-outline-primary" data-su-duzenle="${escapeHtml(String(k['ID']))}">✏️</button>
          <button class="btn btn-sm btn-text" data-su-sil="${escapeHtml(String(k['ID']))}">🗑️</button>` : '—'}
        </td>
      </tr>`;
  }).join('');
}

// Tablo satırı başına metrik: sunucudaki formülün istemci karşılığı.
// Yalnızca GÖRÜNTÜLEME içindir; kaydedilen/raporlanan değerler sunucudan gelir.
function suKayitMetrikleriIstemci(k, f) {
  const kullanilan = suSayi(k['Kullanılan Miktar']);
  let fire = suSayi(k['Fire / Atık Miktarı']);
  let geri = suSayi(k['Geri Kazanılan Miktar']);
  if (fire > kullanilan) fire = kullanilan;
  if (geri > fire) geri = fire;
  const netAtik = fire - geri;
  const fireOrani = kullanilan > 0 ? (fire / kullanilan) * 100 : 0;
  const verimlilik = kullanilan > 0 ? ((kullanilan - netAtik) / kullanilan) * 100 : 0;

  const birimKod = String(k['Birim'] || 'kg');
  const kutleCarpani = ({ kg: 1, g: 0.001, ton: 1000 })[birimKod];
  const kgCarpani = kutleCarpani !== undefined ? kutleCarpani : suSayi(k['Birim Ağırlık (kg)']);
  const kutleBilinir = kgCarpani > 0;

  let karbon = 0;
  if (f) {
    const malzemeF = (f.malzeme && f.malzeme[k['Hammadde Türü']] !== undefined)
      ? f.malzeme[k['Hammadde Türü']] : f.malzeme['Diğer'];
    const bertarafF = (f.bertaraf && f.bertaraf[k['Atık Bertaraf Yöntemi']] !== undefined)
      ? f.bertaraf[k['Atık Bertaraf Yöntemi']] : f.bertaraf['Belirtilmedi'];
    karbon = suSayi(k['Enerji (kWh)']) * f.enerji + suSayi(k['Su (m³)']) * f.su;
    if (kutleBilinir) {
      karbon += kullanilan * kgCarpani * malzemeF
              + netAtik * kgCarpani * bertarafF
              - geri * kgCarpani * malzemeF * f.geriKazanimKredisi;
    }
    if (karbon < 0) karbon = 0;
  }
  return {
    fireOrani: Math.round(fireOrani * 100) / 100,
    verimlilik: Math.round(verimlilik * 100) / 100,
    karbon: Math.round(karbon * 100) / 100,
    kutleBilinir: kutleBilinir
  };
}

function suCsvIndir() {
  const kayitlar = STATE.surdurulebilirlik.kayitlar || [];
  if (!kayitlar.length) { showToast('Dışa aktarılacak kayıt yok.', 'warning'); return; }
  const f = STATE.surdurulebilirlik.faktorler;
  const basliklar = ['ID', 'Dönem', 'Atölye', 'Hammadde Türü', 'Birim', 'Kullanılan Miktar',
    'Fire / Atık Miktarı', 'Geri Kazanılan Miktar', 'Üretilen Ürün Adedi', 'Enerji (kWh)',
    'Su (m³)', 'Atık Bertaraf Yöntemi', 'Fire Oranı %', 'Verimlilik %', 'Karbon (kg CO2e)'];
  const kacis = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const satirlar = kayitlar.map((k) => {
    const m = suKayitMetrikleriIstemci(k, f);
    return basliklar.map((b) => {
      if (b === 'Fire Oranı %') return kacis(m.fireOrani);
      if (b === 'Verimlilik %') return kacis(m.verimlilik);
      if (b === 'Karbon (kg CO2e)') return kacis(m.karbon);
      return kacis(k[b]);
    }).join(';');
  });
  const blob = new Blob(['﻿' + [basliklar.map(kacis).join(';')].concat(satirlar).join('\r\n')],
    { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'kaynak_takibi_' + new Date().toISOString().split('T')[0] + '.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  showToast(kayitlar.length + ' kayıt CSV olarak indirildi.', 'success');
}

// --------------------------------------------------------------------------
// Raporlar > Sürdürülebilirlik panosu (Chart.js)
// --------------------------------------------------------------------------
const SU_RENK = {
  yesil: '#2e9e5b', kirmizi: '#e05252', altin: '#d4af37',
  mor: '#9c27b0', mavi: '#3b82f6', turuncu: '#f59e0b', gri: '#a89ebc'
};

function suGrafikYok(canvasId, mesaj) {
  const ctx = document.getElementById(canvasId);
  if (!ctx || !ctx.getContext) return;
  const c = ctx.getContext('2d');
  c.clearRect(0, 0, ctx.width, ctx.height);
  c.fillStyle = '#a89ebc';
  c.font = '13px Inter, sans-serif';
  c.textAlign = 'center';
  c.fillText(mesaj, ctx.width / 2, ctx.height / 2);
}

function renderSurdurulebilirlikRapor() {
  const analiz = STATE.surdurulebilirlik.analiz;
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  if (!analiz) return;

  setText('su-rapor-verimlilik', suOran(analiz.ozet.verimlilik));
  setText('su-rapor-fire', suOran(analiz.ozet.fireOrani));
  setText('su-rapor-geri', suOran(analiz.ozet.geriKazanimOrani));
  setText('su-rapor-karbon', suMiktar(analiz.ozet.karbon, ''));

  // Karbon rakamının hangi kayıtları kapsamadığı gizlenmez.
  const kapsam = document.getElementById('su-rapor-kapsam');
  if (kapsam) {
    if (analiz.kapsam && analiz.kapsam.not) {
      kapsam.textContent = '⚠️ ' + analiz.kapsam.not;
      kapsam.classList.remove('hidden');
    } else {
      kapsam.classList.add('hidden');
    }
  }

  // İyileştirme odağı
  const odak = document.getElementById('su-rapor-odak');
  if (odak) {
    const o = analiz.odak || {};
    if (!o.enFireliAtolye && !o.enFireliHammadde) {
      odak.innerHTML = '<div class="materyal-bos">Yeterli veri girildiğinde en yüksek fire veren atölye ve hammadde burada listelenir.</div>';
    } else {
      odak.innerHTML = `
        ${o.enFireliAtolye ? `<div class="su-odak-kart">
          <span>En yüksek fire oranına sahip atölye</span>
          <strong>${escapeHtml(o.enFireliAtolye.ad)}</strong>
          <em>${suOran(o.enFireliAtolye.oran)}</em>
        </div>` : ''}
        ${o.enFireliHammadde ? `<div class="su-odak-kart">
          <span>En yüksek fire oranına sahip hammadde</span>
          <strong>${escapeHtml(o.enFireliHammadde.ad)}</strong>
          <em>${suOran(o.enFireliHammadde.oran)}</em>
        </div>` : ''}
        <div class="su-odak-kart">
          <span>Geri kazanımla önlenen salım</span>
          <strong>${suMiktar(analiz.ozet.karbonKredi, 'kg CO₂e')}</strong>
          <em>${analiz.ozet.geriKazanim > 0 ? suMiktar(analiz.ozet.geriKazanim, '') + ' malzeme yeniden kazanıldı' : 'Henüz geri kazanım kaydı yok'}</em>
        </div>`;
    }
  }

  // Atölye karnesi tablosu
  const tbody = document.getElementById('su-rapor-tablo-tbody');
  if (tbody) {
    const atolyeler = analiz.atolyeler || [];
    tbody.innerHTML = atolyeler.length
      ? atolyeler.map((a) => {
          const sinif = a.verimlilik >= 90 ? 'iyi' : (a.verimlilik >= 75 ? 'orta' : 'zayif');
          return `<tr>
            <td data-label="Atölye"><strong>${escapeHtml(a.atolye)}</strong></td>
            <td data-label="Kullanılan">${suMiktar(a.kullanilan, '')}</td>
            <td data-label="Fire">${suMiktar(a.fire, '')}</td>
            <td data-label="Net Atık">${suMiktar(a.netAtik, '')}</td>
            <td data-label="Fire %">${suOran(a.fireOrani)}</td>
            <td data-label="Geri Kazanım %">${suOran(a.geriKazanimOrani)}</td>
            <td data-label="Verimlilik"><span class="su-verim-rozet su-verim-${sinif}">${suOran(a.verimlilik)}</span></td>
            <td data-label="Karbon">${suMiktar(a.karbon, '')}</td>
            <td data-label="Ürün Başına">${a.uretilen > 0 ? suMiktar(a.karbonYogunlugu, '') : '—'}</td>
          </tr>`;
        }).join('')
      : '<tr><td colspan="9" style="text-align:center; color:var(--text-muted); padding:1.5rem;">Kayıt yok.</td></tr>';
  }

  if (!window.Chart) {
    ['chart-su-aylik', 'chart-su-atolye', 'chart-su-karbon', 'chart-su-hammadde']
      .forEach((id) => suGrafikYok(id, 'Grafik kütüphanesi yüklenemedi.'));
    return;
  }
  suGrafikleriCiz(analiz);
}

function suGrafikleriCiz(analiz) {
  const eksenRengi = '#a89ebc';
  const yaziRengi = '#f3effa';
  const izgara = 'rgba(255,255,255,0.06)';
  const temelSecenek = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { color: yaziRengi, font: { size: 11 } } } },
    scales: {
      x: { ticks: { color: eksenRengi, font: { size: 10 } }, grid: { color: izgara } },
      y: { ticks: { color: eksenRengi, font: { size: 10 } }, grid: { color: izgara } }
    }
  };

  // 1) Aylık fire oranı + verimlilik
  if (STATE.charts.suAylik) STATE.charts.suAylik.destroy();
  const donemler = analiz.donemler || [];
  const aylikCtx = document.getElementById('chart-su-aylik');
  if (aylikCtx) {
    if (!donemler.length) {
      suGrafikYok('chart-su-aylik', 'Aylık karşılaştırma için en az bir dönem kaydı gerekir.');
    } else {
      STATE.charts.suAylik = new Chart(aylikCtx, {
        type: 'bar',
        data: {
          labels: donemler.map((d) => d.donem),
          datasets: [
            { type: 'bar', label: 'Fire Oranı (%)', data: donemler.map((d) => d.fireOrani),
              backgroundColor: 'rgba(224,82,82,0.65)', borderColor: SU_RENK.kirmizi, borderWidth: 1, order: 2 },
            { type: 'line', label: 'Verimlilik (%)', data: donemler.map((d) => d.verimlilik),
              borderColor: SU_RENK.yesil, backgroundColor: SU_RENK.yesil, tension: 0.3,
              pointRadius: 4, borderWidth: 2, fill: false, order: 1 }
          ]
        },
        options: Object.assign({}, temelSecenek, {
          scales: Object.assign({}, temelSecenek.scales, {
            y: { beginAtZero: true, max: 100, ticks: { color: eksenRengi, callback: (v) => v + '%' }, grid: { color: izgara } }
          })
        })
      });
    }
  }

  // 2) Atölye bazlı verimlilik
  if (STATE.charts.suAtolye) STATE.charts.suAtolye.destroy();
  const atolyeler = (analiz.atolyeler || []).slice(0, 10);
  const atolyeCtx = document.getElementById('chart-su-atolye');
  if (atolyeCtx) {
    if (!atolyeler.length) {
      suGrafikYok('chart-su-atolye', 'Atölye karşılaştırması için kayıt gerekir.');
    } else {
      STATE.charts.suAtolye = new Chart(atolyeCtx, {
        type: 'bar',
        data: {
          labels: atolyeler.map((a) => a.atolye.length > 22 ? a.atolye.slice(0, 21) + '…' : a.atolye),
          datasets: [{
            label: 'Üretim Verimliliği (%)',
            data: atolyeler.map((a) => a.verimlilik),
            // %90 üstü yeşil, %75-90 sarı, altı kırmızı: hedeften sapan atölye
            // renkten hemen ayırt edilsin.
            backgroundColor: atolyeler.map((a) =>
              a.verimlilik >= 90 ? 'rgba(46,158,91,0.7)'
                : (a.verimlilik >= 75 ? 'rgba(212,175,55,0.7)' : 'rgba(224,82,82,0.7)')),
            borderColor: atolyeler.map((a) =>
              a.verimlilik >= 90 ? SU_RENK.yesil : (a.verimlilik >= 75 ? SU_RENK.altin : SU_RENK.kirmizi)),
            borderWidth: 1
          }]
        },
        options: Object.assign({}, temelSecenek, {
          indexAxis: 'y',
          plugins: { legend: { display: false } },
          scales: {
            x: { beginAtZero: true, max: 100, ticks: { color: eksenRengi, callback: (v) => v + '%' }, grid: { color: izgara } },
            y: { ticks: { color: eksenRengi, font: { size: 10 } }, grid: { display: false } }
          }
        })
      });
    }
  }

  // 3) Karbon kaynak dağılımı
  if (STATE.charts.suKarbon) STATE.charts.suKarbon.destroy();
  const o = analiz.ozet || {};
  const karbonCtx = document.getElementById('chart-su-karbon');
  if (karbonCtx) {
    const dilimler = [
      { ad: 'Hammadde', deger: o.karbonMalzeme || 0, renk: SU_RENK.mor },
      { ad: 'Enerji', deger: o.karbonEnerji || 0, renk: SU_RENK.turuncu },
      { ad: 'Su', deger: o.karbonSu || 0, renk: SU_RENK.mavi },
      { ad: 'Atık Bertarafı', deger: o.karbonAtik || 0, renk: SU_RENK.kirmizi }
    ].filter((d) => d.deger > 0);
    if (!dilimler.length) {
      suGrafikYok('chart-su-karbon', 'Karbon hesabı için tüketim verisi gerekir.');
    } else {
      STATE.charts.suKarbon = new Chart(karbonCtx, {
        type: 'doughnut',
        data: {
          labels: dilimler.map((d) => d.ad),
          datasets: [{
            data: dilimler.map((d) => Math.round(d.deger * 100) / 100),
            backgroundColor: dilimler.map((d) => d.renk),
            borderColor: '#191425', borderWidth: 2
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { position: 'right', labels: { color: yaziRengi, font: { size: 11 } } },
            tooltip: { callbacks: { label: (c) => c.label + ': ' + c.parsed.toLocaleString('tr-TR') + ' kg CO₂e' } }
          }
        }
      });
    }
  }

  // 4) Hammadde bazlı atık
  if (STATE.charts.suHammadde) STATE.charts.suHammadde.destroy();
  const hammaddeler = (analiz.hammaddeler || []).filter((h) => h.fire > 0).slice(0, 8);
  const hamCtx = document.getElementById('chart-su-hammadde');
  if (hamCtx) {
    if (!hammaddeler.length) {
      suGrafikYok('chart-su-hammadde', 'Henüz fire kaydı girilmemiş.');
    } else {
      STATE.charts.suHammadde = new Chart(hamCtx, {
        type: 'bar',
        data: {
          labels: hammaddeler.map((h) => h.hammadde),
          datasets: [
            { label: 'Net Atık', data: hammaddeler.map((h) => h.netAtik),
              backgroundColor: 'rgba(224,82,82,0.7)', borderColor: SU_RENK.kirmizi, borderWidth: 1, stack: 'a' },
            { label: 'Geri Kazanılan', data: hammaddeler.map((h) => h.geriKazanim),
              backgroundColor: 'rgba(46,158,91,0.7)', borderColor: SU_RENK.yesil, borderWidth: 1, stack: 'a' }
          ]
        },
        options: Object.assign({}, temelSecenek, {
          scales: {
            x: { stacked: true, ticks: { color: eksenRengi, font: { size: 9 } }, grid: { color: izgara } },
            y: { stacked: true, beginAtZero: true, ticks: { color: eksenRengi }, grid: { color: izgara } }
          }
        })
      });
    }
  }
}

function suRaporFiltreUygula() {
  _suFiltre = {
    atolye: document.getElementById('su-rapor-atolye')?.value === 'all'
      ? '' : (document.getElementById('su-rapor-atolye')?.value || ''),
    baslangic: document.getElementById('su-rapor-baslangic')?.value || '',
    bitis: document.getElementById('su-rapor-bitis')?.value || ''
  };
  syncSurdurulebilirlik(false, _suFiltre);
}

async function suRaporPdf() {
  const analiz = STATE.surdurulebilirlik.analiz;
  if (!analiz || !analiz.ozet.kayitSayisi) {
    showToast('Raporlanacak kayıt yok.', 'warning');
    return;
  }
  // PDF motoru istek üzerine yüklenir (açılışı yavaşlatmasın diye).
  if (!(await pdfMotoruHazirla())) return;
  const bugun = new Date().toLocaleDateString('tr-TR');
  const donemMetni = (_suFiltre.baslangic || _suFiltre.bitis)
    ? ((_suFiltre.baslangic || 'başlangıç') + ' — ' + (_suFiltre.bitis || 'bugün'))
    : 'Tüm dönemler';

  const kutu = document.createElement('div');
  kutu.style.cssText = 'width:190mm; background:#fff; color:#222; font-family:Arial,Helvetica,sans-serif; padding:8mm;';
  kutu.innerHTML = `
    <div style="text-align:center; border-bottom:2px solid #4b1478; padding-bottom:6mm; margin-bottom:6mm;">
      <div style="font-size:15pt; font-weight:bold; color:#4b1478;">EDİRNE OLGUNLAŞMA ENSTİTÜSÜ</div>
      <div style="font-size:11pt; margin-top:2mm;">Sıfır Atık ve Kaynak Optimizasyonu Raporu</div>
      <div style="font-size:9pt; color:#666; margin-top:2mm;">Dönem: ${escapeHtml(donemMetni)} · Rapor tarihi: ${bugun}</div>
    </div>
    <table style="width:100%; border-collapse:collapse; margin-bottom:6mm; font-size:10pt;">
      <tr>
        <td style="padding:4mm; border:1px solid #ddd; text-align:center;">
          <div style="font-size:16pt; font-weight:bold; color:#2e9e5b;">${suOran(analiz.ozet.verimlilik)}</div>
          <div style="font-size:8pt; color:#666;">Üretim Verimliliği</div>
        </td>
        <td style="padding:4mm; border:1px solid #ddd; text-align:center;">
          <div style="font-size:16pt; font-weight:bold; color:#e05252;">${suOran(analiz.ozet.fireOrani)}</div>
          <div style="font-size:8pt; color:#666;">Fire / Atık Oranı</div>
        </td>
        <td style="padding:4mm; border:1px solid #ddd; text-align:center;">
          <div style="font-size:16pt; font-weight:bold; color:#d4af37;">${suOran(analiz.ozet.geriKazanimOrani)}</div>
          <div style="font-size:8pt; color:#666;">Geri Kazanım</div>
        </td>
        <td style="padding:4mm; border:1px solid #ddd; text-align:center;">
          <div style="font-size:16pt; font-weight:bold; color:#4b1478;">${suMiktar(analiz.ozet.karbon, '')}</div>
          <div style="font-size:8pt; color:#666;">kg CO₂e</div>
        </td>
      </tr>
    </table>
    <h3 style="color:#4b1478; font-size:11pt; border-bottom:1px solid #ddd; padding-bottom:2mm;">Atölye Karnesi</h3>
    <table style="width:100%; border-collapse:collapse; font-size:9pt;">
      <thead>
        <tr style="background:#f3f0f7; color:#4b1478;">
          <th style="padding:2mm; text-align:left; border:1px solid #ddd;">Atölye</th>
          <th style="padding:2mm; border:1px solid #ddd;">Kullanılan</th>
          <th style="padding:2mm; border:1px solid #ddd;">Net Atık</th>
          <th style="padding:2mm; border:1px solid #ddd;">Fire %</th>
          <th style="padding:2mm; border:1px solid #ddd;">Verimlilik</th>
          <th style="padding:2mm; border:1px solid #ddd;">Karbon</th>
        </tr>
      </thead>
      <tbody>
        ${(analiz.atolyeler || []).map((a) => `<tr>
          <td style="padding:2mm; border:1px solid #ddd;">${escapeHtml(a.atolye)}</td>
          <td style="padding:2mm; border:1px solid #ddd; text-align:right;">${suMiktar(a.kullanilan, '')}</td>
          <td style="padding:2mm; border:1px solid #ddd; text-align:right;">${suMiktar(a.netAtik, '')}</td>
          <td style="padding:2mm; border:1px solid #ddd; text-align:right;">${suOran(a.fireOrani)}</td>
          <td style="padding:2mm; border:1px solid #ddd; text-align:right;">${suOran(a.verimlilik)}</td>
          <td style="padding:2mm; border:1px solid #ddd; text-align:right;">${suMiktar(a.karbon, '')}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    <div style="margin-top:6mm; padding:3mm; background:#fffbe6; border-left:3px solid #d4af37; font-size:8pt; line-height:1.5;">
      <b>Yöntem notu:</b> Karbon değerleri, malzeme/enerji/su tüketimi ve atık bertaraf yöntemine
      uygulanan emisyon katsayılarıyla hesaplanan <b>tahmini</b> değerlerdir; akredite bir yaşam
      döngüsü analizi (LCA) yerine geçmez.
      ${analiz.kapsam && analiz.kapsam.not ? '<br><b>Kapsam:</b> ' + escapeHtml(analiz.kapsam.not) : ''}
    </div>`;

  showToast('Sürdürülebilirlik raporu hazırlanıyor...', 'info');
  html2pdf().set({
    margin: [10, 8, 12, 8],
    filename: 'Surdurulebilirlik_Raporu_' + new Date().toISOString().split('T')[0] + '.pdf',
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff' },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  }).from(kutu).save()
    .then(() => showToast('Rapor indirildi.', 'success'))
    .catch((err) => showToast('Rapor oluşturulamadı: ' + err.message, 'danger'));
}

// --------------------------------------------------------------------------
// Emisyon katsayıları penceresi (yönetici)
// --------------------------------------------------------------------------
function openSuFaktorPenceresi() {
  const f = STATE.surdurulebilirlik.faktorler;
  if (!f) { showToast('Önce verileri yükleyin.', 'warning'); return; }

  const durum = document.getElementById('su-faktor-durum');
  if (durum) {
    durum.className = 'su-faktor-durum ' + (f.ozelTanimli ? 'su-faktor-ozel' : 'su-faktor-varsayilan');
    durum.textContent = f.ozelTanimli
      ? '✏️ Şu anda kuruma özel katsayılar kullanılıyor.'
      : 'ℹ️ Şu anda literatür ortalaması olan varsayılan katsayılar kullanılıyor.';
  }

  const alan = (grup, ad, deger) => `
    <div class="form-group">
      <label for="suf-${grup}-${escapeHtml(ad)}">${escapeHtml(ad)}</label>
      <input type="number" id="suf-${grup}-${escapeHtml(ad)}" data-su-faktor="${grup}" data-ad="${escapeHtml(ad)}"
             min="0" step="0.01" value="${deger}">
    </div>`;

  const malzemeKutu = document.getElementById('su-faktor-malzeme');
  if (malzemeKutu) {
    malzemeKutu.innerHTML = Object.keys(f.malzeme)
      .map((m) => alan('malzeme', m, f.malzeme[m])).join('');
  }
  const bertarafKutu = document.getElementById('su-faktor-bertaraf');
  if (bertarafKutu) {
    bertarafKutu.innerHTML = Object.keys(f.bertaraf)
      .map((b) => alan('bertaraf', b, f.bertaraf[b])).join('');
  }
  document.getElementById('su-faktor-enerji').value = f.enerji;
  document.getElementById('su-faktor-su').value = f.su;
  document.getElementById('su-faktor-kredi').value = f.geriKazanimKredisi;

  document.getElementById('dialog-su-faktor').showModal();
}

async function suFaktorKaydet() {
  const faktorler = { malzeme: {}, bertaraf: {} };
  document.querySelectorAll('[data-su-faktor]').forEach((el) => {
    const grup = el.getAttribute('data-su-faktor');
    const ad = el.getAttribute('data-ad');
    const v = parseFloat(el.value);
    if (!isNaN(v) && v >= 0) faktorler[grup][ad] = v;
  });
  const sayi = (id) => { const v = parseFloat(document.getElementById(id).value); return isNaN(v) ? undefined : v; };
  faktorler.enerji = sayi('su-faktor-enerji');
  faktorler.su = sayi('su-faktor-su');
  faktorler.geriKazanimKredisi = sayi('su-faktor-kredi');

  toggleLoading(true, 'Katsayılar kaydediliyor...');
  const res = await apiPost('surdurulebilirlik_faktor_kaydet', { faktorler: faktorler });
  toggleLoading(false);
  if (res && res.success) {
    showToast('Katsayılar kaydedildi; raporlar yeniden hesaplandı.', 'success');
    document.getElementById('dialog-su-faktor').close();
    await syncSurdurulebilirlik(true, _suFiltre);
  } else {
    showToast('Kaydedilemedi: ' + ((res && res.error) || ''), 'danger');
  }
}

async function suFaktorSifirla() {
  const onay = confirm('Emisyon katsayıları literatür ortalaması olan varsayılan değerlere döndürülecek.\n\nKuruma özel girdiğiniz değerler silinir. Devam edilsin mi?');
  if (!onay) return;
  toggleLoading(true, 'Katsayılar sıfırlanıyor...');
  const res = await apiPost('surdurulebilirlik_faktor_sifirla', {});
  toggleLoading(false);
  if (res && res.success) {
    showToast('Varsayılan katsayılara dönüldü.', 'success');
    document.getElementById('dialog-su-faktor').close();
    await syncSurdurulebilirlik(true, _suFiltre);
  } else {
    showToast('İşlem başarısız: ' + ((res && res.error) || ''), 'danger');
  }
}

// --------------------------------------------------------------------------
// Kurulum
// --------------------------------------------------------------------------
function initSurdurulebilirlik() {
  const bolum = document.getElementById('atolye-surdurulebilirlik-subview');
  if (!bolum) return;

  // Atölye bölümü alt sekmeleri
  document.querySelectorAll('#atolye-personel-view .btn-tab').forEach((tab) => {
    tab.addEventListener('click', (e) => {
      document.querySelectorAll('#atolye-personel-view .btn-tab').forEach((t) => t.classList.remove('active'));
      e.currentTarget.classList.add('active');
      const hedef = e.currentTarget.getAttribute('data-subtarget');
      document.querySelectorAll('#atolye-personel-view .atolye-sub-view').forEach((v) => {
        v.classList.add('hidden');
        v.classList.remove('active');
      });
      const panel = document.getElementById(hedef);
      if (panel) { panel.classList.remove('hidden'); panel.classList.add('active'); }
      if (hedef === 'atolye-surdurulebilirlik-subview') {
        suFormTemizle();
        renderSurdurulebilirlik();
        syncSurdurulebilirlik(true, _suFiltre);
      }
    });
  });

  // Form
  ['su-kullanilan', 'su-fire', 'su-geri', 'su-enerji', 'su-su', 'su-birim-agirlik']
    .forEach((id) => document.getElementById(id)?.addEventListener('input', debounce(suOnizlemeGuncelle, 120)));
  ['su-hammadde', 'su-bertaraf'].forEach((id) =>
    document.getElementById(id)?.addEventListener('change', suOnizlemeGuncelle));
  document.getElementById('su-birim')?.addEventListener('change', suBirimDegisti);
  document.getElementById('btn-su-kaydet')?.addEventListener('click', suKaydet);
  document.getElementById('btn-su-temizle')?.addEventListener('click', suFormTemizle);
  document.getElementById('btn-su-yenile')?.addEventListener('click', () => syncSurdurulebilirlik(false, _suFiltre));
  document.getElementById('btn-su-csv')?.addEventListener('click', suCsvIndir);
  document.getElementById('su-filtre-atolye')?.addEventListener('change', renderSurdurulebilirlik);

  // Tablo işlemleri
  document.getElementById('su-tablo-tbody')?.addEventListener('click', (e) => {
    const duzenle = e.target.closest('[data-su-duzenle]');
    if (duzenle) { suKaydiDuzenle(duzenle.getAttribute('data-su-duzenle')); return; }
    const sil = e.target.closest('[data-su-sil]');
    if (sil) suKaydiSil(sil.getAttribute('data-su-sil'));
  });

  // Rapor panosu
  document.getElementById('btn-su-rapor-yenile')?.addEventListener('click', suRaporFiltreUygula);
  document.getElementById('btn-su-rapor-pdf')?.addEventListener('click', suRaporPdf);
  ['su-rapor-baslangic', 'su-rapor-bitis', 'su-rapor-atolye'].forEach((id) =>
    document.getElementById(id)?.addEventListener('change', suRaporFiltreUygula));

  // Katsayılar
  document.getElementById('btn-su-faktor')?.addEventListener('click', openSuFaktorPenceresi);
  document.getElementById('btn-su-faktor-kaydet')?.addEventListener('click', suFaktorKaydet);
  document.getElementById('btn-su-faktor-sifirla')?.addEventListener('click', suFaktorSifirla);
  ['btn-su-faktor-kapat', 'btn-su-faktor-kapat-carpi'].forEach((id) =>
    document.getElementById(id)?.addEventListener('click',
      () => document.getElementById('dialog-su-faktor').close()));

  suFormTemizle();
}

// ==========================================================================
// DİJİTAL KORUMA · E-BÜLTEN · İŞ ZEKÂSI (VERİ AMBARI)
// --------------------------------------------------------------------------
// Üçünün de ağır işi sunucudadır (google-apps-script.js); buradaki katman
// yalnızca çizer ve kullanıcı eylemlerini iletir.
// ==========================================================================

// ---------------------------------------------------------------------------
// 1) DİJİTAL KORUMA
// ---------------------------------------------------------------------------
const KOR_DURUM_STIL = {
  'Doğrulandı':        { sinif: 'iyi',   ikon: '✅' },
  'DEĞİŞTİ':           { sinif: 'uyari', ikon: '⚠️' },
  'KAYIP':             { sinif: 'kotu',  ikon: '❌' },
  'Kontrol Edilemedi': { sinif: 'notr',  ikon: '❔' },
  'Beklemede':         { sinif: 'notr',  ikon: '⏳' }
};
const KOR_RISK_STIL = { 'Düşük': 'iyi', 'Orta': 'uyari', 'Yüksek': 'kotu', 'Bilinmiyor': 'notr' };

let _korAcikKayit = null;
let _korSyncIslemi = null;

function korYazabilir() {
  return STATE.currentUser &&
    (STATE.currentUser.role === 'admin' || STATE.currentUser.role === 'editor');
}

function korBayt(b) {
  const n = parseInt(b, 10) || 0;
  if (n >= 1073741824) return (n / 1073741824).toFixed(2) + ' GB';
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
  return n + ' B';
}

function korTarih(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

async function syncKoruma(sessiz) {
  if (_korSyncIslemi) return _korSyncIslemi;
  if (!sessiz) toggleLoading(true, 'Koruma kayıt defteri yükleniyor...');
  _korSyncIslemi = (async () => {
    const res = await apiPost('get_koruma');
    if (res && res.success) {
      STATE.koruma.kayitlar = res.kayitlar || [];
      STATE.koruma.ozet = res.ozet || null;
      modulOnbellegeYaz('koruma');
      renderKoruma();
    } else if (!sessiz) {
      showToast('Koruma kayıtları alınamadı: ' + ((res && res.error) || ''), 'danger');
    }
    return res;
  })();
  try { return await _korSyncIslemi; }
  finally { _korSyncIslemi = null; if (!sessiz) toggleLoading(false); }
}

function renderKoruma() {
  const tbody = document.getElementById('kor-tablo-tbody');
  if (!tbody) return;
  const ozet = STATE.koruma.ozet;
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  if (ozet) {
    setText('kor-stat-toplam', ozet.toplam);
    setText('kor-stat-dogrulandi', ozet.dogrulandi);
    setText('kor-stat-sorunlu', ozet.degisti + ozet.kayip);
    setText('kor-stat-risk', ozet.yuksekRisk);
  }

  const arama = (document.getElementById('kor-arama')?.value || '').toLowerCase().trim();
  const filtre = document.getElementById('kor-filtre-durum')?.value || 'all';

  const suzulmus = (STATE.koruma.kayitlar || []).filter((k) => {
    if (filtre === 'riskli') {
      if (String(k['Format Riski']) !== 'Yüksek') return false;
    } else if (filtre !== 'all' && String(k['Bütünlük Durumu']) !== filtre) {
      return false;
    }
    if (!arama) return true;
    return ['PID', 'Başlık', 'Dosya Adı', 'DOI', 'Kaynak Kimlik']
      .some((a) => String(k[a] || '').toLowerCase().includes(arama));
  });

  setText('kor-sayac', suzulmus.length + ' / ' + (STATE.koruma.kayitlar || []).length + ' nesne');
  const bos = document.getElementById('kor-bos');
  if (bos) bos.classList.toggle('hidden', (STATE.koruma.kayitlar || []).length > 0);

  tbody.innerHTML = suzulmus.map((k) => {
    const durum = String(k['Bütünlük Durumu'] || 'Beklemede');
    const ds = KOR_DURUM_STIL[durum] || KOR_DURUM_STIL['Beklemede'];
    const risk = String(k['Format Riski'] || 'Bilinmiyor');
    const acik = String(k['Kamuya Açık'] || '').toUpperCase() === 'EVET';
    return `
      <tr>
        <td data-label="PID">
          <code class="kor-pid">${escapeHtml(String(k['PID']))}</code>
          ${k['DOI'] ? `<br><small class="kor-doi">DOI: ${escapeHtml(String(k['DOI']))}</small>` : ''}
        </td>
        <td data-label="Başlık"><strong>${escapeHtml(String(k['Başlık'] || k['Dosya Adı'] || ''))}</strong>
          <br><small style="color:var(--text-muted);">${escapeHtml(String(k['Dosya Adı'] || ''))} · ${korBayt(k['Boyut (Bayt)'])}</small></td>
        <td data-label="Tür">${escapeHtml(String(k['Nesne Türü'] || ''))}</td>
        <td data-label="Risk"><span class="kor-rozet kor-${KOR_RISK_STIL[risk] || 'notr'}">${escapeHtml(risk)}</span></td>
        <td data-label="Sürüm">v${escapeHtml(String(k['Sürüm'] || 1))}</td>
        <td data-label="Bütünlük"><span class="kor-rozet kor-${ds.sinif}">${ds.ikon} ${escapeHtml(durum)}</span></td>
        <td data-label="Son Kontrol">${korTarih(k['Son Bütünlük Kontrolü'])}</td>
        <td data-label="Erişim">${acik ? '🌍 Açık' : '🔒 Kapalı'}</td>
        <td>
          <button class="btn btn-sm btn-outline-primary" data-kor-detay="${escapeHtml(String(k['PID']))}">İncele</button>
          <button class="btn btn-sm btn-text" data-kor-pid-kopyala="${escapeHtml(String(k['PID']))}" title="Kalıcı bağlantıyı kopyala">🔗</button>
        </td>
      </tr>`;
  }).join('');
}

function korPidAdresi(pid) {
  const kok = STATE.sheetUrl || '';
  return kok ? kok + '?kaynak=pid/' + encodeURIComponent(pid) : pid;
}

async function openKorumaDetay(pid) {
  const k = (STATE.koruma.kayitlar || []).find((x) => String(x['PID']) === String(pid));
  if (!k) return;
  _korAcikKayit = k;

  document.getElementById('kor-detay-baslik').textContent = String(k['Başlık'] || k['Dosya Adı'] || pid);
  const govde = document.getElementById('kor-detay-govde');
  const yazabilir = korYazabilir();
  const acik = String(k['Kamuya Açık'] || '').toUpperCase() === 'EVET';

  govde.innerHTML = `
    <div class="kor-pid-kutusu">
      <span>Kalıcı Tanımlayıcı</span>
      <code>${escapeHtml(String(k['PID']))}</code>
      <small>${escapeHtml(korPidAdresi(String(k['PID'])))}</small>
    </div>
    <div class="kor-alanlar">
      <div><span>Nesne Türü</span><strong>${escapeHtml(String(k['Nesne Türü'] || '—'))}</strong></div>
      <div><span>Kaynak</span><strong>${escapeHtml(String(k['Kaynak Modül'] || '—'))} / ${escapeHtml(String(k['Kaynak Kimlik'] || '—'))}</strong></div>
      <div><span>Dosya</span><strong>${escapeHtml(String(k['Dosya Adı'] || '—'))}</strong></div>
      <div><span>Boyut</span><strong>${korBayt(k['Boyut (Bayt)'])}</strong></div>
      <div><span>Sürüm</span><strong>v${escapeHtml(String(k['Sürüm'] || 1))}</strong></div>
      <div><span>Biçim Riski</span><strong>${escapeHtml(String(k['Format Riski'] || '—'))}</strong></div>
      <div><span>Sağlama</span><strong><code>${escapeHtml(String(k['Sağlama (MD5)'] || '—'))}</code></strong></div>
      <div><span>Sağlama Yöntemi</span><strong>${escapeHtml(String(k['Sağlama Yöntemi'] || '—'))}</strong></div>
      <div><span>Son Kontrol</span><strong>${korTarih(k['Son Bütünlük Kontrolü'])} — ${escapeHtml(String(k['Bütünlük Durumu'] || ''))}</strong></div>
    </div>
    ${k['Format Notu'] ? `<div class="kor-format-not">🧬 ${escapeHtml(String(k['Format Notu']))}</div>` : ''}

    <hr class="divider">
    <div class="su-form-izgara">
      <div class="form-group">
        <label for="kor-doi">DOI <small style="color:var(--text-muted);">(DataCite üyeliği alındığında)</small></label>
        <input type="text" id="kor-doi" value="${escapeHtml(String(k['DOI'] || ''))}" placeholder="10.5281/zenodo.123456" ${yazabilir ? '' : 'disabled'}>
      </div>
      <div class="form-group">
        <label for="kor-baslik-alan">Başlık</label>
        <input type="text" id="kor-baslik-alan" value="${escapeHtml(String(k['Başlık'] || ''))}" ${yazabilir ? '' : 'disabled'}>
      </div>
      <div class="form-group su-tam-satir">
        <label class="muze-onay">
          <input type="checkbox" id="kor-kamuya-acik" ${acik ? 'checked' : ''} ${yazabilir ? '' : 'disabled'}>
          🌍 Kalıcı tanımlayıcı çözümleyicisinde içeriği kamuya aç
        </label>
        <small class="settings-desc">
          Kapalıyken çözümleyici tanımlayıcının geçerli olduğunu doğrular ama dosyaya erişim vermez
          (mezar taşı yanıtı). Açtığınızda başlık, biçim ve erişim bağlantısı herkese görünür olur.
        </small>
      </div>
      <div class="form-group su-tam-satir">
        <label for="kor-notlar">Notlar</label>
        <input type="text" id="kor-notlar" value="${escapeHtml(String(k['Notlar'] || ''))}" ${yazabilir ? '' : 'disabled'}>
      </div>
    </div>

    <hr class="divider">
    <h3>📜 Sürüm Geçmişi</h3>
    <div id="kor-surum-listesi"><div class="materyal-bos">Yükleniyor...</div></div>
  `;

  const kopyaBtn = document.getElementById('btn-kor-kopya');
  if (kopyaBtn) kopyaBtn.classList.toggle('hidden', !yazabilir);

  document.getElementById('dialog-koruma').showModal();

  const res = await apiPost('koruma_surumler', { pid: pid });
  const liste = document.getElementById('kor-surum-listesi');
  if (!liste) return;
  const surumler = (res && res.success) ? (res.surumler || []) : [];
  liste.innerHTML = surumler.length
    ? `<ul class="kor-surumler">` + surumler.map((s) => `
        <li>
          <span class="kor-surum-no">v${escapeHtml(String(s['Sürüm']))}</span>
          <span class="kor-surum-tarih">${korTarih(s['Tarih'])}</span>
          <strong>${escapeHtml(String(s['Olay'] || ''))}</strong>
          <span class="kor-surum-not">${escapeHtml(String(s['Açıklama'] || ''))}</span>
          <span class="kor-surum-kul">${escapeHtml(String(s['Kullanıcı'] || ''))}</span>
        </li>`).join('') + `</ul>`
    : '<div class="materyal-bos">Sürüm kaydı yok.</div>';
}

async function korKaydet() {
  if (!_korAcikKayit || !korYazabilir()) return;
  const payload = {
    pid: _korAcikKayit['PID'],
    doi: document.getElementById('kor-doi').value.trim(),
    baslik: document.getElementById('kor-baslik-alan').value.trim(),
    kamuyaAcik: document.getElementById('kor-kamuya-acik').checked,
    notlar: document.getElementById('kor-notlar').value.trim()
  };
  // Kamuya açmak dışa dönük bir karardır: nesnenin künyesi ve erişim bağlantısı
  // anahtarsız çözümleyiciden herkese görünür hale gelir.
  const oncekiAcik = String(_korAcikKayit['Kamuya Açık'] || '').toUpperCase() === 'EVET';
  if (payload.kamuyaAcik && !oncekiAcik) {
    const onay = confirm(
      '"' + (payload.baslik || payload.pid) + '" kalıcı tanımlayıcı çözümleyicisinde KAMUYA AÇILACAK.\n\n' +
      'Başlığı, dosya biçimi, sağlama toplamı ve erişim bağlantısı, adresi bilen herkes tarafından ' +
      'anahtarsız görülebilir hale gelir.\n\nDevam edilsin mi?'
    );
    if (!onay) return;
  }

  toggleLoading(true, 'Koruma kaydı güncelleniyor...');
  const res = await apiPost('koruma_kayit_guncelle', payload);
  toggleLoading(false);
  if (res && res.success) {
    showToast('Kayıt güncellendi.', 'success');
    document.getElementById('dialog-koruma').close();
    await syncKoruma(true);
  } else {
    showToast('Güncellenemedi: ' + ((res && res.error) || ''), 'danger');
  }
}

async function korDefterAl() {
  const onay = confirm(
    'Eğitim materyalleri, 3D prototipler ve envanter görselleri koruma kayıt defterine alınacak.\n\n' +
    'Her nesneye kalıcı tanımlayıcı verilir ve sağlama toplamı kaydedilir. Dosyalara dokunulmaz.\n\n' +
    'Devam edilsin mi?'
  );
  if (!onay) return;
  toggleLoading(true, 'Kayıt defteri güncelleniyor (dosyalar Drive üzerinden okunuyor)...');
  const res = await apiPost('koruma_defter_al', { limit: 80 });
  toggleLoading(false);
  if (res && res.success) {
    showToast(res.message + (res.kalanAday > 0 ? ' Kalan ' + res.kalanAday + ' nesne için tekrar çalıştırın.' : ''),
      'success');
    await syncKoruma(true);
  } else {
    showToast('İşlem başarısız: ' + ((res && res.error) || ''), 'danger');
  }
}

async function korButunlukTara() {
  toggleLoading(true, 'Bütünlük taranıyor...');
  const res = await apiPost('koruma_butunluk_tara', { limit: 60 });
  toggleLoading(false);
  if (!res || !res.success) {
    showToast('Tarama başarısız: ' + ((res && res.error) || ''), 'danger');
    return;
  }
  const s = res.sonuc || {};
  const sorun = (s.degisti || 0) + (s.kayip || 0);
  showToast(res.message + ' Doğrulandı: ' + (s.dogrulandi || 0) +
    (sorun ? ' · SORUNLU: ' + sorun : ''), sorun ? 'warning' : 'success');
  if ((res.bulgular || []).length) console.warn('Bütünlük bulguları:', res.bulgular);
  await syncKoruma(true);
}

async function korFormatRaporu() {
  toggleLoading(true, 'Biçim raporu hazırlanıyor...');
  const res = await apiPost('koruma_format_raporu');
  toggleLoading(false);
  if (!res || !res.success) {
    showToast('Rapor alınamadı: ' + ((res && res.error) || ''), 'danger');
    return;
  }
  const govde = document.getElementById('kor-format-govde');
  const dagilim = res.riskDagilimi || {};
  govde.innerHTML = `
    <div class="kor-risk-ozet">
      ${['Düşük', 'Orta', 'Yüksek', 'Bilinmiyor'].map((r) => `
        <div class="kor-risk-kart kor-${KOR_RISK_STIL[r]}">
          <strong>${dagilim[r] || 0}</strong><span>${r} risk</span>
        </div>`).join('')}
    </div>
    <h3>Biçim Dağılımı</h3>
    <div class="table-responsive">
      <table class="data-table">
        <thead><tr><th>Biçim</th><th>Adet</th><th>Toplam Boyut</th><th>Risk</th></tr></thead>
        <tbody>
          ${(res.biçimler || []).map((b) => `<tr>
            <td><code>${escapeHtml(String(b['biçim']))}</code></td>
            <td>${b.adet}</td><td>${korBayt(b.bayt)}</td>
            <td><span class="kor-rozet kor-${KOR_RISK_STIL[b.risk] || 'notr'}">${escapeHtml(b.risk)}</span></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${(res.riskliNesneler || []).length ? `
      <h3 style="margin-top:1.5rem;">Göç Gerektiren Nesneler</h3>
      <p class="settings-desc">Otomatik dönüştürülebilenler için nesne detayından "Koruma Kopyası Üret" kullanılabilir.</p>
      <ul class="kor-riskli-liste">
        ${res.riskliNesneler.map((n) => `<li>
          <code>${escapeHtml(n.pid)}</code>
          <strong>${escapeHtml(n.dosyaAdi)}</strong>
          <span class="kor-rozet kor-${KOR_RISK_STIL[n.risk] || 'notr'}">${escapeHtml(n.risk)}</span>
          ${n.donusturulebilir ? '<span class="kor-donusur">otomatik dönüştürülebilir</span>' : '<span class="kor-elle">elle dönüştürülmeli</span>'}
          <small>${escapeHtml(n.not)}</small>
        </li>`).join('')}
      </ul>` : '<div class="materyal-bos" style="margin-top:1rem;">Yüksek riskli biçim yok. 👍</div>'}
  `;
  document.getElementById('dialog-koruma-format').showModal();
}

async function korKopyaUret() {
  if (!_korAcikKayit) return;
  const onay = confirm(
    '"' + String(_korAcikKayit['Dosya Adı']) + '" dosyasından PDF koruma kopyası üretilecek.\n\n' +
    'Asıl dosyaya dokunulmaz; kopya ayrı bir Drive klasörüne yazılır ve sürüm kütüğüne işlenir.\n\n' +
    'Devam edilsin mi?'
  );
  if (!onay) return;
  toggleLoading(true, 'Koruma kopyası üretiliyor...');
  const res = await apiPost('koruma_kopya_uret', { pid: _korAcikKayit['PID'] });
  toggleLoading(false);
  if (res && res.success) {
    showToast(res.message, 'success');
    document.getElementById('dialog-koruma').close();
    await syncKoruma(true);
  } else {
    showToast(res && res.error ? res.error : 'Kopya üretilemedi.', 'warning');
  }
}

// ---------------------------------------------------------------------------
// 2) E-BÜLTEN
// ---------------------------------------------------------------------------
const BLT_DURUM_STIL = {
  'Onaylı': 'badge-success', 'Onay Bekliyor': 'badge-warning',
  'Çıktı': 'badge-role', 'Hatalı': 'badge-danger'
};
const BLT_GONDERIM_STIL = {
  'Taslak': 'notr', 'Gönderiliyor': 'aktif', 'Tamamlandı': 'iyi', 'Durduruldu': 'kotu'
};

let _bltSyncIslemi = null;

async function syncBulten(sessiz) {
  if (!STATE.currentUser || STATE.currentUser.role !== 'admin') return null;
  if (_bltSyncIslemi) return _bltSyncIslemi;
  if (!sessiz) toggleLoading(true, 'Bülten verileri yükleniyor...');
  _bltSyncIslemi = (async () => {
    const res = await apiPost('get_bulten');
    if (res && res.success) {
      STATE.bulten = {
        aboneler: res.aboneler || [],
        gonderimler: res.gonderimler || [],
        ozet: res.ozet || null,
        segmentler: res.segmentler || [],
        durumlar: res.durumlar || [],
        kota: res.kota || null
      };
      modulOnbellegeYaz('bulten');
      bltSecenekleriDoldur();
      renderBulten();
    } else if (!sessiz) {
      showToast('Bülten verileri alınamadı: ' + ((res && res.error) || ''), 'danger');
    }
    return res;
  })();
  try { return await _bltSyncIslemi; }
  finally { _bltSyncIslemi = null; if (!sessiz) toggleLoading(false); }
}

function bltSecenekleriDoldur() {
  const segmentler = STATE.bulten.segmentler || [];
  const durumlar = STATE.bulten.durumlar || [];
  const doldur = (id, liste, tumu) => {
    const el = document.getElementById(id);
    if (!el) return;
    const secili = el.value;
    el.innerHTML = (tumu ? `<option value="all">${tumu}</option>` : '') +
      liste.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    if (secili) el.value = secili;
  };
  doldur('blt-yeni-segment', segmentler, '');
  doldur('blt-filtre-segment', segmentler, 'Tüm segmentler');
  doldur('blt-filtre-durum', durumlar, 'Tüm durumlar');
  const segEl = document.getElementById('blt-segment');
  if (segEl) {
    const secili = segEl.value;
    segEl.innerHTML = '<option value="Tümü">Tümü (onaylı tüm aboneler)</option>' +
      segmentler.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    if (secili) segEl.value = secili;
  }
}

function bltKayitKodu() {
  const kok = STATE.sheetUrl || '<APPS_SCRIPT_URL>';
  return `<!-- meb.k12.tr sayfanıza ekleyin -->
<form action="${kok}" method="get" target="_blank">
  <input type="hidden" name="kaynak" value="bulten/kayit">
  <input type="hidden" name="segment" value="Genel">
  <input type="email" name="eposta" placeholder="E-posta adresiniz" required>
  <input type="text"  name="ad"     placeholder="Ad Soyad (isteğe bağlı)">
  <button type="submit">E-bültene kayıt ol</button>
</form>`;
}

function renderBulten() {
  const ozet = STATE.bulten.ozet;
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  if (ozet) {
    setText('blt-stat-onayli', ozet.onayli);
    setText('blt-stat-bekleyen', ozet.bekleyen);
    setText('blt-stat-cikan', ozet.cikan + ozet.hatali);
  }
  const kota = STATE.bulten.kota;
  setText('blt-stat-kota', kota ? (kota.kalan < 0 ? 'okunamadı' : kota.kalan + ' e-posta') : '—');

  const kodEl = document.getElementById('blt-kayit-kod');
  if (kodEl) kodEl.textContent = bltKayitKodu();

  // --- Abone tablosu ---
  const tbody = document.getElementById('blt-abone-tbody');
  if (tbody) {
    const arama = (document.getElementById('blt-arama')?.value || '').toLowerCase().trim();
    const fDurum = document.getElementById('blt-filtre-durum')?.value || 'all';
    const fSegment = document.getElementById('blt-filtre-segment')?.value || 'all';

    const suzulmus = (STATE.bulten.aboneler || []).filter((a) => {
      if (fDurum !== 'all' && String(a['Durum']) !== fDurum) return false;
      if (fSegment !== 'all' && String(a['Segment']) !== fSegment) return false;
      if (!arama) return true;
      return String(a['E-posta']).toLowerCase().includes(arama) ||
             String(a['Ad Soyad'] || '').toLowerCase().includes(arama);
    });

    setText('blt-sayac', suzulmus.length + ' / ' + (STATE.bulten.aboneler || []).length + ' abone');
    const bos = document.getElementById('blt-abone-bos');
    if (bos) bos.classList.toggle('hidden', (STATE.bulten.aboneler || []).length > 0);

    tbody.innerHTML = suzulmus.map((a) => {
      const durum = String(a['Durum']);
      return `
        <tr>
          <td data-label="E-posta"><code>${escapeHtml(String(a['E-posta']))}</code></td>
          <td data-label="Ad">${escapeHtml(String(a['Ad Soyad'] || '—'))}</td>
          <td data-label="Segment">${escapeHtml(String(a['Segment'] || 'Genel'))}</td>
          <td data-label="Durum"><span class="badge ${BLT_DURUM_STIL[durum] || 'badge-role'}">${escapeHtml(durum)}</span></td>
          <td data-label="Kayıt">${korTarih(a['Kayıt Tarihi'])}</td>
          <td data-label="Onay">${a['Onay Tarihi'] ? korTarih(a['Onay Tarihi']) : '—'}</td>
          <td data-label="Gönderim">${escapeHtml(String(a['Gönderim Sayısı'] || 0))}</td>
          <td>
            ${durum !== 'Çıktı' ? `<button class="btn btn-sm btn-text" data-blt-cikar="${escapeHtml(String(a['E-posta']))}" title="Listeden çıkar">🚪</button>` : ''}
            <button class="btn btn-sm btn-text" data-blt-sil="${escapeHtml(String(a['E-posta']))}" title="Kaydı kalıcı sil (KVKK)">🗑️</button>
          </td>
        </tr>`;
    }).join('');
  }

  // --- Bülten listesi ---
  const liste = document.getElementById('blt-liste');
  if (!liste) return;
  const gonderimler = STATE.bulten.gonderimler || [];
  if (!gonderimler.length) {
    liste.innerHTML = '<div class="materyal-bos">Henüz bülten oluşturulmadı.</div>';
    return;
  }
  liste.innerHTML = gonderimler.map((g) => {
    const durum = String(g['Durum']);
    const hedef = parseInt(g['Hedef Sayısı'], 10) || 0;
    const gonderilen = parseInt(g['Gönderilen'], 10) || 0;
    const yuzde = hedef > 0 ? Math.round((gonderilen / hedef) * 100) : 0;
    return `
      <div class="blt-kart blt-${BLT_GONDERIM_STIL[durum] || 'notr'}">
        <div class="blt-kart-ust">
          <div>
            <strong>${escapeHtml(String(g['Başlık']))}</strong>
            <small>${escapeHtml(String(g['ID']))} · ${escapeHtml(String(g['Segment']))}</small>
          </div>
          <span class="blt-durum">${escapeHtml(durum)}</span>
        </div>
        <span class="blt-konu">${escapeHtml(String(g['Konu']))}</span>
        ${hedef > 0 ? `
          <div class="blt-ilerleme"><div class="blt-ilerleme-dolu" style="width:${yuzde}%"></div></div>
          <small class="blt-ilerleme-metin">${gonderilen} / ${hedef} gönderildi${
            parseInt(g['Başarısız'], 10) ? ' · ' + g['Başarısız'] + ' başarısız' : ''}</small>` : ''}
        <div class="blt-kart-islem">
          <button class="btn btn-sm btn-text" data-blt-duzenle="${escapeHtml(String(g['ID']))}">✏️ Aç</button>
          ${durum === 'Taslak' || durum === 'Durduruldu'
            ? `<button class="btn btn-sm btn-primary" data-blt-gonder="${escapeHtml(String(g['ID']))}">📤 Gönder</button>` : ''}
          ${durum === 'Gönderiliyor'
            ? `<button class="btn btn-sm btn-primary" data-blt-gonder="${escapeHtml(String(g['ID']))}">▶️ Devam Et</button>
               <button class="btn btn-sm btn-text" data-blt-durdur="${escapeHtml(String(g['ID']))}">⏸️ Durdur</button>` : ''}
        </div>
      </div>`;
  }).join('');
}

function bltTaslakYukle(id) {
  const g = (STATE.bulten.gonderimler || []).find((x) => String(x['ID']) === String(id));
  if (!g) return;
  document.getElementById('blt-id').value = g['ID'];
  document.getElementById('blt-baslik').value = g['Başlık'];
  document.getElementById('blt-konu').value = g['Konu'];
  document.getElementById('blt-icerik').value = g['İçerik'];
  document.getElementById('blt-segment').value = g['Segment'] || 'Tümü';
  document.getElementById('blt-editor-baslik').textContent = '✉️ ' + g['ID'] + ' — ' + g['Durum'];
  // Alt sekmeyi bültenler sekmesine getir
  const sekme = document.querySelector('#bulten-view [data-subtarget="bulten-gonderim-subview"]');
  if (sekme) sekme.click();
  document.getElementById('blt-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function bltFormTemizle() {
  const form = document.getElementById('blt-form');
  if (form) form.reset();
  document.getElementById('blt-id').value = '';
  document.getElementById('blt-editor-baslik').textContent = '✉️ Yeni Bülten';
}

async function bltTaslakKaydet() {
  const payload = {
    id: document.getElementById('blt-id').value.trim(),
    baslik: document.getElementById('blt-baslik').value.trim(),
    konu: document.getElementById('blt-konu').value.trim(),
    icerik: document.getElementById('blt-icerik').value.trim(),
    segment: document.getElementById('blt-segment').value
  };
  if (!payload.baslik || !payload.konu || !payload.icerik) {
    showToast('Başlık, konu ve içerik zorunludur.', 'warning');
    return;
  }
  toggleLoading(true, 'Taslak kaydediliyor...');
  const res = await apiPost('bulten_taslak_kaydet', payload);
  toggleLoading(false);
  if (res && res.success) {
    showToast(res.message, 'success');
    document.getElementById('blt-id').value = res.id || payload.id;
    await syncBulten(true);
  } else {
    showToast('Kaydedilemedi: ' + ((res && res.error) || ''), 'danger');
  }
}

async function bltGonder(id) {
  const g = (STATE.bulten.gonderimler || []).find((x) => String(x['ID']) === String(id));
  if (!g) return;
  const durum = String(g['Durum']);
  // İlk gönderim geri alınamaz: e-posta gittikten sonra geri çağrılamaz.
  if (durum === 'Taslak') {
    const hedefMetni = g['Segment'] === 'Tümü' ? 'onaylı tüm abonelere' : `"${g['Segment']}" segmentine`;
    const onay = confirm(
      '"' + g['Başlık'] + '" bülteni ' + hedefMetni + ' gönderilecek.\n\n' +
      'Gönderilen e-postalar GERİ ALINAMAZ. Kota yetmezse gönderim kaldığı yerden otomatik sürer.\n\n' +
      'Önce bir deneme gönderdiğinizden emin olun. Devam edilsin mi?'
    );
    if (!onay) return;
  }
  toggleLoading(true, 'Gönderim işleniyor...');
  const res = await apiPost('bulten_gonder', { id: id });
  toggleLoading(false);
  if (res && res.success) {
    showToast(res.message, res.sonuc && res.sonuc.bitti ? 'success' : 'info');
    await syncBulten(true);
  } else {
    showToast('Gönderilemedi: ' + ((res && res.error) || ''), 'danger');
  }
}

async function bltDeneme() {
  const id = document.getElementById('blt-id').value.trim();
  if (!id) { showToast('Önce taslağı kaydedin.', 'warning'); return; }
  const adres = prompt('Deneme e-postası hangi adrese gönderilsin?', STATE.currentUser?.username || '');
  if (!adres) return;
  toggleLoading(true, 'Deneme gönderiliyor...');
  const res = await apiPost('bulten_deneme', { id: id, eposta: adres.trim() });
  toggleLoading(false);
  showToast(res && res.success ? res.message : ('Gönderilemedi: ' + ((res && res.error) || '')),
    res && res.success ? 'success' : 'danger');
}

async function bltAboneEkle() {
  const eposta = document.getElementById('blt-yeni-eposta').value.trim();
  if (!eposta) { showToast('E-posta adresi girin.', 'warning'); return; }
  toggleLoading(true, 'Onay daveti gönderiliyor...');
  const res = await apiPost('bulten_abone_ekle', {
    eposta: eposta,
    ad: document.getElementById('blt-yeni-ad').value.trim(),
    segment: document.getElementById('blt-yeni-segment').value
  });
  toggleLoading(false);
  if (res && res.success) {
    showToast(res.message, 'success');
    document.getElementById('dialog-bulten-abone').close();
    await syncBulten(true);
  } else {
    showToast('Eklenemedi: ' + ((res && res.error) || ''), 'danger');
  }
}

function bltCsvIndir() {
  const aboneler = STATE.bulten.aboneler || [];
  if (!aboneler.length) { showToast('Dışa aktarılacak abone yok.', 'warning'); return; }
  const sutunlar = ['E-posta', 'Ad Soyad', 'Segment', 'Durum', 'Kayıt Tarihi', 'Onay Tarihi', 'Gönderim Sayısı'];
  const kacis = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const csv = [sutunlar.map(kacis).join(';')]
    .concat(aboneler.map((a) => sutunlar.map((k) => kacis(a[k])).join(';'))).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'bulten_aboneleri_' + new Date().toISOString().split('T')[0] + '.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  showToast(aboneler.length + ' abone CSV olarak indirildi.', 'success');
}

// ---------------------------------------------------------------------------
// 3) İŞ ZEKÂSI / VERİ AMBARI
// ---------------------------------------------------------------------------
const BI_DURUM_STIL = {
  'Hedefte': 'iyi', 'İzlemede': 'notr', 'Uyarı': 'uyari', 'Kritik': 'kotu', 'Veri Yok': 'bos'
};

let _biSyncIslemi = null;

async function syncBI(sessiz) {
  if (_biSyncIslemi) return _biSyncIslemi;
  if (!sessiz) toggleLoading(true, 'Veri ambarı okunuyor...');
  _biSyncIslemi = (async () => {
    const res = await apiPost('dw_pano', {});
    if (res && res.success) {
      STATE.bi = {
        kpiler: res.kpiler || [],
        kpiTanimlari: res.kpiTanimlari || [],
        metrikler: res.metrikler || [],
        boyutlar: res.boyutlar || [],
        seri: res.seri || [],
        uyarilar: res.uyarilar || [],
        tarihAraligi: res.tarihAraligi || [],
        toplamOlcum: res.toplamOlcum || 0,
        arsiv: res.arsiv || null
      };
      renderBI();
    } else if (!sessiz) {
      showToast('Veri ambarı okunamadı: ' + ((res && res.error) || ''), 'danger');
    }
    return res;
  })();
  try { return await _biSyncIslemi; }
  finally { _biSyncIslemi = null; if (!sessiz) toggleLoading(false); }
}

function renderBI() {
  const bi = STATE.bi;

  // Kapsam bilgisi
  const kapsam = document.getElementById('bi-kapsam');
  if (kapsam) {
    const gun = bi.tarihAraligi.length;
    kapsam.textContent = gun
      ? ` Şu an ${bi.toplamOlcum} ölçüm, ${gun} güne yayılı (${bi.tarihAraligi[0]} — ${bi.tarihAraligi[gun - 1]}).`
      : ' Henüz ölçüm yok — "Anlık Görüntü Al" ile ilk fotoğrafı çekin.';
  }

  // KPI karneleri
  const izgara = document.getElementById('bi-kpi-izgara');
  if (izgara) {
    izgara.innerHTML = bi.kpiler.length ? bi.kpiler.map((k) => {
      const sinif = BI_DURUM_STIL[k.durum] || 'notr';
      const deger = (k.deger === null || k.deger === undefined)
        ? '—' : Number(k.deger).toLocaleString('tr-TR');
      let egilim = '';
      if (k.degisim !== null && k.degisim !== undefined && k.degisim !== 0) {
        // Değişimin "iyi" mi "kötü" mü olduğu metriğin yönüne bağlıdır.
        const artti = k.degisim > 0;
        const iyi = (k.yon === 'Düşük İyi') ? !artti : artti;
        egilim = `<span class="bi-egilim ${iyi ? 'bi-egilim-iyi' : 'bi-egilim-kotu'}">
          ${artti ? '▲' : '▼'} ${Math.abs(k.degisim).toLocaleString('tr-TR')}</span>`;
      }
      return `
        <div class="bi-kart bi-${sinif}">
          <div class="bi-kart-ust">
            <span class="bi-kart-ad">${escapeHtml(k.aciklama || k.metrik)}</span>
            <span class="bi-kart-durum">${escapeHtml(k.durum)}</span>
          </div>
          <div class="bi-kart-deger">${deger}<small>${escapeHtml(k.birim || '')}</small>${egilim}</div>
          <div class="bi-kart-alt">
            <span>Hedef: ${Number(k.hedef).toLocaleString('tr-TR')} ${escapeHtml(k.birim || '')}</span>
            <span>${escapeHtml(k.boyut === 'TOPLAM' ? '' : k.boyut)}</span>
          </div>
        </div>`;
    }).join('') : '<div class="materyal-bos">Tanımlı KPI yok veya henüz ölçüm alınmadı.</div>';
  }

  // Uyarılar
  const uyariKutu = document.getElementById('bi-uyari-listesi');
  if (uyariKutu) {
    uyariKutu.innerHTML = bi.uyarilar.length
      ? bi.uyarilar.map((u) => `
        <div class="bi-uyari bi-${BI_DURUM_STIL[u.durum] || 'notr'}">
          <span class="bi-uyari-tarih">${korTarih(u.tarih)}</span>
          <strong>${escapeHtml(u.durum)}</strong>
          <span class="bi-uyari-mesaj">${escapeHtml(u.mesaj)}</span>
        </div>`).join('')
      : '<div class="materyal-bos">Eşik aşımı yok. 👍</div>';
  }

  // Metrik/boyut seçicileri
  const metrikEl = document.getElementById('bi-metrik');
  if (metrikEl && bi.metrikler.length) {
    const secili = metrikEl.value;
    metrikEl.innerHTML = bi.metrikler.map((m) =>
      `<option value="${escapeHtml(m.metrik)}">${escapeHtml(m.alan)} · ${escapeHtml(m.metrik)}</option>`).join('');
    if (secili && bi.metrikler.some((m) => m.metrik === secili)) metrikEl.value = secili;
  }
  const boyutEl = document.getElementById('bi-boyut');
  if (boyutEl) {
    const seciliMetrik = metrikEl ? metrikEl.value : '';
    const boyutlar = [...new Set(bi.seri.filter((s) => !seciliMetrik || s.metrik === seciliMetrik)
      .map((s) => s.boyut))].sort();
    const secili = boyutEl.value;
    boyutEl.innerHTML = boyutlar.map((b) => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join('');
    if (secili && boyutlar.includes(secili)) boyutEl.value = secili;
  }

  // Ölçüm kütüğü
  const tbody = document.getElementById('bi-tablo-tbody');
  if (tbody) {
    const son = bi.seri.slice(-100).reverse();
    tbody.innerHTML = son.length ? son.map((o) => `
      <tr>
        <td data-label="Tarih">${escapeHtml(o.tarih)}</td>
        <td data-label="Alan">${escapeHtml(o.alan)}</td>
        <td data-label="Metrik"><code>${escapeHtml(o.metrik)}</code></td>
        <td data-label="Boyut">${escapeHtml(o.boyut)}</td>
        <td data-label="Değer">${Number(o.deger).toLocaleString('tr-TR')}</td>
        <td data-label="Birim">${escapeHtml(o.birim)}</td>
        <td data-label="Kaynak">${escapeHtml(o.kaynak)}</td>
      </tr>`).join('')
      : '<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:1.5rem;">Ölçüm yok.</td></tr>';
  }

  biSeriGrafigiCiz();
}

function biSeriGrafigiCiz() {
  if (!window.Chart) return;
  const ctx = document.getElementById('chart-bi-seri');
  if (!ctx) return;
  if (STATE.charts.biSeri) STATE.charts.biSeri.destroy();

  const metrik = document.getElementById('bi-metrik')?.value || '';
  const boyut = document.getElementById('bi-boyut')?.value || '';
  const nokta = (STATE.bi.seri || [])
    .filter((s) => (!metrik || s.metrik === metrik) && (!boyut || s.boyut === boyut))
    .sort((a, b) => (a.tarih < b.tarih ? -1 : 1));

  if (!nokta.length) {
    const c = ctx.getContext('2d');
    c.clearRect(0, 0, ctx.width, ctx.height);
    c.fillStyle = '#a89ebc'; c.font = '13px Inter, sans-serif'; c.textAlign = 'center';
    c.fillText('Bu metrik için ölçüm yok.', ctx.width / 2, ctx.height / 2);
    return;
  }

  const birim = nokta[0].birim || '';
  STATE.charts.biSeri = new Chart(ctx, {
    type: 'line',
    data: {
      labels: nokta.map((n) => n.tarih),
      datasets: [{
        label: metrik + (boyut && boyut !== 'TOPLAM' ? ' · ' + boyut : '') + (birim ? ' (' + birim + ')' : ''),
        data: nokta.map((n) => n.deger),
        borderColor: '#d4af37', backgroundColor: 'rgba(212,175,55,0.15)',
        tension: 0.3, pointRadius: 3, borderWidth: 2, fill: true
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#f3effa', font: { size: 11 } } } },
      scales: {
        x: { ticks: { color: '#a89ebc', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.06)' } },
        y: { ticks: { color: '#a89ebc' }, grid: { color: 'rgba(255,255,255,0.06)' } }
      }
    }
  });
}

async function biAnlikGoruntu() {
  const onay = confirm(
    'Tüm e-tablolardan güncel ölçümler toplanıp bugünün tarihiyle ambara yazılacak.\n\n' +
    'Bugün için daha önce alınmış bir görüntü varsa TAZELENİR (çift sayım olmaz).\n\nDevam edilsin mi?'
  );
  if (!onay) return;
  toggleLoading(true, 'Ölçümler toplanıyor (birden çok e-tablo okunuyor)...');
  const res = await apiPost('dw_anlik_goruntu', {});
  toggleLoading(false);
  if (res && res.success) {
    showToast(res.message + ' Alanlar: ' + (res.alanlar || []).join(', '), 'success');
    await syncBI(true);
  } else {
    showToast('Alınamadı: ' + ((res && res.error) || ''), 'danger');
  }
}

function openBiKpiPenceresi() {
  const tbody = document.getElementById('bi-kpi-tbody');
  if (tbody) {
    const tanimlar = STATE.bi.kpiTanimlari || [];
    tbody.innerHTML = tanimlar.length ? tanimlar.map((k) => `
      <tr>
        <td><code>${escapeHtml(k.metrik)}</code></td>
        <td>${escapeHtml(k.boyut)}</td>
        <td>${k.hedef}</td><td>${k.uyariEsigi}</td><td>${k.kritikEsik}</td>
        <td>${escapeHtml(k.yon)}</td>
        <td>${escapeHtml(k.eposta || '—')}</td>
        <td>
          <button class="btn btn-sm btn-text" data-bi-kpi-duzenle="${escapeHtml(k.metrik)}|${escapeHtml(k.boyut)}">✏️</button>
          <button class="btn btn-sm btn-text" data-bi-kpi-sil="${escapeHtml(k.metrik)}|${escapeHtml(k.boyut)}">🗑️</button>
        </td>
      </tr>`).join('')
      : '<tr><td colspan="8" style="text-align:center; color:var(--text-muted);">Tanımlı KPI yok.</td></tr>';
  }
  const dl = document.getElementById('bi-metrik-listesi');
  if (dl) {
    dl.innerHTML = (STATE.bi.metrikler || [])
      .map((m) => `<option value="${escapeHtml(m.metrik)}">${escapeHtml(m.alan)}</option>`).join('');
  }
  document.getElementById('dialog-bi-kpi').showModal();
}

function biKpiFormaYukle(anahtar) {
  const [metrik, boyut] = String(anahtar).split('|');
  const k = (STATE.bi.kpiTanimlari || []).find((x) => x.metrik === metrik && x.boyut === boyut);
  if (!k) return;
  const ata = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  ata('bi-kpi-metrik', k.metrik); ata('bi-kpi-boyut', k.boyut);
  ata('bi-kpi-aciklama', k.aciklama); ata('bi-kpi-birim', k.birim);
  ata('bi-kpi-hedef', k.hedef); ata('bi-kpi-uyari', k.uyariEsigi);
  ata('bi-kpi-kritik', k.kritikEsik); ata('bi-kpi-yon', k.yon); ata('bi-kpi-eposta', k.eposta);
}

async function biKpiKaydet() {
  const metrik = document.getElementById('bi-kpi-metrik').value.trim();
  if (!metrik) { showToast('Metrik adı zorunludur.', 'warning'); return; }
  const sayi = (id) => parseFloat(document.getElementById(id).value) || 0;
  toggleLoading(true, 'KPI kaydediliyor...');
  const res = await apiPost('dw_kpi_kaydet', {
    metrik: metrik,
    boyut: document.getElementById('bi-kpi-boyut').value.trim() || 'TOPLAM',
    aciklama: document.getElementById('bi-kpi-aciklama').value.trim(),
    birim: document.getElementById('bi-kpi-birim').value.trim(),
    hedef: sayi('bi-kpi-hedef'), uyariEsigi: sayi('bi-kpi-uyari'), kritikEsik: sayi('bi-kpi-kritik'),
    yon: document.getElementById('bi-kpi-yon').value,
    eposta: document.getElementById('bi-kpi-eposta').value.trim()
  });
  toggleLoading(false);
  if (res && res.success) {
    showToast(res.message, 'success');
    await syncBI(true);
    openBiKpiPenceresi();
  } else {
    showToast('Kaydedilemedi: ' + ((res && res.error) || ''), 'danger');
  }
}

async function biKpiSil(anahtar) {
  const [metrik, boyut] = String(anahtar).split('|');
  if (!confirm(metrik + ' / ' + boyut + ' KPI hedefi silinecek. Devam edilsin mi?')) return;
  const res = await apiPost('dw_kpi_sil', { metrik: metrik, boyut: boyut });
  if (res && res.success) {
    showToast(res.message, 'success');
    await syncBI(true);
    openBiKpiPenceresi();
  } else {
    showToast('Silinemedi: ' + ((res && res.error) || ''), 'danger');
  }
}

async function biArsivle() {
  if (STATE.bi.arsiv && !STATE.bi.arsiv.klasorTanimli) {
    showToast('Arşiv klasörü tanımlı değil. Apps Script içindeki YEDEK_KLASOR_ID ayarlanmalı.', 'warning');
    return;
  }
  const ay = STATE.bi.arsiv ? STATE.bi.arsiv.saklamaAy : 18;
  const onay = confirm(
    ay + ' aydan eski ölçümler Drive\'a aylık JSON bölümleri hâlinde taşınacak ve e-tablodan silinecek.\n\n' +
    'Geçmiş kaybolmaz; e-tablo hücre sınırına dayanmaz. Devam edilsin mi?'
  );
  if (!onay) return;
  toggleLoading(true, 'Arşivleniyor...');
  const res = await apiPost('dw_arsivle', {});
  toggleLoading(false);
  if (res && res.success) {
    showToast(res.message, 'success');
    await syncBI(true);
  } else {
    showToast('Arşivlenemedi: ' + ((res && res.error) || ''), 'danger');
  }
}

// ---------------------------------------------------------------------------
// KURULUM
// ---------------------------------------------------------------------------
function initKorumaBultenBI() {
  // --- Dijital koruma ---
  ['kor-arama', 'kor-filtre-durum'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change',
      el.tagName === 'INPUT' ? debounce(renderKoruma, 150) : renderKoruma);
  });
  document.getElementById('btn-kor-defter')?.addEventListener('click', korDefterAl);
  document.getElementById('btn-kor-tara')?.addEventListener('click', korButunlukTara);
  document.getElementById('btn-kor-format')?.addEventListener('click', korFormatRaporu);
  document.getElementById('kor-tablo-tbody')?.addEventListener('click', async (e) => {
    const detay = e.target.closest('[data-kor-detay]');
    if (detay) { openKorumaDetay(detay.getAttribute('data-kor-detay')); return; }
    const kopyala = e.target.closest('[data-kor-pid-kopyala]');
    if (kopyala) {
      const adres = korPidAdresi(kopyala.getAttribute('data-kor-pid-kopyala'));
      try {
        await navigator.clipboard.writeText(adres);
        showToast('Kalıcı bağlantı panoya kopyalandı.', 'success');
      } catch (err) { showToast('Kopyalanamadı: ' + adres, 'warning'); }
    }
  });
  document.getElementById('btn-kor-kaydet')?.addEventListener('click', korKaydet);
  document.getElementById('btn-kor-kopya')?.addEventListener('click', korKopyaUret);
  ['btn-kor-kapat', 'btn-kor-kapat-carpi'].forEach((id) =>
    document.getElementById(id)?.addEventListener('click', () => document.getElementById('dialog-koruma').close()));
  ['btn-korformat-kapat', 'btn-korformat-kapat-carpi'].forEach((id) =>
    document.getElementById(id)?.addEventListener('click', () => document.getElementById('dialog-koruma-format').close()));

  // --- Bülten ---
  const bltBolum = document.getElementById('bulten-view');
  if (bltBolum) {
    bltBolum.querySelectorAll('.btn-tab').forEach((tab) => {
      tab.addEventListener('click', (e) => {
        bltBolum.querySelectorAll('.btn-tab').forEach((t) => t.classList.remove('active'));
        e.currentTarget.classList.add('active');
        const hedef = e.currentTarget.getAttribute('data-subtarget');
        bltBolum.querySelectorAll('.bulten-sub-view').forEach((v) => {
          v.classList.add('hidden'); v.classList.remove('active');
        });
        const panel = document.getElementById(hedef);
        if (panel) { panel.classList.remove('hidden'); panel.classList.add('active'); }
      });
    });
  }
  document.getElementById('btn-blt-yenile')?.addEventListener('click', () => syncBulten(false));
  ['blt-arama', 'blt-filtre-durum', 'blt-filtre-segment'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change',
      el.tagName === 'INPUT' ? debounce(renderBulten, 150) : renderBulten);
  });
  document.getElementById('btn-blt-csv')?.addEventListener('click', bltCsvIndir);
  document.getElementById('btn-blt-kod-kopyala')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(bltKayitKodu());
      showToast('Form kodu panoya kopyalandı.', 'success');
    } catch (err) { showToast('Kopyalanamadı.', 'warning'); }
  });
  document.getElementById('btn-blt-abone-ekle')?.addEventListener('click', () => {
    document.getElementById('blt-yeni-eposta').value = '';
    document.getElementById('blt-yeni-ad').value = '';
    document.getElementById('dialog-bulten-abone').showModal();
  });
  document.getElementById('btn-bltabone-gonder')?.addEventListener('click', bltAboneEkle);
  ['btn-bltabone-kapat', 'btn-bltabone-kapat-carpi'].forEach((id) =>
    document.getElementById(id)?.addEventListener('click',
      () => document.getElementById('dialog-bulten-abone').close()));

  document.getElementById('blt-abone-tbody')?.addEventListener('click', async (e) => {
    const cikar = e.target.closest('[data-blt-cikar]');
    if (cikar) {
      const eposta = cikar.getAttribute('data-blt-cikar');
      if (!confirm(eposta + ' listeden çıkarılacak. Devam edilsin mi?')) return;
      const res = await apiPost('bulten_abone_durum', { eposta: eposta, durum: 'Çıktı' });
      showToast(res && res.success ? res.message : ('Hata: ' + ((res && res.error) || '')),
        res && res.success ? 'success' : 'danger');
      if (res && res.success) await syncBulten(true);
      return;
    }
    const sil = e.target.closest('[data-blt-sil]');
    if (sil) {
      const eposta = sil.getAttribute('data-blt-sil');
      if (!confirm(eposta + ' kaydı KALICI olarak silinecek (KVKK unutulma hakkı).\n\nDevam edilsin mi?')) return;
      const res = await apiPost('bulten_abone_sil', { eposta: eposta });
      showToast(res && res.success ? res.message : ('Hata: ' + ((res && res.error) || '')),
        res && res.success ? 'success' : 'danger');
      if (res && res.success) await syncBulten(true);
    }
  });

  document.getElementById('btn-blt-taslak')?.addEventListener('click', bltTaslakKaydet);
  document.getElementById('btn-blt-deneme')?.addEventListener('click', bltDeneme);
  document.getElementById('btn-blt-yeni')?.addEventListener('click', bltFormTemizle);
  document.getElementById('blt-liste')?.addEventListener('click', async (e) => {
    const duzenle = e.target.closest('[data-blt-duzenle]');
    if (duzenle) { bltTaslakYukle(duzenle.getAttribute('data-blt-duzenle')); return; }
    const gonder = e.target.closest('[data-blt-gonder]');
    if (gonder) { bltGonder(gonder.getAttribute('data-blt-gonder')); return; }
    const durdur = e.target.closest('[data-blt-durdur]');
    if (durdur) {
      if (!confirm('Gönderim durdurulacak. Gönderilmiş e-postalar geri alınamaz.\n\nDevam edilsin mi?')) return;
      const res = await apiPost('bulten_durdur', { id: durdur.getAttribute('data-blt-durdur') });
      showToast(res && res.success ? res.message : ('Hata: ' + ((res && res.error) || '')),
        res && res.success ? 'warning' : 'danger');
      if (res && res.success) await syncBulten(true);
    }
  });

  // --- İş zekâsı ---
  document.getElementById('btn-bi-yenile')?.addEventListener('click', () => syncBI(false));
  document.getElementById('btn-bi-anlik')?.addEventListener('click', biAnlikGoruntu);
  document.getElementById('btn-bi-kpi')?.addEventListener('click', openBiKpiPenceresi);
  document.getElementById('btn-bi-arsiv')?.addEventListener('click', biArsivle);
  document.getElementById('bi-metrik')?.addEventListener('change', () => { renderBI(); });
  document.getElementById('bi-boyut')?.addEventListener('change', biSeriGrafigiCiz);
  document.getElementById('btn-bikpi-kaydet')?.addEventListener('click', biKpiKaydet);
  ['btn-bikpi-kapat', 'btn-bikpi-kapat-carpi'].forEach((id) =>
    document.getElementById(id)?.addEventListener('click', () => document.getElementById('dialog-bi-kpi').close()));
  document.getElementById('bi-kpi-tbody')?.addEventListener('click', (e) => {
    const duzenle = e.target.closest('[data-bi-kpi-duzenle]');
    if (duzenle) { biKpiFormaYukle(duzenle.getAttribute('data-bi-kpi-duzenle')); return; }
    const sil = e.target.closest('[data-bi-kpi-sil]');
    if (sil) biKpiSil(sil.getAttribute('data-bi-kpi-sil'));
  });
}

// ============================================================
// UYGULAMA TEMALARI (Ayarlar → Görünüm ve Tema)
// Renkler styles.css içindeki :root[data-tema="..."] bloklarında tanımlıdır.
// Yeni tema eklemek için: styles.css'e bir blok yazın ve aşağıdaki diziye
// aynı kimlikle bir kayıt ekleyin — başka hiçbir yeri değiştirmek gerekmez.
// ============================================================

const TEMA_ANAHTARI = 'eo_tema';

const UYGULAMA_TEMALARI = [
  {
    id: 'varsayilan',
    ad: 'Mor & Altın',
    aciklama: 'Kurumsal varsayılan palet.',
    onizleme: ['#2b1450', '#d4af37', '#151120'],
    tarayiciRengi: '#2E0854'
  },
  {
    id: 'zumrut',
    ad: 'Zümrüt & Şampanya',
    aciklama: 'Koyu yeşil zemin, şampanya vurgular.',
    onizleme: ['#0b6b4f', '#e0c076', '#0d1714'],
    tarayiciRengi: '#0b6b4f'
  },
  {
    id: 'safir',
    ad: 'Safir & Buz Mavisi',
    aciklama: 'Lacivert zemin, buz mavisi vurgular.',
    onizleme: ['#12407f', '#6ec6f0', '#0b1220'],
    tarayiciRengi: '#12407f'
  },
  {
    id: 'bordo',
    ad: 'Bordo & Gül Altını',
    aciklama: 'Sıcak bordo zemin, gül altını vurgular.',
    onizleme: ['#6d1229', '#e3a68c', '#190f13'],
    tarayiciRengi: '#6d1229'
  },
  {
    id: 'bakir',
    ad: 'Antrasit & Bakır',
    aciklama: 'Nötr antrasit zemin, bakır vurgular.',
    onizleme: ['#37414f', '#d1793f', '#14171c'],
    tarayiciRengi: '#37414f'
  },
  {
    id: 'isik',
    ad: 'Gün Işığı',
    aciklama: 'Açık zeminli tema; aydınlık ortamlar için.',
    onizleme: ['#2b1450', '#a87d18', '#f5f3f9'],
    tarayiciRengi: '#f5f3f9'
  }
];

function temaBul(id) {
  return UYGULAMA_TEMALARI.find(t => t.id === id) || UYGULAMA_TEMALARI[0];
}

function aktifTema() {
  let kayitli = '';
  try { kayitli = localStorage.getItem(TEMA_ANAHTARI) || ''; } catch (e) { kayitli = ''; }
  return temaBul(kayitli || 'varsayilan').id;
}

function temaUygula(id, kaydet = true) {
  const tema = temaBul(id);

  if (tema.id === 'varsayilan') document.documentElement.removeAttribute('data-tema');
  else document.documentElement.setAttribute('data-tema', tema.id);

  // Açık temada, koyu zemin varsayan eski kurallar için sınıf da işaretlenir
  document.body.classList.toggle('light-theme', tema.id === 'isik');

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && tema.tarayiciRengi) meta.setAttribute('content', tema.tarayiciRengi);

  if (kaydet) {
    try { localStorage.setItem(TEMA_ANAHTARI, tema.id); } catch (e) { /* özel sekme vb. */ }
  }
  if (STATE) STATE.tema = tema.id;

  temaKartlariniIsaretle(tema.id);
  temaSonrasiGrafikleriTazele();
  return tema;
}

// Grafik renkleri çizim anında okunduğu için açık duran grafik yeniden çizilir
function temaSonrasiGrafikleriTazele() {
  try {
    const grafikSekmesi = document.getElementById('personel-grafik-subview');
    if (grafikSekmesi && !grafikSekmesi.classList.contains('hidden') && typeof renderProjeChart === 'function') {
      renderProjeChart();
    }
  } catch (e) { console.warn('Tema sonrası grafik tazelenemedi:', e); }
}

function temaKartlariniIsaretle(id) {
  document.querySelectorAll('#tema-grid .tema-karti').forEach(k => {
    k.classList.toggle('secili', k.getAttribute('data-tema-id') === id);
    k.setAttribute('aria-pressed', k.getAttribute('data-tema-id') === id ? 'true' : 'false');
  });
}

function temaKartlariniCiz() {
  const grid = document.getElementById('tema-grid');
  if (!grid) return;
  const secili = aktifTema();
  grid.innerHTML = UYGULAMA_TEMALARI.map(t => `
    <button type="button" class="tema-karti${t.id === secili ? ' secili' : ''}"
            data-tema-id="${t.id}" aria-pressed="${t.id === secili ? 'true' : 'false'}"
            title="${escapeHtml(t.ad)}">
      <span class="tema-onizleme" aria-hidden="true">
        ${t.onizleme.map(c => `<span style="background:${c};"></span>`).join('')}
      </span>
      <span class="tema-karti-ad">${escapeHtml(t.ad)}</span>
      <span class="tema-karti-aciklama">${escapeHtml(t.aciklama)}</span>
    </button>`).join('');
}

document.addEventListener('DOMContentLoaded', function () {
  // Kayıtlı tema index.html'deki erken betikle zaten uygulanmıştır;
  // burada yalnızca sınıf/meta gibi tamamlayıcı işler yapılır.
  temaUygula(aktifTema(), false);
  temaKartlariniCiz();

  document.getElementById('tema-grid')?.addEventListener('click', (e) => {
    const kart = e.target.closest('.tema-karti');
    if (!kart) return;
    const tema = temaUygula(kart.getAttribute('data-tema-id'));
    if (typeof showToast === 'function') showToast(`"${tema.ad}" teması uygulandı.`, 'success');
  });

  document.getElementById('btn-tema-varsayilan')?.addEventListener('click', () => {
    temaUygula('varsayilan');
    if (typeof showToast === 'function') showToast('Varsayılan temaya dönüldü.', 'info');
  });
});
