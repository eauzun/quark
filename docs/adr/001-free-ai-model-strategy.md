# ADR-001: Ücretsiz AI Model Stratejisi

**Tarih:** 2026-10-28  
**Durum:** Kabul edildi  
**Bağlam:** Quark spesifikasyonu OpenAI GPT-5.4 / GPT-5.4 mini kullanımı varsayıyor. Maliyeti sıfıra indirmek için ücretsiz alternatifler gerekli.

## Karar

OpenAI yerine aşağıdaki ücretsiz model zinciri kullanılacak:

1. **Google Gemini Flash** (birincil) — 1M token context, ~15 RPM, ücretsiz
2. **Groq Llama 3.3 70B** (adversarial pass) — ~1000 req/gün, ücretsiz  
3. **NVIDIA Nemotron** (fallback) — ~40 RPM, trial credits
4. **Mistral Codestral** (kod-spesifik) — ücretsiz experimental tier

## Sonuçlar

- AI maliyeti iş başına $0 (spec'te $0.15–$2.32)
- Rate limit yönetimi gerekli (circuit breaker + fallback zinciri)
- Ücretsiz tier'larda gizlilik kısıtı var — gönderilen veriler model eğitimi için kullanılabilir
- Ölçekleme için self-hosted model (Ollama + Qwen/Llama) hazırlığı yapılmalı

## Riskler

- Provider ücretsiz tier politika değişiklikleri
- Rate limit aşımı durumunda review gecikmeleri
- Model kalitesi GPT-5.4 seviyesinde olmayabilir (benchmark gerekli)
