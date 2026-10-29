# ADR-004: Settlement — Base USDC Testnet

**Tarih:** 2026-10-28  
**Durum:** Kabul edildi  
**Bağlam:** Spesifikasyon Base üzerinde native USDC'yi mühendislik varsayılanı olarak belirtir. Mainnet aktivasyonu gate gerektirir.

## Karar

1. İlk bağlayıcı: Base Sepolia testnet + USDC test token
2. Settlement adapter arayüzü: `createFundingIntent`, `observeFunding`, `confirmFunding`, `authorizeAward`, `requestTransfer`, `requestRefund`, `getStatus`, `reconcile`
3. Lokal testlerde mock settlement, staging'de gerçek testnet
4. viem kütüphanesi ile blokzincir etkileşimi (ethers.js alternatifi, daha tip güvenli)
5. Finality chain-specific adapter config'den gelir
6. Pre-finality deposit'ler harcanamaz

## Production Gate'ler (G)

- [ ] Yasal varlık/faaliyet bölgeleri
- [ ] Custody/provider onayı
- [ ] Güncel USDC adresi/decimal/finality
- [ ] Güvenli anahtar yönetimi (KMS)
- [ ] Bağımsız güvenlik incelemesi

## Sonuçlar

- Mainnet adresi/config asla hardcode edilmez
- Test vs production ortamı her zaman belirgin şekilde işaretlenir
- Mock settlement geliştirme hızını artırır
