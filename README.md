# Okey — YouTube Playables

Tek oyunculu Okey: oyuncu + 3 bot. YouTube Playables üzerinde yayınlanmak üzere
TypeScript + Vite ile, motor kullanmadan (DOM) yazıldı.

## Komutlar

```bash
npm install
npm run dev        # http://localhost:5180  (?lang=tr, ?audio=off)
npm test           # kurallar, botlar, kayıt
npm run build      # typecheck + build + Playables bundle denetimi
npm run package    # build + release/okey-playable-v<sürüm>.zip (portala yüklenecek paket)
npm run assets     # store/ altındaki mağaza görsellerini yeniden üretir (Chrome ister)
```

```bash
npm run package:web  # web derlemesi (itch.io vb.): SDK yok, kayıt tarayıcıda -> release/okey-web-v<sürüm>.zip
npm run bench:bots   # botların gücünü ölçer: seviyeler birbirine karşı, eller kaç atışta biter (dakikalar sürer)
npm run check:layout # web derlemesini 18 ekran boyutunda başsız Chrome/Edge ile tarar: bindirme ve taşma olmamalı
                     # (bir de geniş yazı tipi turu; CI'da `--no-stress` ile yalnızca normal tur)
```

Botlar ve ölçümleri: [docs/BOTS.md](docs/BOTS.md). `?seed=<sayı>` (yalnızca `npm run dev` ve web derlemesi)
ilk eli o tohumla dağıtır; yerleşim kontrolü ve hata ayıklama için.

YouTube'a yükleme durumu ve adımları: [docs/YOUTUBE_PLAYABLES.md](docs/YOUTUBE_PLAYABLES.md) ·
itch.io: [docs/ITCH.md](docs/ITCH.md)

## Puanlama (klasik "20'den düşme")

| Durum | Diğer oyunculardan düşen |
|---|---|
| Normal bitiş (seri/per) | 2 |
| Okey atarak bitiş | 4 |
| Çiftten bitiş | 4 |
| Çiftten, okey atarak bitiş | 8 |
| Gösterge (göstergenin eşi elde; ilk turda, taş çekmeden) | 1 |
| Taşlar biterse | 0 |

Herkes 20 puanla başlar; bir elin sonunda biri 0 veya altına inerse maç biter, en yüksek
puanlı kazanır (eşitlikte paylaşılır). Sahte okey atmak "okey atarak bitiş" sayılmaz.
Değerler `src/core/scoring.ts` içinde. YouTube'a gönderilen skor kazanılan el sayısı.

**İsteğe bağlı kurallar** (kurallar kartından seçilir, kayda yazılır):

| Kural | Etkisi |
|---|---|
| Maç uzunluğu: kısa / klasik / uzun | 10 / 20 / 40 puanla başlar, sonraki maçtan itibaren |
| Renkli okey | Gösterge kırmızı ya da siyahsa okey iki kat sayılır: okey atarak bitiş 8 (çiftten 16) puan |
| Tek renk bitiş | Elin tüm taşları tek renkte bitirilirse diğerleri iki kat öder (4 / 8 / 16) |
| Rakip zorluğu: kolay / normal / zor | Rakiplerin temposu ve açgözlülüğü: kolayda yavaş ve pasif, zorda hızlı ve atış yığınından her şeyi kapar |

**Rakip zorluğu ölçüldü.** 300 el üzerinde simülasyon: rakiplerin oyun
kalitesi sonucu belirgin değiştirmiyor (dağıtım belirliyor), bu yüzden seviyeler
oyuncunun **hissedeceği** farkı üretiyor: botların düşünme süresi (kolayda
900/1100 ms, normelde 320/420 ms, zorda 180/240 ms) ve atış yığınından taş
alma açgözlülüğü (kolay 7, normal 4, zor 2). Ölçüm aracı `tests/` altında değil,
`git log` ile bakılabilir; kalıcı olan kısımları testler.

