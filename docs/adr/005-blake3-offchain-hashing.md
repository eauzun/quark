# ADR-005: BLAKE3 for Off-Chain Authentication and Scope Hashing

**Tarih:** 2026-10-28  
**Durum:** Kabul edildi  
**Bağlam:** Spesifikasyon kod arşivleri, kapsam sözleşmeleri, teslimat kanıtları ve yetkilendirme hashleri için değişmez kriptografik hashleme gerektiriyor. Geleneksel SHA-256 büyük dosyalarda CPU darboğazı yaratmakta ve EVM dışı off-chain işlemlerde gereksiz gecikmeye neden olmaktadır.

## Karar

Off-chain kimlik doğrulama, token saklama, kapsam sözleşmeleri ve kod teslimatları için **BLAKE3** kriptografik hash algoritması kabul edilmiştir.

### Kullanım Alanları

1. **Off-Chain Auth & Oturumlar:** API anahtarları ve auth token'ları düz metin olarak değil, BLAKE3 ile türetilmiş hash olarak (`quark_auth_v1:<token>`) veritabanında saklanır.
2. **Kapsam Sözleşmeleri (`scope_versions`):** Kanonik JSON sıralaması sonrası BLAKE3 hash'i (`quark_scope_v1:<canonical_json>`) ile içerik değişmezliği mühürlenir.
3. **Kod Teslimatları & Arşivler (`submissions`):** İşçinin yüklediği kod arşivleri BLAKE3 ile doğrulanır (Merkle ağaç yapısı ve SIMD hızından faydalanılır).
4. **On-Chain İstisna:** EVM üzerinde akıllı sözleşme içi doğrudan doğrulanan cüzdan imzalarında EVM standardı olan EIP-191 / Keccak-256 korunur.

## Avantajlar

- SHA-256'ya göre 6x–12x daha hızlıdır; free-tier CPU limitlerinde tasarruf sağlar.
- Yerleşik Merkle ağacı yapısı (Tree Hashing) sayesinde büyük kod depolarında parça doğrulaması kolaylaşır.
- Length-extension saldırılarına karşı doğal koruma sağlar.
- `@noble/hashes/blake3` ile saf TypeScript / WebAssembly ortamlarında sıfır ek yerel derleme bağımlılığı ile çalışır.
