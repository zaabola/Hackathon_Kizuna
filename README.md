# NOUBA — Fair Water for Shared Oasis Boreholes

NOUBA plans solar and grid pumping around STEG power cuts, stores water in the borehole's basin, releases it by gravity at night, shares shortages equally, and generates family SMS/WhatsApp messages in Arabic, Tunisian Darija, French, English, and Japanese.

## Architecture
- **Planner**: 16 GB VRAM open-weights LLM (`Qwen/Qwen2.5-14B-Instruct-AWQ` via **vLLM** OpenAI-compatible API with `guided_json`) paired with a deterministic **Plan Verifier & Repair Loop** (`backend/app/services/plan_verifier.py`) so cut windows, aquifer quotas, and basin limits are never violated.
- **Backend**: Python **FastAPI** (`backend/app/main.py`) serving `/api/weather`, `/api/plan`, `/api/messages`, `/api/qa`, and the built React `frontend/dist` on a single port (`7860`).
- **Frontend**: Lightweight **React + TypeScript + Vite** SPA (`frontend/`) with custom SVG pumping chart, light/dark mode, RTL Arabic/Darija support, and one-tap SMS/WhatsApp links.

## Local Development (Backend + Tests)
```powershell
cd Hackathon_Kizuna
python -m venv backend\.venv
backend\.venv\Scripts\pip install -r backend\requirements.txt
$env:PYTHONPATH="backend"
backend\.venv\Scripts\pytest backend\tests -q
backend\.venv\Scripts\uvicorn app.main:app --app-dir backend --reload --port 7860
```

## Running on Kaggle / Google Colab (16 GB VRAM)
1. Push this repository to GitHub.
2. Open `notebooks/run_nouba_kaggle_colab.ipynb` in Kaggle or Colab (select a **T4 16 GB** GPU).
3. Update `REPO_URL` in Cell 1 and run all cells to launch **vLLM** (`Qwen2.5-14B-Instruct-AWQ`), **FastAPI**, and a public `trycloudflare.com` URL.
