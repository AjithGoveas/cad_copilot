# LLM Codegen and Use Cases Specification

The application logic layer consists of modular Use Case Interactors (`GenerateCadUseCase`, `EditCadUseCase`, and `RepairCadUseCase`) and the `UniversalHTTPXGateway` connection pool adapter.

---

## 1. Use Case Interactors (`app/application/use_cases/`)

### 1.1 `GenerateCadUseCase`
Orchestrates the generation of parametric OpenSCAD scripts from user descriptions and optional blueprint uploads (PDF/Image).
- **Stage 1: Blueprint Audit**:
  - The blueprint is uploaded to LLM vision endpoints.
  - Returns a detailed JSON feature map representing boundary coordinates, features, and tolerances.
  - Implements an MD5 hash cache (`_BLUEPRINT_CACHE`) to bypass visual analysis for duplicate uploads.
- **Stage 2: Script Synthesis**:
  - Combines the user prompt and the Stage 1 feature map into a detailed context.
  - Sends the request to the LLM backend to synthesize compile-safe OpenSCAD code.
- **Cascading Fallbacks**:
  - If a request fails due to status code `5xx` or `429` (rate limits) or a connection timeout, the use case catches the exception and retries the prompt using the client-provided `fallback_metadata` block.

### 1.2 `EditCadUseCase`
Orchestrates surgical edits to existing OpenSCAD source code:
- Takes the current active source code, target click coordinates, and user instruction.
- Contextually formats the 3D target coordinates (`[System Context: The user clicked X, Y, Z. Use as origin/target]`) and injects it alongside the instruction.
- Instructs the LLM via `EDIT_SYSTEM_PROMPT` to surgically modify code variables and structures, keeping parameters headers (`// PARAMETERS_START`) intact.

### 1.3 `RepairCadUseCase`
Acts as a syntax self-healing pass:
- Triggered when the WebAssembly thread fails to compile a script.
- Sends the faulty script and compilation error trace to the LLM with `REPAIR_SYSTEM_PROMPT` to receive a corrected version of the code.

---

## 2. Infrastructure Gateway (`app/infrastructure/httpx_gateway.py`)

The `UniversalHTTPXGateway` implements the `ILLMProviderGateway` domain contract. It maintains a thread-safe connection pool utilizing raw HTTP REST queries, eliminating heavy SDK packages from the service.

### Supported Vendors & Payloads:
1. **Google (Gemini REST)**:
   - Endpoint: `https://generativelanguage.googleapis.com/v1beta/models/{model_id}:generateContent?key={api_key}`
   - Support for multimodal inline image blocks and custom `responseMimeType: "application/json"`.
2. **OpenAI / DeepSeek (Chat Completions)**:
   - Endpoint: `https://api.openai.com/v1/chat/completions` or `https://api.deepseek.com/chat/completions`
   - Maps inputs to standard messages payloads (`system`, `user`).
3. **Anthropic (Messages API)**:
   - Endpoint: `https://api.anthropic.com/v1/messages`
   - Incorporates custom system parameter fields and message components.
4. **Ollama (Local Models)**:
   - Endpoint: `{ollama_host}/api/chat`
   - Enables offline coding using models like `qwen2.5-coder`.

---

## 3. Code Normalization & Safety Filters

Before returning any code to the presentation router, the Use Case base class (`UseCaseBase`) runs sanitization filters to ensure manifold stability:
1. **Markdown Fences Extraction**: Extracts clean code blocks wrapped in ` ```scad ` or ` ```openscad ` fences.
2. **Resolution Cap (`$fn`)**: Locates `$fn = N` declarations. If `N` exceeds `32`, it is capped down to `32` to avoid blocking the WebAssembly thread in the browser. If `$fn` is missing, `$fn = 32;` is automatically prepended.
3. **Epsilon Offset (`eps`)**: Subtractive boolean operations (`difference()`) require cylinder/cube volumes to pierce manifold boundaries cleanly. If missing, `eps = 0.02;` is injected and applied to offsets to prevent co-planar face z-fighting compiler crashes.
