# Botlar

Üç bilgisayar rakip, üç seviye. Bu belge nasıl oynadıklarını, gücün nasıl ölçüldüğünü ve ölçümün ne dediğini anlatır.

## Nasıl oynarlar

Normal ve Zor botlar **"kazanmaya kaç taş kaldı"** ölçüsüyle oynar (`src/core/distance.ts`):

- Kazanan bir el en fazla dört per/seriden oluşur (14 yer, her biri en az 3). Bir elin mesafesi, eldeki taşların en
  çok kaçının böyle bir düzende yer bulabildiğine göre hesaplanır: `mesafe = 14 − yerleşen taş`. Joker (okey)
  her boşluğa uyar, o yüzden hep yerleşir. Yedi çift için ayrı, basit bir hesap var.
- Çözücü en küçük taştan başlayıp onu atar ya da ondan başlayan her per/seriye koyar. Durum "kalan taşlar +
  kalan yer" olduğundan küçüktür: bir el için ≈0,2 ms.
- **Atış:** 15 taştan hangisi atılırsa el kazanmaya en yakın kalıyorsa o. **Alma:** soldaki taş mesafeyi
  düşürüyorsa alınır, düşürmüyorsa ortadan çekilir.
- **Normal** bunu eksiksiz yapar, ama %20 ihtimalle bir hata yapar: en iyiden en fazla bir adım kötü bir taş atar
  ya da işine yarayacak taşı almayı atlar.
- **Zor** hata yapmaz ve masada görünenleri sayar. Eşit mesafedeki atışlar arasında, **hangi taşların gelirse
  eli yaklaştıracağını** (`improvingFaces`) ve bunların kaç kopyasının hâlâ çıkabileceğini hesaplar; eli
  tamamlayacak taşın iki kopyası da yığınlarda duruyorsa o bekleyiş ölüdür. En fazla 4 adayı bu şekilde
  inceler (maliyet).
- **Kolay** eski kuralları kullanır (hangi taşlar birbirine yakın), taşları geç alır, %15 ihtimalle rastgele bir
  taş atar. Okeyi hiçbir seviye atmaz.
- **İpucu** her zaman Zor'un tavsiyesidir; "atınca kazanmaya N taş kalır" diye gerekçesini de söyler.

Botlar rakibin elini görmez; yalnızca masadaki açık bilgiyi kullanır (yığınlar, gösterge, kendi eli).

## Ölçüm

```bash
npm run bench:bots              # seviyeler: hepsi aynı seviyede ve birbirine karşı (Zor yavaş: aşağıya bak)
.\bench\run-tune.ps1 -Name x -Tune '{"outsWeight":0}' -Slices 6 -HandsPerSlice 350    # bir ayarı çok işleme bölerek dener
```

`bench/tune.test.ts` + `bench/run-tune.ps1`, botun ayar değerlerini (`tuning`, `src/core/bot.ts`) **aynı
dağıtımlarla** dener, böylece fark talih değildir; sonuç %95 gürültü payıyla verilir. Zor bot pahalı
olduğu için (aşağıda) binlerce elini tek süreçte oynatmak saatler sürer; `run-tune.ps1` işleri bölüştürür.
Rol örnekleri: `-Role hard` (bir Zor, üç Normal), `duel-normal-easy`, `all-hard`.

## Sonuçlar

"Adil pay" bir koltuğun, dört eşit oyuncu arasında, kazanan elleri bölüşürken payıdır: **%25**.

**Bu çalışmadan önce** (eski bot, her ayar 400 el): Zor, Kolaydan güçlü değildi, çünkü zorluk yalnızca "atılan taşı alma eşiğini" değiştiriyordu.

| Karşılaşma | Önce | Sonra |
|---|---|---|
| 1 Normal, 3 Kolay'a karşı | %27 ±5 | **%56,5 ±4,5** (600 el) |
| 1 Zor, 3 Kolay'a karşı | %24 ±5 | **%81,0 ±3,2** (600 el) |
| 1 Zor, 3 Normal'e karşı | %21 ±4 | **%46,1 ±2,2** (2100 el) |
| 1 Kolay, 3 Zor'a karşı | %33 ±5 | **%2,3 ±1,5** (400 el) |

