const SAMPLE_MIN = 280;
const SAMPLE_MAX = 520;

const demoSources = [
  String.raw`\section{Warmup}
Let $f(x)=x^2+2x+1$. Then
\[
  \int_0^1 f(x)\,dx = \int_0^1 (x^2+2x+1)\,dx = \frac{7}{3}.
\]
Typing LaTeX is a different skill from typing prose because braces, slashes,
carets, and punctuation all matter. A useful benchmark should preserve that.`,
  String.raw`\begin{align}
  \nabla \cdot \mathbf{E} &= \frac{\rho}{\varepsilon_0}, \\
  \nabla \cdot \mathbf{B} &= 0, \\
  \nabla \times \mathbf{E} &= -\frac{\partial \mathbf{B}}{\partial t}.
\end{align}
The alignment markers, bold macros, and partial derivatives are exactly the sort
of things that look obvious when rendered and slippery when you have to type them.`,
  String.raw`Theorem. For $x \in (0,1)$, the beta integral satisfies
\[
  B(x,1-x)=\int_0^1 t^{x-1}(1-t)^{-x}\,dt=\frac{\pi}{\sin(\pi x)}.
\]
Proof. The reflection formula for $\Gamma$ converts the integral into a compact identity
that is easy to read and annoyingly easy to mistype.
`,
  String.raw`Consider the update rule $w_{t+1}=w_t-\eta_t \nabla \mathcal{L}(w_t)$.
If $\eta_t = \eta_0 / \sqrt{t+1}$, then the schedule decays sublinearly.
We also track the shorthand
\[
  \widehat{\theta} = \operatorname*{arg\,min}_{\theta \in \Theta} \sum_{i=1}^n \ell(x_i,\theta).
\]
That line is a good test of whether you remember operator names and accent macros.`,
  String.raw`Algorithm~\ref{alg:beam} maintains a frontier $F_t$ of partial hypotheses.
At each step we score a candidate with
\[
  s(y_{1:t}) = \sum_{i=1}^{t} \log p(y_i \mid y_{<i}, x) + \alpha \,\mathrm{lp}(y_{1:t}).
\]
In implementation notes we write \texttt{top\_k}, \texttt{mask\_fill}, and
\verb|\mathrm{O}(kV)| often enough that they are worth drilling as muscle memory.`,
];

let demoIndex = 0;

const state = {
  targetText: "",
  units: [],
  unitResults: [],
  unitInputs: [],
  displaySegments: [],
  currentUnitIndex: -1,
  typedBuffer: "",
  correctKeystrokes: 0,
  incorrectKeystrokes: 0,
  knuthMode: false,
  startedAt: null,
  finished: false,
};

const latexInput = document.querySelector("#latex-input");
const fileInput = document.querySelector("#file-input");
const pasteButton = document.querySelector("#paste-button");
const fileButton = document.querySelector("#file-button");
const demoButton = document.querySelector("#demo-button");
const knuthButton = document.querySelector("#knuth-button");
const resetButton = document.querySelector("#reset-button");
const renderedPreview = document.querySelector("#rendered-preview");
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

function cleanTextForDisplay(source) {
  return source
    .replace(/\\(sub)*section\*?\{([^}]*)\}/g, "\n$2\n")
    .replace(/\\begin\{(theorem|proof|align|equation|gather)\*?\}/g, "\n")
    .replace(/\\end\{(theorem|proof|align|equation|gather)\*?\}/g, "\n")
    .replace(/\\item\b/g, "•")
    .replace(/\\,/g, " ")
    .replace(/\\;/g, " ")
    .replace(/\\:/g, " ")
    .replace(/\\!/g, "")
    .replace(/\n{3,}/g, "\n\n");
}

function queueMathTypeset() {
  if (!window.MathJax?.typesetPromise) {
    return;
  }
  window.MathJax.typesetPromise([renderedPreview]).catch(() => {});
}