Geliştirme sırasında tarayıcı konsolunda `okeyDev.pause()`, `okeyDev.resume()`,
`okeyDev.setAudio(false)`, `okeyDev.clearSave()` ile YouTube olaylarını taklit edebilirsin.
`okeyGame` / `okeyView` ile oyun durumuna doğrudan erişilebilir (yalnızca `npm run dev`; build'e girmez).

## Hareket katmanı

Oyun bir "durum makinesi" gibi oynamasın diye her taşın nereden nereye gittiği
görünür. Masa her değişiklikte baştan çizildiği için taş, hedefteki yerine
giderken kaynak konumundan animasyonla taşınır (FLIP): kopyası çıkmaz, göz
tek bir nesneyi takip eder.

| Olay | Görünen |
|---|---|
| Oyuncu çekti | Taş desteden ızgaradaki yerine uçar |
| Oyuncu aldı | Taş atış yığınından ızgaraya uçar |
| Oyuncu attı | Taş ızakadan atış yığınına uçar |
| Bot çekti | Desteden bir taş çıkar, botun avatarına uçup kaybolur |
| Bot aldı | Yığındaki taş kalkar, botun avatarına uçup kaybolur |
| Bot attı | Avatarın üstünden bir taş atış yığınına düşer |
| Per/seri tamamlandı | O taşlar yeşil parlar |
| Gösterge gösterildi | Gösterge taşı altın parlar |
| El bitti | Masa bir an parlar, sonuç ekranı gelir |

| Dosya | İçerik |
|---|---|
| `src/app/motion.ts` | `Motion` tipi: taş nereden nereye gitti |
| `src/ui/flight.ts` | Dikdörtgen ölçümü, uçuş animasyonu, duraklatma takibi |
| `src/ui/view.ts` | `render()` içinde ölçüm → yeniden çizim → animasyon |

**Erişilebilirlik:** `prefers-reduced-motion: reduce` açıkta uçuşlar hiç
oynanmaz, durum anında değişir, oyun aynı şekilde oynanır. Duraklatıldığında
(`onPause`) uçan taşlar ve CSS animasyonları da dondurulur.

**Tempo:** rakiplerin düşünme süresi zorluk seviyesine göre (kolay 1000/1100
ms, normal 450/550 ms, zor 260/340 ms) ve taş uçuşu bu sürenin üstüne binerek
olayı görünür kılar.

## Yapı

| Klasör | İçerik |
|---|---|
| `src/core/` | Saf oyun mantığı (DOM yok): taşlar, deste, okey/gösterge, el doğrulama (seri, per, çift, 12-13-1), eldeki per/seri bulma, tur akışı, gösterge, puanlama, botlar || `src/app/` | Kontrolcü (tur sırası, botlar, maç puanı, kayıt + sürüm geçişi), ıstaka düzeni, duraklatılabilir zamanlayıcı, ses, hareket tanımları |
| `src/platform/` | `ytgame` SDK sarmalayıcısı ve tipleri; Playables dışında yerel yedek |
| `src/ui/` | Masa görünümü, sürükle-bırak, taş uçuşları, stiller |
| `tests/` | Vitest testleri |
| `scripts/check-bundle.mjs` | Build sonrası boyut ve yasak API denetimi |
| `scripts/package.mjs` | `dist/` → portal için ZIP (bağımlılıksız) |
| `scripts/shoot-assets.mjs` | `store/` görsellerini oyunun kendi CSS'inden üretir |
| `store/` | Mağaza görselleri: ikon 512/1024, kapak 16:9 ve 9:16 |

## Mağaza görselleri

`store/` altındaki görseller oyunun kendi sanatından üretiliyor: **logo, marka ve
yazı yok** (portal kuralı). Üretim `store/art.html` + oyunun derlenmiş CSS'i ile
yapılır, yani tasarım değişince `npm run assets` ile hepsi yeniden çıkar.

| Dosya | Ölçü | Kullanım |
|---|---|---|
| `okey-icon-512.png` | 512×512 | Portal ikonu |
| `okey-icon-1024.png` | 1024×1024 | Portal ikonu (büyük) |
| `okey-cover-1280x720.png` | 1280×720 | Küçük resim (16:9) |
| `okey-cover-1080x1920.png` | 1080×1920 | Küçük resim (9:16) |

Portalın istediği ölçüleri yalnızca portal yazıyor; başka bir ölçü gerektiğinde
`scripts/shoot-assets.mjs` içindeki `SHOTS` listesine ekle.

## Playables kurallarına uyum

| Kural | Nerede |
|---|---|
| SDK, oyun kodundan önce yüklenir | `index.html`; build denetimi kontrol eder |
| `firstFrameReady` → `gameReady` | `src/main.ts` (splash ekranı → masa) |
| Kayıt yalnızca `saveData`/`loadData`; önce yükle, sonra kaydet | `src/app/save.ts`, `controller.persist()`; yükleme başarısızsa hiç kaydetmez |
| `onPause`/`onResume`: her şeyi durdur, kaydet | `Scheduler` tüm bot zamanlayıcılarını dondurur, `Sound` susar |
| YouTube ses ayarı, oyunda ayrı sessize alma düğmesi yok | `src/app/sound.ts` |
| Dil `getLanguage()` ile, İngilizce zorunlu | `src/i18n.ts` |
| Her en-boy oranı, yön kilidi yok | `View.fit()`: ıstaka ekran genişliğine göre sütun sayısını kendi ayarlar; dikeyde 3-4 satır, yatayda 1-2 satır |
| Dokunma + fare (+ klavye) | Pointer Events; ←/→ taş seçer, Tab/Enter ile her şey kullanılabilir |
| Esc engellenmez | `View.onKey` |
| Harici istek, dış font, giriş ekranı, dış link yok | Sistem fontu; ağ çağrısı yok |
| Reklam yalnızca `ytgame.ads`, doğal molada | El arası interstitial (her 2 elde bir) |
| `sendScore` = kayıttaki skor | Kazanılan el sayısı |
| Worker / WebAssembly / eval / localStorage yok | Build denetimi kontrol eder |

## Oyuncuya ne gösterilir

- **Tamamlanmış per ve seriler yeşil halkayla işaretlenir.** `meldsInHand()` elde
  hazır duran perleri (aynı sayı, farklı renk) ve serileri (aynı renk, art arda;
  12-13-1 dâhil) bulur, okey de eksik taşın yerine geçer. Araç çubuğundaki
  "✓ n" sayacı bunları sayar.
- **"Düzenle → En iyi diz"** eli önce tamamlanmış grupları öne alarak dizer;
  kalan taşlar renklerine göre gruplanır. El yeni dağıtıldığında da bu dizilim
  kullanılır, yani oyuncu elini ilk andan itibaren gruplu görür.
- **İlk elde kurallar kartı** çıkar, istendiğinde araç çubuğundaki "?" ile
  yeniden açılır (`coachSeen` kayıtta tutulur, `SAVE_VERSION = 3`).
- **İpucu**: durum çubuğundaki düğme, eli bozan en az taşı gösterir (ve el
  bir taş kala bitiyorsa o taşı gösterir). Elin ilk ipucu bedavadır; eldeki
  ikinci ipucu için kısa bir ödüllü reklam izlenir (`requestRewardedAd`).
  Reklam gelmezse oyun yine devam eder, oyuncuya "reklam yok" denir.
- **Rakip zorluğu** kurallar kartından seçilir: kolay, normal, zor. Zor
  rakipler per tamamlayan taşı alır ve elini korur; kolay rakipler daha
  savunmasız oynar. Kayıtta saklanır (`SAVE_VERSION = 4`).
- **Rakip hızı** (Rahat / Hızlı): botların bekleme süresi, taş uçuşu aynı kalır.
  Orta deste 12 taşa inince sayaç amber olur: el, deste bitince biter
  (`SAVE_VERSION = 6`).
- **İstatistikler** (Menü): kazanılan el ve maç, kazanma oranı, galibiyet serisi,
  çiftle ve okeyle kazanılanlar, en hızlı galibiyet (`SAVE_VERSION = 7`).
- **Günün eli** (Menü): günde bir el, o gün herkese aynı dağıtım (tohum yerel
  takvim gününden gelir, `src/core/daily.ts`). Maç eli kenara alınır ve el
  bitince geri gelir; günün eli maç puanını ve el istatistiklerini etkilemez,
  rakipler her zaman Normal, kurallar sade oynanır. Günlük galibiyet serisi
  tutulur. YouTube'a giden skor, maçtaki ve günlük galibiyetlerin toplamıdır
  (`SAVE_VERSION = 8`).
- **İlk el rehberi**: kurallar kartını kapatan yeni oyuncuya ilk elde dört kısa
  adım gösterilir (taş seç, "Buraya at"a dokun, desteden çek, per ve seri yap) ve
  adımın konusu parlar. Durum çubuğu dar telefonda birkaç kelimelik yer bıraktığı
  için metinler 21 karakteri geçmez ve rehber sürerken süre göstergesi çekilir.
  Rehber el bitince ya da son adımdan sonra kapanır, günün elinde çalışmaz;
  kurallar kartını daha önce okumuş oyuncular hiç görmez (`SAVE_VERSION = 9`).
- **El değeri** rozeti eldeki taşların toplam değerini gösterir.
- **Bitirme** düğmesi yalnızca bir taş seçiliyken belirir; el bitince
  "Bitir" hedefi ortaya çıkar.
- **Ses**: taş çekme, atma, gösterge, per tamamlama, el bitirme ve sıra geldi
  için ayrı sesler. Hepsi sentezlenir, dosya yoktur; ilk dokunuştan önce
  AudioContext açılmaz (tarayıcı otomatik ses politikası).

## Kontrol

| Girdi | Sonuç |
|---|---|
| Dokunma / fare | Taşa dokun seçer, düğmelere basar; sürükle-bırak ıstakada taşı taşır |
| ← → | Görsel satır içinde taşı seçer (satır sonunda sonraki satıra geçer) |
| ↑ ↓ | Satırlar arasında aynı sütunda gezinir |
| Tab / Enter | Her düğme erişilebilir |
| Esc | Engellenmez (Playables buna bağlı) |

## Yapılacaklar

- [x] Puanlama ve maç yapısı
- [x] Tamamlanmış per/seri göstergesi ve "en iyi diz" düzenlemesi
- [x] Daha güçlü botlar (eli bozan taşı atmamak, per tamamlayan taşı almak)
- [x] Gerçekten farklı bot seviyeleri: "kazanmaya kaç taş kaldı" ölçüsü, Zor'da kesin "canlı taş" sayımı ([docs/BOTS.md](docs/BOTS.md))
- [x] Ölçüm altyapısı: bot bench'i, 18 ekran boyutunda yerleşim kontrolü (CI'da), el doğrulayıcısı için bağımsız kaba kuvvet testi
- [x] Kısa öğretici (kurallar kartı) ve ipucu
- [x] Animasyonlar (taş dağıtma, atma) ve ayrık sesler
- [x] Sonsuz el hatası: botlar attıkları taşı geri aldığı için deste hiç boşalmıyordu
- [x] İsteğe bağlı kurallar: maç uzunluğu, renkli okey, tek renk bitiş, bot zorluğu
- [x] Ödüllü reklam: ipucunun ikinci kullanımı (`requestRewardedAd`)
- [ ] Erken erişime kabul edilince resmî test paketi ile doğrulama
- [ ] Mağaza görselleri (başlıkta/küçük resimde logo olmamalı)
