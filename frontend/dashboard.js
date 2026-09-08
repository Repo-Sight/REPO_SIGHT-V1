/* ==========================================================================
   repo-sight dashboard — client-side logic
   Reads ?scan=<id> from the URL and polls GET /api/scans/:id until the
   scan is COMPLETED/FAILED, then renders the Overview report from
   { project, violations }. With no ?scan= param it renders the "start a
   new scan" form, which POSTs to /api/analyze and redirects to ?scan=<id>.
   ========================================================================== */

// Direction B tokens (body.report-mode in styles.css) -- grade colors map
// 1:1 onto the accent/warning/critical tokens per v2 plan Section 7.2.1,
// rather than a separate green/amber/red severity palette.
const GRADE_COLOR = { A: '#3d5a8a', B: '#3d5a8a', C: '#c77d22', D: '#c77d22', F: '#b4432e' };
const GAUGE_RADIUS = 54;
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * GAUGE_RADIUS;
const LONG_FUNCTION_THRESHOLD = 100; // matches cpp/py/java-long-*-function rule

// Mirrors analyser/src/report/HealthScore.cpp exactly (weights + good/bad
// reference points for each of the five scoreBreakdown components) so the
// Scoring tab's bars and "your value vs. target" captions stay truthful to
// the actual formula instead of drifting from it. Do not tune these here --
// change HealthScore.cpp and update this comment/table together.
const SCORE_COMPONENTS = [
    {
        key: 'complexityDensity', weight: 0.35, goodRef: 0.15, badRef: 0.50, higherIsBetter: false,
        title: 'Complexity density', unit: 'ratio',
        valueOf: p => (p.cyclomaticComplexity || 0) / Math.max(1, p.codeLines || 0),
        format: v => v.toFixed(2),
        detail: (v, good) => `Your repo: ${v.toFixed(2)} cyclomatic complexity per code line (target: ${good.toFixed(2)} or lower).`,
        tip: 'Break large functions into smaller ones and reduce branching (if/else, loops) per function.',
    },
    {
        key: 'avgFunctionLength', weight: 0.25, goodRef: 15, badRef: 60, higherIsBetter: false,
        title: 'Average function length', unit: 'lines',
        valueOf: p => p.avgFunctionLength || 0,
        format: v => v.toFixed(1),
        detail: (v, good) => `Your repo: ${v.toFixed(1)} lines per function on average (target: ${good} or fewer).`,
        tip: 'Split your longest functions into smaller, single-purpose ones \u2014 see the Files tab to find them.',
    },
    {
        key: 'commentCoverage', weight: 0.20, goodRef: 0.20, badRef: 0.02, higherIsBetter: true,
        title: 'Comment coverage', unit: 'ratio',
        valueOf: p => (p.commentLines || 0) / Math.max(1, p.codeLines || 0),
        format: v => `${(v * 100).toFixed(1)}%`,
        detail: (v, good) => `Your repo: ${(v * 100).toFixed(1)}% of code lines are comments (target: ${(good * 100).toFixed(0)}% or more).`,
        tip: 'Add explanatory comments to non-obvious logic, especially in your most complex files.',
    },
    {
        key: 'todoDensity', weight: 0.10, goodRef: 0.01, badRef: 0.05, higherIsBetter: false,
        title: 'TODO density', unit: 'ratio',
        valueOf: p => (p.todoCount || 0) / Math.max(1, p.codeLines || 0),
        format: v => `${(v * 100).toFixed(1)}%`,
        detail: (v, good) => `Your repo: ${(v * 100).toFixed(1)}% of code lines carry a TODO/FIXME (target: ${(good * 100).toFixed(0)}% or lower).`,
        tip: 'Resolve or remove outstanding TODO/FIXME markers instead of letting them accumulate.',
    },
    {
        key: 'nestingDepth', weight: 0.10, goodRef: 3, badRef: 8, higherIsBetter: false,
        title: 'Max nesting depth', unit: 'levels',
        valueOf: p => p.maxNestingDepth || 0,
        format: v => `${v}`,
        detail: (v, good) => `Your repo's deepest nesting: ${v} levels (target: ${good} or shallower).`,
        tip: 'Flatten deeply nested if/loop blocks \u2014 early returns and guard clauses usually help.',
    },
];

class RepoSightDashboard {
    constructor() {
        this.jsonData = null;
        this.meta = { projectName: '', scanId: '', createdAt: '' };
        this.lastAnalysisDate = localStorage.getItem('rs-last-analysis');
        this.analysisStreak = parseInt(localStorage.getItem('rs-streak') || '0', 10);
        this.feedbackRating = 0;
        this.feedbackSubmitting = false;

        this.init();
    }

    init() {
        this.bindStaticEvents();
        this.loadReport();
        this.updateStreakDisplay();
    }

    /* -----------------------------------------------------------------
       Small DOM helpers (defensive -- never throw if markup drifts)
       ----------------------------------------------------------------- */
    $(id) {
        return document.getElementById(id);
    }

    setText(id, value) {
        const el = this.$(id);
        if (el) el.textContent = value;
    }

    escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

