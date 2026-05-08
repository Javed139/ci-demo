# ci-demo

> Lab 10 · Professional CI/CD Pipelines and Release Engineering

---

## Pipeline Overview

```
Push to main / PR
       │
       ▼
┌─────────────────────────────────────────────────────┐
│              CI – Quality Gates                     │
│  lint ──┐                                           │
│         ├──► test ──► build (artifact upload)       │
│  scan ──┘                                           │
└─────────────────────────────────────────────────────┘
       │  (on success)
       ▼
┌─────────────────────────────────────────────────────┐
│           CD – Deploy with Protected Environments   │
│  deploy-staging → smoke-test-staging                │
│       │ (manual approval gate)                      │
│  deploy-production → smoke-test-production          │
└─────────────────────────────────────────────────────┘
       │  (on tagged commit)
       ▼
┌─────────────────────────────────────────────────────┐
│           Release – Semantic Versioning             │
│  Analyse commits → bump version → CHANGELOG → tag  │
└─────────────────────────────────────────────────────┘
```

---

## Task 1 · Quality-Controlled CI Pipeline

Defined in [`.github/workflows/ci-pipeline.yml`](.github/workflows/ci-pipeline.yml).

| Job | Runs after | Purpose |
|-----|-----------|---------|
| `lint` | — | ESLint code-style checks |
| `security-scan` | — | Trivy CVE / misconfiguration scan (parallel with lint) |
| `test` | lint + security-scan | Unit tests (zero external dependencies) |
| `build` | test | Package artifact, upload to GitHub Actions |

---

## Task 2 · Protected Environments

Defined in [`.github/workflows/cd-deploy.yml`](.github/workflows/cd-deploy.yml).

### Setting up environments in GitHub

1. Go to **Settings → Environments → New environment**
2. Create **`staging`** – no required reviewers
3. Create **`production`**:
   - Add a **Required Reviewer** (your GitHub username)
   - Add secret: `PROD_API_KEY` = `mock-prod-key-abc123`

The `production` job will pause and send an email/notification to the reviewer. The deployment only proceeds after explicit approval.

Secrets are referenced safely in the workflow — never hardcoded:
```yaml
env:
  PROD_API_KEY: ${{ secrets.PROD_API_KEY }}
```

---

## Task 3 · Canary Deployment Strategy

### What is Canary Deployment?

A **Canary deployment** gradually shifts production traffic from the old version to the new version, exposing only a small percentage of users to the new code initially. If the canary is healthy, traffic is incrementally increased until rollout is complete. If it fails, traffic is shifted back with zero user impact.

### Implementation Plan

#### Step 1 – Deploy the canary alongside the stable version

Using Kubernetes and an ingress controller (e.g., NGINX or Istio):

```yaml
# canary-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ci-demo-canary
spec:
  replicas: 1        # 1 canary pod vs. 9 stable pods = 10% traffic
  selector:
    matchLabels:
      app: ci-demo
      track: canary
  template:
    metadata:
      labels:
        app: ci-demo
        track: canary
    spec:
      containers:
        - name: ci-demo
          image: ghcr.io/org/ci-demo:${{ github.sha }}
```

With NGINX ingress, annotate to split traffic:
```yaml
nginx.ingress.kubernetes.io/canary: "true"
nginx.ingress.kubernetes.io/canary-weight: "10"   # 10% to canary
```

#### Step 2 – Monitor the canary

Key metrics to track during canary analysis (using Prometheus + Grafana or Datadog):

| Metric | Threshold | Action if breached |
|--------|-----------|-------------------|
| **HTTP 5xx error rate** | < 1% | Immediate rollback |
| **p99 latency** | < 500 ms | Rollback |
| **CPU / memory usage** | < 80% baseline | Investigate |
| **Successful test transactions** | > 99% | Continue rollout |

Automated canary analysis can be performed with **Flagger** or **Argo Rollouts**:

