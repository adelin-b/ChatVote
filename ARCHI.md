# ChatVote — Architecture Map

> Auto-generated architecture documentation. See `CLAUDE.md` for dev commands.

---

## 1. High-Level System Overview

```mermaid
graph TB
    subgraph Users["👤 Users"]
        Browser["Browser"]
    end

    subgraph Vercel["Vercel (Frontend)"]
        NextJS["Next.js 16<br/>TypeScript / React 19<br/>Tailwind v4 / shadcn/ui"]
        VercelAPI["API Routes<br/>(Server-side)"]
    end

    subgraph Scaleway["Scaleway (Backend)"]
        Backend["aiohttp + Socket.IO<br/>Python 3.11<br/>Port 8080"]
    end

    subgraph K8s["Scaleway Kapsule K8s<br/>fr-par-2"]
        Qdrant["Qdrant v1.14.0<br/>Vector DB"]
        CronSnap["CronJob<br/>Daily Snapshot"]
    end

    subgraph Google["Google Cloud"]
        Firestore["Cloud Firestore<br/>eur3"]
        FireAuth["Firebase Auth"]
        FireStorage["Firebase Storage"]
    end

    subgraph LLMs["LLM Providers"]
        Gemini["Google Gemini 2.0-flash<br/>(Primary)"]
        OpenAI["OpenAI GPT-4o<br/>(Fallback)"]
        Azure["Azure OpenAI<br/>(Fallback)"]
        Anthropic["Anthropic Claude<br/>(Fallback)"]
    end

    subgraph Embedding["Embedding Providers"]
        ScalewayEmbed["Scaleway<br/>qwen3-embedding-8b<br/>4096d (Prod)"]
        GeminiEmbed["Google<br/>gemini-embedding-001<br/>3072d"]
    end

    subgraph Storage["Scaleway S3"]
        S3Snap["chatvote-qdrant-snapshots<br/>(30-day retention)"]
        S3Assets["chatvote-public-assets<br/>(public-read)"]
    end

    Browser -->|"HTTPS"| NextJS
    NextJS -->|"Socket.IO (WSS)"| Backend
    VercelAPI -->|"Admin SDK"| Firestore
    Backend -->|"RAG queries"| Qdrant
    Backend -->|"Chat/LLM"| Gemini
    Backend -.->|"Failover"| OpenAI
    Backend -.->|"Failover"| Azure
    Backend -.->|"Failover"| Anthropic
    Backend -->|"Embeddings"| ScalewayEmbed
    Backend -->|"CRUD"| Firestore
    Backend -->|"PDFs"| FireStorage
    NextJS -->|"Auth"| FireAuth
    CronSnap -->|"Snapshot"| Qdrant
    CronSnap -->|"Upload"| S3Snap

    style Vercel fill:#000,color:#fff
    style Scaleway fill:#4f0599,color:#fff
    style K8s fill:#326ce5,color:#fff
    style Google fill:#4285f4,color:#fff
    style LLMs fill:#10a37f,color:#fff
    style Embedding fill:#ff6f00,color:#fff
    style Storage fill:#4f0599,color:#fff
```

---

## 2. Production Endpoints

| Service | Location | Protocol |
|---------|----------|----------|
| **Frontend** | Vercel (custom domain) | HTTPS |
| **Backend API** | Scaleway Serverless Container | HTTPS |
| **Qdrant (K8s LB)** | K8s LoadBalancer `:6333` | HTTP |
| **Qdrant (internal)** | K8s ClusterIP `:6333` | HTTP |
| **Docker Registry** | Scaleway Container Registry (private) | HTTPS |
| **S3 Snapshots** | Scaleway Object Storage (30-day retention) | HTTPS |
| **S3 Assets** | Scaleway Object Storage (public-read) | HTTPS |
| **Logs** | Scaleway Cockpit (Loki) | HTTPS |
| **Firebase** | Google Cloud Firestore (`eur3` region) | — |

### Local Development Ports

