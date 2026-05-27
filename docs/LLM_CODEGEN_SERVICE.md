# LLM Codegen Service Specification

The `LLMCodegenService` class manages GenAI API execution, prompt templates, and code formatting filters.

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

### `audit_blueprint(image_bytes: bytes, mime_type: str) -> dict`
Analyzes technical drawing files.
* **Parameters**:
  * `image_bytes`: Binary data of PNG, JPEG, or PDF drawing.
  * `mime_type`: File content type.
* **Returns**: A JSON dictionary matching the feature-map schema.

### `generate_script(prompt, image_bytes, mime_type, feature_map, base_code, selection_context) -> str`
Generates a parametric OpenSCAD script from scratch.
* **Parameters**:
  * `prompt`: Sizing or topology request.
  * `image_bytes` & `mime_type`: Original blueprint file.
  * `feature_map`: Pre-audited JSON model from Stage 1.
* **Returns**: Clean, parameterized OpenSCAD code.

### `edit_script(prompt: str, current_code: str, target_point: Optional[list[float]]) -> str`
Surgically edits active code.
* **Parameters**:
  * `prompt`: Refinement instruction.
  * `current_code`: Current script contents.
  * `target_point`: Target coordinates vector.
* **Returns**: Updated OpenSCAD code.

---

## 3. Code Normalization

Gemini responses can sometimes contain markdown formatting blocks or conversational prefaces. The service runs `_normalize_script` to extract code content:

1. **Markdown Fences Extraction**: Extracts scripts wrapped in ` ```scad ` or ` ```openscad ` fences.
2. **Fast-Forward Regex**: Searches for common OpenSCAD starting tokens (e.g. `// PARAMETERS_START`, `$fn =`, `module`) and slices away any text preceding them.
3. **Trim**: Trims trailing whitespace and ticks.
