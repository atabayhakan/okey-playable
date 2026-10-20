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

Geliştirme sırasında tarayıcı konsolunda `okeyDev.pause()`, `okeyDev.resume()`,
`okeyDev.setAudio(false)`, `okeyDev.clearSave()` ile YouTube olaylarını taklit edebilirsin.
`okeyGame` / `okeyView` ile oyun durumuna doğrudan erişilebilir (yalnızca `npm run dev`; build'e girmez).

## Yapı

| Klasör | İçerik |
|---|---|
| `src/core/` | Saf oyun mantığı (DOM yok): taşlar, deste, okey/gösterge, el doğrulama (seri, per, çift, 12-13-1), tur akışı, gösterge, puanlama, botlar |
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
| Her en-boy oranı, yön kilidi yok | `View.fit()`: yatayda 2×15, dikeyde 3×10 ıstaka |
| Dokunma + fare (+ klavye) | Pointer Events; ←/→ taş seçer, Tab/Enter ile her şey kullanılabilir |
| Esc engellenmez | `View.onKey` |
| Harici istek, dış font, giriş ekranı, dış link yok | Sistem fontu; ağ çağrısı yok |
| Reklam yalnızca `ytgame.ads`, doğal molada | El arası interstitial (her 2 elde bir) |
| `sendScore` = kayıttaki skor | Kazanılan el sayısı |
| Worker / WebAssembly / eval / localStorage yok | Build denetimi kontrol eder |

## Yapılacaklar

- [x] Puanlama ve maç yapısı
- [ ] İsteğe bağlı kurallar: renkli okey (kırmızı/siyah göstergede çift puan), tek renk bitiş, başlangıç puanı seçimi
- [ ] Daha güçlü botlar (rakibe yarayacak taşı atmamak, çifte gitme kararı)
- [ ] Animasyonlar (taş dağıtma, atma)
- [ ] Ödüllü reklam: ör. "ipucu" (`requestRewardedAd`)
- [ ] Kısa öğretici / ilk el ipuçları
- [ ] Erken erişime kabul edilince resmî test paketi ile doğrulama
- [ ] Mağaza görselleri (başlıkta/küçük resimde logo olmamalı)
