/* ==========================================================================
   repo-sight dashboard — client-side logic
   Reads ?scan=<id> from the URL and polls GET /api/scans/:id until the
   scan is COMPLETED/FAILED, then renders the Overview report from
   { project, violations }. With no ?scan= param it renders the "start a
   new scan" form, which POSTs to /api/analyze and redirects to ?scan=<id>.
   ========================================================================== */

const GRADE_COLOR = { A: '#1f6f5c', B: '#1f6f5c', C: '#b8791f', D: '#b8791f', F: '#a8402a' };
const GAUGE_RADIUS = 54;
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * GAUGE_RADIUS;
const LONG_FUNCTION_THRESHOLD = 100; // matches cpp/py/java-long-*-function rule

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
        this.updateTopbarMeta();
        this.updateStreak();
        this.maybeShowFeedbackAlready();
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
