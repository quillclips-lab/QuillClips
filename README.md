# QuillClips

Sadece kendi bilgisayarında çalışan kişisel clipping stüdyosu. Uzun videolardan (15 dk – 2+ saat) **brief'ine ve kampanyana en uygun**, viral potansiyeli yüksek anları bulur. Bu anları Opus'un yazdığı bir kurgu planıyla (kesimler, konuşanı takip eden kamera, zoom, animasyonlu yazılar, 3D başlık, geçişler, SFX, müzik) Remotion'da 9:16 olarak render eder. Her klip için yalnızca kampanyanın platformlarına uygun başlık, açıklama ve caption yazar.

- **AI tarafında yalnızca Claude var, API key kullanılmıyor.** Bütün LLM çağrıları `claude -p` (Claude Code CLI, headless) ile yapılıyor, yani Claude aboneliğinin limitinden düşüyor. Alt süreç başlatılırken `ANTHROPIC_API_KEY` ortamdan siliniyor.
- Ses, görüntü ve render işleri lokal ve ücretsiz araçlarla yapılıyor: faster-whisper, Kokoro / Piper, OpenCV + mediapipe, Remotion, ffmpeg.

---

## Kurulum

Gereksinimler: **Node.js 20+**, **Python 3.10–3.13**, **ffmpeg** (ffprobe dahil), **Claude Code CLI** (girişi yapılmış olmalı).

### Windows

```powershell
winget install OpenJS.NodeJS.LTS
winget install Python.Python.3.12
winget install Gyan.FFmpeg
# Claude Code: https://docs.claude.com/claude-code  → kurduktan sonra bir kez `claude` çalıştırıp aboneliğinle giriş yap
# Yeni bir terminal aç (PATH yenilensin), sonra:
cd QuillClips
npm install
npm run setup
```

### macOS

```bash
brew install node python@3.12 ffmpeg
# Claude Code kur, ardından `claude` çalıştırıp giriş yap
cd QuillClips
npm install
npm run setup
```

`npm run setup` şunları yapar:

1. `worker/.venv` içinde bir Python sanal ortamı oluşturur ve `worker/requirements.txt` bağımlılıklarını kurar.
2. Modelleri ve yardımcı dosyaları ilk kez indirir/üretir:
   - faster-whisper modeli (varsayılan `auto` → GPU varsa `large-v3-turbo`, yoksa `small`)
   - Kokoro TTS (`kokoro-v1.0.onnx` ve sesler), yedek olarak Piper sesleri
   - OpenCV YuNet yüz algılayıcı ve mediapipe FaceLandmarker (ağız hareketi → aktif konuşmacı)
   - Fontlar (`public/fonts`, OFL): Anton, Bebas Neue, Montserrat, Archivo Black. 3D yazı için bunların three.js typeface JSON'ları `public/fonts3d` klasörüne üretilir
   - SFX kütüphanesi (`assets/sfx/<tür>/qc_*.wav`): numpy ile **sentezlenir**. Lisans sorunu yoktur, CC0 olarak sayılabilir
3. Remotion'un kullandığı Chrome Headless Shell'i indirir.

Bir model indirilemezse, ilk kullanıldığı anda tekrar indirilmeye çalışılır.

## Başlatma

```bash
npm run dev
```

Bu tek komut iki şeyi birlikte açar:

- Python worker (FastAPI + iş kuyruğu): `http://127.0.0.1:8765`
- Next.js arayüzü: **http://127.0.0.1:3000**

`Ctrl+C` ikisini birden kapatır. Her şey yalnızca `127.0.0.1` adresine bağlanır. Bütün dosyalar lokalde tutulur:

| Yol | İçerik |
|---|---|
| `data/uploads` | Yüklenen kaynak videolar |
| `data/clips` | Render edilmiş klipler (MP4) ve küçük resimler. Ayarlar'dan değiştirilebilir |
| `data/cache/<hash>` | Ses, transkript, sinyaller; brief'e göre ayrı tutulan analiz ve seçim önbelleği |
| `data/cache/remotion` | Remotion bundle önbelleği |
| `data/work/clip_<id>` | Klip başına proxy video, konuşmacı analizi, props.json, ses miksajı |
| `data/db.sqlite` | Veritabanı (videolar, klipler, kampanyalar, işler, ayarlar, Claude logları) |
| `data/models` | İndirilen modeller |
| `assets/sfx/<tür>/` | SFX kütüphanesi. Kendi dosyalarını buraya koyarsan otomatik algılanır ve sentezlenmiş olanların yerine tercih edilir |
| `assets/music/` | Kendi arka plan müziklerin (wav/mp3/ogg/flac/m4a). Boşsa müzik eklenmez |