| Dört koltuk aynı seviyede | Kazananla biten el | Ortanca el (atış) | Karar başına süre |
|---|---|---|---|
| Kolay | %71 (önce %71) | 73 (önce 60) | 0,4 ms |
| Normal | %87 (önce %80) | **39** (önce 59) | 4 ms |
| Zor | **%100** (önce %86) | **29** (önce 66) | 25-45 ms |

Eller her seviyede aynı dağıtımlarda oynandı. "Atış", dört oyuncunun toplamıdır; 40 atış, oyuncu başına ≈10 tur demek.

**Hedeflerle karşılaştırma** (plandaki hedefler):

| Hedef | Sonuç |
|---|---|
| Zor ≥ %40 (3 Kolay'a karşı) | ✔ %81 |
| Zor ≥ %30 (3 Normal'e karşı) | ✔ %46 |
| Normal ≥ %33 (3 Kolay'a karşı) | ✔ %56 |
| Ortanca el ≤ 45 atış | ✔ Zor 29, Normal 39 (Kolay bilerek yavaş: 73) |
| Kazananla biten el ≥ %95 | Zor ✔ (%100). Normal %87, Kolay %71: hata payları elleri kasıtlı uzatıyor. Gerçek oyunda insan da eli bitirmeye çalıştığı için bu oran yüksek olur, ama ölçülemedi |
| Karar başına ≤ 5 ms | Normal ✔ (4 ms). **Zor ✘** (25-45 ms): kesin "canlı taş" hesabı bilerek kabul edilen bir maliyet. Gücün kaynağı bu |

## Neyin işe yarayıp yaramadığı

Her biri aynı dağıtımlarda, 1 Zor vs 3 Normal, 2100 el (adil pay %25, hata payı ±1,9):

| Deneme | Sonuç |
|---|---|
| Canlı taşları, planın **deliklerinden** tahmin etmek | **%21,1** (Zor, Normal'den *kötü*: tahmin edilen plan, eşit iyi birçok plandan yalnızca biri) |
| Canlı taşları **çözücüye sorarak** saymak (`improvingFaces`) | **%29,9** |
| ...ve eşit mesafede canlı taş artıyorsa soldaki taşı da almak (`hardTakeMargin: 3`) | %30,3; kapatınca %28,5 |
| Adayları 2'ye indirmek (daha hızlı) | %27,6 |
| Sıradaki oyuncunun aldığı taşlara yarayacak taşı atmamak ("savunma") | %28,9 (savunmasız %29,9): fark yok, kodu çıkarıldı |
| Mesafe ile canlı taşı tek değerde birleştirip takas ettirmek (`hardWeight`) | hiçbir değişiklik, çıkarıldı |
| Çift cezasını 0, 1, 2 yapmak (`pairBias`) | fark yok |

Çözücü hızlandırıldı (artımlı arama: elin hesabı yeniden kullanılıyor): `improvingFaces` 7,2 → 4,8 ms.

## Bilinen sınırlar

- **Normal ve Zor çifte neredeyse hiç gitmez** (400 elde 0-1). Çift cezası ayarı gücü değiştirmedi; botlar farklı oynasın
  diye ayrıca bir çeşitlilik özelliği eklenebilir.
- **Okeyle bitirme** (okey atarak bitiş, çift puan) botlarda görülmez: bunun için, tur başında 14 taşlık eli
  *zaten* tam olan bir bot gerekir; böyle bir bot bir önceki turda bitirmiş olurdu. Sadece dağıtımı ilk alan oyuncuda
  olabilir.
- Zor, bu ölçümlere göre iyi bir insan oyuncudan güçlü olabilir; insanlara karşı kazanma oranı ölçülmedi.
  Seviyeler birbirine karşı ölçüldü.
- Sayılar bilgisayar-bilgisayar ellerinden. İnsan oyuncu eli bitirmeye çalıştığı için gerçek oyunda berabere biten
  el oranı Kolay/Normal'de daha düşük olmalı.