      formatNumber(num) {
        return Number(num || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    // Vercel Web Analytics custom events (Section 9 of the v2 plan --
    // scan_started/scan_completed/scan_failed/file_upload_used). This is a
    // plain static site with no bundler, so this calls the window.va queue
    // shim declared in index.html's <head> directly rather than importing
    // the @vercel/analytics npm package, which cannot run unbundled in the
    // browser. Defensive: never throws if the shim isn't present.
    track(name, data) {
        try {
            if (typeof window.va === 'function') {
                window.va('event', data ? { name, data } : { name });
            }
        } catch (_) {
            // Analytics must never break the actual scan flow.
        }
    }
    /* -----------------------------------------------------------------
       Static event bindings -- the rerun button and the feedback widget.
       Both live in markup that's present regardless of scan state, so
       binding happens once up front rather than after the report loads.
       ----------------------------------------------------------------- */
    bindStaticEvents() {
        const rerunBtn = this.$('rerun-btn');
        if (rerunBtn) {
            rerunBtn.addEventListener('click', () => window.location.reload());
        }
        this.bindFeedbackWidget();
        this.bindTabs();
        this.bindFilesToolbar();
    }

    /* -----------------------------------------------------------------
       Phase 4: tab navigation (Overview / By Language / Files / Scoring).
       Markup is present regardless of scan state, so binding happens up
       front like the other static events -- switching tabs before data
       has loaded is harmless, the panels are just empty.
       ----------------------------------------------------------------- */
    bindTabs() {
        const tabs = Array.from(document.querySelectorAll('.rs-tab'));
        if (!tabs.length) return;

        const TAB_TITLES = { overview: 'Overview', bylang: 'By Language', files: 'Files', scoring: 'Scoring' };

        tabs.forEach(btn => {
            btn.addEventListener('click', () => {
                const tabId = btn.dataset.tab;
                tabs.forEach(t => {
                    const active = t === btn;
                    t.classList.toggle('active', active);
                    t.setAttribute('aria-selected', active ? 'true' : 'false');
                });
                document.querySelectorAll('.tab-panel').forEach(panel => {
                    panel.classList.toggle('hidden', panel.dataset.tabPanel !== tabId);
                });
                this.setText('page-header-title', TAB_TITLES[tabId] || 'Overview');
                this.track('tab_viewed', { tab: tabId });
            });
        });
    }

    /* -----------------------------------------------------------------
       Feedback widget -- star rating (1-5) + optional comment, shown on
       the report page. Submits to POST /api/feedback and remembers (via
       localStorage, keyed by scanId) that this scan was already rated so
       a page refresh doesn't ask twice.
       ----------------------------------------------------------------- */
    bindFeedbackWidget() {
        const stars = Array.from(document.querySelectorAll('#feedback-stars .feedback-star'));
        const submitBtn = this.$('feedback-submit');
        const messageEl = this.$('feedback-message');
        const statusEl = this.$('feedback-status');
        const honeypotEl = this.$('feedback-company');
        if (!stars.length || !submitBtn || !messageEl || !statusEl) return;

        stars.forEach(star => {
            star.addEventListener('click', () => {
                this.feedbackRating = parseInt(star.dataset.value, 10) || 0;
                stars.forEach(s => {
                    const active = (parseInt(s.dataset.value, 10) || 0) <= this.feedbackRating;
                    s.classList.toggle('is-active', active);
                    s.setAttribute('aria-checked', active ? 'true' : 'false');
                });
                submitBtn.disabled = this.feedbackRating < 1;
            });
        });

        submitBtn.addEventListener('click', () => this.submitFeedback({ submitBtn, messageEl, statusEl, honeypotEl }));
    }

    async submitFeedback({ submitBtn, messageEl, statusEl, honeypotEl }) {
        if (!this.feedbackRating || this.feedbackSubmitting) return;

        this.feedbackSubmitting = true;
        submitBtn.disabled = true;
        submitBtn.textContent = 'Sending\u2026';
        statusEl.textContent = '';
        statusEl.classList.remove('is-error', 'is-success');

        try {
            const res = await fetch('/api/feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    rating: this.feedbackRating,
                    message: messageEl.value.trim(),
                    scanId: this.meta.scanId || '',
                    projectName: this.meta.projectName || '',
                    company: honeypotEl ? honeypotEl.value : '',
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

            if (this.meta.scanId) {
                localStorage.setItem(`rs-feedback-${this.meta.scanId}`, '1');
            }
            this.showFeedbackThanks();
        } catch (err) {
            statusEl.textContent = err.message || 'Could not send feedback \u2014 try again.';
            statusEl.classList.add('is-error');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Send feedback';
            this.feedbackSubmitting = false;
        }
    }

    showFeedbackThanks() {
        const state = this.$('feedback-form-state');
        if (state) {
            state.innerHTML = '<p class="feedback-thanks">Thanks for the rating \u2014 it genuinely helps.</p>';
        }
    }

    // Called once meta.scanId is known (see populateReport) so a returning
    // visit to an already-rated scan shows the thank-you state instead of
    // asking again.
    maybeShowFeedbackAlready() {
        if (this.meta.scanId && localStorage.getItem(`rs-feedback-${this.meta.scanId}`)) {
            this.showFeedbackThanks();
        }
    }

    /* -----------------------------------------------------------------
       Entry point -- either poll an existing scan or show the "start a
       new scan" form.
       ----------------------------------------------------------------- */
    loadReport() {
        const scanId = new URLSearchParams(window.location.search).get('scan');
        if (!scanId) {
            this.renderLandingPage();
            return;
        }

        // Landing page (#landing-page) is the default-visible markup so
        // crawlers/no-JS/slow-JS always see real content first. Once we
        // confirm a real scan is being requested, swap to the dashboard
        // shell explicitly rather than assuming it's already visible.
        const landing = this.$('landing-page');
        if (landing) landing.classList.add('hidden');

        // Phase 4 / Direction B theme is scoped to the report view only
        // (v2 plan Section 7.5) -- see body.report-mode in styles.css.
        document.body.classList.add('report-mode');

        const topbar = document.querySelector('.dash-topbar');
        if (topbar) topbar.classList.remove('hidden');

        const dashboardMain = document.querySelector('body > main');
        if (dashboardMain) dashboardMain.classList.remove('hidden');

        this.meta.scanId = scanId;
        this.showLoadingState();
        this.pollScan(scanId);
    }

    pollScan(scanId, attempt = 0) {
        const poll = async at => {
            try {
                const res = await fetch(`/api/scans/${encodeURIComponent(scanId)}`);
                const data = await res.json().catch(() => ({}));

                // The API always answers 200 (even "not found"), signalling
                // state through the body's `status` field instead of the
                // HTTP status code -- so lag right after submission shows
                // up as status: "FAILED" with a "Scan not found" message,
                // not a 404. Retry that specific case a few times before
                // treating it as a real failure.
                const notFoundYet =
                    data.status === 'FAILED' &&
                    /not found/i.test(data.errorMessage || '') &&
                    at < 6;
                if (notFoundYet) {
                    setTimeout(() => poll(at + 1), 2000);
                    return;
                }

                if (!res.ok && data.status === undefined) {
                    throw new Error(`HTTP ${res.status}`);
                }

                const status = data.status || (data.project ? 'COMPLETED' : 'PROCESSING');

                if (status === 'QUEUED' || status === 'PROCESSING') {
                    const pct = data.totalFiles > 0
                        ? Math.round((data.processedFiles / data.totalFiles) * 100)
                        : null;
                    this.updateLoadingProgress(pct);
                    setTimeout(() => poll(0), 3000);
                    return;
                }

                                if (status === 'FAILED') {
                    this.track('scan_failed', { reason: data.errorMessage || 'unknown' });
                    this.showError(data.errorMessage || 'Analysis failed.');
                    return;
                }

                if (status === 'COMPLETED') {
                    this.meta.projectName = data.projectName || '';
                    this.meta.createdAt = data.createdAt || '';
                    this.jsonData = {
                        project: data.project || {},
                        violations: data.violations || [],
                        files: data.files || [],
                        byLanguage: data.byLanguage || [],
                        unanalyzedLanguages: data.unanalyzedLanguages || [],
                        hotspots: data.hotspots || null,
                    };
                    this.track('scan_completed');
                    this.hideLoadingState();
                    this.populateReport();
                    return;
                }

                this.track('scan_failed', { reason: `unknown_status_${status}` });
                this.showError(`Unknown scan status: ${status}`);
            } catch (err) {
                console.error('Polling error:', err);
                if (at < 3) {
                    setTimeout(() => poll(at + 1), 3000);
                } else {
                    this.track('scan_failed', { reason: 'poll_error' });
                    this.showError(`Could not load report: ${err.message}`);
                }
            }
        };

        poll(attempt);
    }

    /* -----------------------------------------------------------------
       Landing page (no ?scan= in the URL) -- the marketing homepage is
       static markup already sitting in index.html as #landing-page, so
       this just swaps it in for the dashboard shell and wires the hero
       form's submit handler.
       ----------------------------------------------------------------- */
    renderLandingPage() {
        document.body.classList.add('landing-mode');

        const topbar = document.querySelector('.dash-topbar');
        if (topbar) topbar.classList.add('hidden');

        const dashboardMain = document.querySelector('body > main');
        if (dashboardMain) dashboardMain.classList.add('hidden');

        const landing = this.$('landing-page');
        if (landing) landing.classList.remove('hidden');

        const form = this.$('new-scan-form');
        const urlInput = this.$('new-scan-url');
        const submitBtn = this.$('new-scan-submit');
        const errorEl = this.$('new-scan-error');
        if (!form || !urlInput || !submitBtn || !errorEl) return;

        form.addEventListener('submit', async e => {
            e.preventDefault();
            const repoUrl = urlInput.value.trim();
            if (!repoUrl) return;

                       errorEl.classList.add('hidden');
            submitBtn.disabled = true;
            submitBtn.textContent = 'Analyzing\u2026';
            this.track('scan_started', { mode: 'repo' });

            try {
                const res = await fetch('/api/analyze', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ repoUrl }),
                });
                const data = await res.json().catch(() => ({}));

                if (!res.ok || !data.scanId) {
                    throw new Error(data.error || `HTTP ${res.status}`);
                }

                window.location.search = `?scan=${encodeURIComponent(data.scanId)}`;
            } catch (err) {
                this.track('scan_failed', { reason: 'submit_error' });
                errorEl.textContent = err.message || 'Could not start analysis.';
                errorEl.classList.remove('hidden');
                submitBtn.disabled = false;
                submitBtn.textContent = 'Analyze';
            }
        });

        this.bindFileScanPanels();
    }

