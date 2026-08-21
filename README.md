# CodeTrace — LeetCode-style DSA Editor

A dark-mode DSA practice workspace with:

- Monaco / VS Code-style editor
- Editable problem statement
- Multiple test cases with pass/fail status
- Run a single program and inspect stdout/stderr
- Submit against all custom test cases
- Python step-by-step execution visualization
- Current-line highlighting in Monaco
- Local-variable snapshots
- Timeline + previous/next execution controls
- Python, JavaScript, Java and C++ execution through Judge0

Monaco is integrated through `@monaco-editor/react`, which exposes the editor and Monaco instances through React props/hooks. citeturn0search1turn0search11

Judge0 is used as the execution sandbox. It supports online IDE/code-editor use cases, sandboxed execution, multiple languages and configurable time/memory limits. citeturn0search2turn0search13

## Run locally

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export JUDGE0_URL=https://ce.judge0.com
# If your Judge0 instance requires authentication:
# export JUDGE0_TOKEN=your_token
uvicorn main:app --reload --port 8000
```

### Frontend

In another terminal:

```bash
cd frontend
npm install
npm run dev
```

Open the Vite URL, normally `http://localhost:5173`.

Optional frontend API override:

```bash
VITE_API_URL=http://localhost:8000 npm run dev
```

## Important execution note

Do **not** execute arbitrary user code directly in the FastAPI process. Keep Judge0 (or another isolated execution service) between the browser and your application server. For production, use a controlled/self-hosted Judge0 deployment or another sandboxed runner. Judge0 documents both cloud and self-hosted deployment options. citeturn0search13

## How visualization works

The Visualizer currently supports Python. The backend wraps the submitted Python program with `sys.settrace`, records each executed source line and a safe `repr()` snapshot of local variables, then returns those snapshots to the UI. The Monaco editor highlights the current line and the right panel provides timeline controls.

## Next production upgrades

1. Parse LeetCode-style function signatures and generate language-specific harnesses.
2. Add hidden test cases separate from visible custom tests.
3. Add AST-based variable visualization for arrays, maps, trees, graphs and linked lists.
4. Add call-stack frames and recursion visualization.
5. Add AI hints, complexity analysis and solution explanation.
6. Add authentication, saved problems and submission history.
7. Add rate limiting and per-user execution quotas.
