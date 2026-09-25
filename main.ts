import {
    analyseCharsPerLine,
    analyseLineStarts,
    analyseCursorPosition,
    analyseLineText,
    analyseWrappedLineCount,
    analyseCursorWrappedHeight,
    analyseWrappedRow
} from "./analyse";

const editor = document.querySelector<HTMLDivElement>("#editor")!;
const editorArea =
    document.querySelector<HTMLDivElement>("#editor-area")!;
const displayLayer = document.querySelector<HTMLDivElement>("#display-layer")!;
const cloneLayer = editor.cloneNode(true) as HTMLDivElement;
cloneLayer.id = "clone-layer";
editorArea.appendChild(cloneLayer);
const outline = document.querySelector<HTMLDivElement>("#outline")!;
const currentLine = document.querySelector<HTMLDivElement>("#current-line")!;
const fileName = document.querySelector<HTMLSpanElement>("#file-name")!;
const newButton = document.querySelector<HTMLButtonElement>("#new-button")!;
const openButton = document.querySelector<HTMLButtonElement>("#open-button")!;
const saveButton = document.querySelector<HTMLButtonElement>("#save-button")!;
const APP_VERSION = "0.1.0";

/* ==========================================================
   EditContext
   ========================================================== */

const EditContextConstructor = (
    window as Window & {
        EditContext?: new (options?: {
            text?: string;
            selectionStart?: number;
            selectionEnd?: number;
        }) => any;
    }
).EditContext;

if (!EditContextConstructor) {
    throw new Error("EditContext is not supported by this browser.");
}

const editContext: any = new EditContextConstructor({
    text: "",
    selectionStart: 0,
    selectionEnd: 0
});

(editor as any).editContext = editContext;

/* ==========================================================
   EditContext と DOM Selection の同期
   ========================================================== */

function setDomSelection(start: number, end: number): void {
    const selection = document.getSelection();
    const textNode = editor.firstChild;

    if (!selection || !textNode || textNode.nodeType !== Node.TEXT_NODE) {
        return;
    }

    const length = textNode.textContent?.length ?? 0;

    start = Math.max(0, Math.min(start, length));
    end = Math.max(0, Math.min(end, length));

    selection.setBaseAndExtent(
        textNode,
        start,
        textNode,
        end
    );
}

function getDomSelectionOffsets(): { start: number; end: number } | null {
    const selection = document.getSelection();

    if (!selection || selection.rangeCount === 0) {
        return null;
    }

    const range = selection.getRangeAt(0);

    if (!editor.contains(range.startContainer)) {
        return null;
    }

    if (!editor.contains(range.endContainer)) {
        return null;
    }

    const textNode = editor.firstChild;

    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
        return null;
    }

    if (
        range.startContainer !== textNode ||
        range.endContainer !== textNode
    ) {
        return null;
    }

    return {
        start: range.startOffset,
        end: range.endOffset
    };
}

let currentCaretRect: DOMRect | null = null;

function updateSelectionBounds(): void {
    const selection = document.getSelection();

    if (!selection || selection.rangeCount === 0) {
        currentCaretRect = null;
        return;
    }

    const range = selection.getRangeAt(0);

    if (!editor.contains(range.startContainer)) {
        currentCaretRect = null;
        return;
    }

    /* EditContextへは従来どおりSelection全体を渡す。 */
    editContext.updateSelectionBounds(
        range.getBoundingClientRect()
    );

    currentCaretRect = null;

    /*
     * 現在行の位置は、カーソル位置から折り返しを計算しない。
     * カーソルが属する表示文字の実際の矩形をブラウザから取得する。
     */
    if (!selection.isCollapsed) {
        const rects = range.getClientRects();
        currentCaretRect = rects.length > 0 ? rects[0] : null;
        return;
    }

    const textNode = editor.firstChild;

    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
        return;
    }

    const text = textNode.textContent ?? "";
    const cursor = range.startOffset;

    if (text.length === 0) {
        currentCaretRect = range.getBoundingClientRect();
        return;
    }

    let index = cursor;

    /*
     * 通常はカーソル直後の文字を使う。
     * カーソルが改行コードの直前なら、直前の文字を使う。
     * 文末なら直前の文字を使う。
     */
    if (index < text.length && text[index] === "\n") {
        if (index > 0) {
            index--;
        } else {
            currentCaretRect = range.getBoundingClientRect();
            return;
        }
    } else if (index >= text.length) {
        index = text.length - 1;
    }

    if (text[index] === "\n") {
        currentCaretRect = range.getBoundingClientRect();
        return;
    }

    const characterRange = document.createRange();
    characterRange.setStart(textNode, index);
    characterRange.setEnd(textNode, index + 1);

    currentCaretRect = characterRange.getBoundingClientRect();
}

