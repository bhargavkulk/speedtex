const SAMPLE_MIN = 280;
const SAMPLE_MAX = 520;

const demoSource = String.raw`\documentclass{article}
\usepackage{amsmath}
\begin{document}
\section{Warmup}
Let $f(x)=x^2+2x+1$. Then
\[
  \int_0^1 f(x)\,dx = \int_0^1 (x^2+2x+1)\,dx = \frac{7}{3}.
\]
Typing LaTeX is a different skill from typing prose because braces, slashes,
carets, and punctuation all matter. A useful benchmark should preserve that.

\subsection{A Small Identity}
For integers $n \ge 1$ we have
\[
  \sum_{k=1}^{n} k = \frac{n(n+1)}{2}.
\]
This paragraph exists only to make the sample long enough that the app can
choose a representative excerpt instead of forcing the entire document.
\end{document}`;

const state = {
  targetText: "",
  units: [],
  unitResults: [],
  unitInputs: [],
  currentUnitIndex: -1,
  typedBuffer: "",
  correctKeystrokes: 0,
  incorrectKeystrokes: 0,
  startedAt: null,
  finished: false,
};

const latexInput = document.querySelector("#latex-input");
const fileInput = document.querySelector("#file-input");
const pasteButton = document.querySelector("#paste-button");
const fileButton = document.querySelector("#file-button");
const demoButton = document.querySelector("#demo-button");
const resetButton = document.querySelector("#reset-button");
const targetText = document.querySelector("#target-text");
const wpmStat = document.querySelector("#wpm-stat");
const accuracyStat = document.querySelector("#accuracy-stat");
const progressStat = document.querySelector("#progress-stat");

function stripLatexComments(source) {
  return source
    .split("\n")
    .map((line) => {
      let result = "";
      let escaping = false;
      for (const char of line) {
        if (char === "%" && !escaping) {
          break;
        }
        result += char;
        escaping = char === "\\" && !escaping;
      }
      return result;
    })
    .join("\n");
}

function normalizeLatex(source) {
  const withoutComments = stripLatexComments(source);
  return withoutComments
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function splitIntoCandidateBlocks(source) {
  return source
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block.length >= 40);
}