---

## Kullanım akışı

1. **Kampanyalar:** "Kampanya ekle" ile Whop linki, isim, CPM ($/1K), platformlar (YouTube/TikTok/Instagram), opsiyonel Drive linki, opsiyonel kişi (platform + kullanıcı adı + Instagram) ve notlar/kurallar girilir. Kişi bilgisi alt bar'ı doldurur. Notlar, seçim ve metin yazımında Claude'a kural olarak verilir.
2. **Üretim:** Video sol tarafa bırakılır. Sağdaki **Brief** kutusuna kim konuştuğu ve hangi açıdan klip istendiği yazılır; "Hariç tut" ve kampanya da burada seçilebilir. Brief boş bırakılırsa analiz ana temayı ve kişinin uzmanlığını çıkarıp bir brief önerir. Önerilen brief video sayfasında düzenlenebilir, "Tahmini yeniden hesapla" ile brief'e göre klip tahmini güncellenir.
3. **Seçim:** Opus her an için iki ayrı skor verir. **Alaka** (brief/kampanya uyumu) önce gelir, **viral** skor sonra. Alakası eşiğin (varsayılan 60) altında kalan anlar elenir; hariç tutulan konular hiçbir zaman seçilmez. Sıralama 0,6 × alaka + 0,4 × viral formülüyle yapılır.
4. **Render aşamaları:** Konuşmacı tespiti → Kurgu planı → Render. Klip kartında iki skor ve alaka gerekçesi görünür. "Kurgu planını göster" zaman çizelgesini açar; "Kurguyu yeniden üret" ile farklı bir kurgu stili denenebilir.
5. **Envanter:** Kampanyaya göre filtrelenebilir ("Kampanyasız" seçeneği de var).
6. **Panel:** Kampanya başına tahmini kazanç kartı (izlenme × CPM / 1000). Platform analitiği bağlanana kadar izlenme ve kazanç "—" gösterilir.

---

## Mimari

```
Next.js (App Router, TS, Tailwind v4)  ──HTTP──▶  FastAPI worker (Python)
  app/            sayfalar                          worker/app/main.py        API
  components/     bento UI bileşenleri              worker/app/jobs.py        SQLite kalıcı iş kuyruğu + orkestrasyon
  lib/api.ts      tipler + parçalı upload            worker/app/claude_cli.py  `claude -p` sarmalayıcı
  lib/platforms   platform provider arayüzü         worker/app/providers.py   analitik provider'ları (placeholder)
remotion/         klip kompozisyonu (React)         worker/app/pipeline/
  Main.tsx          katmanlar                         ingest.py       parmak izi, probe, 16 kHz ses
  components/       VideoLayer, Captions,             transcribe.py   faster-whisper, kelime zamanları
                    HookIntro, TextPopup, Text3D,     signals.py      enerji tepeleri, kahkaha, sahne değişimi
                    Transitions, ColorGrade,          analyze.py      analiz + brief önerisi + brief tahmini (Opus/Sonnet)
                    TrackingLabel, BottomBar          select.py       alaka + viral seçim, görsel inceleme (Opus)
scripts/render-remotion.mjs  bundle + renderMedia     speakers.py     YuNet takip + FaceLandmarker ağız → aktif konuşmacı
                                                      edit_signals.py sessizlik/dolgu kelime adayları, enerji, kahkaha
                                                      edit_plan.py    EDL şeması, Opus çağrısı, doğrulama, props üretimi
                                                      sfx.py          SFX/müzik kütüphanesi (sentez + kullanıcı dosyaları)
                                                      audio_mix.py    konuşma kesimleri + hook + SFX + ducking'li müzik
                                                      tts.py          Kokoro → Piper yedek
                                                      subtitles.py    kelime gruplama, TTS hizalama
                                                      render.py       proxy → konuşmacı → EDL → Remotion → miks → mux
                                                      metadata.py     platforma göre başlık/caption (Sonnet)
prompts/  video_analysis.md · clip_selection.md · edit_plan.md · metadata.md
```

### Hangi aşamada hangi model/araç çalışıyor

