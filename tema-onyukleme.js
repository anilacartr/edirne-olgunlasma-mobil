/*
  Tema ön yükleyici
  ------------------
  Kayıtlı renk teması, sayfa boyanmadan <html> üzerine yazılır; böylece açılışta
  varsayılan renklerin bir an görünüp değişmesi (renk sıçraması) yaşanmaz.
  Ayrı dosyadır çünkü index.html'deki CSP "script-src 'self'" satır içi betiğe
  izin vermez. Tema listesi ve tüm mantık app.js içindedir; buradaki kod yalnızca
  kayıtlı değeri okuyup uygular.
*/
// Uygulama başka bir sayfanın çerçevesinde açılamaz (tıklama tuzağı). Statik yayında bu koruma
// başlıkla ve meta CSP ile verilemediği için burada yapılır; dosya sayfa boyanmadan önce çalışır.
(function () {
  if (window.top === window.self) return;
  document.documentElement.style.display = 'none';
  try { window.top.location = window.self.location.href; } catch (e) { /* çerçeve engelliyorsa sayfa gizli kalır */ }
})();

(function () {
  try {
    var tema = localStorage.getItem('eo_tema');
    if (!tema || tema === 'varsayilan') return;
    document.documentElement.setAttribute('data-tema', tema);
    if (tema === 'isik') {
      document.addEventListener('DOMContentLoaded', function () {
        document.body.classList.add('light-theme');
      });
    }
  } catch (e) {
    /* localStorage kapalıysa (gizli sekme vb.) varsayılan tema kullanılır */
  }
})();