| Service | Port |
|---------|------|
| Frontend (Turbopack) | `localhost:3000` |
| Backend (aiohttp) | `localhost:8080` |
| Qdrant HTTP | `localhost:6333` |
| Qdrant gRPC | `localhost:6334` |
| Firestore Emulator | `localhost:8081` |
| Auth Emulator | `localhost:9099` |
| Firebase UI | `localhost:4000` |
| Ollama | `localhost:11434` |

---

## 3. Real-Time Communication Flow

```mermaid
sequenceDiagram
    participant B as Browser (Next.js)
    participant S as Socket.IO Server
    participant RAG as RAG Pipeline
    participant Q as Qdrant
    participant LLM as LLM (Gemini)
    participant FS as Firestore

    B->>S: chat_session_init (scope, locale)
    B->>S: chat_answer_request (question, parties[])

    S->>RAG: Process question
    RAG->>LLM: Improve/expand query
    LLM-->>RAG: Enhanced query
    RAG->>Q: Vector similarity search<br/>(namespace filter, fiabilite filter)
    Q-->>RAG: Top-K documents
    RAG->>LLM: Rerank documents
    LLM-->>RAG: Reranked docs

    S-->>B: responding_parties_selected
    S-->>B: sources_ready (reranked sources)

    loop For each party
        RAG->>LLM: Generate response (streamed)
        loop Chunks (max 10 chars each)
            S-->>B: party_response_chunk_ready
        end
        S-->>B: party_response_complete
    end

    S-->>B: quick_replies_and_title_ready
    S-->>B: chat_response_complete (timing, tokens, model)

    S->>FS: Persist chat session
```

### Socket.IO Events Reference

| Direction | Event | Purpose |
|-----------|-------|---------|
| **C→S** | `chat_session_init` | Initialize chat (scope, user locale) |
| **C→S** | `chat_answer_request` | User question + party/candidate selection |
| **C→S** | `pro_con_perspective_request` | Pro/con analysis for a party |
| **C→S** | `candidate_pro_con_perspective_request` | Pro/con for a candidate |
| **C→S** | `voting_behavior_request` | Parliamentary voting summary |
| **S→C** | `responding_parties_selected` | Confirms selected parties |
| **S→C** | `sources_ready` | RAG-retrieved sources (reranked) |
| **S→C** | `party_response_chunk_ready` | Streamed response chunk |
| **S→C** | `party_response_complete` | Single party response done |
| **S→C** | `quick_replies_and_title_ready` | Title + follow-up suggestions |
| **S→C** | `chat_response_complete` | Final metadata (time, tokens, model) |
| **S→C** | `stream_reset` | Reset frontend stream (LLM failure recovery) |
| **S→C** | `debug_llm_call` | Debug info (dev only) |

---

## 4. Backend Architecture

```mermaid
graph LR
    subgraph API["aiohttp Server :8080"]
        Routes["REST Routes<br/>/healthz, /health<br/>/api/v1/assistant<br/>/api/v1/admin/*"]
        SIO["Socket.IO<br/>websocket_app.py"]
    end

    subgraph Core["Core Pipeline"]
        Chatbot["chatbot_async.py<br/>RAG Pipeline (~53KB)"]
        LLMs["llms.py<br/>Provider Failover"]
        Prompts["prompts.py<br/>prompts_en.py"]
    end

    subgraph Data["Data Layer"]
        Firebase["firebase_service.py<br/>Firestore CRUD"]
        VectorStore["vector_store_helper.py<br/>Qdrant Setup"]
        Models["models/<br/>chat, party, candidate,<br/>vote, dtos"]
    end

    subgraph Services["Background Services"]
        Scraper["candidate_website_scraper.py<br/>Playwright BFS crawl"]
        CandIdx["candidate_indexer.py<br/>Chunk → Embed → Qdrant"]
        ManIdx["manifesto_indexer.py<br/>PDF → Chunk → Embed"]
        Classifier["chunk_classifier.py<br/>Theme classification (LLM)"]
        Scheduler["scheduler.py<br/>APScheduler cron"]
        Listener["firestore_listener.py<br/>Real-time sync"]
        Upload["document_upload.py<br/>Job lifecycle"]
    end

    Routes --> Chatbot
    SIO --> Chatbot
    Chatbot --> LLMs
    Chatbot --> Prompts
    Chatbot --> VectorStore
    Chatbot --> Firebase
    Scraper --> CandIdx
    CandIdx --> VectorStore
    CandIdx --> Classifier
    ManIdx --> VectorStore
    ManIdx --> Classifier
    Scheduler --> Scraper
    Scheduler --> ManIdx
    Listener --> CandIdx
```

