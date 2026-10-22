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
```

YouTube'a yükleme durumu ve adımları: [docs/YOUTUBE_PLAYABLES.md](docs/YOUTUBE_PLAYABLES.md)

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
| Rakip zorluğu: kolay / normal / zor | Botlar ne kadar agresif taş alır, elini ne kadar korur |

Geliştirme sırasında tarayıcı konsolunda `okeyDev.pause()`, `okeyDev.resume()`,
`okeyDev.setAudio(false)`, `okeyDev.clearSave()` ile YouTube olaylarını taklit edebilirsin.
`okeyGame` / `okeyView` ile oyun durumuna doğrudan erişilebilir (yalnızca `npm run dev`; build'e girmez).

## Yapı

| Klasör | İçerik |
|---|---|
| `src/core/` | Saf oyun mantığı (DOM yok): taşlar, deste, okey/gösterge, el doğrulama (seri, per, çift, 12-13-1), eldeki per/seri bulma, tur akışı, gösterge, puanlama, botlar |
| `src/app/` | Kontrolcü (tur sırası, botlar, maç puanı, kayıt + sürüm geçişi), ıstaka düzeni, duraklatılabilir zamanlayıcı, ses |
| `src/platform/` | `ytgame` SDK sarmalayıcısı ve tipleri; Playables dışında yerel yedek |
| `src/ui/` | Masa görünümü, sürükle-bırak, stiller |
| `tests/` | Vitest testleri |
| `scripts/check-bundle.mjs` | Build sonrası boyut ve yasak API denetimi |
| `scripts/package.mjs` | `dist/` → portal için ZIP (bağımlılıksız) |

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
- [x] Kısa öğretici (kurallar kartı) ve ipucu
- [x] Animasyonlar (taş dağıtma, atma) ve ayrık sesler
- [x] İsteğe bağlı kurallar: maç uzunluğu, renkli okey, tek renk bitiş, bot zorluğu
- [x] Ödüllü reklam: ipucunun ikinci kullanımı (`requestRewardedAd`)
- [ ] Erken erişime kabul edilince resmî test paketi ile doğrulama
- [ ] Mağaza görselleri (başlıkta/küçük resimde logo olmamalı)
