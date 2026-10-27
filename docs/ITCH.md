# itch.io'ya yükleme

YouTube Playables erişimi gelene kadar oyun itch.io'da yayınlanabilir. Aynı oyun, ayrı bir
**web derlemesi**: YouTube SDK'sı yok, ilerleme tarayıcıda kayıtlı (`localStorage`), dil tarayıcıdan seçilir,
sekme gizlenince oyun durur.

```bash
npm run package:web        # build:web + release/okey-web-v<sürüm>.zip
node scripts/shoot-itch.mjs  # store/itch/*.png (gerçek oyundan ekran görüntüleri)
```

`npm run package` hâlâ YouTube portalına gidecek ayrı paketi üretir (`okey-playable-v*.zip`).
İkisini karıştırma: `package.mjs` yanlış pakette SDK veya kayıt kodu varsa hata verir.

## Yüklemek için (≈5 dakika)

1. <https://itch.io/login> ile giriş yap (hesap yoksa "Create account").
2. <https://itch.io/game/new> → **Create new project**.
3. Aşağıdaki alanları doldur.
4. **Uploads → Upload files**: `release/okey-web-v0.2.0.zip`, ardından
   **"This file will be played in the browser"** kutusunu işaretle.
5. **Embed options**:
   - Kind of project: **HTML**
   - Viewport dimensions: **960 × 600** (ya da "Click to launch in fullscreen" açık kalsın)
   - **Mobile friendly** aç, **Fullscreen button** aç
   - "Automatically start on page load" kapalı (ses ancak dokunuşla başlar)
   - SharedArrayBuffer ve iframe izinleri: gerek yok
6. **Cover image**: `store/itch/itch-cover-630x500.png` (630×500)
7. **Screenshots**: `store/itch/itch-1-table.png`, `itch-2-table-tr.png`, `itch-3-phone.png`
8. **Visibility**: önce **Draft** kaydet, **"View page"** ile bir kere oyna, sonra **Public** yap.

## Sayfa metinleri

**Title:** Okey: Classic Tiles

**Short description / tagline:** The classic Turkish tile game against three computer players.

**Genre:** Board Game (ya da Card Game) · **Tags:** okey, tile game, rummy, turkish, board game, singleplayer, offline, casual, browser

**Kind of project:** HTML · **Pricing:** No payments (ücretsiz)

**Description (EN):**

> Okey is the tile game played in coffee houses all over Turkey, a close cousin of Rummikub.
> Draw a tile, arrange your rack and throw one away, until your 14 tiles form runs (same colour,
> in order) and sets (same number, different colours) — or seven pairs.
>
> - Play a full match against three computer players: everyone starts with 20 points, whoever
>   finishes takes points off the others, and the match ends when somebody hits zero.
> - The classic rules: the indicator and the okey (wild) tile, fake okeys, showing the indicator
>   for a bonus point, double points for finishing with the okey or with pairs.
> - Optional rules: match length, coloured okey, single-colour finish.
> - Three difficulty levels, hints, and a rules card for first-time players.
> - Works on phones, tablets and desktops, with touch, mouse or keyboard. Saves your game in the browser.
> - English and Turkish (picked from your browser, or add `?lang=tr` to the address).

**Açıklama (TR):**

> Okey, Türkiye'nin kahvehanelerinde oynanan taş oyunu. Taş çek, ıstakanı diz, bir taş at;
> 14 taşın seri ve perlerden ya da yedi çiftten oluşana kadar.
>
> - Üç bilgisayar rakibe karşı tam bir maç: herkes 20 puanla başlar, eli bitiren diğerlerinden puan
>   düşürür, biri sıfıra inince maç biter.
> - Klasik kurallar: gösterge ve okey, sahte okey, göstergeyi göstererek bonus puan, okey atarak
>   ya da çiftten bitirince çift puan.
> - İsteğe bağlı kurallar: maç uzunluğu, renkli okey, tek renk bitiş.
> - Üç zorluk seviyesi, ipucu ve ilk oynayanlar için kurallar kartı.
> - Telefon, tablet ve bilgisayarda; dokunma, fare ya da klavye ile. İlerleme tarayıcıda kayıtlı.

## Notlar

- Oyun çevrimdışı çalışır, hiçbir sunucuya istek atmaz; ilerleme yalnızca o tarayıcıda durur
  (başka tarayıcıda ya da gizli pencerede sıfırdan başlanır).
- Ses, Chrome/Safari kuralı gereği ilk dokunuştan sonra açılır.
- Yeni sürüm yüklerken aynı projeye yeni ZIP yükle (eskisini sil); kayıtlı oyunlar korunur,
  kayıt formatı eski sürümleri okur.