### LLM Provider Failover Chain

```mermaid
graph LR
    Q["User Query"] --> G["Gemini 2.0-flash<br/>🟢 Primary"]
    G -.->|"Rate limit / error"| O1["GPT-4o<br/>🟡 Fallback 1"]
    O1 -.-> O2["GPT-4o-mini<br/>🟡 Fallback 2"]
    O2 -.-> A1["Azure GPT-4o<br/>🟠 Fallback 3"]
    A1 -.-> A2["Azure GPT-4o-mini<br/>🟠 Fallback 4"]
    A2 -.-> C1["Claude 3.5 Sonnet<br/>🔵 Fallback 5"]
    C1 -.-> C2["Claude 3 Haiku<br/>🔵 Fallback 6"]
    C2 -.-> L["Ollama llama3.2<br/>⚪ Dev only"]

    style G fill:#34a853,color:#fff
    style O1 fill:#f9ab00,color:#000
    style O2 fill:#f9ab00,color:#000
    style A1 fill:#ff6f00,color:#fff
    style A2 fill:#ff6f00,color:#fff
    style C1 fill:#6366f1,color:#fff
    style C2 fill:#6366f1,color:#fff
    style L fill:#666,color:#fff
```

### Embedding Providers

| Provider | Model | Dimensions | Environment |
|----------|-------|-----------|-------------|
| Scaleway | `qwen3-embedding-8b` | 4096 | **Production** |
| Google | `gemini-embedding-001` | 3072 | Fallback |
| OpenAI | `text-embedding-3-large` | 3072 | Fallback |
| Ollama | `nomic-embed-text` | 768 | Local dev |

---

## 5. Qdrant Vector Collections

```mermaid
graph TB
    subgraph Qdrant["Qdrant v1.14.0"]
        AP["all_parties_{env}<br/>232 pts (prod)<br/>Party manifestos"]
        CW["candidates_websites_{env}<br/>3,871 pts (prod)<br/>571 candidates / 152 communes"]
        JV["justified_voting_behavior_{env}<br/>Parliamentary voting records"]
        PQ["parliamentary_questions_{env}<br/>Parliamentary questions"]
    end

    AP -->|"namespace: {party_id}"| APns["Chunked PDFs<br/>+ theme/sub_theme"]
    CW -->|"namespace: {candidate_id}"| CWns["Scraped sites + profession de foi<br/>+ theme/sub_theme"]

    style Qdrant fill:#dc2626,color:#fff
```

**Metadata schema:** `party_ids` (KEYWORD), `candidate_ids` (KEYWORD), `theme` (KEYWORD), `sub_theme` (KEYWORD), `fiabilite` (INTEGER, 0–3)

---

## 6. Frontend Architecture

```mermaid
graph TB
    subgraph App["Next.js 16 App Router"]
        Home["/ — Home"]
        Chat["chat/[chatId] — Chat Session"]
        Commune["/commune/[communeCode]"]
        Admin["/admin/dashboard/[secret]"]
        AdminUp["/admin/upload/[secret]"]
        AdminDS["/admin/data-sources/[secret]"]
    end

    subgraph State["State Management"]
        Zustand["Zustand Store<br/>chat-store.ts"]
        Actions["Modular Actions<br/>actions/*.ts"]
    end

    subgraph Providers["Providers"]
        Socket["SocketProvider<br/>socket-provider.tsx"]
        Auth["AuthProvider<br/>(Firebase Auth)"]
        AppProv["AppProvider"]
    end

    subgraph Libs["Libraries"]
        ChatSocket["chat-socket.ts<br/>Socket.IO wrapper"]
        SocketTypes["socket.types.ts<br/>Type-safe events"]
        FireAdmin["firebase-admin.ts<br/>Server-side Firestore"]
        FireClient["firebase-client.ts<br/>Client-side Auth"]
    end

    subgraph UI["UI Layer"]
        Shadcn["shadcn/ui + Radix"]
        Tailwind["Tailwind CSS v4"]
        I18n["next-intl<br/>FR / EN"]
    end

    Chat --> Zustand
    Zustand --> Actions
    Socket --> ChatSocket
    ChatSocket --> SocketTypes
```