function keepCaretVisible(): void {
    const visualLine = getCurrentVisualLine();

    const style = getComputedStyle(editor);
    const lineHeight = parseFloat(style.lineHeight);
    const paddingTop = parseFloat(style.paddingTop);
    const paddingBottom = parseFloat(style.paddingBottom);

    /*
     * カーソル位置はDOMの文字矩形ではなく、
     * 既存の表示行計算を使う。
     * これにより空行も1表示行として扱える。
     */
    const caretTop =
        paddingTop +
        visualLine * lineHeight;

    const caretBottom =
        caretTop +
        lineHeight;

    const topLimit =
        editorArea.scrollTop + paddingTop;

    /*
     * 下から3行目を追従位置にする。
     */
    const bottomLimit =
        editorArea.scrollTop +
        editorArea.clientHeight -
        paddingBottom -
        lineHeight;

    if (caretTop < topLimit) {
        editorArea.scrollTop = Math.max(
            0,
            caretTop - paddingTop
        );
        return;
    }

    if (caretBottom > bottomLimit) {
        const maxScrollTop =
            Math.max(
                0,
                editorArea.scrollHeight -
                editorArea.clientHeight
            );

        editorArea.scrollTop = Math.min(
            maxScrollTop,
            caretBottom -
            (editorArea.clientHeight -
                paddingBottom -
                lineHeight)
        );
    }
}

function updateControlBounds(): void {
    editContext.updateControlBounds(
        editor.getBoundingClientRect()
    );
}

function setEditorSelection(start: number, end: number): void {
    const length = editContext.text.length;

    start = Math.max(0, Math.min(start, length));
    end = Math.max(0, Math.min(end, length));

    editContext.updateSelection(start, end);
    setDomSelection(start, end);
    updateSelectionBounds();
}

function getEditorText(): string {
    return editContext.text;
}

function setEditorText(text: string): void {
    editContext.updateText(
        0,
        editContext.text.length,
        text
    );

    editContext.updateSelection(0, 0);
    renderEditorText();
}

function getEditorSelectionStart(): number {
    return editContext.selectionStart;
}

function getEditorSelectionEnd(): number {
    return editContext.selectionEnd;
}

/* ==========================================================
   EditContext の本文を DOM に描画
   ========================================================== */

