# Brazil — IBGE Agência de Notícias  (SourceId: latam-brazil)

- **Tier:** A  +  primary-official (IBGE is the Brazilian federal statistics institute; news releases are official government publications)
- **Role:** STORY (emits RawItem content records — press releases and news items from the official Brazilian statistical agency)
- **Endpoint probed:** GET https://servicodados.ibge.gov.br/api/v3/noticias/?qtd=2&page=1
- **Format:** JSON
- **Auth:** none   |   **Rate limit:** not documented; no rate-limit headers observed in responses; pacing at ~1 req/s recommended as a courtesy
- **Probe status:** LIVE-CONFIRMED (HTTP 200, parsed 2 items from 7,337 total)
- **Region mapping:** asserts LatinAmerica (IBGE is the national statistics bureau of Brazil, covering Brazilian economic, social, and geographic topics)
- **Topic mapping:** `editorias` field values (e.g. "ibge", "economicas", "geociencias", "social") → Politics/Business/Science/Other; must-infer for fine-grained mapping
- **Signals yielded:** no points, no mention counts, no tone/sentiment field. `destaque` (boolean highlight flag) is the only editorial weighting signal. No native engagement metrics.
- **externalId (dedup key):** `id` (integer, e.g. `47201`) — unique per news item, stable, monotonically increasing
- **Sample response shape:**
```json
{
  "count": 7337,
  "page": 1,
  "totalPages": 3669,
  "items": [
    {
      "id": 47201,
      "tipo": "Notícia",
      "titulo": "IBGE divulga, em 1º de julho, resultados inéditos sobre os impactos das enchentes de 2024 no Rio Grande do Sul",
      "introducao": "O Instituto Brasileiro de Geografia e Estatística...",
      "data_publicacao": "16/06/2026 07:22:16",
      "editorias": "ibge",
      "destaque": true,
      "link": "http://agenciadenoticias.ibge.gov.br/agencia-noticias/2012-agencia-de-noticias/noticias/47201-..."
    }
  ]
}
```
- **Storage/ToS note:** IBGE data is published under Brazil's Open Government Data policy (Lei de Acesso à Informação, Law 12.527/2011) and the government open-data license (CC-BY 4.0 equivalent). Caching and redistribution are permitted with attribution to IBGE. The dados.gov.br CKAN API returned HTTP 401 (requires API key) — this source relies solely on the unauthenticated IBGE servicodados endpoint.
- **Verdict:** ADOPT — adds the first dedicated Latin America official-statistics/government-news feed; no other current source covers Brazil or South America at Tier A
- **Risks:** API is undocumented re rate limits (add polite pacing); `data_publicacao` is a Brazilian locale date string (DD/MM/YYYY HH:MM:SS) requiring parsing; `editorias` values are free-text tags in Portuguese requiring translation/mapping; no engagement signals means this is purely a STORY source with no scoring context; dados.gov.br CKAN remains inaccessible without an auth key (may be obtainable free via portal registration).