    /* -----------------------------------------------------------------
       Phase 3: "Analyze a file" hero tab -- mode toggle plus the two
       side-by-side panels (paste code / upload a file). Both panels
       collect { filename, content } and hand off to the same submit
       routine, which POSTs to /api/analyze-file and reuses the exact
       ?scan=<id> redirect the repo-scan form uses -- pollScan/populateReport
       don't need to know or care which endpoint produced the scan.
       ----------------------------------------------------------------- */
    bindFileScanPanels() {
        const repoTabBtn = this.$('hero-mode-repo');
        const fileTabBtn = this.$('hero-mode-file');
        const repoForm = this.$('new-scan-form');
        const repoFineprint = this.$('hero-repo-fineprint');
        const filePanels = this.$('hero-file-panels');
        const fileFineprint = this.$('hero-file-fineprint');
        const fileErrorEl = this.$('file-scan-error');

        if (repoTabBtn && fileTabBtn && repoForm && filePanels) {
            const showRepoMode = () => {
                repoTabBtn.classList.add('active');
                repoTabBtn.setAttribute('aria-selected', 'true');
                fileTabBtn.classList.remove('active');
                fileTabBtn.setAttribute('aria-selected', 'false');
                repoForm.classList.remove('hidden');
                if (repoFineprint) repoFineprint.classList.remove('hidden');
                filePanels.classList.add('hidden');
                if (fileFineprint) fileFineprint.classList.add('hidden');
                if (fileErrorEl) fileErrorEl.classList.add('hidden');
            };
            const showFileMode = () => {
                fileTabBtn.classList.add('active');
                fileTabBtn.setAttribute('aria-selected', 'true');
                repoTabBtn.classList.remove('active');
                repoTabBtn.setAttribute('aria-selected', 'false');
                filePanels.classList.remove('hidden');
                if (fileFineprint) fileFineprint.classList.remove('hidden');
                repoForm.classList.add('hidden');
                if (repoFineprint) repoFineprint.classList.add('hidden');
                this.$('new-scan-error')?.classList.add('hidden');
            };
            repoTabBtn.addEventListener('click', showRepoMode);
            fileTabBtn.addEventListener('click', showFileMode);
        }

        this.bindPasteCodePanel(fileErrorEl);
        this.bindUploadFilePanel(fileErrorEl);
    }

