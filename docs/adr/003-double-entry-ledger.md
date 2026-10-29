# ADR-003: Double-Entry Muhasebe Tasarımı

**Tarih:** 2026-10-28  
**Durum:** Kabul edildi  
**Bağlam:** Spesifikasyon Bölüm 9.3 çift taraflı muhasebe gerektiriyor. Tüm finansal işlemler dengelenmiş journal entry'ler olarak kaydedilmeli.

## Karar

1. Her journal entry balanced olmalı: toplam debit = toplam credit
2. Tüm tutarlar bigint atomic unit olarak saklanır (USDC: 6 decimal → 1 USDC = 1_000_000)
3. Her network/token çifti ayrı muhasebe — cross-token netting yok
4. Journal entry'ler immutable — düzeltme yeni entry olarak yapılır
5. Her dış event benzersiz (network, tx_hash, log_index) — idempotent
6. Günlük otomatik bakiye uzlaştırması

## Hesap Planı

- `settlement_asset` — Onaylanmış blokzincir mevduatları
- `held_employer_liability` — Tutulan işveren fonları
- `worker_payable` — İşçiye ödenecek
- `platform_revenue` — Platform geliri (%20)
- `refund_payable` — İade edilecek
- `provider_expense` — Ağ/provider masrafları
- `recovery_suspense` — Uzlaştırma bekleme

## Sonuçlar

- Binary float kesinlikle yasak — compile-time enforcement
- Her mutation idempotency key gerektirir
- Bakiye uyumsuzluğu acil alert tetikler