---

## 7. Kubernetes Infrastructure

```mermaid
graph TB
    subgraph Cluster["Kapsule K8s — k8s-ingestion<br/>v1.35.2 / Cilium CNI / fr-par-2"]
        subgraph VPC["chatvote-vpc (Private Network)"]
            subgraph NS["namespace: chatvote"]
                BackendDeploy["Deployment: chatvote-backend<br/>1 replica<br/>512Mi–2Gi / 250m–2000m CPU"]
                QdrantSS["StatefulSet: qdrant<br/>1 replica / 10Gi scw-bssd<br/>1Gi–2Gi / 500m–1000m CPU"]

                BackendSvc["Service: chatvote-backend<br/>LoadBalancer :8080<br/>600s timeout"]
                QdrantInt["Service: qdrant-internal<br/>ClusterIP :6333"]
                QdrantLB["Service: qdrant-lb<br/>LoadBalancer :6333"]

                CronSnap["CronJob: qdrant-snapshot<br/>03:00 UTC daily"]
                CronScrape["CronJob: candidate-scraper"]
                CronIndex["CronJob: manifesto-indexer"]
            end
        end

        subgraph Pools["Node Pools"]
            Pool1["pool-par-2-8gb<br/>DEV1-L (4 vCPU, 8GB)<br/>1 node (min 1, max 2)<br/>Backend + Qdrant"]
            Pool2["pool-pipeline<br/>POP2-2C-8G (2 vCPU, 8GB)<br/>0 nodes (min 0, max 2)<br/>CronJobs (scale-to-zero)"]
        end
    end

    BackendDeploy --> BackendSvc
    QdrantSS --> QdrantInt
    QdrantSS --> QdrantLB
    CronSnap --> QdrantSS
    BackendDeploy -.-> Pool1
    QdrantSS -.-> Pool1
    CronSnap -.-> Pool2
    CronScrape -.-> Pool2
    CronIndex -.-> Pool2

    style Cluster fill:#326ce5,color:#fff
    style VPC fill:#1a56db,color:#fff
    style NS fill:#1e40af,color:#fff
```

### Health Probes

| Probe | Endpoint | Interval | Threshold |
|-------|----------|----------|-----------|
| Backend startup | `/healthz` | 5s | 30 failures (150s max) |
| Backend liveness | `/healthz` | 15s | 3 failures → kill |
| Backend readiness | `/health` (deep) | 10s | 3 failures → remove from LB |

---

## 8. CI/CD Pipelines

```mermaid
graph LR
    subgraph Triggers
        PushMain["Push to main"]
        PR["PR to main/develop"]
        PoetryChange["poetry.lock changed"]
    end

    subgraph Workflows
        Prod["production-deploy.yml<br/>🟢 PROD environment"]
        Preview["preview-deploy.yml<br/>🔵 PR preview"]
        Base["build-base-image.yml<br/>⚙️ Base image"]
        E2E["e2e.yml<br/>🧪 Playwright"]
    end

    PushMain --> Prod
    PushMain --> E2E
    PR --> Preview
    PR --> E2E
    PoetryChange --> Base

    subgraph ProdJobs["production-deploy.yml"]
        PF["Path filter"]
        DB["deploy-backend<br/>Docker build → Scaleway"]
        DF["deploy-frontend<br/>Vercel build → deploy"]
        Gate["ci-gate ✅"]
        PF --> DB
        PF --> DF
        DB --> Gate
        DF --> Gate
    end

    subgraph PreviewJobs["preview-deploy.yml"]
        PF2["Path filter"]
        BB["build-backend<br/>Docker pr-{N}"]
        DPI["deploy-preview-infra<br/>Qdrant + Firebase emu + Backend"]
        Seed["seed-preview<br/>seed_local.py --with-vectors"]
        DFP["deploy-frontend<br/>Vercel preview"]
        Comment["PR comment<br/>with preview URLs"]
        PF2 --> BB --> DPI --> Seed --> DFP --> Comment
    end

    Prod --> ProdJobs
    Preview --> PreviewJobs

    style Prod fill:#16a34a,color:#fff
    style Preview fill:#2563eb,color:#fff
    style Base fill:#6b7280,color:#fff
    style E2E fill:#9333ea,color:#fff
```