    // Shared by both panels: POSTs { filename, content } to
    // /api/analyze-file, redirects to ?scan=<id> on success, otherwise
    // shows the message inline in the shared file-scan-error element.
    async submitFileForAnalysis({ filename, content, mode, buttons, errorEl }) {
        if (errorEl) errorEl.classList.add('hidden');
        buttons.forEach(btn => { if (btn) btn.disabled = true; });
        this.track('scan_started', { mode });
        if (mode === 'upload') this.track('file_upload_used');

        try {
            const res = await fetch('/api/analyze-file', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename, content }),
            });
            const data = await res.json().catch(() => ({}));

            if (!res.ok || !data.scanId) {
                throw new Error(data.error || `HTTP ${res.status}`);
            }

            window.location.search = `?scan=${encodeURIComponent(data.scanId)}`;
        } catch (err) {
            this.track('scan_failed', { reason: 'submit_error' });
            if (errorEl) {
                errorEl.textContent = err.message || 'Could not analyze this file.';
                errorEl.classList.remove('hidden');
            }
            buttons.forEach(btn => { if (btn) btn.disabled = false; });
        }
    }

    bindPasteCodePanel(fileErrorEl) {
        const languageSelect = this.$('file-scan-language');
        const contentArea = this.$('file-scan-content');
        const submitBtn = this.$('file-scan-paste-submit');
        if (!languageSelect || !contentArea || !submitBtn) return;

        const EXT_BY_LANGUAGE = {
            cpp: 'cpp',
            python: 'py',
            java: 'java',
            typescript: 'ts',
            javascript: 'js',
            csharp: 'cs',
        };

        submitBtn.addEventListener('click', () => {
            const content = contentArea.value;
            if (!content.trim()) {
                if (fileErrorEl) {
                    fileErrorEl.textContent = 'Paste some code first.';
                    fileErrorEl.classList.remove('hidden');
                }
                return;
            }
            const ext = EXT_BY_LANGUAGE[languageSelect.value] || 'txt';
            const originalLabel = submitBtn.textContent;
            submitBtn.textContent = 'Analyzing\u2026';
            this.submitFileForAnalysis({
                filename: `pasted.${ext}`,
                content,
                mode: 'paste',
                buttons: [submitBtn],
                errorEl: fileErrorEl,
            }).finally(() => { submitBtn.textContent = originalLabel; });
        });
    }

    bindUploadFilePanel(fileErrorEl) {
        const fileInput = this.$('file-scan-upload');
        const dropLabel = this.$('file-scan-drop-label');
        const dropZone = this.$('file-scan-drop');
        const submitBtn = this.$('file-scan-upload-submit');
        if (!fileInput || !dropLabel || !submitBtn) return;

        fileInput.addEventListener('change', () => {
            const file = fileInput.files && fileInput.files[0];
            if (file) {
                dropLabel.textContent = file.name;
                dropZone?.classList.add('has-file');
                submitBtn.disabled = false;
            } else {
                dropLabel.textContent = 'Click to choose a file\u2026';
                dropZone?.classList.remove('has-file');
                submitBtn.disabled = true;
            }
        });

        submitBtn.addEventListener('click', () => {
            const file = fileInput.files && fileInput.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onerror = () => {
                if (fileErrorEl) {
                    fileErrorEl.textContent = 'Could not read that file.';
                    fileErrorEl.classList.remove('hidden');
                }
            };
            reader.onload = () => {
                const originalLabel = submitBtn.textContent;
                submitBtn.textContent = 'Analyzing\u2026';
                this.submitFileForAnalysis({
                    filename: file.name,
                    content: String(reader.result || ''),
                    mode: 'upload',
                    buttons: [submitBtn],
                    errorEl: fileErrorEl,
                }).finally(() => { submitBtn.textContent = originalLabel; });
            };
            reader.readAsText(file);
        });
    }

    /* -----------------------------------------------------------------
       Loading / error state
       ----------------------------------------------------------------- */
    showLoadingState() {
        const loadingState = this.$('loading-state');
        const reportContent = this.$('report-content');
        if (loadingState) loadingState.classList.remove('hidden');
        if (reportContent) reportContent.classList.add('hidden');
        this.setText('loading-message', 'Starting analysis\u2026');
        this.setText('loading-progress', '');
        this.setText('loading-tip', 'Tip: analysis runs against the repository\u2019s default branch (main or master).');
    }

    updateLoadingProgress(pct) {
        this.setText('loading-message', 'Analyzing source files\u2026');
        this.setText('loading-progress', pct === null ? '' : `${pct}%`);
    }

    hideLoadingState() {
        const loadingState = this.$('loading-state');
        const reportContent = this.$('report-content');
        if (loadingState) loadingState.classList.add('hidden');
        if (reportContent) reportContent.classList.remove('hidden');
    }

    // Keeps loading-state visible (with report-content hidden) so the
    // error message is actually seen, instead of hiding the element the
    // message was written into.
    showError(message) {
        const loadingState = this.$('loading-state');
        const reportContent = this.$('report-content');
        if (reportContent) reportContent.classList.add('hidden');
        if (loadingState) {
            loadingState.classList.remove('hidden');
            loadingState.innerHTML = `
                <div class="error-panel">
                    <h2>Analysis failed</h2>
                    <p>${this.escapeHtml(message)}</p>
                </div>
            `;
        }
    }

    /* -----------------------------------------------------------------
       Report rendering -- Overview only.
       ----------------------------------------------------------------- */
    populateReport() {
        if (!this.jsonData) return;

        this.populateOverview(this.jsonData.project || {});
        this.populateUnanalyzedCallout();
        this.populateHotspots();
        this.populateByLanguage();
        this.populateFilesTab();
        this.populateScoring();
        this.updateTopbarMeta();
        this.updateStreak();
        this.maybeShowFeedbackAlready();
    }

    /* -----------------------------------------------------------------
       Overview tab additions -- unanalyzed-languages callout + hotspots.
       Both were already in the scan JSON (schemaVersion 2 / Phase 2) but
       had no UI anywhere until Phase 4 (v2 plan Section 7.4).
       ----------------------------------------------------------------- */
    populateUnanalyzedCallout() {
        const list = this.jsonData.unanalyzedLanguages || [];
        const callout = this.$('unanalyzed-callout');
        const body = this.$('unanalyzed-callout-body');
        if (!callout || !body) return;

        if (!list.length) {
            callout.classList.add('hidden');
            return;
        }

        const totalFiles = list.reduce((sum, u) => sum + (u.fileCount || 0), 0);
        const totalLines = list.reduce((sum, u) => sum + (u.lineCount || 0), 0);
        const items = list
            .slice()
            .sort((a, b) => (b.lineCount || 0) - (a.lineCount || 0))
            .map(u => `<li>${this.escapeHtml(u.languageName || u.extension)} \u2014 ${this.formatNumber(u.fileCount)} file(s), ${this.formatNumber(u.lineCount)} lines</li>`)
            .join('');

        body.innerHTML = `
            ${this.formatNumber(totalFiles)} file(s) totaling ${this.formatNumber(totalLines)} lines weren't analyzed \u2014 REPO-SIGHT doesn't have a language front-end for these yet:
            <ul>${items}</ul>
        `;
        callout.classList.remove('hidden');
    }

    populateHotspots() {
        const hotspots = this.jsonData.hotspots;
        const listEl = this.$('hotspot-list');
        const noteEl = this.$('hotspots-unavailable-note');
        if (!listEl || !noteEl) return;

        if (!hotspots || !hotspots.gitAvailable) {
            listEl.classList.add('hidden');
            noteEl.classList.remove('hidden');
            return;
        }

        const topFiles = (hotspots.topFiles || [])
            .slice()
            .sort((a, b) => (b.hotspotScore || 0) - (a.hotspotScore || 0))
            .slice(0, 5);

        if (!topFiles.length) {
            listEl.classList.add('hidden');
            noteEl.classList.remove('hidden');
            noteEl.textContent = 'No hotspots to show \u2014 not enough commit history yet for this repository.';
            return;
        }

        noteEl.classList.add('hidden');
        listEl.innerHTML = topFiles
            .map(fh => `
                <li class="hotspot-item">
                    <span class="hotspot-path" title="${this.escapeHtml(fh.path)}">${this.escapeHtml(fh.path)}</span>
                    <span class="hotspot-stats">
                        <span>CC <b>${this.formatNumber(fh.cyclomaticComplexity)}</b></span>
                        <span>Commits <b>${this.formatNumber(fh.commitCount)}</b></span>
                        <span>+${this.formatNumber(fh.linesAdded)}/-${this.formatNumber(fh.linesDeleted)}</span>
                    </span>
                </li>
            `)
            .join('');
        listEl.classList.remove('hidden');
    }

    /* -----------------------------------------------------------------
       By Language tab -- one corner-bracket card per language from the
       scan JSON's byLanguage[] array, sorted by share of project LOC.
       ----------------------------------------------------------------- */
    classifyComplexityDensity(density) {
        // Same thresholds as HealthScore.cpp's kComplexityDensityGood/Bad
        // (0.15 / 0.50) -- a presentational Low/Med/High bucket, not a
        // restatement of the full 5-component weighted health score.
        if (density <= 0.15) return 'low';
        if (density >= 0.50) return 'high';
        return 'med';
    }

    populateByLanguage() {
        const byLanguage = this.jsonData.byLanguage || [];
        const grid = this.$('bylang-grid');
        const empty = this.$('bylang-empty');
        if (!grid || !empty) return;

        if (!byLanguage.length) {
            grid.innerHTML = '';
            empty.classList.remove('hidden');
            return;
        }
        empty.classList.add('hidden');

        const projectCodeLines = Math.max(1, this.jsonData.project.codeLines || 0);
        const sorted = byLanguage.slice().sort((a, b) => (b.codeLines || 0) - (a.codeLines || 0));

        grid.innerHTML = sorted
            .map(la => {
                const pct = ((la.codeLines || 0) / projectCodeLines) * 100;
                const density = (la.cyclomaticComplexity || 0) / Math.max(1, la.codeLines || 0);
                const bucket = this.classifyComplexityDensity(density);
                const badgeLabel = bucket === 'low' ? 'Low complexity' : bucket === 'high' ? 'High complexity' : 'Med complexity';
                const badgeClass = bucket === 'low' ? '' : bucket;
                return `
                    <div class="metric-card">
                        <div class="metric-card-head">
                            <span class="metric-card-title">${this.escapeHtml(la.language)}</span>
                            <span class="complexity-badge ${badgeClass}">${badgeLabel}</span>
                        </div>
                        <div class="metric-card-sub">${pct.toFixed(1)}% of project \u00b7 ${this.formatNumber(la.fileCount)} file(s)</div>
                        <div class="metric-card-row">
                            <div class="metric-item"><span class="metric-value">${this.formatNumber(la.codeLines)}</span><span class="metric-label">Code lines</span></div>
                            <div class="metric-item"><span class="metric-value">${this.formatNumber(la.functionCount)}</span><span class="metric-label">Functions</span></div>
                            <div class="metric-item"><span class="metric-value">${this.formatNumber(la.cyclomaticComplexity)}</span><span class="metric-label">Complexity</span></div>
                            <div class="metric-item"><span class="metric-value">${this.formatNumber(la.classCount)}</span><span class="metric-label">Classes</span></div>
                            <div class="metric-item"><span class="metric-value">${(la.avgFunctionLength || 0).toFixed(1)}</span><span class="metric-label">Avg fn length</span></div>
                            <div class="metric-item"><span class="metric-value">${this.formatNumber(la.todoCount)}</span><span class="metric-label">TODOs</span></div>
                        </div>
                    </div>
                `;
            })
            .join('');
    }

    /* -----------------------------------------------------------------
       Files tab -- sortable/filterable table over the scan JSON's
       files[] array. Rendering is capped (FILES_RENDER_CAP) with a
       "show all" escape hatch so a very large repo's file list doesn't
       lock up the tab; sort/filter always run against the full array.
       ----------------------------------------------------------------- */
    violationCountsByPath() {
        const counts = {};
        (this.jsonData.violations || []).forEach(v => {
            counts[v.path] = (counts[v.path] || 0) + 1;
        });
        return counts;
    }

    populateFilesTab() {
        const files = this.jsonData.files || [];
        this.filesState = {
            sortKey: 'cyclomaticComplexity',
            sortDir: 'desc',
            search: '',
            lang: '',
            renderCap: 300,
            showAll: false,
        };
        this._violationCounts = this.violationCountsByPath();

        const langSelect = this.$('files-lang-filter');
        if (langSelect) {
            const languages = Array.from(new Set(files.map(f => f.language).filter(Boolean))).sort();
            langSelect.innerHTML = '<option value="">All languages</option>' +
                languages.map(l => `<option value="${this.escapeHtml(l)}">${this.escapeHtml(l)}</option>`).join('');
        }

        this.renderFilesTable();
    }

    getFilteredSortedFiles() {
        const files = this.jsonData.files || [];
        const state = this.filesState || {};
        const search = (state.search || '').toLowerCase();
        const lang = state.lang || '';

        let rows = files.filter(f => {
            if (lang && f.language !== lang) return false;
            if (search && !f.path.toLowerCase().includes(search)) return false;
            return true;
        });

        rows = rows.map(f => ({ ...f, issues: this._violationCounts[f.path] || 0 }));

        const key = state.sortKey || 'cyclomaticComplexity';
        const dir = state.sortDir === 'asc' ? 1 : -1;
        rows.sort((a, b) => {
            const av = a[key];
            const bv = b[key];
            if (typeof av === 'string' || typeof bv === 'string') {
                return dir * String(av || '').localeCompare(String(bv || ''));
            }
            return dir * ((av || 0) - (bv || 0));
        });

        return rows;
    }

    renderFilesTable() {
        const tbody = this.$('files-table-body');
        const empty = this.$('files-empty');
        const countLabel = this.$('files-count-label');
        const showMoreBtn = this.$('files-show-more');
        if (!tbody || !empty || !countLabel) return;

        const allFiltered = this.getFilteredSortedFiles();
        const totalFiles = (this.jsonData.files || []).length;

        if (!totalFiles) {
            tbody.innerHTML = '';
            empty.classList.remove('hidden');
            countLabel.textContent = '';
            if (showMoreBtn) showMoreBtn.classList.add('hidden');
            return;
        }
        empty.classList.add('hidden');

        const cap = this.filesState.renderCap;
        const showAll = this.filesState.showAll;
        const rows = showAll ? allFiltered : allFiltered.slice(0, cap);

        tbody.innerHTML = rows
            .map(f => `
                <tr>
                    <td class="file-path-cell" title="${this.escapeHtml(f.path)}">${this.escapeHtml(f.path)}</td>
                    <td><span class="lang-badge">${this.escapeHtml(f.language || '?')}</span></td>
                    <td>${this.formatNumber(f.codeLines)}</td>
                    <td>${this.formatNumber(f.cyclomaticComplexity)}</td>
                    <td>${this.formatNumber(f.maxNestingDepth)}</td>
                    <td>${this.formatNumber(f.functionCount)}</td>
                    <td>${this.formatNumber(f.issues)}</td>
                </tr>
            `)
            .join('');

        countLabel.textContent = allFiltered.length === totalFiles
            ? `${this.formatNumber(totalFiles)} file(s)`
            : `${this.formatNumber(allFiltered.length)} of ${this.formatNumber(totalFiles)} file(s)`;

        if (showMoreBtn) {
            const hiddenCount = allFiltered.length - rows.length;
            if (hiddenCount > 0) {
                showMoreBtn.textContent = `Show all files (${this.formatNumber(hiddenCount)} more)`;
                showMoreBtn.classList.remove('hidden');
            } else {
                showMoreBtn.classList.add('hidden');
            }
        }

        document.querySelectorAll('.files-table thead th[data-sort]').forEach(th => {
            const isSorted = th.dataset.sort === this.filesState.sortKey;
            th.classList.toggle('sorted', isSorted);
            th.classList.toggle('asc', isSorted && this.filesState.sortDir === 'asc');
        });
    }

    bindFilesToolbar() {
        const searchInput = this.$('files-search');
        const langSelect = this.$('files-lang-filter');
        const showMoreBtn = this.$('files-show-more');
        const headers = document.querySelectorAll('.files-table thead th[data-sort]');

        if (searchInput) {
            searchInput.addEventListener('input', () => {
                if (!this.filesState) return;
                this.filesState.search = searchInput.value;
                this.renderFilesTable();
            });
        }
        if (langSelect) {
            langSelect.addEventListener('change', () => {
                if (!this.filesState) return;
                this.filesState.lang = langSelect.value;
                this.renderFilesTable();
            });
        }
        if (showMoreBtn) {
            showMoreBtn.addEventListener('click', () => {
                if (!this.filesState) return;
                this.filesState.showAll = true;
                this.renderFilesTable();
            });
        }
        headers.forEach(th => {
            th.addEventListener('click', () => {
                if (!this.filesState) return;
                const key = th.dataset.sort;
                if (this.filesState.sortKey === key) {
                    this.filesState.sortDir = this.filesState.sortDir === 'asc' ? 'desc' : 'asc';
                } else {
                    this.filesState.sortKey = key;
                    this.filesState.sortDir = 'desc';
                }
                this.renderFilesTable();
            });
        });
    }

    /* -----------------------------------------------------------------
       Scoring tab -- the five weighted components behind the health
       score (SCORE_COMPONENTS, mirroring HealthScore.cpp exactly), each
       as a bar with a plain-language "why" and "how to improve", plus a
       quick-wins list ranked by how many of the 100 points each
       component is actually costing the project right now.
       ----------------------------------------------------------------- */
    populateScoring() {
        const project = this.jsonData.project || {};
        const breakdown = project.scoreBreakdown;
        const barsEl = this.$('score-bars');
        const quickWinsEl = this.$('quick-wins-list');
        if (!barsEl || !quickWinsEl) return;

        this.setText('scoring-grade-big', project.healthGrade || '\u2014');
        this.setText('scoring-score-big', `${Math.round(project.healthScore || 0)} / 100`);

        if (!breakdown) {
            barsEl.innerHTML = '<p style="color: var(--text-faint); font-size: 12.5px;">Score breakdown isn\u2019t available for this scan.</p>';
            quickWinsEl.innerHTML = '';
            return;
        }

        const scored = SCORE_COMPONENTS.map(c => {
            const subScore = breakdown[c.key] != null ? breakdown[c.key] : 0;
            const rawValue = c.valueOf(project);
            const lostPoints = c.weight * (100 - subScore);
            return { ...c, subScore, rawValue, lostPoints };
        });

        barsEl.innerHTML = scored
            .map(c => {
                const barClass = c.subScore >= 80 ? 'good' : c.subScore >= 50 ? 'mid' : 'bad';
                return `
                    <div class="score-bar-row">
                        <div class="score-bar-head">
                            <span class="score-bar-title">${this.escapeHtml(c.title)}</span>
                            <span class="score-bar-weight">${Math.round(c.subScore)}/100 \u00b7 weight ${(c.weight * 100).toFixed(0)}%</span>
                        </div>
                        <div class="score-bar-track"><div class="score-bar-fill ${barClass}" style="width: ${Math.max(2, c.subScore)}%"></div></div>
                        <div class="score-bar-detail">${c.detail(c.rawValue, c.goodRef)}</div>
                    </div>
                `;
            })
            .join('');

        const quickWins = scored
            .filter(c => c.lostPoints > 0.5)
            .sort((a, b) => b.lostPoints - a.lostPoints)
            .slice(0, 3);

        quickWinsEl.innerHTML = quickWins.length
            ? quickWins
                  .map(c => `<li><span><b>${this.escapeHtml(c.tip)}</b><span class="quick-wins-impact">${c.title} \u2014 costing about ${c.lostPoints.toFixed(1)} of 100 points</span></span></li>`)
                  .join('')
            : '<li><span>Nothing stands out \u2014 all five components are already close to their targets.</span></li>';
    }

    updateTopbarMeta() {
        const project = this.jsonData.project || {};
        if (this.meta.projectName) {
            document.title = `${this.meta.projectName} \u2014 REPO-SIGHT`;
        }
        this.setText('dash-project', this.meta.projectName || '\u2014');
        this.setText('dash-scan', this.meta.scanId ? `scan ${this.meta.scanId.slice(0, 8)}` : '');
        this.setText(
            'page-subtitle',
            `${this.formatNumber(project.filesAnalyzed)} files \u00b7 ${this.formatNumber(project.totalLines)} lines analyzed`
        );
    }

    populateOverview(project) {
        const healthScore = Math.round(project.healthScore || 0);
        const healthGrade = project.healthGrade || 'F';

        this.setGauge(healthScore, healthGrade);
        this.setText('health-score-value', `${healthScore}`);
        this.setText('health-grade', `GRADE ${healthGrade}`);

        const violations = this.jsonData.violations || [];
        const bySeverity = sev => violations.filter(v => v.severity === sev).length;

        this.setText('count-warning', bySeverity('warning'));
        this.setText('count-info', bySeverity('info'));

        this.setText('function-count', project.functionCount || 0);
        this.setText('complexity-count', project.cyclomaticComplexity || 0);
        this.setText('todo-count', project.todoCount || 0);
        this.setText('nesting-depth', project.maxNestingDepth || 0);

        // Size & shape
        this.setText('m-total-lines', this.formatNumber(project.totalLines || 0));
        this.setText('m-code-lines', this.formatNumber(project.codeLines || 0));
        this.setText('m-comment-lines', this.formatNumber(project.commentLines || 0));
        this.setText('m-blank-lines', this.formatNumber(project.blankLines || 0));

        // Structure
        this.setText('m-class-count', this.formatNumber(project.classCount || 0));
        this.setText('m-variable-count', this.formatNumber(project.variableCount || 0));
        this.setText('m-include-count', this.formatNumber(project.includeCount || 0));

        // Complexity detail
        this.setText('m-loop-count', this.formatNumber(project.loopCount || 0));
        this.setText('m-condition-count', this.formatNumber(project.conditionCount || 0));
        this.setText('m-trycatch-count', this.formatNumber(project.tryCatchCount || 0));

        const longestName = project.longestFunctionName || '\u2014';
        const longestLines = project.longestFunctionLines || 0;
        this.setText('longest-fn-name', longestName);
        this.setText('longest-fn-lines', longestLines ? `${longestLines} lines` : '');
        const bar = this.$('longest-fn-bar');
        if (bar) {
            const pct = Math.max(0, Math.min(100, (longestLines / LONG_FUNCTION_THRESHOLD) * 100));
            bar.style.width = `${pct}%`;
        }
    }

    setGauge(score, grade) {
        const fill = this.$('gauge-fill');
        if (!fill) return;
        const pct = Math.max(0, Math.min(100, score)) / 100;
        fill.style.strokeDasharray = `${GAUGE_CIRCUMFERENCE}`;
        fill.style.strokeDashoffset = `${GAUGE_CIRCUMFERENCE * (1 - pct)}`;
        fill.style.stroke = GRADE_COLOR[grade] || GRADE_COLOR.F;
    }

    /* -----------------------------------------------------------------
       Streak
       ----------------------------------------------------------------- */
    updateStreak() {
        const today = new Date().toISOString().slice(0, 10);
        if (this.lastAnalysisDate !== today) {
            this.analysisStreak = this.lastAnalysisDate ? this.analysisStreak + 1 : 1;
            this.lastAnalysisDate = today;
            localStorage.setItem('rs-last-analysis', today);
            localStorage.setItem('rs-streak', String(this.analysisStreak));
        }
        this.updateStreakDisplay();
    }

    updateStreakDisplay() {
        const msg = this.$('streak-message');
        const vis = this.$('streak-visual');
        if (!msg || !vis) return;
        if (this.analysisStreak > 0) {
            msg.textContent = `You've analyzed code ${this.analysisStreak} ${this.analysisStreak === 1 ? 'day' : 'days'} in a row!`;
            vis.textContent = '\u{1F525}'.repeat(Math.min(this.analysisStreak, 5));
        }
    }
}

/* -----------------------------------------------------------------
   Bootstrap
   ----------------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
    window.repoSightDashboard = new RepoSightDashboard();
});

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { RepoSightDashboard };
}
