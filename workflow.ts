import {
  createWorkflow,
  type WorkflowExecutionContext,
  SequenceNodeBuilder,
} from '@jshookmcp/extension-sdk/workflow';

const workflowId = 'workflow.evidence-pack.v1';

/**
 * Evidence Pack — Reverse Mission Workflow
 *
 * One-click export of the current reverse engineering session:
 *   1. Queries the full evidence graph
 *   2. Exports HAR from network capture
 *   3. Takes a page screenshot
 *   4. Collects session insights
 *   5. Gathers instrumentation session data
 *   6. Captures console logs and local storage state
 *   7. Packages everything into a structured evidence bundle
 */
export default createWorkflow(workflowId, 'Evidence Pack')
  .description(
    'One-click export of the current reverse session: evidence graph, HAR, screenshot, console logs, storage, instrumentation sessions, and session insights — packaged as a replayable evidence bundle.',
  )
  .tags([
    'reverse',
    'evidence',
    'export',
    'report',
    'har',
    'screenshot',
    'session',
    'mission',
  ])
  .timeoutMs(5 * 60_000)
  .defaultMaxConcurrency(6)
  .buildGraph((ctx: WorkflowExecutionContext) => {
    const prefix = 'workflows.evidencePack';

    // ── Config ──────────────────────────────────────────────────────
    const includeHar = Boolean(ctx.getConfig(`${prefix}.includeHar`, true));
    const includeScreenshot = Boolean(ctx.getConfig(`${prefix}.includeScreenshot`, true));
    const includeConsoleLogs = Boolean(ctx.getConfig(`${prefix}.includeConsoleLogs`, true));
    const includeStorage = Boolean(ctx.getConfig(`${prefix}.includeStorage`, true));
    const consoleLogLimit = Number(ctx.getConfig(`${prefix}.consoleLogLimit`, 100));
    const maxConcurrency = Number(ctx.getConfig(`${prefix}.parallel.maxConcurrency`, 6));
    const exportFormat = String(ctx.getConfig(`${prefix}.exportFormat`, 'json'));
    const requestTail = Number(ctx.getConfig(`${prefix}.requestTail`, 100));

    const root = new SequenceNodeBuilder('evidence-pack-root');

    root
      // ── Phase 1: Parallel Collection ──────────────────────────────
      .parallel('collect-evidence', (p) => {
        p.maxConcurrency(maxConcurrency)
          .failFast(false)
          // Evidence graph
          .tool('query-evidence-graph', 'evidence_query', {
            input: { format: exportFormat },
          })
          // Session insights
          .tool('get-session-insights', 'get_session_insights', {
            input: {},
          })
          // Instrumentation sessions
          .tool('list-sessions', 'instrumentation_session_list', {
            input: {},
          })
          // Network requests
          .tool('get-requests', 'network_get_requests', {
            input: { tail: requestTail },
          })
          // Cookies
          .tool('get-cookies', 'page_get_cookies');

        // Optional collectors
        if (includeHar) {
          p.tool('export-har', 'network_export_har', {
            input: {},
          });
        }

        if (includeScreenshot) {
          p.tool('take-screenshot', 'page_screenshot', {
            input: { fullPage: true },
          });
        }

        if (includeConsoleLogs) {
          p.tool('get-console-logs', 'console_get_logs', {
            input: { limit: consoleLogLimit },
          });
        }

        if (includeStorage) {
          p.tool('get-local-storage', 'page_get_local_storage');
        }
      })

      // ── Phase 2: Auth Surface ─────────────────────────────────────
      .tool('extract-auth', 'network_extract_auth', {
        input: { minConfidence: 0.2 },
      })

      // ── Phase 3: Page Snapshot (Coordination) ─────────────────────
      .tool('save-page-snapshot', 'save_page_snapshot', {
        input: {},
      })

      // ── Phase 4: Evidence Export ──────────────────────────────────
      .tool('export-evidence', 'evidence_export', {
        input: { format: exportFormat },
      })

      // ── Phase 5: Summary Insight ──────────────────────────────────
      .tool('emit-insight', 'append_session_insight', {
        input: {
          insight: JSON.stringify({
            status: 'evidence_pack_complete',
            workflowId,
            includeHar,
            includeScreenshot,
            includeConsoleLogs,
            includeStorage,
            exportFormat,
          }),
        },
      });

    return root;
  })
  .onStart((ctx) => {
    ctx.emitMetric('workflow_runs_total', 1, 'counter', {
      workflowId,
      mission: 'evidence_pack',
      stage: 'start',
    });
  })
  .onFinish((ctx) => {
    ctx.emitMetric('workflow_runs_total', 1, 'counter', {
      workflowId,
      mission: 'evidence_pack',
      stage: 'finish',
    });
  })
  .onError((ctx, error) => {
    ctx.emitMetric('workflow_errors_total', 1, 'counter', {
      workflowId,
      mission: 'evidence_pack',
      stage: 'error',
      error: error.name,
    });
  })
  .build();