### Production Deploy Flow

1. Push to `main` → GitHub Actions triggers `production-deploy.yml` (env: `PROD`)
2. **Path filter**: detect backend (`CHATVOTE-BackEnd/**`) vs frontend (`CHATVOTE-FrontEnd/**`) changes
3. **Backend**: Docker build → push to Scaleway registry → create/update serverless container (4096MB, 2240mCPU, min 1 / max 3) → poll `/healthz` up to 10 min
4. **Frontend**: `vercel pull` → sync env vars → `vercel build --prod` → `vercel deploy --prebuilt --prod`
5. **CI gate**: verify both succeeded or were skipped

### Preview Deploy Flow (per PR)

Deploys ephemeral infra: `backend-pr-{N}` + `qdrant-pr-{N}` + `firestore-pr-{N}` + `auth-pr-{N}` on Scaleway (scale-to-zero). Seeds data, deploys Vercel preview, posts URLs as PR comment. Auto-cleaned on PR close.

---

## 9. Infrastructure as Code (OpenTofu)

```mermaid
graph TB
    subgraph TF["terraform/ (Scaleway provider v2.45+)"]
        VPC["VPC: chatvote-vpc"]
        K8s["Kapsule: k8s-ingestion<br/>v1.35.2, Cilium"]
        Pool1["Pool: pool-par-2-8gb<br/>DEV1-L, 1 node"]
        Pool2["Pool: pool-pipeline<br/>POP2-2C-8G, 0 nodes"]
        Registry["Container Registry<br/>(Scaleway, private)"]
        S3a["S3: chatvote-qdrant-snapshots<br/>30-day expiration"]
        S3b["S3: chatvote-public-assets<br/>public-read ACL"]
    end

    K8s --> VPC
    Pool1 --> K8s
    Pool2 --> K8s

    style TF fill:#7c3aed,color:#fff
```

> **Note:** The Scaleway serverless container `backend-prod` is intentionally **not** managed by Terraform — it's owned by CI/CD (`production-deploy.yml`) to avoid conflicts.

---

## 10. Data Flow: Ingestion Pipeline

```mermaid
graph LR
    subgraph Sources
        PDF["Party Manifesto PDFs<br/>(Firebase Storage)"]
        Sites["Candidate Websites"]
        Sheets["Google Sheets<br/>(Candidate master data)"]
    end

    subgraph Scraping
        Playwright["Playwright BFS Crawl<br/>max depth 2<br/>15 pages + 5 PDFs / site"]
        BS["BeautifulSoup<br/>Content extraction"]
    end

    subgraph Processing
        Chunker["RecursiveCharacterTextSplitter<br/>1000 chars, 200 overlap"]
        Classifier["chunk_classifier.py<br/>Theme classification (Gemini)"]
        Embedder["Embedding Model<br/>(Scaleway / Google / OpenAI)"]
    end

    subgraph Storage
        Qdrant["Qdrant Collections<br/>all_parties / candidates_websites"]
    end

    PDF --> Chunker
    Sites --> Playwright --> BS --> Chunker
    Chunker --> Classifier --> Embedder --> Qdrant
    Sheets -.->|"Candidate metadata"| Sites

    style Sources fill:#f59e0b,color:#000
    style Processing fill:#8b5cf6,color:#fff
    style Storage fill:#dc2626,color:#fff
```

---

## 11. Authentication & Security

