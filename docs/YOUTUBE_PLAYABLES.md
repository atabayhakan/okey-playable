# YouTube Playables'a yükleme

## Durum (22 Ekim 2026)

- Chrome'daki YouTube hesabıyla [Playables Developer Portal](https://www.youtube.com/playables_portal) açıldı.
  Sonuç: **"Unauthorized — Your channel is not authorized to use the Playables Developer Portal."**
  - Etkin kanal: **ULGEN Core** → yetkisiz.
  - Hesaptaki diğer profil **Hakan Atabay** → kanalı yok.
- Portal davetle çalışıyor (Private Preview). Oyun yüklenebilmesi için önce bekleme listesine
  başvurmak ve YouTube'dan kabul almak gerekiyor. Bu adım atlanamaz.
- Başvuru formu senin adına yasal beyan içerdiği için (aşağıda) gönderilmedi; senin onayına bırakıldı.
- **Oynanabilir bağlantılar hazır** (ikisi de YouTube dışında çalışan **web derlemesi**, ilerleme
  tarayıcıda kayıtlı): <https://atabayhakan.github.io/okey-playable/> (GitHub Pages, `main` dalına
  push olunca otomatik) ve <https://atabayhakan.itch.io/okey> ([docs/ITCH.md](ITCH.md)). Bekleme listesi
  formunda bağlantı istenirse bunlardan biri verilebilir. YouTube'a gidecek paket ayrı: `npm run package`.
- **Form artık erişim istiyor** (23 Ekim 2026): ilgi formu "You need access" gösteriyor; Request access
  senin adına e-posta göndereceği için basılmadı. Resmî belgeler formu hâlâ tek yol olarak gösteriyor.

## 1. Bekleme listesi / ilgi formu

Form: <https://docs.google.com/forms/d/e/1FAIpQLSdvdQ0lgIq2369aemj1O6w8R8FwGn9O5ARRGODDDUbVINCRJQ/viewform>
(Portaldaki "join the waitlist" bağlantısı da buraya gidiyor.)

**Sayfa 1** (okundu):

| Soru | Önerilen cevap |
|---|---|
| Email: "Record atabayhakan@outlook.com as the email…" | İşaretle (YouTube hesabının e-postası; istersen "Switch account" ile değiştir) |
| "I understand the bullet points listed above." | İşaretle. **Dikkat:** bununla oyunun tüm haklarının sende olduğunu ve lisanslama yetkin olduğunu beyan ediyorsun. Form yalnızca oynanabilir durumdaki oyunları kabul ediyor; bizimki oynanabilir. |
| How did you hear about YouTube Playables? | AI (ChatGPT, Gemini, etc.) |

**Sayfa 2** (sayfa 1 doldurulmadan açılmadığı için görülemedi). Muhtemel sorular için hazır metinler:

- **Game title:** Okey: Classic Tiles
- **Short description (EN):** The classic Turkish tile game. Build runs and sets or seven pairs, use the okey wildcard, and outplay three computer opponents in 20-point matches.
- **Long description (EN):** Okey is the tile game played in coffee houses across Turkey. Draw, arrange your rack and discard until your 14 tiles form runs (same color, in order) and sets (same number, different colors), or seven pairs. The indicator tile decides which tile is the okey, a wildcard that can stand in for any tile. Show the indicator's twin for a bonus point, finish with the okey for double, and be the last one standing when someone drops to zero. Plays in portrait or landscape, with touch, mouse or keyboard, in English or Turkish.
- **Kısa açıklama (TR):** Klasik okey: seri, per ve çift dizip okeyi kullan, üç bilgisayar rakibe karşı 20 puanlık maçlarda kazan.
- **Genre:** Board / Tile (yoksa Puzzle veya Card)
- **Engine / tech:** TypeScript + Vite, plain DOM (no engine), Playables SDK integrated (save, pause/resume, audio, language, score, interstitial ads)
- **State:** Playable. Single-player against 3 bots, full match scoring, EN + TR.
- **Bundle size:** ~40 KiB total
- **Developer / publisher:** ULGEN Core (onayla)
- **Oynanabilir bağlantı istenirse:** <https://atabayhakan.github.io/okey-playable/> —
  `main` dalına push olunca GitHub Actions web derlemesini otomatik yayınlıyor. Alternatif:
  <https://atabayhakan.itch.io/okey>.

## 2. Kabul gelince: portal adımları

1. <https://www.youtube.com/playables_portal> → **Add a new game**
2. Metadata: başlık, tür, açıklama, yayıncı/geliştirici (yukarıdaki metinler).
   Başlıkta, açıklamada ve küçük resimlerde logo veya marka olmamalı.
3. Bundle: `npm run package` → `release/okey-playable-v<sürüm>.zip` dosyasını yükle
   (`index.html` arşivin kökünde; build sırasında boyut ve yasaklı API denetimi otomatik yapılıyor).
4. Küçük resimler: portalın istediği en-boy oranlarında. Ölçüler yalnızca portalda
   yazıyor. Hazır olanlar `store/` altında: ikon 512×512 ve 1024×1024, kapak
   1280×720 (16:9) ve 1080×1920 (9:16). Hepsi oyunun kendi sanatından üretildi,
   **logo, marka ve yazı yok** (portal kuralı). Tasarım değişince
   `npm run assets` ile yeniden üretilir; başka bir ölçü gerekiyorsa
   `scripts/shoot-assets.mjs` içindeki `SHOTS` listesine ekle.
5. Monetization: **Interstitial açık** (oyun her 2 elde bir, el arasında istiyor), **Rewarded kapalı**
   (henüz kullanılmıyor). Reklam açılırsa portalda monetization'ı da aç.
6. **Save** → **Create release** ("Release Creation in Progress" birkaç dakika sürer).
7. **Verify and test** sekmesi: Dev Link ve Test Suite Link ile masaüstü web, mobil web, Android ve iOS'ta dene.
8. **Submit for Certification**.

## 3. Sertifikasyon öncesi kontrol listesi

- [ ] Test Suite Link'teki tüm otomatik testler geçiyor
- [ ] Dikey (9:16), kare ve yatay (16:9, 21:9) ekranlarda oynanabiliyor
- [ ] Duraklat/devam: botlar duruyor, ses kesiliyor, ilerleme kaydediliyor
- [ ] YouTube'da sessize alınca oyun sessiz
- [ ] Türkçe ve İngilizce metinler doğru
- [ ] Kayıt: el ortasında çıkıp girince el kaldığı yerden devam ediyor
- [ ] Mağaza görselleri yüklendi (`store/`) ve küçük resimlerde logo/marka yok
