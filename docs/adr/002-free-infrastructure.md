# ADR-002: Ücretsiz Altyapı Seçimleri

**Tarih:** 2026-10-28  
**Durum:** Kabul edildi  
**Bağlam:** Pilot dönemde $0/ay OPEX hedefi için tüm servislerin ücretsiz tier'ları kullanılacak.

## Karar

| Katman | Seçim | Ücretsiz Limiti |
|---|---|---|
| Veritabanı | Supabase Free | 500 MB, 2 proje |
| Cache/Queue | Upstash Redis Free | 250 MB, 500K cmd/ay |
| Nesne Depolama | Cloudflare R2 Free | 10 GB, sınırsız egress |
| Hosting | Vercel Hobby / Cloudflare Pages | 100 GB BW/ay |
| E-posta | Resend Free | 3,000/ay, 100/gün |
| Auth | Supabase Auth | 50K MAU |
| Monitoring | Grafana Cloud Free | 50 GB log/ay |

## Ölçekleme Stratejisi

- 50 iş/ay altında ücretsiz tier yeterli
- 50-200 iş/ay: Supabase Pro ($25) + Upstash pay-as-you-go
- 200+: Self-hosted altyapıya geçiş (Hetzner VPS ~$10/ay)

## Sonuçlar

- Aylık sabit maliyet $0 (spec'te $1,500)
- İnaktivite durumunda Supabase projeleri durdurulabilir
- Vercel Hobby ticari kullanıma izin vermez — launch'ta Cloudflare Pages'e geçiş