```yaml
# flagger-canary.yaml
apiVersion: flagger.app/v1beta1
kind: Canary
metadata:
  name: ci-demo
spec:
  analysis:
    interval: 1m
    threshold: 5        # max failed metric checks before rollback
    maxWeight: 50       # max traffic % to canary
    stepWeight: 10      # increment per analysis interval
    metrics:
      - name: request-success-rate
        thresholdRange:
          min: 99
        interval: 1m
      - name: request-duration
        thresholdRange:
          max: 500
        interval: 1m
```

#### Step 3 – Promote or rollback

**Promote** (all checks green):
```bash
# Flagger does this automatically, or manually:
kubectl set image deployment/ci-demo-stable ci-demo=ghcr.io/org/ci-demo:$NEW_SHA
kubectl delete deployment ci-demo-canary
```

**Rollback** (threshold breached):
```bash
# Automatic via Flagger, or manually:
kubectl delete deployment ci-demo-canary
# Stable deployment is untouched – users experience zero downtime
```

#### Step 4 – Integrate into GitHub Actions

```yaml
- name: Progressive canary rollout (10% → 25% → 50% → 100%)
  run: |
    for weight in 10 25 50 100; do
      kubectl annotate ingress ci-demo \
        nginx.ingress.kubernetes.io/canary-weight="$weight" --overwrite
      echo "Traffic at ${weight}% – waiting 5 minutes for metrics..."
      sleep 300
      ERROR_RATE=$(curl -s "$PROMETHEUS_URL/api/v1/query?query=rate(http_requests_total{status=~'5..'}[5m])" \
        | jq '.data.result[0].value[1]' -r)
      if (( $(echo "$ERROR_RATE > 0.01" | bc -l) )); then
        echo "::error::Error rate ${ERROR_RATE} exceeded 1% – rolling back!"
        kubectl annotate ingress ci-demo \
          nginx.ingress.kubernetes.io/canary="false" --overwrite
        exit 1
      fi
    done
    echo "✅ Canary promoted to 100%"
```

---

## Task 4 · Automated Rollback Mechanism

Defined in [`.github/workflows/cd-deploy.yml`](.github/workflows/cd-deploy.yml) — `smoke-test-staging` and `smoke-test-production` jobs.

The smoke test (`node src/index.test.js`) runs immediately after every deployment. If it returns a non-zero exit code:

1. The step prints a clear `::error::` annotation visible in the GitHub UI
2. The pipeline logs the rollback steps (kubectl rollout undo / helm rollback)
3. An on-call notification is simulated (real setup: Slack webhook / PagerDuty API)
4. The job exits with code `1`, blocking any further promotion

---

## Task 5 · Semantic Release

Defined in [`.github/workflows/semantic-release.yml`](.github/workflows/semantic-release.yml) and [`.releaserc.json`](.releaserc.json).

### Conventional Commits format

```
<type>(<scope>): <short description>
```

| Type | SemVer bump | Example |
|------|-------------|---------|
| `feat` | MINOR | `feat(auth): add JWT login endpoint` |
| `fix` | PATCH | `fix(api): handle null response from DB` |
| `perf` | PATCH | `perf(query): cache user lookups` |
| `BREAKING CHANGE` in footer | MAJOR | `feat!: redesign public API` |
| `chore`, `docs`, `ci` | none | — |

### Example commits for this project

```bash
git commit -m "feat(health): add healthCheck function to index.js"
git commit -m "fix(greet): throw error on non-string input"
git commit -m "perf(tests): remove external test runner dependency"
```

These three commits would produce: **v1.1.0** (one `feat` → MINOR bump).

### What semantic-release does automatically

1. Reads all commits since the last tag
2. Determines next version using the bump rules above
3. Updates `CHANGELOG.md`
4. Updates `version` in `package.json`
5. Creates a git tag (e.g., `v1.1.0`)
6. Creates a GitHub Release with auto-generated release notes

---

## Secrets Reference

| Secret name | Environment | Description |
|-------------|-------------|-------------|
| `GITHUB_TOKEN` | All | Automatically provided by GitHub Actions |
| `PROD_API_KEY` | production | Mock production API key |

---

## Local Development

```bash
npm install          # Install dependencies
npm run lint         # Run ESLint
npm test             # Run unit tests
node src/index.js    # Start the app
```
#   t e s t  
 