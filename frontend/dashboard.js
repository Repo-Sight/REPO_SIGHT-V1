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
                    this.hideLoadingState();
                    this.populateReport();
                    return;
                }

                this.showError(`Unknown scan status: ${status}`);
            } catch (err) {
                console.error('Polling error:', err);
                if (at < 3) {
                    setTimeout(() => poll(at + 1), 3000);
                } else {
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
                errorEl.textContent = err.message || 'Could not start analysis.';
                errorEl.classList.remove('hidden');
                submitBtn.disabled = false;
                submitBtn.textContent = 'Analyze';
            }
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
