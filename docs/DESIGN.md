# Görsel tasarım: yön ve sözleşmeler

Bu belge iki şey söyler: oyunun **nasıl görünmesi gerektiği** (sanat yönü) ve bir yeniden tasarımın **neyi
kıramayacağı** (kod, test ve denetimlerin dayandığı sözleşmeler). Uygulayan kişi ya da ajan ikisini de okur.

## 1. Sanat yönü: "modern kıraathane"

Hedef: profesyonel bir oyun stüdyosundan çıkmış gibi dursun. Bu, "daha çok efekt" değil; **tutarlı bir malzeme
dili, net bir hiyerarşi, az ama kararlı renk, iyi tipografi ve her durumda okunaklılık** demek.

- **Malzemeler:** derin yeşil çuha (kimliğimiz, kalsın; ama daha zengin: merkezde ışık havuzu, kenarda vinyet,
  ince dokuma dokusu), **ceviz** ıstaka (sıcak, mat, hafif damarlı; üstünde ince **pirinç** bir çizgi/kenar),
  **fildişi** taşlar (hafif kağıt dokusu, pahlı kenar, taşın altında yere düşen yumuşak gölge, üstte ince parlama).
  Pirinç/amber tek vurgu rengi: dokunulabilir ve "sıra sende" olan her şey bu renk.
- **Işık:** tek, yukarıdan ve hafif önden gelen sıcak ışık. Gölgeler aynı yöne düşer (masa, taş, ıstaka, modal).
  Parlamalar aynı yönden gelir. Tutarsız gölge yönü amatör görünümün ilk işaretidir.
- **Hiyerarşi:** masada göz önce kendi ıstakasına, sonra ortaya (deste + gösterge), sonra rakiplere gider.
  Rakip koltukları sakin; aktif koltuk belirgin ama bağırmaz (pirinç halka + hafif parlama).
- **Tipografi:** taş rakamları **ağır, geometrik, net** (taşın kimliği budur); arayüz metni sakin ve okunaklı.
  Harf aralığı ve ağırlıkla hiyerarşi kurulur, renk çeşitliliğiyle değil. Rakamlar `tabular-nums`.
- **Hareket:** az ve amaçlı. Taş uçuşu, dağıtım, per tamamlanma parlaması, "sıra sende" nabzı. Her animasyon
  200–700 ms, yumuşak eğri; `prefers-reduced-motion` ile hepsi kapanır (mevcut kural kalır).
- **Modal/kartlar:** krem kağıt üzerinde koyu yazı, tek bir başlık stili, düğme hiyerarşisi: **birincil** (pirinç
  dolgu, koyu yazı), **ikincil** (çerçeveli), **tehlikeli yok**. Ayar satırları segmentli kontrol gibi (seçili
  parça dolu). Kenar yarıçapları ve iç boşluklar tek bir ölçekten (4-8-12-16-24).
- **Avatarlar:** her bot için ayırt edilebilir, sade bir monogram (harf + kendine ait koyu ton), fotoğraf yok.
- **Splash:** oyunun kendi dilinde: üç taşlık yelpaze ya da tek "O" taşı; yükleme noktaları yerine ince bir nabız.
- **Yapma:** neon, cam efekti (glassmorphism), gökkuşağı degrade, emoji, stok ikon. Sahte "3D" ışıma.

## 2. Kırılmaması gerekenler (sözleşmeler)

### 2.1 DOM ve sınıflar
`src/ui/view.ts`, `scripts/layout-check.mjs`, `scripts/ui-smoke.mjs` ve testler şu kancalara bakar. Hepsi aynen
kalmalı; yeni sınıf eklenebilir, bunlar silinemez/yeniden adlandırılamaz:

- `data-action`, `data-key`, `data-drop`, `data-slot`, `data-tile-id`, `data-color`, `data-level`, `data-pace`,
  `data-palette`, `data-start`
- `#app`, `[data-compact]`, `[data-palette='colorblind']`, `.paused`
- `.table`, `.board`, `.seat` (+ `.top .left .right .active`, `.avatar .name .meta .points .count`), `.center`,
  `.pile` (+ `.low .tour`), `.pile-count`, `.indicator` (+ `.has-action`), `.caption` (+ `.shown`), `.chip.show`,
  `.finish` (+ `.target .hover`), `.discard` (+ `.tl .tr .bl .br .target .takeable .empty .hover .tour`, `.hint`)
- `.status` (+ `.notice .invalidFinish .guided`), `.clock`, `.status-text`, `.hint-button` (+ `.ad`)
- `.toolbar`, `.chip` (+ `.on .help`), `details.menu`, `.menu-list`, `.meld-count` (+ `.has`), `.score`
- `.rack` (+ `.tour`), `.slot` (+ `.gap .empty`), `.tile` (+ `.back .selected .fresh .hinted .melded .flying
  .ghost .wild .fake`), `.value`, `.mark`
- `.modal-backdrop`, `.modal` (+ `.coach .menu`), `.modal-body`, `.coach-list`, `.difficulty` (+ `.label`),
  `.stats`, `.scores` (+ `tr.winner .leader .out`), `.lifetime`, `.rule`, `.detail`, `.seed`, `.match-over`,
  `.single-color`, `.hand`, `.meld`, `.new-match`, `.daily`, `.primary`, `.sr-only`
- `.splash` (+ `.dots`) `index.html` içinde