function buildSample(source) {
  const normalized = normalizeLatex(source);
  if (normalized.length < 80) {
    return {
      error: "Need a bit more LaTeX. Paste at least a few lines so the sample is meaningful.",
    };
  }

  const blocks = splitIntoCandidateBlocks(normalized);
  const pool = blocks.length > 0 ? blocks : [normalized];
  const combined = [];
  let combinedLength = 0;
  const startIndex = Math.floor(pool.length * 0.25);

  for (let offset = 0; offset < pool.length; offset += 1) {
    const block = pool[(startIndex + offset) % pool.length];
    combined.push(block);
    combinedLength += block.length + 2;
    if (combinedLength >= SAMPLE_MIN) {
      break;
    }
  }

  let sample = combined.join("\n\n");
  if (sample.length > SAMPLE_MAX) {
    sample = sample.slice(0, SAMPLE_MAX);
    const cutAt = Math.max(sample.lastIndexOf("\n"), sample.lastIndexOf(" "));
    sample = sample.slice(0, cutAt > SAMPLE_MIN ? cutAt : SAMPLE_MAX).trim();
  }

  return { sample, normalizedLength: normalized.length };
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function tokenizeText(source) {
  return source.match(/\s+|\S+/g)?.map((text) => ({
    text,
    isWhitespace: /^\s+$/.test(text),
  })) || [];
}

function getNextWordIndex(startIndex = 0) {
  for (let index = startIndex; index < state.units.length; index += 1) {
    if (!state.units[index].isWhitespace) {
      return index;
    }
  }
  return state.units.length;
}

function getCurrentWord() {
  if (state.currentUnitIndex < 0 || state.currentUnitIndex >= state.units.length) {
    return "";
  }
  return state.units[state.currentUnitIndex].text;
}

function getPreviousWordIndex(startIndex = state.currentUnitIndex - 1) {
  for (let index = startIndex; index >= 0; index -= 1) {
    if (!state.units[index].isWhitespace) {
      return index;
    }
  }
  return -1;
}

function getWordResult(unitText, typedText) {
  const targetChars = [...unitText];
  const typedChars = [...typedText];
  let correctChars = 0;

  for (let index = 0; index < Math.min(targetChars.length, typedChars.length); index += 1) {
    if (typedChars[index] === targetChars[index]) {
      correctChars += 1;
    }
  }

  return {
    typedText,
    correctChars,
    totalChars: targetChars.length,
    exact: typedText === unitText,
  };
}

function formatWordUnit(unitText, status, typedBuffer, isCurrentWord) {
  const targetChars = [...unitText];
  const typedChars = [...typedBuffer];
  const html = targetChars
    .map((char, index) => {
      const classes = ["char"];
      if (status && !isCurrentWord) {
        const committedChars = [...status.typedText];
        if (index < committedChars.length) {
          classes.push(committedChars[index] === char ? "correct" : "incorrect");
        }
      } else if (isCurrentWord) {
        const typed = typedChars[index];
        if (typed != null) {
          classes.push(typed === char ? "correct" : "incorrect");
        } else if (index === typedChars.length) {
          classes.push("current");
        }
      }
      return `<span class="${classes.join(" ")}">${escapeHtml(char)}</span>`;
    })
    .join("");

  const overflow = isCurrentWord && typedChars.length > targetChars.length
    ? typedChars
        .slice(targetChars.length)
        .map((char) => `<span class="char incorrect extra">${escapeHtml(char)}</span>`)
        .join("")
    : "";

  return html + overflow;
}

function formatTarget() {
  if (!state.targetText) {
    targetText.classList.remove("active");
    targetText.textContent = "Paste a LaTeX document to begin.";
    return;
  }

  const html = state.units
    .map((unit, index) => {
      if (unit.isWhitespace) {
        return escapeHtml(unit.text);
      }
      return formatWordUnit(
        unit.text,
        state.unitResults[index],
        index === state.currentUnitIndex ? state.typedBuffer : "",
        index === state.currentUnitIndex
      );
    })
    .join("");

  targetText.innerHTML = html;
}

function calculateMetrics() {
  const elapsedMinutes = state.startedAt
    ? Math.max((Date.now() - state.startedAt) / 60000, 1 / 60000)
    : 0;
  const correctChars = state.correctKeystrokes;
  const totalScoredKeystrokes = state.correctKeystrokes + state.incorrectKeystrokes;
  let consumedChars = 0;

  for (let index = 0; index < state.units.length; index += 1) {
    const unit = state.units[index];
    if (index < state.currentUnitIndex) {
      consumedChars += unit.text.length;
    }

    if (unit.isWhitespace) {
      continue;
    }

    const result = state.unitResults[index];
    void result;
  }

  const currentWord = getCurrentWord();
  if (currentWord) {
    consumedChars += Math.min(state.typedBuffer.length, currentWord.length);
  }

  const accuracy = totalScoredKeystrokes > 0
    ? (state.correctKeystrokes / totalScoredKeystrokes) * 100
    : 100;
  const wpm = elapsedMinutes > 0 ? Math.round(correctChars / 5 / elapsedMinutes) : 0;
  const progress = state.targetText.length
    ? Math.min((consumedChars / state.targetText.length) * 100, 100)
    : 0;

  return {
    wpm,
    accuracy,
    progress,
    complete: state.currentUnitIndex >= state.units.length,
  };
}

function updateStats() {
  const metrics = calculateMetrics();
  wpmStat.textContent = String(metrics.wpm);
  accuracyStat.textContent = `${metrics.accuracy.toFixed(1)}%`;
  progressStat.textContent = `${Math.round(metrics.progress)}%`;

  if (metrics.complete) {
    state.finished = true;
    targetText.classList.remove("active");
  } else {
    state.finished = false;
  }
}

function resetRun({ preserveText = true } = {}) {
  state.typedBuffer = "";
  state.unitResults = state.units.map(() => null);
  state.unitInputs = state.units.map(() => "");
  state.currentUnitIndex = preserveText ? getNextWordIndex(0) : -1;
  state.correctKeystrokes = 0;
  state.incorrectKeystrokes = 0;
  state.startedAt = null;
  state.finished = false;
  wpmStat.textContent = "0";
  accuracyStat.textContent = "100%";
  progressStat.textContent = "0%";
  formatTarget("");
}

function buildTestFromInput(source) {
  const result = buildSample(source);
  if (result.error) {
    targetText.textContent = result.error;
    state.targetText = "";
    state.units = [];
    state.unitResults = [];
    state.unitInputs = [];
    state.currentUnitIndex = -1;
    state.typedBuffer = "";
    state.correctKeystrokes = 0;
    state.incorrectKeystrokes = 0;
    targetText.classList.remove("active");
    resetButton.disabled = true;
    wpmStat.textContent = "0";
    accuracyStat.textContent = "100%";
    progressStat.textContent = "0%";
    return;
  }

  state.targetText = result.sample;
  state.units = tokenizeText(result.sample);
  resetRun();
  resetButton.disabled = false;
  targetText.classList.add("active");
  targetText.focus();
}

function commitCurrentWord() {
  const currentWord = getCurrentWord();
  if (!currentWord) {
    return;
  }

  state.unitInputs[state.currentUnitIndex] = state.typedBuffer;
  state.unitResults[state.currentUnitIndex] = getWordResult(currentWord, state.typedBuffer);
  state.typedBuffer = "";
  state.currentUnitIndex = getNextWordIndex(state.currentUnitIndex + 1);
}

function scoreCharacterKey(key) {
  const currentWord = getCurrentWord();
  const targetChar = currentWord[state.typedBuffer.length];
  if (targetChar != null && key === targetChar) {
    state.correctKeystrokes += 1;
  } else {
    state.incorrectKeystrokes += 1;
  }
}

function reopenPreviousWord() {
  const previousIndex = state.finished
    ? getPreviousWordIndex(state.units.length - 1)
    : getPreviousWordIndex();

  if (previousIndex < 0) {
    return;
  }

  state.currentUnitIndex = previousIndex;
  state.typedBuffer = state.unitInputs[previousIndex] || "";
  state.unitResults[previousIndex] = null;
  state.finished = false;
  targetText.classList.add("active");
}

async function requestLatexSource() {
  if (navigator.clipboard?.readText) {
    try {
      const clipboardText = await navigator.clipboard.readText();
      if (clipboardText.trim()) {
        return clipboardText;
      }
    } catch (error) {
      // Fall through to prompt if clipboard access is denied.
    }
  }

  return window.prompt("Paste your LaTeX document:") || "";
}

pasteButton.addEventListener("click", async () => {
  const source = await requestLatexSource();
  if (!source.trim()) {
    targetText.textContent = "Paste a LaTeX document to begin.";
    return;
  }
  latexInput.value = source;
  buildTestFromInput(source);
});

fileButton.addEventListener("click", () => {
  fileInput.click();
});

fileInput.addEventListener("change", async () => {
  const [file] = fileInput.files || [];
  if (!file) {
    return;
  }

  const source = await file.text();
  latexInput.value = source;
  buildTestFromInput(source);
  fileInput.value = "";
});

demoButton.addEventListener("click", () => {
  latexInput.value = demoSource;
  buildTestFromInput(demoSource);
});

resetButton.addEventListener("click", () => {
  resetRun();
  if (state.targetText) {
    targetText.classList.add("active");
    targetText.focus();
  }
});

targetText.addEventListener("click", () => {
  if (state.targetText && !state.finished) {
    targetText.classList.add("active");
    targetText.focus();
  }
});

targetText.addEventListener("keydown", (event) => {
  if (!state.targetText) {
    return;
  }

  if (event.metaKey || event.ctrlKey || event.altKey) {
    return;
  }

  if (event.key === "Backspace") {
    event.preventDefault();
    if (state.typedBuffer.length > 0) {
      state.typedBuffer = state.typedBuffer.slice(0, -1);
    } else {
      reopenPreviousWord();
    }
  } else if (event.key === " " || event.key === "Tab" || event.key === "Enter") {
    event.preventDefault();
    if (!state.finished) {
      commitCurrentWord();
    }
  } else if (event.key.length === 1) {
    event.preventDefault();
    if (!state.finished) {
      scoreCharacterKey(event.key);
      state.typedBuffer += event.key;
    }
  } else {
    return;
  }

  if (!state.startedAt && (state.typedBuffer.length > 0 || event.key === " " || event.key === "Tab" || event.key === "Enter")) {
    state.startedAt = Date.now();
  }

  formatTarget();
  updateStats();
});

latexInput.value = demoSource;
buildTestFromInput(demoSource);