| Aşama | Araç / model |
|---|---|
| Transkript | faster-whisper (GPU varsa CUDA float16, yoksa CPU int8) |
| Video analizi, ana tema, kişinin uzmanlığı, brief önerisi, brief'e göre klip tahmini | **claude-opus-5-5** (8 kare + tam transkript) |
| Brief değişince tahmini yeniden hesaplama | **claude-sonnet-5-5** |
| An seçimi (alaka + viral skor, gerekçe, hook) ve görsel inceleme | **claude-opus-5-5** |
| Konuşmacı tespiti | OpenCV YuNet ile yüz takibi + mediapipe FaceLandmarker (jawOpen + dudak açıklığı) → aktif konuşmacı zaman çizelgesi |
| Kurgu sinyalleri | Kelime boşluklarından sessizlik adayları, dolgu kelimeler (um/uh/like/you know), ses enerjisi tepeleri, kahkaha |
| Kurgu planı (EDL) | **claude-opus-5-5**. Transkript, numaralı kesim adayları, konuşmacı zaman çizelgesi ve 6 etiketli kare görür |
| Render | **Remotion 4** (React → Chrome headless, h264). Ses ayrı miks edilir (numpy) ve ffmpeg ile loudnorm -14 LUFS uygulanarak muxlanır |
| Başlık, açıklama, caption'lar | **claude-sonnet-5-5**, yalnızca kampanyanın platformları için |
| Hook seslendirmesi | Kokoro → Piper |

### Kurgu motoru

- **EDL** (`prompts/edit_plan.md`): kesimler (yalnızca numaralı adaylar), çekimler (speaker/face/split/wide; cut/pan geçişi), zoom (punch/slow), yazı popup'ları, 3D başlık, takip etiketi, geçişler, SFX ve renk.
- **Efekt kütüphanesi:**
  - 10 yazı animasyonu: pop, slam, typewriter, bounce, slide_up, glitch, wave, blur_in, highlight, counter
  - 6 geçiş: whip, zoom, glitch, flash, blur, shake
  - 4 renk: clean, warm, cinematic, punchy
  - 3D yazı (three.js; orbit/push/flip)
  - Yüze yapışan takip etiketi
  - Jump-cut'larda dönüşümlü zoom
- **Doğrulama:** Opus'un planı her zaman kod tarafından kontrol edilir:
  - Kesimler kelime sınırına oturtulur ve toplam kesinti %45 ile sınırlanır.
  - Kurgu stiline göre yoğunluk tavanları uygulanır.
  - Geçişler kesim noktalarına çekilir.
  - Emoji temizlenir.
  - Claude yanıt vermezse (limit dışı bir hata olursa) sinyallere dayalı bir yedek plan kullanılır.
- **Kurgu stili:** Minimal, Dengeli veya Agresif. Kesim, zoom, yazı ve SFX yoğunluğunu belirler.
- **Ses:**
  - Konuşma segmentleri 6 ms fade ile birleştirilir.
  - Riser efektleri vurgu anında biter.
  - Müzik konuşmada otomatik kısılır (ducking).
  - Son olarak loudnorm uygulanır.
- **Hook altyazısı:** Kelime kelime senkron. Varsayılan olarak ana altyazıyla aynı stilde; kapatılırsa hook için ayrı stil ve font seçilir. 4 font (Anton, Bebas Neue, Montserrat Black, Archivo Black) canlı önizlemeyle sunulur.

Tüm yeni varsayılanlar (font, hook stili, kurgu stili, minimum alaka, SFX/müzik seviyeleri, Remotion eşzamanlılık/GL) Ayarlar sayfasından değiştirilebilir.

---

## Varsayımlar ve kararlar

- **Claude CLI çağrıları:** `--output-format json` ve `--json-schema` kullanılıyor, sonuç `structured_output` alanından okunuyor. `--no-session-persistence`, `--strict-mcp-config`, `--disable-slash-commands` ve `--setting-sources project` bayraklarıyla kullanıcının MCP sunucuları ve skill'leri yüklenmiyor. Görsel gereken çağrılarda yalnızca `Read` aracına izin veriliyor. `--bare` bilerek kullanılmıyor, çünkü API key istiyor.
- **Limit:** Kullanım limiti dolarsa iş duraklatılır. Limit sıfırlandığında "Devam et" ile iş kaldığı yerden sürer.
- **Yayıncılar → Kampanyalar:** Migration v2 (`PRAGMA user_version`) kampanya tablosunu ekliyor ve klip/videolara `campaign_id`, brief alanlarını ekliyor. Eski yayıncı profillerinde link ve CPM olmadığı için kampanyaya çevrilemiyorlar; bu nedenle siliniyorlar. Klipler ve videolar korunuyor; eski kliplerdeki yayıncı bilgisi kişi (`person`) olarak okunuyor. Videonun `streamer` alanı, analizde tespit edilen kişi olarak kalıyor.
- **Brief önbelleği:** Analiz ve seçim önbelleği brief, hariç tutulanlar, kampanya notları ve model hash'iyle anahtarlanıyor. Brief değişince seçim yeniden yapılıyor.
- **Remotion lisansı:** Remotion bireyler ve 3 kişiye kadar şirketler için ücretsizdir. Bu proje kişisel kullanım içindir. Daha büyük bir şirkette kullanılacaksa remotion.pro lisansı gerekir.
- **Remotion'a medya:** Render betiği iş klasörünü kendi küçük HTTP sunucusundan (range destekli) sunuyor, böylece büyük dosyalar bundle'a kopyalanmıyor.
- **Proxy:** Her klip için ±0,5 sn paylı, 30 fps sabit kare hızlı, en fazla 1080p bir proxy çıkarılıyor. Remotion bu proxy'yi okuyor.
- **Arayüz ve içerik dili:** Arayüz Türkçe. Üretilen başlık, hook ve altyazılar İngilizce.