function renderEditorText(): void {
    editor.replaceChildren(
        document.createTextNode(editContext.text)
    );

    //ここから見出し用レイヤーの描画。見出しは赤、それ以外は透明に
    cloneLayer.innerHTML = "";

    const lines = editContext.text.split("\n");

    for (const line of lines) {
        const span = document.createElement("span");

        span.textContent = line;

        const headingMatch = line.match(/^(#{1,6}) /);

        if (headingMatch) {
            const level = headingMatch[1].length;
            span.className = `heading-level-${level}`;
        } else {
            span.className = "heading-normal";
        }

        cloneLayer.appendChild(span);
        cloneLayer.appendChild(document.createTextNode("\n"));
    }

    const headings = [...cloneLayer.children].filter(
        el => /^#{1,6} /.test(el.textContent ?? "")
    );

    // 一時的テスト挿入
    console.log(
        headings.slice(-5).map(el => ({
            text: el.textContent,
            top: el.getBoundingClientRect().top
        }))
    );

    setDomSelection(
        editContext.selectionStart,
        editContext.selectionEnd
    );

    updateControlBounds();
    updateSelectionBounds();
}

/* ==========================================================
   状態
   ========================================================== */

let currentFileName = "no_title.txt";
let isModified = false;
let lineStarts = analyseLineStarts(getEditorText());
let wrappedLineCounts: number[] = [];
let visualLineStarts: number[] = [];
let charsPerLine = 0;
let editorWidth = 0;
let currentVisualLine = 0;
let highlightVisible = true;
let wheelTimer: number | null = null;
let lastEditorWidth = 0;
let lastValue = getEditorText();
let lastCursor = 0;
let renderedStartLine = 0;
let renderedEndLine = -1;

function updateFileName(): void {
    fileName.textContent = currentFileName + (isModified ? "*" : "");
}

function updateEditorMetrics(): void {
    editorWidth = editor.clientWidth;
    charsPerLine = analyseCharsPerLine(editor);

    console.log("=== WIDTH CHECK ===");
    console.log("editor width:", editorWidth);
    console.log("chars per line:", charsPerLine);
}

function updateLayoutMetrics(): void {
    const style = getComputedStyle(editor);
    const displayStyle = getComputedStyle(displayLayer);

    const editorContentWidth =
        editor.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight);

    const displayContentWidth =
        displayLayer.clientWidth -
        parseFloat(displayStyle.paddingLeft) -
        parseFloat(displayStyle.paddingRight);

    console.log("=== LAYOUT CHECK ===");
    console.log("editor content width:", editorContentWidth);
    console.log("display content width:", displayContentWidth);
    console.log("editor padding:", style.padding);
    console.log("display padding:", displayStyle.padding);
    console.log("editor box-sizing:", style.boxSizing);
    console.log("display box-sizing:", displayStyle.boxSizing);
}

function rebuildVisualLineIndex(): void {
    const t0 = performance.now();

    const lines = getEditorText().split("\n");

    const t1 = performance.now();

    wrappedLineCounts = new Array(lines.length);
    visualLineStarts = new Array(lines.length);

    let visualLine = 0;

    const t2 = performance.now();

    let analyseTotal = 0;
    let analyseMax = 0;
    let analyseMaxLine = -1;

    for (let i = 0; i < lines.length; i++) {
        visualLineStarts[i] = visualLine;

        const t = performance.now();

        wrappedLineCounts[i] = analyseWrappedLineCount(lines[i], editor);

        const elapsed = performance.now() - t;

        analyseTotal += elapsed;

        if (elapsed > analyseMax) {
            analyseMax = elapsed;
            analyseMaxLine = i;
        }

        visualLine += wrappedLineCounts[i];
    }

    const t3 = performance.now();

    console.log(
        "=== rebuildVisualLineIndex TIMING ===",
        "split:", (t1 - t0).toFixed(2), "ms",
        "array init:", (t2 - t1).toFixed(2), "ms",
        "loop:", (t3 - t2).toFixed(2), "ms",
        "TOTAL:", (t3 - t0).toFixed(2), "ms",
        "lines:", lines.length
    );

    console.log(
        "analyseWrappedLineCount:",
        "TOTAL", analyseTotal.toFixed(2), "ms",
        "MAX", analyseMax.toFixed(2), "ms",
        "MAX LINE", analyseMaxLine
    );

    console.log("=== VISUAL LINE CHECK ===");
    console.log("font size:", getComputedStyle(editor).fontSize);
    console.log("line height:", getComputedStyle(editor).lineHeight);
    console.log("wrappedLineCounts:", wrappedLineCounts.slice(340, 350));
    console.log("visualLineStarts:", visualLineStarts.slice(340, 350));
    console.log("=== VISUAL LINE DETAIL ===");

    wrappedLineCounts.forEach((count, i) => {
        if (count > 1) {
            console.log({
                logicalLine: i,
                wrappedLines: count,
                visualStart: visualLineStarts[i],
                text: analyseLineText(
                    getEditorText(),
                    i,
                    lineStarts
                )
            });
        }
    });
}

function updateVisualLineIndexForCurrentLine(line: number): void {
    if (line < 0 || line >= lineStarts.length) return;

    if (wrappedLineCounts.length !== lineStarts.length) {
        rebuildVisualLineIndex();
        return;
    }

    const newCount = analyseWrappedLineCount(
        analyseLineText(getEditorText(), line, lineStarts),
        editor
    );

    const oldCount = wrappedLineCounts[line] ?? 1;
    const delta = newCount - oldCount;

    wrappedLineCounts[line] = newCount;

    if (delta === 0) return;

    for (let i = line + 1; i < visualLineStarts.length; i++) {
        visualLineStarts[i] += delta;
    }
}

function findLineAtVisualLine(target: number): number {
    if (visualLineStarts.length === 0) return 0;

    let low = 0;
    let high = visualLineStarts.length - 1;
    let answer = 0;

    while (low <= high) {
        const mid = Math.floor((low + high) / 2);

        if (visualLineStarts[mid] <= target) {
            answer = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    return answer;
}

function renderDisplayLayer(): void {
    const editorStyle = getComputedStyle(editor);

    displayLayer.style.paddingRight =
        `${parseFloat(editorStyle.paddingRight)}px`;

    const style = editorStyle;
    const lineHeight = parseFloat(style.lineHeight);
    const paddingTop = parseFloat(style.paddingTop);
    const paddingBottom = parseFloat(style.paddingBottom);
    const totalVisualLines =
        wrappedLineCounts.reduce((sum, count) => sum + count, 0);

    const scrollTop = editorArea.scrollTop;
    const viewHeight = editorArea.clientHeight;
    const buffer = Math.max(viewHeight * 2, lineHeight * 8);

    const firstVisual = Math.max(
        0,
        Math.floor((scrollTop - buffer - paddingTop) / lineHeight)
    );

    const lastVisual = Math.max(
        firstVisual,
        Math.ceil(
            (scrollTop + viewHeight + buffer - paddingTop) /
            lineHeight
        )
    );

    const startLine = findLineAtVisualLine(firstVisual);
    const endLine = Math.min(
        lineStarts.length - 1,
        findLineAtVisualLine(
            Math.min(totalVisualLines - 1, lastVisual)
        ) + 1
    );

    renderedStartLine = startLine;
    renderedEndLine = endLine;

    displayLayer.innerHTML = "";

    const spacer = document.createElement("div");
    spacer.style.height =
        `${visualLineStarts[startLine] * lineHeight}px`;
    displayLayer.appendChild(spacer);

    for (let i = startLine; i <= endLine; i++) {
        const line = analyseLineText(
            getEditorText(),
            i,
            lineStarts
        );

        const span = document.createElement("span");
        span.textContent = line;

        /* span.style.color = /^#{1,6} /.test(line) ? "red" : "transparent"; */

        displayLayer.appendChild(span);

        if (i < endLine) {
            displayLayer.appendChild(
                document.createTextNode("\n")
            );
        }
    }

    displayLayer.style.height =
        Math.max(
            editorArea.scrollHeight,
            editorArea.clientHeight,
            paddingTop +
            totalVisualLines * lineHeight +
            paddingBottom
        ) + "px";
}

function updateOutline(): void {
    const lines = getEditorText().split("\n");
    outline.innerHTML = "";

    lines.forEach((line, index) => {
        const match = line.match(/^(#{1,6}) (.*)$/);
        if (!match) return;

        const item = document.createElement("div");
        item.className = "outline-item";
        item.textContent = "▼ " + match[2];
        item.style.paddingLeft = `${(match[1].length - 1) * 10}px`;
        item.dataset.line = String(index);
        item.addEventListener("click", () => jumpToOutlineLine(index));
        outline.appendChild(item);
    });

    updateCurrentHeading();
}

function updateCurrentHeading(): void {
    const currentLineNumber = analyseCursorPosition(
        getEditorSelectionStart(),
        lineStarts
    ).line;

    const items = outline.querySelectorAll<HTMLDivElement>(".outline-item");
    let activeIndex = -1;

    items.forEach((item, index) => {
        const line = Number(item.dataset.line);
        item.classList.remove("active");
        if (line <= currentLineNumber) activeIndex = index;
    });

    if (activeIndex >= 0) {
        items[activeIndex].classList.add("active");
    }
}

function getCurrentVisualLine(): number {
    const position = analyseCursorPosition(
        getEditorSelectionStart(),
        lineStarts
    );

    const lineText = analyseLineText(
        getEditorText(),
        position.line,
        lineStarts
    );

    /*
     * 空行ではDOMのcaret矩形を使わない。
     * 空行は visualLineStarts に1行として
     * すでに登録されているので、その位置をそのまま使う。
     */
    /*　空行対策
    if (lineText.length === 0) {
        return visualLineStarts[position.line] ?? 0;
    } */
    if (lineText.length === 0) {
        const textNode = editor.firstChild;

        if (textNode && textNode.nodeType === Node.TEXT_NODE) {
            const cursor = getEditorSelectionStart();

            if (cursor > 0) {
                const range = document.createRange();

                range.setStart(textNode, cursor - 1);
                range.setEnd(textNode, cursor);

                const rect = range.getBoundingClientRect();
                const areaRect = editorArea.getBoundingClientRect();
                const lineHeight =
                    parseFloat(getComputedStyle(editor).lineHeight);

                if (lineHeight > 0 && rect.height > 0) {
                    const contentTop =
                        rect.top -
                        areaRect.top +
                        editorArea.scrollTop -
                        parseFloat(getComputedStyle(editor).paddingTop);

                    return Math.max(
                        0,
                        Math.round(contentTop / lineHeight)
                    ) + 1;
                }
            }
        }

        return visualLineStarts[position.line] ?? 0;
    }

    /*
     * 文字がある行では、実際のDOM上の文字矩形を使う。
     * 自動折り返し2行目の1文字目も、
     * その文字の実位置から取得できる。
     */
    if (currentCaretRect) {
        const areaRect =
            editorArea.getBoundingClientRect();

        const lineHeight =
            parseFloat(
                getComputedStyle(editor).lineHeight
            );

        if (lineHeight > 0) {
            const contentTop =
                currentCaretRect.top -
                areaRect.top +
                editorArea.scrollTop -
                parseFloat(
                    getComputedStyle(editor).paddingTop
                );

            return Math.max(
                0,
                Math.round(
                    contentTop / lineHeight
                )
            );
        }
    }

    /*
     * DOM矩形が取得できない場合の従来計算。
     */
    const height =
        analyseCursorWrappedHeight(
            lineText,
            position.x,
            editor
        );

    const lineHeight =
        parseFloat(
            getComputedStyle(editor).lineHeight
        );

    const wrappedRow =
        analyseWrappedRow(
            height,
            lineHeight
        );

    return (
        (visualLineStarts[position.line] ?? 0) +
        wrappedRow
    );
}

function isCursorOnScreen(visualLine: number): boolean {
    const style = getComputedStyle(editor);
    const lineHeight = parseFloat(style.lineHeight);
    const paddingTop = parseFloat(style.paddingTop);
    const top = paddingTop + visualLine * lineHeight;
    const bottom = top + lineHeight;

    return (
        bottom > editorArea.scrollTop &&
        top < editorArea.scrollTop + editor.clientHeight
    );
}

function updateCurrentLine(): void {
    if (!highlightVisible) {
        currentLine.style.display = "none";
        return;
    }

    const style =
        getComputedStyle(editor);

    const lineHeight =
        parseFloat(style.lineHeight);

    const paddingTop =
        parseFloat(style.paddingTop);

    const visualLine =
        getCurrentVisualLine();

    if (currentCaretRect) {
        const areaRect =
            editorArea.getBoundingClientRect();

        const top =
            currentCaretRect.top -
            areaRect.top +
            editorArea.scrollTop - 5;

        currentLine.style.top = `${top}px`;
    } else {
        currentLine.style.top =
            `${paddingTop + visualLine * lineHeight}px`;
    }

    console.log(
        "DRAW CURRENT LINE:",
        "display=", currentLine.style.display,
        "top=", currentLine.style.top,
        "rect=", currentLine.getBoundingClientRect()
    );
}

function showCurrentLineIfVisible(): void {
    updateSelectionBounds();

    const style =
        getComputedStyle(editor);

    const lineHeight =
        parseFloat(style.lineHeight);

    const paddingTop =
        parseFloat(style.paddingTop);


    const visualLine =
        getCurrentVisualLine();

    const lineTop =
        paddingTop +
        visualLine * lineHeight;

    const lineBottom =
        lineTop + lineHeight;

    console.log(
        "CURRENT LINE:",
        "visualLine=", visualLine,
        "scrollTop=", editorArea.scrollTop,
        "clientHeight=", editorArea.clientHeight,
        "lineTop=", lineTop
    );

    if (
        lineBottom <= editorArea.scrollTop ||
        lineTop >= editorArea.scrollTop + editorArea.clientHeight
    ) {
        console.log("★ highlightVisible FALSE: showCurrentLineIfVisible");
        highlightVisible = false;
        currentLine.style.display = "none";
        return;
    }

    highlightVisible = true;
    updateCurrentLine();
}

function hideCurrentLine(): void {
    console.log("★ highlightVisible FALSE: hideCurrentLine");
    highlightVisible = false;
    currentLine.style.display = "none";
}

function logCursorAnalysis(): void {
    const cursor = getEditorSelectionStart();
    const position = analyseCursorPosition(cursor, lineStarts);
    const currentLineText = analyseLineText(
        getEditorText(),
        position.line,
        lineStarts
    );

    const wrappedLineCount = analyseWrappedLineCount(
        currentLineText,
        editor
    );

    const cursorWrappedHeight = analyseCursorWrappedHeight(
        currentLineText,
        position.x,
        editor
    );

    const lineHeight = parseFloat(getComputedStyle(editor).lineHeight);
    const cursorWrappedRow = analyseWrappedRow(
        cursorWrappedHeight,
        lineHeight
    );

    console.log("カーソル位置:", cursor);
    console.log("cursor logical line:", position.line);
    console.log("cursor x:", position.x);
    console.log("current logical line text:", currentLineText);
    console.log("current logical line wrapped lines:", wrappedLineCount);
    console.log("cursor wrapped height:", cursorWrappedHeight);
    console.log("cursor wrapped row:", cursorWrappedRow);
}

function updateAll(): void {
    renderEditorText();
    updateEditorMetrics();
    updateLayoutMetrics();
    lineStarts = analyseLineStarts(getEditorText());
    rebuildVisualLineIndex();
    renderDisplayLayer();
    updateOutline();
    showCurrentLineIfVisible();
    keepCaretVisible();
}

function createNewFile(): void {
    setEditorText("");
    currentFileName = "no_title.txt";
    isModified = false;
    lineStarts = analyseLineStarts(getEditorText());
    wrappedLineCounts = [1];
    visualLineStarts = [0];
    updateFileName();
    updateAll();
    editor.focus();
    setEditorSelection(0, 0);
    lastValue = getEditorText();
    lastCursor = 0;
    console.log("NEW FILE");
}

function saveFile(): boolean {
    if (currentFileName === "no_title.txt") return saveFileAs();

    const blob = new Blob(
        [getEditorText()],
        { type: "text/plain;charset=utf-8" }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = currentFileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    isModified = false;
    updateFileName();
    console.log("SAVED:", currentFileName);
    return true;
}

function saveFileAs(): boolean {
    const name = prompt(
        "ファイル名を入力してください",
        currentFileName === "no_title.txt"
            ? "untitled.txt"
            : currentFileName
    );

    if (name === null || name.trim() === "") return false;

    currentFileName = name.trim();

    const blob = new Blob(
        [getEditorText()],
        { type: "text/plain;charset=utf-8" }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = currentFileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    isModified = false;
    updateFileName();
    console.log("SAVED AS:", currentFileName);
    return true;
}

// クローン赤文字画面のスクロール同期
editorArea.addEventListener("scroll", () => {
    console.log(
        "editorArea:",
        editorArea.scrollTop,
        "clone:",
        cloneLayer.getBoundingClientRect().top,
        "editorAreaRect:",
        editorArea.getBoundingClientRect().top
    );
});

newButton.addEventListener("click", () => {
    if (!isModified) {
        createNewFile();
        return;
    }

    if (confirm("ファイルが未保存です。\n保存しますか？")) {
        if (!saveFile()) {
            if (!confirm("保存されませんでした。\n変更を破棄して新規作成しますか？")) {
                return;
            }
        }
    } else if (!confirm("変更を破棄して\n新規作成しますか？")) {
        return;
    }

    createNewFile();
});

saveButton.addEventListener("click", () => saveFile());

openButton.addEventListener("click", () => {
    if (
        isModified &&
        !confirm("ファイルが未保存です。\n破棄してファイルを開きますか？")
    ) {
        return;
    }

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".txt,.md,text/plain,text/markdown";

    fileInput.addEventListener("change", async () => {
        const file = fileInput.files?.[0];
        if (!file) return;

        const text =
            (await file.text()).replace(/\r\n/g, "\n");

        editContext.updateText(
            0,
            editContext.text.length,
            text
        );

        editContext.updateSelection(0, 0);

        currentFileName = file.name;
        isModified = false;
        editorArea.scrollTop = 0;
        editorArea.scrollLeft = 0;
        lastValue = text;
        lastCursor = 0;

        renderEditorText();
        updateFileName();
        updateAll();

        console.log("=== ANALYSE (OPEN) ===");
        console.log("line starts:", lineStarts);
        console.log("logical line count:", lineStarts.length);

        editor.focus();
        setEditorSelection(0, 0);
    });

    fileInput.click();
});


/* ==========================================================
   編集操作ボタン / Ctrl+X C V / フォント
   ========================================================== */

const copyButton =
    document.querySelector<HTMLButtonElement>("#copy-text");

const cutButton =
    document.querySelector<HTMLButtonElement>("#cut-text");

const pasteButton =
    document.querySelector<HTMLButtonElement>("#paste-text");

const font16Button =
    document.querySelector<HTMLButtonElement>("#font-16");

const font20Button =
    document.querySelector<HTMLButtonElement>("#font-20");

const font24Button =
    document.querySelector<HTMLButtonElement>("#font-24");

const helpButton =
    document.querySelector<HTMLButtonElement>("#help")!
        .addEventListener("click", () => {
            alert(`UME lite2\n\nVersion ${APP_VERSION}`);
        });

/*
 * メニューボタンを押してもエディタのSelectionを失わせない。
 */
document
    .querySelectorAll<HTMLButtonElement>("#menu-bar button, #menu button")
    .forEach((button) => {
        button.addEventListener("mousedown", (event) => {
            event.preventDefault();
        });
    });

function getSelectionRangeOffsets(): {
    start: number;
    end: number;
} {
    return {
        start: Math.min(
            getEditorSelectionStart(),
            getEditorSelectionEnd()
        ),
        end: Math.max(
            getEditorSelectionStart(),
            getEditorSelectionEnd()
        )
    };
}

function getSelectedText(): string {
    const { start, end } = getSelectionRangeOffsets();
    return getEditorText().slice(start, end);
}

function replaceCurrentSelection(text: string): void {
    const { start, end } = getSelectionRangeOffsets();

    editContext.updateText(
        start,
        end,
        text
    );

    editContext.updateSelection(
        start + text.length,
        start + text.length
    );

    isModified = true;
    updateFileName();

    renderEditorText();
    updateAll();

    editor.focus();

    lastValue = getEditorText();
    lastCursor = getEditorSelectionStart();
}

async function copySelection(): Promise<void> {
    const { start, end } = getSelectionRangeOffsets();

    if (start === end) {
        return;
    }

    await navigator.clipboard.writeText(
        getEditorText().slice(start, end)
    );
}

async function cutSelection(): Promise<void> {
    const { start, end } = getSelectionRangeOffsets();

    if (start === end) {
        return;
    }

    await navigator.clipboard.writeText(
        getEditorText().slice(start, end)
    );

    replaceCurrentSelection("");
}

async function pasteText(): Promise<void> {
    const text = await navigator.clipboard.readText();

    if (text.length === 0) {
        return;
    }

    replaceCurrentSelection(
        text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
    );
}

copyButton?.addEventListener("click", () => {
    void copySelection();
});

cutButton?.addEventListener("click", () => {
    void cutSelection();
});

pasteButton?.addEventListener("click", () => {
    void pasteText();
});

function setEditorFontSize(size: number): void {
    document.documentElement.style.setProperty(
        "--editor-font-size",
        `${size}px`
    );

    document.documentElement.style.setProperty(
        "--editor-line-height",
        `${size * 1.6}px`
    );

    updateAll();
    editor.focus();
}

font16Button?.addEventListener("click", () => {
    setEditorFontSize(16);
});

font20Button?.addEventListener("click", () => {
    setEditorFontSize(20);
});

font24Button?.addEventListener("click", () => {
    setEditorFontSize(24);
});



document.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.isComposing) {
        return;
    }

    if (!(event.ctrlKey || event.metaKey)) {
        return;
    }

    switch (event.key.toLowerCase()) {
        case "c":
            event.preventDefault();
            void copySelection();
            break;

        case "x":
            event.preventDefault();
            void cutSelection();
            break;

        case "v":
            event.preventDefault();
            void pasteText();
            break;
    }
});

/* ==========================================================
   EditContext IME
   ========================================================== */

editContext.addEventListener("compositionstart", (event: CompositionEvent) => {
    console.log(
        "EDITCONTEXT compositionstart:",
        event.data
    );
});

editContext.addEventListener("compositionend", (event: CompositionEvent) => {
    console.log(
        "EDITCONTEXT compositionend:",
        event.data
    );

    requestAnimationFrame(() => {
        keepCaretVisible();
    });
});

editContext.addEventListener("textupdate", (event: any) => {
    const inputTime = performance.now();

    if (
        (window as any).__lastInputTime !== undefined
    ) {
        console.log(
            "EDITCONTEXT TEXTUPDATE:",
            inputTime.toFixed(2),
            "interval:",
            (
                inputTime -
                (window as any).__lastInputTime
            ).toFixed(2),
            "ms",
            "range:",
            event.updateRangeStart,
            event.updateRangeEnd,
            "text:",
            JSON.stringify(event.text),
            "selection:",
            event.selectionStart,
            event.selectionEnd
        );
    } else {
        console.log(
            "EDITCONTEXT TEXTUPDATE:",
            inputTime.toFixed(2),
            "interval: ---",
            "range:",
            event.updateRangeStart,
            event.updateRangeEnd,
            "text:",
            JSON.stringify(event.text),
            "selection:",
            event.selectionStart,
            event.selectionEnd
        );
    }

    (window as any).__lastInputTime = inputTime;

    const oldLineStarts = lineStarts;
    const oldLine =
        analyseCursorPosition(lastCursor, oldLineStarts).line;
    const oldLineCount = oldLineStarts.length;

    isModified = true;
    updateFileName();

    lineStarts = analyseLineStarts(getEditorText());

    const t0 = performance.now();

    if (lineStarts.length !== oldLineCount) {
        rebuildVisualLineIndex();
        renderDisplayLayer();
        updateOutline();
    } else {
        const m0 = performance.now();

        updateVisualLineIndexForCurrentLine(oldLine);

        const m1 = performance.now();

        const currentLineNumber = analyseCursorPosition(
            getEditorSelectionStart(),
            lineStarts
        ).line;

        const m2 = performance.now();

        if (
            currentLineNumber === renderedStartLine ||
            currentLineNumber === renderedEndLine ||
            (
                currentLineNumber >= renderedStartLine &&
                currentLineNumber <= renderedEndLine
            )
        ) {
            renderDisplayLayer();
        }

        const m3 = performance.now();

        const oldText = analyseLineText(
            lastValue,
            oldLine,
            oldLineStarts
        );

        const newText = analyseLineText(
            getEditorText(),
            currentLineNumber,
            lineStarts
        );

        const m4 = performance.now();

        if (
            oldText !== newText &&
            (
                /^#{1,6} /.test(oldText) ||
                /^#{1,6} /.test(newText)
            )
        ) {
            updateOutline();
        }

        const m5 = performance.now();

        console.log(
            "textupdate: updateVisualLineIndexForCurrentLine:",
            (m1 - m0).toFixed(2),
            "ms"
        );
        console.log(
            "textupdate: analyseCursorPosition:",
            (m2 - m1).toFixed(2),
            "ms"
        );
        console.log(
            "textupdate: renderDisplayLayer:",
            (m3 - m2).toFixed(2),
            "ms"
        );
        console.log(
            "textupdate: analyseLineText:",
            (m4 - m3).toFixed(2),
            "ms"
        );
        console.log(
            "textupdate: updateOutline:",
            (m5 - m4).toFixed(2),
            "ms"
        );
    }

    const t1 = performance.now();

    console.log(
        "textupdate main processing:",
        (t1 - t0).toFixed(2),
        "ms"
    );

    /*
     * EditContext自身が更新した本文とselectionを
     * 画面へ反映する。
     */
    renderEditorText();
    keepCaretVisible();

    const t2 = performance.now();

    updateCurrentHeading();
    showCurrentLineIfVisible();
    keepCaretVisible();

    lastValue = getEditorText();
    lastCursor = getEditorSelectionStart();

    const t3 = performance.now();

    console.log(
        "textupdate render:",
        (t2 - t1).toFixed(2),
        "ms"
    );
    console.log(
        "textupdate current line:",
        (t3 - t2).toFixed(2),
        "ms"
    );
    console.log(
        "textupdate TOTAL:",
        (t3 - t0).toFixed(2),
        "ms"
    );
});

editContext.addEventListener("textformatupdate", (event: any) => {
    console.log(
        "EDITCONTEXT textformatupdate:",
        event.getTextFormats?.() ?? event
    );
});

editContext.addEventListener("characterboundsupdate", (event: any) => {
    const textNode = editor.firstChild;

    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
        return;
    }

    const bounds: DOMRect[] = [];

    for (
        let i = event.rangeStart;
        i < event.rangeEnd && i < textNode.textContent!.length;
        i++
    ) {
        const range = document.createRange();

        range.setStart(textNode, i);
        range.setEnd(textNode, i + 1);

        bounds.push(
            range.getBoundingClientRect()
        );
    }

    if (bounds.length > 0) {
        editContext.updateCharacterBounds(
            event.rangeStart,
            bounds
        );
    }
});

/* ==========================================================
   Enter / Tab
   ========================================================== */

editor.addEventListener("keydown", (event: KeyboardEvent) => {
    const start = Math.min(
        getEditorSelectionStart(),
        getEditorSelectionEnd()
    );

    const end = Math.max(
        getEditorSelectionStart(),
        getEditorSelectionEnd()
    );

    if (event.key === "Enter") {
        event.preventDefault();

        editContext.updateText(
            start,
            end,
            "\n"
        );

        editContext.updateSelection(
            start + 1,
            start + 1
        );

        isModified = true;
        updateFileName();
        renderEditorText();
        updateAll();
        editor.focus();

        lastValue = getEditorText();
        lastCursor = getEditorSelectionStart();

        console.log("EDITCONTEXT Enter");

        return;
    }

    if (event.key === "Tab") {
        event.preventDefault();

        editContext.updateText(
            start,
            end,
            "\t"
        );

        editContext.updateSelection(
            start + 1,
            start + 1
        );

        isModified = true;
        updateFileName();
        renderEditorText();
        updateAll();
        editor.focus();

        lastValue = getEditorText();
        lastCursor = getEditorSelectionStart();

        console.log("EDITCONTEXT Tab");
    }
});


/* ==========================================================
   Selection change
   ========================================================== */

document.addEventListener("selectionchange", () => {
    const offsets = getDomSelectionOffsets();

    if (!offsets) {
        return;
    }

    editContext.updateSelection(
        offsets.start,
        offsets.end
    );

    updateSelectionBounds();
    keepCaretVisible();

    updateCurrentHeading();
    showCurrentLineIfVisible();

    lastCursor = editContext.selectionStart;
});

/* ==========================================================
   クリック
   ========================================================== */

editor.addEventListener("click", () => {

    updateCurrentHeading();

    showCurrentLineIfVisible();

    highlightVisible = true;
    currentLine.style.display = "block";
    updateCurrentLine();

    logCursorAnalysis();

    lastCursor = getEditorSelectionStart();

});

/* ==========================================================
   ホイール
   ========================================================== */

editor.addEventListener("wheel", () => {
    hideCurrentLine();

    if (wheelTimer !== null) {
        window.clearTimeout(wheelTimer);
    }

    wheelTimer = window.setTimeout(() => {
        wheelTimer = null;
        showCurrentLineIfVisible();
    }, 100);
}, { passive: true });

/* ==========================================================
   スクロール
   ========================================================== */

editorArea.addEventListener("scroll", () => {
    const style = getComputedStyle(editor);
    const lineHeight = parseFloat(style.lineHeight);
    const paddingTop = parseFloat(style.paddingTop);
    const buffer = Math.max(
        editorArea.clientHeight * 2,
        lineHeight * 8
    );

    const firstVisual = Math.max(
        0,
        Math.floor(
            (editorArea.scrollTop - buffer - paddingTop) /
            lineHeight
        )
    );

    const lastVisual = Math.max(
        firstVisual,
        Math.ceil(
            (
                editorArea.scrollTop +
                editorArea.clientHeight +
                buffer -
                paddingTop
            ) / lineHeight
        )
    );

    const renderedStartVisual =
        visualLineStarts[renderedStartLine] ?? 0;

    const renderedEndVisual =
        renderedEndLine >= 0 &&
            renderedEndLine < wrappedLineCounts.length
            ?
            (visualLineStarts[renderedEndLine] ?? 0) +
            (wrappedLineCounts[renderedEndLine] ?? 1)
            : 0;

    if (
        firstVisual < renderedStartVisual ||
        lastVisual > renderedEndVisual
    ) {
        renderDisplayLayer();
    }
    console.log(
        "SCROLL HIGHLIGHT",
        "scrollTop=", editorArea.scrollTop,
        "caret=", getEditorSelectionStart(),
        "visualLine=", getCurrentVisualLine()
    );

    showCurrentLineIfVisible();
});

/* ==========================================================
   ショートカット
   ========================================================== */

document.addEventListener("keydown", (event: KeyboardEvent) => {
    if (
        event.ctrlKey &&
        event.key.toLowerCase() === "s"
    ) {
        event.preventDefault();
        saveFile();
        return;
    }

    if (
        event.ctrlKey &&
        event.key.toLowerCase() === "o"
    ) {
        event.preventDefault();
        openButton.click();
        return;
    }

    if (
        event.ctrlKey &&
        event.key.toLowerCase() === "n"
    ) {
        event.preventDefault();
        newButton.click();
    }
});

/* ==========================================================
   アウトラインジャンプ
   ========================================================== */

function jumpToOutlineLine(line: number): void {
    if (line < 0 || line >= lineStarts.length) return;

    const position = lineStarts[line];
    const lineText = analyseLineText(
        getEditorText(),
        line,
        lineStarts
    );

    const targetPosition =
        position + lineText.length;

    editor.focus();
    setEditorSelection(
        targetPosition,
        targetPosition
    );

    const style = getComputedStyle(editor);

    const lineHeight =
        parseFloat(style.lineHeight);

    const paddingTop =
        parseFloat(style.paddingTop);

    /*
     * 見出しジャンプ先を
     * エディタ上端から5行目に置く。
     *
     * 1行目 = 0
     * 5行目 = 4
     */
    const targetTop =
        paddingTop +
        lineHeight * 4;

    if (currentCaretRect) {
        const areaRect =
            editorArea.getBoundingClientRect();

        const currentTop =
            currentCaretRect.top -
            areaRect.top;

        const newScrollTop =
            editorArea.scrollTop +
            currentTop -
            targetTop;

        const maxScrollTop =
            Math.max(
                0,
                editorArea.scrollHeight -
                editorArea.clientHeight
            );

        editorArea.scrollTop =
            Math.max(
                0,
                Math.min(
                    newScrollTop,
                    maxScrollTop
                )
            );
    }

    renderDisplayLayer();
    updateCurrentHeading();
    showCurrentLineIfVisible();
    logCursorAnalysis();
    lastCursor = getEditorSelectionStart();
}

/* ==========================================================
   Resize
   ========================================================== */

window.addEventListener("resize", () => {
    const container = document.getElementById("editor-container");
    if (container && window.visualViewport) {
        container.style.height = `${window.visualViewport.height}px`;
    }

    const width = editor.clientWidth;

    if (width === lastEditorWidth) return;

    lastEditorWidth = width;
    updateEditorMetrics();
    lineStarts = analyseLineStarts(getEditorText());
    rebuildVisualLineIndex();
    renderDisplayLayer();
    updateOutline();
    showCurrentLineIfVisible();
    logCursorAnalysis();
    updateControlBounds();
});

/* ==========================================================
   初期化
   ========================================================== */

renderEditorText();
updateFileName();
updateEditorMetrics();
lastEditorWidth = editor.clientWidth;
updateLayoutMetrics();
rebuildVisualLineIndex();
renderDisplayLayer();
updateOutline();
showCurrentLineIfVisible();

console.log("=== UME lite2 EditContext START ===");
console.log("file:", currentFileName);
console.log("editor width:", editorWidth);
console.log("chars per line:", charsPerLine);
console.log("line starts:", lineStarts);
console.log("logical line count:", lineStarts.length);
console.log("EditContext:", editContext);
