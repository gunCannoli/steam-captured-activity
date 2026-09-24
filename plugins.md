# Plugin Development & Guardrails

The comprehensive guide to creating Millennium plugins, plugin architecture, the 4-rung UI modification ladder, and all 9 regression guardrails is documented in:

👉 **[docs/plugins.md](docs/plugins.md)**

### Table of Contents in [docs/plugins.md](docs/plugins.md):
- **Layout:** Workspace and standalone plugin directory structure
- **1. Scaffold:** `plugin.json` schema, naming, backend type, and Millennium lib stubs
- **2. Backend (LuaJIT):** Lifecycle hooks (`on_load`, `on_frontend_loaded`), RPC bridges, nil-safety
- **3. Frontend (TypeScript + React):** Module probing, webpack runtime, `findClassModule`
- **Build Nothing Steam Already Builds:** The 4-rung UI modification ladder
- **Core Architectural Principles:** No network in core, DOM vs Stores, CSS scoping
- **Guardrails & Regression Prevention:**
  1. Prototype Hook Coupling (`BIsModOrShortcut` vs `GetGameID`)
  2. Zero Expensive Operations in Hot Prototype Methods ($O(1)$ Strictly Enforced)
  3. Single-Pass Webpack Module Pre-Caching
  4. Multi-Tab Smoke Verification Requirement
  5. Persistent In-Memory Stubs & Negative Cache Immunization
  6. Two-Way Navigation Lifecycle Smoke Verification
  7. Safe Category Cache Invalidation
  8. Dedicated Metadata Association (Never Overwrite `appData.details`)
  9. Automated CDP Verification Suite
- **4. Develop:** Local workflow (`dev.ps1`, `-dev` mode, DevTools)
- **5. Test:** Running Lua unit tests outside Steam
- **6. Publish:** Subtree split and public repository publishing
- **Checklist for a New Plugin**