## Uçtan uca test

Test sentetik bir videoyla yapıldı: 1:54'lük "Market Hours" podcast'i. Solda sunucu, sağda konuk Marco var. Videoda kick.com/tradewithmarco overlay'i, dolgu kelimeler, duraklamalar ve trading dışında bir rap/müzik yan sohbeti bulunuyor. Sonuçlar aşağıda.

1. **Kampanya:** "TradeWithMarco Test" oluşturuldu. Bilgiler: CPM $1.50, YouTube + TikTok, kişi Kick @tradewithmarco / IG @marco.trades, kurallar "@tradewithmarco'yu an, yatırım tavsiyesi iddiası yok, #ad".
2. **Analiz (brief boş):** Opus ana temayı ("day trading discipline and risk management") ve kişinin uzmanlığını doğru çıkardı. Türkçe bir brief önerdi ve hariç tutulacaklar listesine rap/müzik sohbetini kendiliğinden ekledi. Tahmin: 4 klip.
3. **Brief + hariç tut ile üretim (Agresif):**
   - 2 klip seçildi: alaka 97 / viral 82 ve alaka 92 / viral 74. Rap yan sohbeti seçilmedi.
   - Metinlerde yalnızca YouTube ve TikTok alanları üretildi. Kampanya kuralları uygulandı (#ad, @tradewithmarco, "not financial advice").
4. **Render:**
   - Konuşmacı tespiti → Opus EDL → Remotion → ses miksajı; klip başına yaklaşık 2–2,5 dk.
   - Görünenler: konuşanı takip eden kamera, split ekran, kesimler, zoom'lar, popup'lar (slam/highlight/counter), 3D yazı, takip etiketi, geçişler ve SFX. Hook ayrı stilde (Anton, kontur) ve kelime senkronlu.
   - Çıktı 1080×1920, 30 fps, -14,0 LUFS.
5. **Kurguyu yeniden üret (Minimal):** 96 sn sürdü, daha sade bir plan çıktı. EDL endpoint'i, kampanya filtresi (2 klip / "Kampanyasız" 10 klip) ve kazanç kartı kontrol edildi.
6. **Testte bulunup düzeltilenler:**
   - Uzun takip etiketi kadrajdan taşıyordu; artık sığacak şekilde küçülüyor.
   - Whisper "$20,000" sayısını "$20" ve ",000" olarak bölüyordu; bu parçalar artık birleştiriliyor.
   - Müzik kütüphanesi boşken Opus özetinde müzik anıyordu; artık kütüphane durumu prompt'a veriliyor.
   - Panel yerleşimi düzeltildi.

## Bilinen sınırlamalar

- **Hız (GPU'suz):** Ryzen 5 1600'de 30 sn'lik bir klip yaklaşık 2–4 dakikada hazır olur (konuşmacı analizi ve Remotion render dahil). İlk render, tarayıcı ve bundle hazırlandığı için daha uzun sürer.
- **Konuşmacı tespiti** görünür yüzlere dayanır. Yüz görünmüyorsa (ekran paylaşımı, oyun) geniş plan kullanılır.
- **Kokoro yalnızca İngilizce** seslendirir.
- **Platform analitiği yok:** Kazanç kartı altyapısı hazır (`worker/app/providers.py` → `campaign_views`), ama izlenme verisi bağlanana kadar tahmini kazanç gösterilmez.
- **Müzik dahil değil:** Telifsiz müziği kendin `assets/music` klasörüne koymalısın.
- **İş sırası:** Kuyruk tek bir worker thread'iyle çalışır, render'lar sırayla yapılır.