```mermaid
graph LR
    subgraph AuthProviders["Firebase Auth Providers"]
        Email["Email/Password"]
        Google["Google OAuth"]
        MS["Microsoft OAuth"]
        Anon["Anonymous"]
    end

    subgraph Frontend
        FireClient["Firebase Client SDK"]
        AdminSDK["Firebase Admin SDK<br/>(API routes only)"]
    end

    subgraph Backend
        AdminBE["Firebase Admin SDK<br/>(Server-side)"]
        AdminSecret["ADMIN_SECRET<br/>(Admin API auth)"]
    end

    AuthProviders --> FireClient
    FireClient -->|"ID Token"| AdminSDK
    AdminBE -->|"Service account"| Firestore
    AdminSecret -->|"Header"| Backend

    style AuthProviders fill:#f97316,color:#fff
```

---

## 12. Firebase Data Model

| Collection | Purpose | Key Fields |
|------------|---------|------------|
| `chat_sessions` | Conversation history | `user_id`, `updated_at`, `created_at`, `messages[]` |
| `parties` | Political party metadata | `name`, `logo`, `manifesto_url` |
| `candidates` | Candidate metadata | `name`, `party_id`, `commune`, `website` |
| `municipalities` | French commune data | `code`, `name`, `department` |
| `cached_answers` | Pre-computed answers | `question_hash`, `party_id`, `response` |
| `proposed_questions` | Suggested follow-ups | `party_id`, `questions[]` |
| `system_status` | LLM rate limit tracking | `llm_status` subdoc |

**Indexes:** Composite on `chat_sessions` (`user_id` + `updated_at` + `created_at`)

---

## 13. Docker Images

| Image | Tag | Purpose | Size |
|-------|-----|---------|------|
| `backend` | `:{sha}`, `:latest` | Production backend | ~258MB |
| `backend-base` | `:latest` | Cached deps + Playwright/Chromium | Larger |
| `backend` | `:pr-{N}` | Preview backend | ~258MB |
| `firebase-emulator` | `:latest` | Firebase emulator suite | — |
| `qdrant-snapshot` | `:latest` | Daily snapshot to S3 | — |
| `qdrant/qdrant` (public) | `:v1.14.0` | Vector database | — |

> All custom images are stored in a private Scaleway Container Registry.

---

## 14. Key Files Reference

| Category | File | Purpose |
|----------|------|---------|
| **CI/CD** | `.github/workflows/production-deploy.yml` | Prod deploy (main push) |
| | `.github/workflows/preview-deploy.yml` | PR preview environments |
| | `.github/workflows/build-base-image.yml` | Base Docker image rebuild |
| | `.github/workflows/e2e.yml` | Playwright E2E tests |
| **Backend** | `CHATVOTE-BackEnd/src/aiohttp_app.py` | HTTP server + REST routes |
| | `src/websocket_app.py` | Socket.IO event handlers |
| | `src/chatbot_async.py` | Core RAG pipeline (~53KB) |
| | `src/llms.py` | LLM provider failover |
| | `src/vector_store_helper.py` | Qdrant setup |
| | `src/firebase_service.py` | Firestore CRUD |
| | `src/services/candidate_website_scraper.py` | Playwright BFS crawler |
| | `src/services/candidate_indexer.py` | Candidate → Qdrant |
| | `src/services/manifesto_indexer.py` | Manifesto → Qdrant |
| **Frontend** | `CHATVOTE-FrontEnd/src/lib/chat-socket.ts` | Socket.IO client wrapper |
| | `src/lib/stores/chat-store.ts` | Zustand state |
| | `src/lib/firebase-admin.ts` | Server-side Firestore |
| | `src/lib/firebase-client.ts` | Client-side Auth |
| | `src/lib/socket.types.ts` | Type-safe Socket.IO events |
| **K8s** | `k8s/deployment.yaml` | Backend pod |
| | `k8s/qdrant-statefulset.yaml` | Qdrant persistent state |
| | `k8s/service.yaml` | Backend LoadBalancer |
| | `k8s/cronjob-qdrant-snapshot.yaml` | Daily backup |
| **IaC** | `terraform/scaleway.tf` | Scaleway infra (VPC, K8s, S3) |
| **Build** | `Makefile` | Dev automation |
| | `CHATVOTE-BackEnd/Dockerfile` | Prod image |
| | `CHATVOTE-BackEnd/Dockerfile.base` | Cached deps layer |
| | `CHATVOTE-BackEnd/docker-compose.dev.yml` | Local dev services |
