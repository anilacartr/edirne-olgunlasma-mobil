/* ===========================================================================
   KATILIM BELGESİ DOĞRULAMA
   ---------------------------------------------------------------------------
   Sertifikanın üzerindeki QR kod bu sayfayı ?kod=<UUID> ile açar. Sayfa,
   Apps Script'teki "sertifika_dogrula" ucuna sorar. O uç kimlik doğrulaması
   İSTEMEZ (belgeyi doğrulayan kişi kurum personeli olmak zorunda değildir) ve
   yalnızca belgenin üzerinde zaten yazan bilgileri döndürür.
   =========================================================================== */

function apiAdresi() {
  if (window.EO_PUBLIC_CONFIG && window.EO_PUBLIC_CONFIG.sheetUrl) {
    return window.EO_PUBLIC_CONFIG.sheetUrl;
  }
  return '';
}

function esc(metin) {
  const d = document.createElement('div');
  d.textContent = String(metin == null ? '' : metin);
  return d.innerHTML;
}

function tarihYaz(t) {
  if (!t) return '—';
  const d = new Date(t);
  if (isNaN(d.getTime())) return String(t);
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function yukleniyorGoster(goster) {
  document.getElementById('yukleniyor').hidden = !goster;
  if (goster) document.getElementById('sonuc').hidden = true;
}

function sonucYaz(html, sinif) {
  const kart = document.getElementById('sonuc-kart');
  kart.classList.remove('gecerli', 'gecersiz');
  if (sinif) kart.classList.add(sinif);
  const kutu = document.getElementById('sonuc');
  kutu.innerHTML = html;
  kutu.hidden = false;
  document.getElementById('yukleniyor').hidden = true;
}

function gecersizGoster(mesaj) {
  sonucYaz(
    '<div class="durum">' +
      '<span class="durum-ikon">⚠️</span>' +
      '<div class="durum-baslik">Belge Doğrulanamadı</div>' +
      '<div class="durum-aciklama">' + esc(mesaj || 'Bu koda ait geçerli bir katılım belgesi bulunamadı.') + '</div>' +
    '</div>', 'gecersiz');
}

function gecerliGoster(d) {
  sonucYaz(
    '<div class="durum">' +
      '<span class="durum-ikon">✅</span>' +
      '<div class="durum-baslik">Belge Geçerli</div>' +
      '<div class="durum-aciklama">Bu katılım belgesi enstitümüz kayıtlarında doğrulanmıştır.</div>' +
    '</div>' +
    '<dl class="satirlar">' +
      satir('Katılımcı', d.katilimci) +
      satir('Eğitim / Kurs', d.egitim) +
      (d.atolye ? satir('Atölye / Dal', d.atolye) : '') +
      (d.egitimVeren ? satir('Eğitim Veren', d.egitimVeren) : '') +
      (d.sure ? satir('Süre', d.sure + ' saat') : '') +
      satir('Bitiş Tarihi', tarihYaz(d.bitisTarihi)) +
      satir('Veriliş Tarihi', tarihYaz(d.verilisTarihi)) +
      satir('Belge No', d.sertifikaNo) +
    '</dl>', 'gecerli');
}

function satir(etiket, deger) {
  return '<div class="satir"><dt>' + esc(etiket) + '</dt><dd>' + esc(deger || '—') + '</dd></div>';
}

async function dogrula(kod) {
  const adres = apiAdresi();
  if (!adres) {
    gecersizGoster('Doğrulama servisi yapılandırılmamış. Kurum ile iletişime geçin.');
    return;
  }
  yukleniyorGoster(true);
  try {
    const yanit = await fetch(adres, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'sertifika_dogrula', payload: { kod: kod } })
    });
    const veri = await yanit.json();
    if (veri && veri.success && veri.gecerli) gecerliGoster(veri);
    else gecersizGoster(veri && veri.mesaj ? veri.mesaj : (veri && veri.error));
  } catch (err) {
    gecersizGoster('Doğrulama servisine ulaşılamadı. İnternet bağlantınızı kontrol edin.');
  }
}

document.getElementById('kod-form').addEventListener('submit', function (e) {
  e.preventDefault();
  const kod = document.getElementById('kod-girdi').value.trim();
  if (kod) dogrula(kod);
});

// QR ile gelindiğinde kod adreste bulunur; hemen sorgulanır.
(function () {
  const kod = new URLSearchParams(window.location.search).get('kod');
  if (kod) {
    document.getElementById('kod-girdi').value = kod;
    dogrula(kod);
  } else {
    document.getElementById('yukleniyor').hidden = true;
    sonucYaz(
      '<div class="durum">' +
        '<span class="durum-ikon">🔎</span>' +
        '<div class="durum-baslik">Doğrulama Kodu Girin</div>' +
        '<div class="durum-aciklama">Belgenin alt kısmındaki doğrulama kodunu yapıştırın ya da QR kodu okutun.</div>' +
      '</div>', null);
  }
})();
