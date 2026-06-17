# LLM Codegen Service Specification

The `LLMCodegenService` class manages GenAI API execution, prompt templates, code formatting filters, file uploading caching, and integration with the Gemini Files API.

---

## 1. Prompt Engineering Pipeline

The service utilizes three isolated system instruction sets to configure Gemini's generation parameters:

### 1.1 `AUDIT_INSTRUCTION` (Vision Audit)
* **Goal**: Analyze 2D technical drawings (image or PDF blueprint).
* **Constraints**: Specifies Z-axis stacking guidelines and datum coordinate setup.
* **Output**: Strictly JSON conforming to a schema.

### 1.2 `SYSTEM_INSTRUCTION` (Scratch Generation)
* **Goal**: Synthesize OpenSCAD code.
* **Key Guidelines**:
  1. Manifold Stability: Mandates `$fn = 32` and clean boolean geometry.
  2. Parametric Stacking: All heights and offsets must be derived variables, not hardcoded values.
  3. Epsilon Protocol: Explicitly details the use of `eps = 0.01` to offset cutting cylinders and cubes to pierce manifolds cleanly.
  4. Block Structure: Mandates variables inside `// PARAMETERS_START/END` comments and assembly calling inside `part_root()`.

### 1.3 `EDIT_SYSTEM_PROMPT` (Surgical Refinement)
* **Goal**: Modify existing OpenSCAD code.
* **Key Guidelines**:
  - Focuses on modification in place.
  - Instructs the LLM to retain the active variables blocks and module schemas, appending or removing lines selectively.
  - Mandates outputting the entire updated file rather than partial snippets.

---

## 2. API Method Definitions

### `upload_file_to_gemini(file_bytes: bytes, mime_type: str, filename: str) -> Any`
Uploads raw file bytes to the Gemini Files API via a temporary file on the host filesystem.
* **Parameters**:
  * `file_bytes`: Binary contents of the document.
  * `mime_type`: Content type (e.g. `application/pdf`, `image/png`).
  * `filename`: Base name of the file to resolve file extension correctly.
* **Returns**: Gemini file object representation, after polling until status is `ACTIVE`.

### `audit_blueprint(image_bytes: bytes, mime_type: str, filename: str = "blueprint.pdf") -> dict`
Analyzes technical drawing files, checking an in-memory MD5 cache first.
* **Parameters**:
  * `image_bytes`: Binary data of PNG, JPEG, or PDF drawing.
  * `mime_type`: File content type.
  * `filename`: The name of the file.
* **Returns**: A JSON dictionary matching the feature-map schema.

### `generate_script(prompt: str, image_bytes: Optional[bytes] = None, mime_type: Optional[str] = None, feature_map: Optional[dict] = None, base_code: Optional[str] = None, selection_context: Optional[str] = None, filename: str = "blueprint.pdf") -> str`
Generates a parametric OpenSCAD script from scratch or refines an existing one.
* **Parameters**:
  * `prompt`: Sizing or topology request.
  * `image_bytes` & `mime_type`: Optional blueprint file.
  * `feature_map`: Pre-audited JSON model from Stage 1.
  * `base_code`: Existing OpenSCAD code if doing refinement.
  * `selection_context`: Target coordinates context metadata.
  * `filename`: Name of the file.
* **Returns**: Clean, parameterized OpenSCAD code.

### `edit_script(prompt: str, current_code: str, target_point: Optional[list[float]]) -> str`
Surgically edits active code.
* **Parameters**:
  * `prompt`: Refinement instruction.
  * `current_code`: Current script contents.
  * `target_point`: Target coordinates vector.
* **Returns**: Updated OpenSCAD code.

---

## 3. In-Memory Cache Schema (`_BLUEPRINT_CACHE`)

A global dictionary stores up to 50 parsed files:
```python
_BLUEPRINT_CACHE = {
    "<MD5_HASH>": {
        "feature_map": { ... },     # Stage 1 Audit JSON output
        "gemini_file": file_object, # Uploaded Gemini File handle
        "mime_type": "..."          # Resolved mime type
    }
}
```

---

## 4. Code Normalization

Gemini responses can sometimes contain markdown formatting blocks or conversational prefaces. The service runs `_normalize_script` to extract code content:

1. **Markdown Fences Extraction**: Extracts scripts wrapped in ` ```scad ` or ` ```openscad ` fences.
2. **Fast-Forward Regex**: Searches for common OpenSCAD starting tokens (e.g. `// PARAMETERS_START`, `$fn =`, `module`) and slices away any text preceding them.
3. **Trim**: Trims trailing whitespace and ticks.
