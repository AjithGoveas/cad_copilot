# CAD Copilot AI Engine

A Python backend service that converts engineering drawings (PDF/images) into precise 3D CAD models using Google's Gemini AI and the build123d library.

## Features

- **Two-Stage Generation**: Blueprint analysis (Vision) → Code generation (Text)
- **Streaming Output**: SSE-based token streaming for real-time feedback
- **Isolated Rendering**: Subprocess execution for stability
- **Comprehensive Error Handling**: Specific error messages for debugging
- **STEP/STL Export**: Professional CAD format output

## Architecture

```
User Prompt + Image
      ↓
Stage 1: Gemini Vision (Analysis)
      ↓
Stage 2: Gemini Text (Code Generation)
      ↓
build123d Script + Parameters
      ↓
Subprocess Execution
      ↓
STEP + STL Files
```

## Quick Start

### 1. Install Dependencies

```bash
cd ai-engine
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your Google AI API key
GOOGLE_API_KEY=your_api_key_here
```

### 3. Run the API Server

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 4. Test the Pipeline

```bash
# Using the demo script
python end_to_end_demo.py --image test_image.png --prompt "Generate this part"
```

## API Endpoints

### POST `/api/v1/generate`

Generate a build123d script from an image.

**Request** (multipart/form-data):
- `prompt` (form): Description of what to build
- `image` (file): Engineering drawing (PNG, JPEG, PDF)
- `model_name` (form, optional): Gemini model name

**Response** (SSE):
- `metadata`: Token budget information
- `status`: Processing status messages
- `token`: Code generation chunks
- `done`: Final script and parameters
- `error`: Error details if failed

### POST `/api/v1/render`

Render the generated script to 3D model files.

**Request** (JSON):
```json
{
    "python_script": "from build123d import * ...",
    "parameters": {"diameter": 10.0, "height": 20.0},
    "session_id": "optional_id"
}
```

**Response** (JSON):
```json
{
    "status": "SUCCESS",
    "artifacts": {
        "step_file_path": ".../cad_xxx.step",
        "stl_file_path": ".../cad_xxx.stl"
    }
}
```

## Project Structure

```
ai-engine/
├── app/
│   ├── api/
│   │   └── v1/
│   │       ├── __init__.py
│   │       └── router.py      # FastAPI routes
│   ├── models/
│   │   ├── __init__.py
│   │   └── schemas.py         # Pydantic schemas
│   ├── services/
│   │   ├── __init__.py
│   │   ├── llm_codegen.py     # AI code generation
│   │   └── parameter_render.py # 3D rendering
│   ├── main.py                # FastAPI app
│   └── __init__.py
├── logs/                      # Diagnostic logs
├── outputs/                   # Generated 3D models
├── scripts/
│   └── validate.py            # CLI validation tool
├── end_to_end_demo.py         # Complete pipeline demo
├── ARCHITECTURE.md            # Detailed architecture
├── IMPROVEMENTS.md            # Technical improvements
├── requirements.txt
└── .env.example
```

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `GOOGLE_API_KEY` | Google AI API key | Required |
| `GENAI_MODEL` | Gemini model to use | `gemini-3.1-flash-lite` |
| `GENAI_MAX_RETRIES` | Max retry attempts | `5` |
| `MAX_PROMPT_TOKENS` | Token budget | `12000` |
| `MAX_OUTPUT_TOKENS` | Max output tokens | `2048` |
| `GENAI_RETRY_BASE_DELAY` | Retry base delay (s) | `1.5` |
| `GENAI_MAX_RETRY_DELAY` | Max retry delay (s) | `60` |

## Usage Example

```python
from app.services.llm_codegen import LLMCodegenService
from app.services.parameter_render import ParameterRenderService, extract_parameters_from_script

# Initialize services
codegen = LLMCodegenService()
render = ParameterRenderService()

# Load image
with open("drawing.png", "rb") as f:
    image_bytes = f.read()

# Stage 1: Analyze
summary = codegen.summarise_blueprint(image_bytes, "image/png")

# Stage 2: Generate
script = "".join(codegen.stream_build123d_script(
    prompt="Generate a housing with 4 mounting holes",
    image_bytes=image_bytes,
    image_mime_type="image/png",
    summary=summary
))

# Stage 3: Extract parameters
params = extract_parameters_from_script(script)

# Stage 4: Render
paths = render.render_to_outputs(
    parameters=params,
    script=codegen.normalize_script(script),
    output_basename="my_part"
)

print(f"Generated: {paths['stl_path']}")
```

## Error Handling

| Error | Cause | Solution |
|-------|-------|----------|
| `GOOGLE_API_KEY not set` | Missing API key | Configure `.env` |
| `Prompt too large` | Exceeds token budget | Simplify prompt/image |
| `Model quota exhausted` | Daily limit reached | Wait or upgrade API tier |
| `Render Engine timed out` | Complex geometry | Simplify model or increase timeout |
| `No exportable shape found` | Script execution failed | Check script syntax |

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `build123d` | 0.10.0 | CAD kernel |
| `google-genai` | 1.73.1 | Gemini AI client |
| `fastapi` | 0.136.0 | REST API framework |
| `python-dotenv` | 1.2.2 | Environment config |
| `uvicorn` | 0.44.0 | ASGI server |

## Development

### Running Tests

```bash
# Validate with a test image
python scripts/validate.py --image path/to/image.png
```

### Linting

```bash
# Check code style
ruff check .
```

## License

MIT License - See LICENSE file for details.