Metin düğümleri kalmalı: kontrast denetimi (`ui-smoke.mjs`) **metin içeren** öğeleri ölçer; takım işaretleri
(`.mark`) metin glifi (● ▲ ■ ◆) olarak kalsın (SVG'ye çevrilirse kontrastı ölçülemez).

### 2.2 view.ts ile paylaşılan ölçüler
`fit()` (`src/ui/view.ts`) ıstaka ve masa yüksekliğini CSS'teki gerçek yüksekliklerden hesaplar:
- ROOMY: `chrome 74` (araç çubuğu + boşluklar), `statusStrip 48`, taş 30–56 px, `minBoard 185/230`
- COMPACT: `chrome 52`, `statusStrip 40`, taş 20–40 px, `minBoard 105/150`
- CSS değişkenleri view.ts tarafından yazılır: `--tile-w`, `--btw`, `--cols`; CSS bunları okur, yeniden tanımlamaz.
Araç çubuğu, çip, durum şeridi ya da ıstaka dolgusu değişirse bu sabitler **birlikte** güncellenir, yoksa
yerleşim denetimi düşer.

### 2.3 Renk belirteçleri (testler okur)
- `:root` içinde `--red --yellow --blue --black` (standart palet) ve `#app[data-palette='colorblind'] { ... }`
  bloğunda aynı dördü: `tests/palette.test.ts` **stil dosyasından okur**. Renk körü palet kendi ailesinde
  kalmalı (kırmızı kırmızımsı vb.), üç renk körlüğü simülasyonunda en yakın çift **ΔE ≥ 20**; standart palette
  **ΔE < 10** olmalı (test bunu da ister, "fark gerçek" diye). Taş yüzünün **en koyu tonu** üzerinde her renk
  **≥ 4,5:1**.
- Taş yüzü gradyanının en koyu tonu `scripts/ui-smoke.mjs` ve `tests/palette.test.ts` içinde **`#efe5d0`**
  olarak yazılı; yüz değişirse ikisi de güncellenir.
- `--felt-hi --felt-mid --felt-lo` kontrast denetiminin zemin örnekleri; `scripts/pwa-plugin.mjs` içindeki
  `THEME_COLOR = --felt-mid`, `BACKGROUND_COLOR = --felt-lo` (`tests/pwa.test.ts` eşitliği denetler).
- `--tile-face-hi --tile-face` kontrast denetiminde kullanılır.
- Kontrast: metin **4,5:1**, büyük metin ve `.mark` **3:1**, arka planla birleştirilmiş (compositing) olarak.
  Yarı saydam şeritler ve degradelerde en kötü ton sayılır.

### 2.4 Playables ve paket
- **Dış istek yok:** Google Fonts, CDN, uzak görsel yasak (`check-bundle.mjs` ve sertifikasyon). Yazı tipi
  kullanılacaksa **paketlenir** (npm'den OFL lisanslı, ör. `@fontsource-variable/*`, `woff2`) ve `src` içinden
  içe aktarılır. Paket makul kalsın (< 1 MiB toplam hedef; bugün ~100 KiB).
- Yazı tipi **glif kapsamı**: Türkçe `ğ ş ı İ ç ö ü`, Azerbaycanca **`ə Ə`** (U+0259/U+018F), Almanca `ß ä ö ü`,
  Felemenkçe `ij`. Kapsamı olmayan bir yazı tipini arayüz metnine verme; rakam/başlık için ayrı bir "display"
  yazı tipi, gövde için `system-ui` kabul edilir. Kapsam **doğrulanır** (ör. `?lang=az` ile görsel kontrol).
- Playables derlemesi (`npm run build`) ve web derlemesi (`npm run build:web`) ikisi de geçmeli.

### 2.5 Erişilebilirlik ve hareket
- `prefers-reduced-motion: reduce` → animasyon/geçiş yok (kural `styles.css` sonunda, kalsın).
- Odak görünür (klavye): her etkileşimli öğede belirgin `:focus-visible`.
- Dokunma hedefleri ≥ 44 px (kompakt modda ≥ 32 px mevcut istisnalar dışında büyütme).
- `.sr-only` kalsın.

### 2.6 Doğrulama (hepsi geçmeli, hiçbiri atlanamaz)
```bash
npm run typecheck
npm run build            # Playables paketi + yasak API/dosya denetimi
npm test                 # birim testleri (palet, PWA, kayıt zinciri dahil) + zamanlama
npm run build:web
node scripts/layout-check.mjs --no-stress     # 18 boyut × 5 dil; LAYOUT_FONT=Verdana ile ikinci tur önerilir
node scripts/ui-smoke.mjs                      # axe + kontrast + 3 el + günün eli + bellek
node scripts/pwa-check.mjs
```
Ayrıca gözle: 390×844, 360×640, 568×320 (kompakt), 1280×720; `?lang=tr`, `?lang=az`, `?lang=de`; menü, kurallar
kartı, istatistik, sonuç ekranı; renk körü palet açık.

## 3. Varlıklar
- Simgeler: `src/pwa/icon-192.png`, `icon-512.png` ← `store/okey-icon-512.png` (`node scripts/make-icons.mjs`).
- Mağaza görselleri: `store/art.html` + `npm run assets` (`scripts/shoot-assets.mjs`, Chrome ile render);
  itch.io ekran görüntüleri `node scripts/shoot-itch.mjs`. Yeni görünüm bunlara da yansımalı.