function buildDisplaySegments(source) {
  const mathPattern = /(\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$\$[\s\S]*?\$\$|\$[^$\n]*?\$)/g;
  const segments = [];
  let cursor = 0;
  let unitCursor = 0;
  let match;

  while ((match = mathPattern.exec(source)) !== null) {
    if (match.index > cursor) {
      const rawText = source.slice(cursor, match.index);
      const tokens = tokenizeText(rawText);
      segments.push({
        kind: "text",
        rawText,
        displayText: cleanTextForDisplay(rawText),
        startUnitIndex: unitCursor,
        endUnitIndex: unitCursor + tokens.length,
      });
      unitCursor += tokens.length;
    }

    const rawMath = match[0];
    const tokens = tokenizeText(rawMath);
    segments.push({
      kind: "math",
      rawText: rawMath,
      displayText: rawMath,
      startUnitIndex: unitCursor,
      endUnitIndex: unitCursor + tokens.length,
    });
    unitCursor += tokens.length;
    cursor = match.index + rawMath.length;
  }

  if (cursor < source.length) {
    const rawText = source.slice(cursor);
    const tokens = tokenizeText(rawText);
    segments.push({
      kind: "text",
      rawText,
      displayText: cleanTextForDisplay(rawText),
      startUnitIndex: unitCursor,
      endUnitIndex: unitCursor + tokens.length,
    });
  }

  return segments.filter((segment) => segment.displayText.trim().length > 0);
}

function getSegmentStatus(segment) {
  let hasCommitted = false;
  let allExact = true;
  let hasIncorrect = false;

  for (let index = segment.startUnitIndex; index < segment.endUnitIndex; index += 1) {
    const unit = state.units[index];
    if (!unit || unit.isWhitespace) {
      continue;
    }

    if (index === state.currentUnitIndex) {
      if (state.typedBuffer.length === 0) {
        return hasIncorrect ? "incorrect" : "current";
      }
      const targetWord = unit.text;
      for (let charIndex = 0; charIndex < state.typedBuffer.length; charIndex += 1) {
        if (state.typedBuffer[charIndex] !== targetWord[charIndex]) {
          return "incorrect";
        }
      }
      return "current";
    }

    const result = state.unitResults[index];
    if (result) {
      hasCommitted = true;
      if (!result.exact) {
        hasIncorrect = true;
        allExact = false;
      }
    } else {
      allExact = false;
    }
  }

  if (hasIncorrect) {
    return "incorrect";
  }
  if (hasCommitted && allExact) {
    return "correct";
  }
  return "";
}

function renderPreview() {
  if (!state.targetText) {
    renderedPreview.classList.remove("active");
    renderedPreview.textContent = "Paste a LaTeX document to begin.";
    return;
  }

  renderedPreview.innerHTML = state.displaySegments
    .map((segment) => {
      const status = getSegmentStatus(segment);
      const statusClass = status ? ` ${status}` : "";
      if (segment.kind === "math") {
        return `<span class="render-segment math${statusClass}">${segment.displayText}</span>`;
      }
      return `<span class="render-segment prose${statusClass}">${escapeHtml(segment.displayText)}</span>`;
    })
    .join("");

  queueMathTypeset();
}

function focusInputSurface() {
  if (state.knuthMode) {
    renderedPreview.classList.add("active");
    targetText.classList.remove("active");
    renderedPreview.focus();
  } else {
    targetText.classList.add("active");
    renderedPreview.classList.remove("active");
    targetText.focus();
  }
}

function setKnuthMode(enabled) {
  state.knuthMode = enabled;
  document.body.classList.toggle("knuth-mode", enabled);
  knuthButton.classList.toggle("active", enabled);
  knuthButton.setAttribute("aria-pressed", String(enabled));
  if (state.targetText) {
    focusInputSurface();
  }
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
    renderPreview();
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
  renderPreview();
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
    renderedPreview.classList.remove("active");
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
    renderPreview("");
    state.targetText = "";
    state.units = [];
    state.unitResults = [];
    state.unitInputs = [];
    state.displaySegments = [];
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
  state.displaySegments = buildDisplaySegments(result.sample);
  resetRun();
  resetButton.disabled = false;
  focusInputSurface();
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
  const source = demoSources[demoIndex % demoSources.length];
  demoIndex += 1;
  latexInput.value = source;
  buildTestFromInput(source);
});

knuthButton.addEventListener("click", () => {
  setKnuthMode(!state.knuthMode);
});

resetButton.addEventListener("click", () => {
  resetRun();
  if (state.targetText) {
    focusInputSurface();
  }
});

targetText.addEventListener("click", () => {
  if (state.targetText && !state.finished) {
    focusInputSurface();
  }
});

renderedPreview.addEventListener("click", () => {
  if (state.targetText && !state.finished) {
    focusInputSurface();
  }
});

function handleTypingKeydown(event) {
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
}

targetText.addEventListener("keydown", handleTypingKeydown);
renderedPreview.addEventListener("keydown", handleTypingKeydown);

const initialDemo = demoSources[demoIndex % demoSources.length];
demoIndex += 1;
latexInput.value = initialDemo;
buildTestFromInput(initialDemo);
setKnuthMode(false);
