(function () {
  const form = document.getElementById('airdrop-form');
  const submitBtn = document.getElementById('submit-btn');
  const jobSection = document.getElementById('job-section');
  const jobIdEl = document.getElementById('job-id');
  const jobStatusEl = document.getElementById('job-status');
  const jobProgressEl = document.getElementById('job-progress');
  const progressFill = document.getElementById('progress-fill');
  const jobErrorsEl = document.getElementById('job-errors');
  const backendUrlEl = document.getElementById('backend-url');

  const defaultApiBase = window.location.origin; // assumes same host/port
  backendUrlEl.textContent = defaultApiBase;

  let pollTimer = null;

  function parseRecipients(text) {
    return text
      .split(/\r?\n/) // split lines
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  async function createAirdropJob(payload) {
    const res = await fetch(`${defaultApiBase}/api/doge/airdrop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Failed to create airdrop job');
    }
    return data;
  }

  async function fetchJob(jobId) {
    const res = await fetch(`${defaultApiBase}/api/doge/airdrop/${jobId}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Failed to fetch job');
    }
    return data;
  }

  function renderJob(job) {
    const total = job?.stats?.total || 0;
    const processed = job?.stats?.processed || 0;
    jobStatusEl.textContent = job.status || '-';
    jobProgressEl.textContent = `${processed}/${total}`;
    const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
    progressFill.style.width = `${pct}%`;
  }

  async function startPolling(jobId) {
    clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      try {
        const job = await fetchJob(jobId);
        renderJob(job);
        if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
          clearInterval(pollTimer);
        }
      } catch (e) {
        console.error(e);
        jobErrorsEl.textContent = e.message;
        clearInterval(pollTimer);
      }
    }, 2500);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    jobErrorsEl.textContent = '';

    const fromAddress = document.getElementById('fromAddress').value.trim();
    const ticker = document.getElementById('ticker').value.trim();
    const amount = document.getElementById('amount').value.trim();
    const op = document.getElementById('op').value;
    const repeat = Number(document.getElementById('repeat').value || 1);
    const recipientsText = document.getElementById('recipients').value;
    const recipients = parseRecipients(recipientsText);

    if (recipients.length === 0) {
      jobErrorsEl.textContent = 'Please add at least one recipient address.';
      return;
    }

    const payload = { fromAddress, ticker, amount, recipients, op, repeat };

    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';
    try {
      const job = await createAirdropJob(payload);
      jobSection.classList.remove('hidden');
      jobIdEl.textContent = job.jobId;
      jobStatusEl.textContent = 'queued';
      jobProgressEl.textContent = `0/${job.total || recipients.length}`;
      progressFill.style.width = '0%';
      await startPolling(job.jobId);
    } catch (err) {
      jobErrorsEl.textContent = err.message || String(err);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create Airdrop Job';
    }
  });
})();

