# CMS KI-Integration

Folgendes Konzept ist nicht fix, es sind nur mal ideen.

- skalierbar
- modular
- skalierbar
- flexibel
- sparsam mit tokens

---

## Übersicht der KI-Spezialisten (Ideen, beispiele)

| Bot-Name             | Schicht       | Hauptaufgabe                                        | Liest                        | Schreibt              |
|----------------------|---------------|-----------------------------------------------------|------------------------------|-----------------------|
| ContentWriterBot     | Content       | Texte, Headlines, CTAs generieren/umformulieren     | texte, Brand-Voice           | texte                 |
| TranslatorBot        | Lokalisierung | Konsistente Übersetzungen, Platzhalter erhalten     | texte.source, Glossar        | texte.target          |
| SEOBot               | SEO/Meta      | Meta-Title, Description, OG-Tags vorschlagen        | texte, urls                  | einstellungen.seo     |
| SlugBot              | Routing       | Sprechende, unique Slugs erzeugen                   | texte.title, alle urls       | urls                  |
| LayoutArchitectBot   | Struktur      | Sinnvolle Block-Abfolgen für Seitentyp vorschlagen  | einstellungen.type           | Child-Nodes als Preset|
| ConfigAssistantBot   | Settings      | JsonSchema erklären, Settings aus Prompt befüllen   | JsonSchema, User-Prompt      | einstellungen         |
| MediaTaggerBot       | Assets        | Alt-Texte, Tags, Beschreibungen für Bilder/PDFs     | dateien                      | einstellungen.media   |
| FrontendCopilotBot   | Code          | Template-Code für Node-Typ generieren               | Node-Typ, einstellungen      | Datei: template.twig  |
| ModuleForgeBot       | Entwicklung   | Neue Block-Typen scaffolden inkl. Schema + Template | User-Prompt, Bestands-Blöcke | Neue Modul-Dateien    |
| SearchTuningBot      | Suche         | Synonyme, Embeddings, "Meinten Sie..."              | texte, einstellungen.tags    | Such-Index            |
| LektorBot            | QS            | Rechtschreibung, Tonality, A11y, Link-Check         | Komplette Node               | Report + Fixes        |
| CMSExplainerBot      | Backend-UX    | Felder im Editor live erklären                      | Feldname, JsonSchema         | Tooltip-Text          |
| CMS-SystemBot        | Kern          | Kennt DB, validiert, stellt Tools für andere Bots   | Alle Felder                  | —                     |



## Architektur-Entscheide

**Router-Bot:** Kennt alle Bots, nimmt User-Intent entgegen, delegiert, hält geteilten Context-State. Bots sind zustandslos und kennen sich nicht gegenseitig. Bot-zu-Bot-Kommunikation via Router möglich halten (API flexibel).

**Server:** Proxy-Ansatz — API-Key-Sicherheit, Caching, Rate-Limiting. Serverless-kompatibel (z.B. Deno Deploy).

**Streaming:** Provider-Adapter abstrahiert SSE-Unterschiede. Interface: `stream()` + `complete()`. Provider ohne Streaming laufen nahtlos über `complete()`.

**Output:** Natives Structured Output (JSON-Schema pro Bot). Fallback auf anweisungsbasiert erst wenn nötig.

**Kontext pro Request:** Nutzername, aktueller Ort im CMS, Zeit, User-Prompt.

**UX:** Minimal (fast ohne CSS), kein Fokus jetzt — zuerst Bot-Logik sauber.

**Provider:** Pro Bot konfigurierbar. Provider-Definition enthält Stärken + Kosten (für spätere dynamische Zuweisung). Start mit Groq.

**Wichtiges Architektur-Prinzip:** Provider-Logik immer generisch halten. Neue Provider sollen möglichst nur über deklarative Provider-Metadaten ergänzt werden, nicht über verstreute `if provider === ...`-Sonderfälle. Provider-spezifisches Verhalten gehört in kleine Adapter/Mapper, die von generischem Routing, Sync und Backend-UI verwendet werden.

```ts
type ProviderStrength =
  | "speed"
  | "reasoning"
  | "multilingual"
  | "coding"
  | "vision"
  | "cost"
  | "quality"
  | "privacy"
  | "long-context"
  | "routing"
  | "model-choice"

interface ProviderModel {
  id: string
  label?: string
  source?: string
  syncedAt?: string
  strengths?: ProviderStrength[]
  maxInputTokens?: number
  maxOutputTokens?: number
  costPerMToken?: number
  inputCostPerMToken?: number
  outputCostPerMToken?: number
  supports?: {
    streaming?: boolean
    tools?: boolean
    vision?: boolean
    jsonMode?: boolean
  }
}

interface Provider {
  id: string
  adapter: LLMAdapter
  strengths: ProviderStrength[]   // z.B. ["speed", "reasoning", "multilingual"]
  models: ProviderModel[]
  defaultModel?: string
  costPerMToken: number // für spätere dynamische Zuweisung
  sync?: {
    modelsEndpoint?: string // z.B. "/models"
    requiresKey?: boolean
    source: string          // z.B. "openrouter-sync"
    mapper: "openai-compatible" | "openrouter"
  }
}
```

Konsequenz:

- Provider-Registry ist die zentrale Quelle für Endpoint, Capabilities, Models, Sync-Konfiguration und Defaults.
- Backendseiten lesen diese Registry und rendern daraus UI, Buttons und Status.
- Model-Sync nutzt denselben generischen Ablauf für alle Provider: Endpoint abrufen, Mapper anwenden, Sync-Models ersetzen, manuelle Models behalten.
- Spezialfälle sind erlaubt, aber nur als explizite Mapper/Adapter mit kleinem Scope.
- Bots und Router sollten nicht wissen müssen, wie ein Provider intern synchronisiert oder welche API-Details er hat.

### Was braucht es
- JSON-Schema pro Bot (= Typ + Validierung + Doku)
- Provider-Adapter-Interface mit `stream()` + `complete()`
- Provider-Registry mit Stärken/Kosten/Models/Sync
- Router mit Context-Object
